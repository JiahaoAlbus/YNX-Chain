package main

import (
	"embed"
	calendarservice "github.com/JiahaoAlbus/YNX-Chain/internal/calendar"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed web/*
var assets embed.FS

func main() {
	dataDir := env("YNX_CALENDAR_DATA_DIR", "./var/calendar")
	store, err := calendarservice.NewStore(filepath.Join(dataDir, "state.json"))
	fatal(err)
	service, err := calendarservice.NewService(store, calendarservice.RemoteWalletVerifier{BaseURL: os.Getenv("YNX_WALLET_VERIFY_URL")}, calendarservice.RemoteAI{BaseURL: os.Getenv("YNX_AI_GATEWAY_URL"), Token: os.Getenv("YNX_AI_GATEWAY_TOKEN")})
	fatal(err)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for now := range ticker.C {
			if _, e := service.ProcessReminders(now); e != nil {
				log.Printf("calendar reminder processing failed: %v", e)
			}
		}
	}()
	webFS, err := fs.Sub(assets, "web")
	fatal(err)
	mux := http.NewServeMux()
	mux.Handle("/v1/", calendarservice.NewHandler(service))
	mux.Handle("/", spa(http.FS(webFS)))
	server := &http.Server{Addr: env("YNX_CALENDAR_ADDR", ":8096"), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX Calendar listening on %s (production scheduling is not claimed)", server.Addr)
	fatal(server.ListenAndServe())
}
func spa(root http.FileSystem) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if f, e := root.Open(path); e == nil {
			_ = f.Close()
			http.FileServer(root).ServeHTTP(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/index.html"
		http.FileServer(root).ServeHTTP(w, r2)
	})
}
func env(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}
func fatal(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
