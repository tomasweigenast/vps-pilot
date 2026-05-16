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
	"github.com/tomasweigenast/vps-manager/internal/sse"
	wslib "github.com/tomasweigenast/vps-manager/internal/ws"
)

func NewRouter(
	db *sql.DB,
	cfg *config.Config,
	dockerManager *docker.Manager,
	metricsHub *sse.Hub,
	logBuf *logbuffer.RingBuffer,
) http.Handler {
	r := chi.NewRouter()
	r.Use(requestIDMiddleware)
	r.Use(middleware.Recoverer)

	sm := auth.NewSessionManager(cfg.CookieSecret, cfg.SecureCookies)
	browser := files.NewBrowser(cfg.FilesRootDir)
	wsHub := wslib.NewHub()

	ah := &authHandler{db: db, session: sm, authMode: cfg.AuthMode}
	sh := &systemHandler{metricsHub: metricsHub, wsHub: wsHub}
	dh := &dockerHandler{manager: dockerManager, database: db}
	fh := &filesHandler{browser: browser}
	lh := &logsHandler{buf: logBuf, database: db, logSink: cfg.LogSink}
	ph := &projectsHandler{manager: dockerManager, database: db}
	cfh := &containerFilesHandler{manager: dockerManager}
	audh := &auditHandler{database: db}

	StartMetricsBroadcast(metricsHub, wsHub, 1*time.Second)

	// Public routes
	r.With(middleware.Compress(5)).Group(func(r chi.Router) {
		r.Post("/api/login", ah.login)
		r.Post("/api/logout", ah.logout)
	})

	// Authenticated JSON API routes
	r.With(middleware.Compress(5)).Group(func(r chi.Router) {
		r.Use(requireAuth(sm))

		r.Get("/api/me", ah.me)
		r.Get("/api/metrics", sh.metricsJSON)

		r.Get("/api/projects", dh.apiListProjects)
		r.Post("/api/projects", ph.apiCreateProject)
		r.Get("/api/projects/{name}", ph.apiGetProject)
		r.Put("/api/projects/{name}", ph.apiUpdateProject)
		r.Delete("/api/projects/{name}", ph.deleteProject)
		r.Post("/api/projects/{name}/start", dh.apiStartProject)
		r.Post("/api/projects/{name}/stop", dh.apiStopProject)
		r.Post("/api/projects/{name}/restart", dh.apiRestartProject)
		r.Post("/api/projects/{name}/containers/{id}/{action}", dh.apiContainerAction)
		r.Get("/api/projects/{name}/files", ph.apiListProjectFiles)
		r.Put("/api/projects/{name}/files", ph.apiUpsertProjectFile)
		r.Delete("/api/projects/{name}/files/{filename}", ph.apiDeleteProjectFile)

		r.Get("/api/files", fh.apiList)
		r.Get("/api/files/content", fh.content)
		r.Put("/api/files", fh.update)
		r.Delete("/api/files", fh.delete)
		r.Get("/files/download", fh.download)

		r.Get("/api/logs/history", lh.logsHistory)
		r.Get("/api/audit", audh.list)

		r.Get("/api/projects/{name}/containers/{id}/files", cfh.listDir)
		r.Get("/api/projects/{name}/containers/{id}/files/download", cfh.downloadFile)
	})

	// WebSocket routes
	r.Group(func(r chi.Router) {
		r.Use(requireAuth(sm))

		r.Get("/api/ws/metrics", sh.wsMetrics)
		r.Get("/api/ws/projects/{name}/logs", dh.wsProjectLogs)
		r.Get("/api/ws/projects/{name}/stats", dh.wsProjectStats)
		r.Get("/api/ws/projects/{name}/deploy", dh.wsDeployStream)
		r.Get("/api/ws/projects/{name}/stop", dh.wsStopStream)
		r.Get("/api/ws/logs", lh.wsServerLogs)
		r.Get("/api/ws/projects/{name}/containers/{id}/exec", dh.wsContainerExec)
	})

	// Legacy SSE routes
	r.Group(func(r chi.Router) {
		r.Use(requireAuth(sm))

		r.Get("/api/metrics/stream", sh.metricsStream)
		r.Get("/api/logs/stream", lh.serverLogsStream)
		r.Get("/api/logs/journalctl/stream", lh.journalctlStream)
	})

	// SPA catch-all
	r.Handle("/*", spaHandler())

	return r
}
