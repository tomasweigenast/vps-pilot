package api

import (
	"io"
	"net/http"
	"strings"

	"github.com/tomasweigenast/vps-pilot/internal/webapp"
)

// spaHandler serves the embedded Vite dist. Static assets are served
// directly via http.FileServer; every other path returns index.html so
// React Router can handle client-side navigation.
// Unknown /api/* paths return 404 JSON instead of HTML to avoid
// confusing the SPA auth logic.
func spaHandler() http.Handler {
	sub := webapp.FS()
	fileServer := http.FileServer(http.FS(sub))

	// Pre-read index.html once at startup to avoid redirect loops.
	// (http.FileServer redirects "/index.html" → "./" which the browser
	// resolves relative to the request path, creating infinite loops.)
	indexFile, err := sub.Open("index.html")
	if err != nil {
		panic("webapp: index.html not found in dist")
	}
	indexHTML, err := io.ReadAll(indexFile)
	indexFile.Close()
	if err != nil {
		panic("webapp: cannot read index.html")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")

		// Unknown /api/* paths should be 404, not the SPA shell.
		if strings.HasPrefix(p, "api") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error":"not found"}`)) //nolint:errcheck
			return
		}

		// Serve known static assets directly (assets/, favicons, etc.)
		if p != "" && p != "index.html" {
			f, err := sub.Open(p)
			if err == nil {
				f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// Everything else: serve the SPA shell.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write(indexHTML) //nolint:errcheck
	})
}
