package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/tomasweigenast/vps-manager/internal/auth"
	"github.com/tomasweigenast/vps-manager/internal/config"
	"github.com/tomasweigenast/vps-manager/internal/docker"
	"github.com/tomasweigenast/vps-manager/internal/files"
	"github.com/tomasweigenast/vps-manager/internal/logbuffer"
	wslib "github.com/tomasweigenast/vps-manager/internal/ws"
)

func NewRouter(
	db *sql.DB,
	cfg *config.Config,
	dockerManager *docker.Manager,
	logBuf *logbuffer.RingBuffer,
) http.Handler {
	r := chi.NewRouter()
	r.Use(requestIDMiddleware)
	r.Use(middleware.Recoverer)

	sm := auth.NewSessionManager(cfg.CookieSecret, cfg.SecureCookies)
	browser := files.NewBrowser(cfg.FilesRootDir)
	wsHub := wslib.NewHub()

	ah := &authHandler{db: db, session: sm, authMode: cfg.AuthMode}
	sh := &systemHandler{wsHub: wsHub}
	dh := &dockerHandler{manager: dockerManager, database: db}
	fh := &filesHandler{browser: browser}
	lh := &logsHandler{buf: logBuf, database: db, logSink: cfg.LogSink}
	ph := &projectsHandler{manager: dockerManager, database: db}
	cfh := &containerFilesHandler{manager: dockerManager}
	audh := &auditHandler{database: db}
	seth := &setupHandler{database: db}
	uh := &usersHandler{database: db}
	rh := &rolesHandler{database: db}

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

	// Authenticated JSON API routes
	r.With(middleware.Compress(5)).Group(func(r chi.Router) {
		r.Use(requireAuth(sm, db))

		r.Get("/api/me", ah.me)
		r.With(requireGlobalPermission(db, "view_dashboard")).Get("/api/metrics", sh.metricsJSON)

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

		// Admin-only: user and role management
		r.With(requireAdmin(db)).Get("/api/users", uh.list)
		r.With(requireAdmin(db)).Post("/api/users", uh.create)
		r.With(requireAdmin(db)).Patch("/api/users/{id}", uh.update)
		r.With(requireAdmin(db)).Delete("/api/users/{id}", uh.delete)

		r.With(requireAdmin(db)).Get("/api/roles", rh.list)
		r.With(requireAdmin(db)).Post("/api/roles", rh.create)
		r.With(requireAdmin(db)).Put("/api/roles/{id}", rh.update)
		r.With(requireAdmin(db)).Delete("/api/roles/{id}", rh.delete)
	})

	// WebSocket routes
	r.Group(func(r chi.Router) {
		r.Use(requireAuth(sm, db))

		r.With(requireGlobalPermission(db, "view_dashboard")).Get("/api/ws/metrics", sh.wsMetrics)
		r.With(requirePermission(db, "logs")).Get("/api/ws/projects/{name}/logs", dh.wsProjectLogs)
		r.With(requirePermission(db, "view")).Get("/api/ws/projects/{name}/stats", dh.wsProjectStats)
		r.With(requirePermission(db, "deploy")).Get("/api/ws/projects/{name}/deploy", dh.wsDeployStream)
		r.With(requirePermission(db, "stop")).Get("/api/ws/projects/{name}/stop", dh.wsStopStream)
		r.With(requireGlobalPermission(db, "view_logs")).Get("/api/ws/logs", lh.wsServerLogs)
		r.With(requireGlobalPermission(db, "view_logs")).Get("/api/ws/logs/journalctl", lh.wsJournalctlStream)
		r.With(requirePermission(db, "files")).Get("/api/ws/projects/{name}/containers/{id}/exec", dh.wsContainerExec)
	})

	// SPA catch-all
	r.With(middleware.Compress(9)).Handle("/*", spaHandler())

	return r
}
