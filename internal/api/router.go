package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	mobyClient "github.com/moby/moby/client"
	"github.com/tomasweigenast/vps-pilot/internal/auth"
	"github.com/tomasweigenast/vps-pilot/internal/config"
	"github.com/tomasweigenast/vps-pilot/internal/docker"
	"github.com/tomasweigenast/vps-pilot/internal/files"
	"github.com/tomasweigenast/vps-pilot/internal/logbuffer"
	wslib "github.com/tomasweigenast/vps-pilot/internal/ws"
)

func NewRouter(
	db *sql.DB,
	cfg *config.Config,
	dockerManager *docker.Manager,
	logBuf *logbuffer.RingBuffer,
	secretsKey []byte,
	dockerClient *mobyClient.Client,
	browser *files.Browser,
	reloader *Reloader,
) http.Handler {
	r := chi.NewRouter()
	r.Use(requestIDMiddleware)
	r.Use(middleware.Recoverer)

	sm := auth.NewSessionManager(cfg.CookieSecret, cfg.SecureCookies)
	wsHub := wslib.NewHub()

	if browser == nil {
		root := cfg.FilesRootDir
		if root == "" {
			root = "/"
		}
		browser = files.NewBrowser(root)
	}

	ah := &authHandler{db: db, session: sm, authMode: cfg.AuthMode}
	if reloader != nil {
		reloader.AuthHandler = ah
	}
	sh := &systemHandler{wsHub: wsHub, dockerClient: dockerClient, db: db}
	dh := &dockerHandler{manager: dockerManager, database: db}
	fh := &filesHandler{browser: browser}
	lh := &logsHandler{buf: logBuf, database: db, logSink: cfg.LogSink}
	ph := &projectsHandler{manager: dockerManager, database: db}
	cfh := &containerFilesHandler{manager: dockerManager}
	audh := &auditHandler{database: db}
	seth := &setupHandler{database: db}
	uh := &usersHandler{database: db}
	rh := &rolesHandler{database: db}
	regh := &registriesHandler{database: db}
	wbh := &webhooksHandler{database: db, manager: dockerManager}
	sech := &secretsHandler{database: db, secretsKey: secretsKey}
	psech := &projectSecretsHandler{database: db}
	cth := &containersHandler{manager: dockerManager}
	nth := &notificationsHandler{database: db}
	bkh := &backupHandler{database: db, dataDir: cfg.DataDir, projectsDir: cfg.ProjectsDir}
	crnh := &cronHandler{}
	updh := &updateHandler{version: AppVersion}
	StartUpdateChecker(AppVersion)
	cfgh := &configAPIHandler{cfg: cfg, reloader: reloader}

	StartMetricsBroadcast(wsHub, 1*time.Second)

	// Setup routes (public, redirect-guarded)
	r.Use(setupRedirect(db))
	r.With(middleware.Compress(5)).Group(func(r chi.Router) {
		r.Get("/api/setup", seth.getSetup)
		r.Post("/api/setup", seth.postSetup)
	})

	// Public routes
	r.With(middleware.Compress(5)).Group(func(r chi.Router) {
		r.Post("/api/login", ah.login)
		r.Post("/api/logout", ah.logout)
	})

	// Public webhook trigger (no auth, no CSRF)
	// Token is the last path segment; project/service names are for readability only.
	r.Post("/webhooks/{project}/{token}", wbh.publicWebhookTrigger)
	r.Post("/webhooks/{project}/{service}/{token}", wbh.publicWebhookTrigger)

	// Authenticated JSON API routes
	r.With(middleware.Compress(5)).Group(func(r chi.Router) {
		r.Use(requireAuth(sm, db))

		r.Get("/api/me", ah.me)
		r.With(requireGlobalPermission(db, "view_dashboard")).Get("/api/metrics", sh.metricsJSON)
		r.With(requireGlobalPermission(db, "view_dashboard")).Get("/api/metrics/history", sh.metricsHistory)
		r.With(requireGlobalPermission(db, "view_dashboard")).Get("/api/system/info", sh.sysInfoJSON)

		r.Get("/api/projects", dh.apiListProjects)
		r.With(requireAdmin(db)).Post("/api/projects", ph.apiCreateProject)
		r.With(requirePermission(db, "view")).Get("/api/projects/{name}", ph.apiGetProject)
		r.With(requirePermission(db, "manage")).Put("/api/projects/{name}", ph.apiUpdateProject)
		r.With(requirePermission(db, "manage")).Delete("/api/projects/{name}", ph.deleteProject)
		r.With(requirePermission(db, "start")).Post("/api/projects/{name}/start", dh.apiStartProject)
		r.With(requirePermission(db, "stop")).Post("/api/projects/{name}/stop", dh.apiStopProject)
		r.With(requirePermission(db, "restart")).Post("/api/projects/{name}/restart", dh.apiRestartProject)
		r.With(requirePermission(db, "start")).Post("/api/projects/{name}/containers/{id}/{action}", dh.apiContainerAction)
		r.With(requirePermission(db, "files")).Get("/api/projects/{name}/files", ph.apiListProjectFiles)
		r.With(requirePermission(db, "files")).Put("/api/projects/{name}/files", ph.apiUpsertProjectFile)
		r.With(requirePermission(db, "files")).Delete("/api/projects/{name}/files/{filename}", ph.apiDeleteProjectFile)

		r.With(requireGlobalPermission(db, "view_files")).Get("/api/files", fh.apiList)
		r.With(requireGlobalPermission(db, "view_files")).Get("/api/files/content", fh.content)
		r.With(requireGlobalPermission(db, "edit_files")).Put("/api/files", fh.update)
		r.With(requireGlobalPermission(db, "edit_files")).Delete("/api/files", fh.delete)
		r.With(requireGlobalPermission(db, "view_files")).Get("/files/download", fh.download)

		r.With(requireGlobalPermission(db, "view_logs")).Get("/api/logs/history", lh.logsHistory)
		r.With(requireGlobalPermission(db, "view_audit")).Get("/api/audit", audh.list)

		r.With(requirePermission(db, "files")).Get("/api/projects/{name}/containers/{id}/files", cfh.listDir)
		r.With(requirePermission(db, "files")).Get("/api/projects/{name}/containers/{id}/files/download", cfh.downloadFile)

		r.With(requireAdmin(db)).Get("/api/networks", dh.apiListNetworks)
		r.With(requireAdmin(db)).Post("/api/networks", dh.apiCreateNetwork)
		r.With(requireAdmin(db)).Get("/api/networks/{networkID}", dh.apiGetNetwork)
		r.With(requireAdmin(db)).Delete("/api/networks/{networkID}", dh.apiDeleteNetwork)
		r.With(requireAdmin(db)).Post("/api/networks/{networkID}/connect", dh.apiConnectContainer)
		r.With(requireAdmin(db)).Post("/api/networks/{networkID}/disconnect", dh.apiDisconnectContainer)
		r.With(requireAdmin(db)).Get("/api/volumes", dh.apiListVolumes)
		r.With(requireAdmin(db)).Post("/api/volumes", dh.apiCreateVolume)
		r.With(requireAdmin(db)).Get("/api/volumes/{vol}", dh.apiGetVolume)
		r.With(requireAdmin(db)).Delete("/api/volumes/{vol}", dh.apiDeleteVolume)
		r.With(requireAdmin(db)).Get("/api/images", dh.apiListImages)
		r.With(requireAdmin(db)).Post("/api/images/build", dh.apiBuildImage)

		r.With(requirePermission(db, "view")).Get("/api/projects/{name}/networks", dh.apiListProjectNetworks)
		r.With(requirePermission(db, "view")).Get("/api/projects/{name}/networks/{networkID}", dh.apiGetProjectNetwork)
		r.With(requirePermission(db, "view")).Get("/api/projects/{name}/volumes", dh.apiListProjectVolumes)
		r.With(requirePermission(db, "view")).Get("/api/projects/{name}/volumes/{vol}", dh.apiGetProjectVolume)
		r.With(requirePermission(db, "view")).Get("/api/projects/{name}/images", dh.apiListProjectImages)
		r.With(requireAdmin(db)).Delete("/api/images/{id}", dh.apiDeleteImage)
		r.With(requirePermission(db, "view")).Get("/api/projects/{name}/containers/{id}/inspect", dh.apiInspectContainer)
		r.With(requirePermission(db, "view")).Get("/api/projects/{name}/updates", dh.apiCheckProjectUpdates)

		// Admin-only: user and role management
		r.With(requireAdmin(db)).Get("/api/users", uh.list)
		r.With(requireAdmin(db)).Post("/api/users", uh.create)
		r.With(requireAdmin(db)).Patch("/api/users/{id}", uh.update)
		r.With(requireAdmin(db)).Delete("/api/users/{id}", uh.delete)

		r.With(requireAdmin(db)).Get("/api/roles", rh.list)
		r.With(requireAdmin(db)).Post("/api/roles", rh.create)
		r.With(requireAdmin(db)).Put("/api/roles/{id}", rh.update)
		r.With(requireAdmin(db)).Delete("/api/roles/{id}", rh.delete)

		// Registry management
		r.With(requireGlobalPermission(db, "view_registries")).Get("/api/registries", regh.list)
		r.With(requireGlobalPermission(db, "manage_registries")).Post("/api/registries", regh.create)
		r.With(requireGlobalPermission(db, "manage_registries")).Put("/api/registries/{id}", regh.update)
		r.With(requireGlobalPermission(db, "manage_registries")).Delete("/api/registries/{id}", regh.delete)
		r.With(requireGlobalPermission(db, "manage_registries")).Post("/api/registries/{id}/test", regh.test)
		r.With(requireGlobalPermission(db, "view_registries")).Get("/api/registries/{id}/repositories", regh.listRepositories)
		r.With(requireGlobalPermission(db, "view_registries")).Get("/api/registries/{id}/repositories/*", regh.listRepoTags)

		// Image tag search (any authenticated user)
		r.Get("/api/images/tags", regh.searchImageTags)

		// Project config patch
		r.With(requirePermission(db, "manage")).Patch("/api/projects/{name}/config", ph.apiPatchProjectConfig)

		// Standalone containers (admin only)
		r.With(requireAdmin(db)).Get("/api/containers", cth.list)
		r.With(requireAdmin(db)).Post("/api/containers", cth.create)
		r.With(requireAdmin(db)).Delete("/api/containers/{id}", cth.remove)

		// Secrets management
		r.With(requireGlobalPermission(db, "view_secrets")).Get("/api/secrets", sech.list)
		r.With(requireGlobalPermission(db, "manage_secrets")).Post("/api/secrets", sech.create)
		r.With(requireGlobalPermission(db, "manage_secrets")).Put("/api/secrets/{id}", sech.update)
		r.With(requireGlobalPermission(db, "manage_secrets")).Delete("/api/secrets/{id}", sech.delete)
		r.With(requireGlobalPermission(db, "manage_secrets")).Post("/api/secrets/{id}/reveal", sech.reveal)

		// Project secrets (manage permission on the project)
		r.With(requirePermission(db, "manage")).Get("/api/projects/{name}/secrets", psech.list)
		r.With(requirePermission(db, "manage")).Put("/api/projects/{name}/secrets", psech.set)

		// Webhooks (requires manage permission)
		r.With(requirePermission(db, "manage")).Get("/api/projects/{name}/webhooks", wbh.list)
		r.With(requirePermission(db, "manage")).Post("/api/projects/{name}/webhooks", wbh.createProjectWebhook)
		r.With(requirePermission(db, "manage")).Delete("/api/projects/{name}/webhooks/{webhookId}", wbh.deleteWebhook)
		r.With(requirePermission(db, "manage")).Post("/api/projects/{name}/containers/{service}/webhooks", wbh.createServiceWebhook)

		// Notifications
		r.With(requireGlobalPermission(db, "view_notifications")).Get("/api/notifications/channels", nth.listChannels)
		r.With(requireGlobalPermission(db, "manage_notifications")).Post("/api/notifications/channels", nth.createChannel)
		r.With(requireGlobalPermission(db, "manage_notifications")).Put("/api/notifications/channels/{id}", nth.updateChannel)
		r.With(requireGlobalPermission(db, "manage_notifications")).Delete("/api/notifications/channels/{id}", nth.deleteChannel)
		r.With(requireGlobalPermission(db, "manage_notifications")).Post("/api/notifications/channels/{id}/test", nth.testChannel)
		r.With(requireGlobalPermission(db, "manage_notifications")).Post("/api/notifications/channels/{id}/rules", nth.createRule)
		r.With(requireGlobalPermission(db, "manage_notifications")).Put("/api/notifications/rules/{id}", nth.updateRule)
		r.With(requireGlobalPermission(db, "manage_notifications")).Delete("/api/notifications/rules/{id}", nth.deleteRule)

		// Backup & Restore
		r.With(requireGlobalPermission(db, "manage_backups")).Get("/api/backup", bkh.download)
		r.With(requireGlobalPermission(db, "manage_backups")).Post("/api/restore", bkh.restore)

		// Cron management
		r.With(requireGlobalPermission(db, "view_cron")).Get("/api/cron/users", crnh.listUsers)
		r.With(requireGlobalPermission(db, "manage_cron")).Post("/api/cron/validate", crnh.validate)
		r.With(requireGlobalPermission(db, "view_cron")).Get("/api/cron/{user}", crnh.getCrontab)
		r.With(requireGlobalPermission(db, "manage_cron")).Put("/api/cron/{user}/raw", crnh.saveRaw)
		r.With(requireGlobalPermission(db, "manage_cron")).Put("/api/cron/{user}/entries", crnh.saveEntries)

		// Version & update notifications
		r.Get("/api/system/version", updh.getVersion)
		r.Get("/api/system/update/status", updh.getUpdateStatus)
		r.With(requireGlobalPermission(db, "manage_updates")).Get("/api/system/update/check", updh.checkUpdate)

		// Config editor (admin only)
		r.With(requireAdmin(db)).Get("/api/system/config", cfgh.getConfig)
		r.With(requireAdmin(db)).Put("/api/system/config", cfgh.updateConfig)
	})

	// WebSocket routes
	r.Group(func(r chi.Router) {
		r.Use(requireAuth(sm, db))

		r.With(requireGlobalPermission(db, "view_dashboard")).Get("/api/ws/metrics", sh.wsMetrics)
		r.With(requireGlobalPermission(db, "view_events")).Get("/api/ws/events", sh.wsEvents)
		r.With(requirePermission(db, "logs")).Get("/api/ws/projects/{name}/logs", dh.wsProjectLogs)
		r.With(requirePermission(db, "view")).Get("/api/ws/projects/{name}/stats", dh.wsProjectStats)
		r.With(requirePermission(db, "deploy")).Get("/api/ws/projects/{name}/deploy", dh.wsDeployStream)
		r.With(requirePermission(db, "stop")).Get("/api/ws/projects/{name}/stop", dh.wsStopStream)
		r.With(requireGlobalPermission(db, "view_logs")).Get("/api/ws/logs", lh.wsServerLogs)
		r.With(requireGlobalPermission(db, "view_logs")).Get("/api/ws/logs/journalctl", lh.wsJournalctlStream)
		r.With(requirePermission(db, "files")).Get("/api/ws/projects/{name}/containers/{id}/exec", dh.wsContainerExec)
		r.With(requireAdmin(db)).Get("/api/ws/images/build/{id}", dh.wsBuildStream)
	})

	// SPA catch-all
	r.With(middleware.Compress(9)).Handle("/*", spaHandler())

	return r
}
