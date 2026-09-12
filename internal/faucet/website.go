package faucet

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web/index.html web/style.css web/app.js web/client.js web/legacy-receipts.json
var website embed.FS

const websiteCSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

func (s *Server) websiteRoutes() {
	assets, _ := fs.Sub(website, "web")
	s.mux.Handle("GET /faucet-assets/", http.StripPrefix("/faucet-assets/", http.FileServer(http.FS(assets))))
	s.mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", websiteCSP)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		page, _ := website.ReadFile("web/index.html")
		_, _ = w.Write(page)
	})
}
