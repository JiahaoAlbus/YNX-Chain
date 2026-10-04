package main

import (
	"net/http"
	"os"
	"path/filepath"
)

func publicEntry(webDir string) http.Handler {
	files := http.FileServer(http.Dir(webDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			if r.URL.Path == "/app" || r.URL.Path == "/index.html" {
				forward := r.Clone(r.Context())
				forward.URL.Path, forward.URL.RawPath = "/", ""
				w.Header().Set("Cache-Control", "no-store")
				files.ServeHTTP(w, forward)
				return
			}
			if r.URL.Path == "/" && r.URL.RawQuery == "" {
				name := filepath.Join(webDir, "introduction.html")
				if info, err := os.Lstat(name); err == nil && info.Mode().IsRegular() {
					http.ServeFile(w, r, name)
					return
				}
			}
		}
		files.ServeHTTP(w, r)
	})
}
