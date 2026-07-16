package main

import (
	"embed"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/trustproduct"
	"io/fs"
	"log"
	"net/http"
	"os"
)

//go:embed web/*
var web embed.FS

func main() {
	store := env("YNX_TRUST_CENTER_STORE", "tmp/trust-center/state.json")
	sessions := map[string]trustproduct.Actor{}
	if raw := os.Getenv("YNX_TRUST_CENTER_SESSIONS_JSON"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &sessions); err != nil {
			log.Fatal("invalid YNX_TRUST_CENTER_SESSIONS_JSON: ", err)
		}
	}
	svc, err := trustproduct.New(trustproduct.Config{StorePath: store, AIURL: os.Getenv("YNX_AI_GATEWAY_URL"), AIKey: os.Getenv("YNX_AI_GATEWAY_API_KEY"), AIModel: os.Getenv("YNX_AI_MODEL"), Sessions: sessions, AllowHeaderAuth: os.Getenv("YNX_TRUST_CENTER_DEV_HEADER_AUTH") == "1", CentralGatewayURL: os.Getenv("YNX_CENTRAL_GATEWAY_URL"), CentralClientID: env("YNX_TRUST_CENTER_CLIENT_ID", "ynx-trust-center-v1")})
	if err != nil {
		log.Fatal(err)
	}
	assets, _ := fs.Sub(web, "web")
	addr := env("YNX_TRUST_CENTER_ADDR", "127.0.0.1:6440")
	log.Printf("YNX Trust Center listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, svc.Handler(http.FileServer(http.FS(assets)))))
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
