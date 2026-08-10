package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	mailservice "github.com/JiahaoAlbus/YNX-Chain/internal/mail"
)

//go:embed web/*
var assets embed.FS
var buildCommit = "unknown"
var buildRelease = "local"
var buildTime = "unknown"

func main() {
	dataDir := env("YNX_MAIL_DATA_DIR", "./var/mail")
	store, err := mailservice.NewStore(filepath.Join(dataDir, "state.json"))
	fatal(err)
	signer, err := loadOrCreateKey(filepath.Join(dataDir, "sender.ed25519"))
	fatal(err)
	verifier := mailservice.RemoteWalletVerifier{BaseURL: os.Getenv("YNX_WALLET_VERIFY_URL")}
	ai := mailservice.RemoteAI{BaseURL: os.Getenv("YNX_AI_GATEWAY_URL"), Token: os.Getenv("YNX_AI_GATEWAY_TOKEN")}
	service, err := mailservice.NewService(store, verifier, ai, signer)
	fatal(err)
	webFS, err := fs.Sub(assets, "web")
	fatal(err)
	mux := http.NewServeMux()
	mux.Handle("/v1/", mailservice.NewHandlerWithBuild(service, buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}))
	mux.Handle("/", spa(http.FS(webFS)))
	server := &http.Server{Addr: env("YNX_MAIL_ADDR", ":8095"), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX Mail listening on %s (internet-wide delivery is not enabled)", server.Addr)
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
func loadOrCreateKey(path string) (ed25519.PrivateKey, error) {
	if text, err := os.ReadFile(path); err == nil {
		raw, e := base64.RawStdEncoding.DecodeString(strings.TrimSpace(string(text)))
		if e != nil || len(raw) != ed25519.PrivateKeySize {
			return nil, errors.New("invalid persisted Mail sender signing key")
		}
		return ed25519.PrivateKey(raw), nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if err = os.WriteFile(path, []byte(base64.RawStdEncoding.EncodeToString(private)), 0o600); err != nil {
		return nil, err
	}
	return private, nil
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
