package main

import (
	"net/http"
	"os"
	"path/filepath"
)

// introductionHandler owns only the public entry layer. All API, callback and
// application requests still run through the existing Finance server.
func introductionHandler(application http.Handler, webDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			application.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/app" || r.URL.Path == "/index.html" {
			forward := r.Clone(r.Context())
			forward.URL.Path = "/"
			forward.URL.RawPath = ""
			application.ServeHTTP(w, forward)
			return
		}
		name := ""
		if r.URL.Path == "/" && r.URL.RawQuery == "" {
			name = "introduction.html"
		}
		switch r.URL.Path {
		case "/introduction.css", "/introduction.js", "/finance-workspace-preview.png":
			name = r.URL.Path[1:]
		}
		if name != "" && webDir != "" {
			path := filepath.Join(webDir, name)
			// Inherited releases without the new entry assets keep their original
			// application. Do not serve a symlink substituted for a public asset.
			if info, err := os.Lstat(path); err == nil && info.Mode().IsRegular() {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Pragma", "no-cache")
				http.ServeFile(w, r, path)
				return
			}
		}
		application.ServeHTTP(w, r)
	})
}
