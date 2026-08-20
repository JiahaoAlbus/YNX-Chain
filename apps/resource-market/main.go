package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/resourceproduct"
)

//go:embed web/*
var web embed.FS

func main() {
	sessions := map[string]resourceproduct.Actor{}
	if raw := os.Getenv("YNX_RESOURCE_MARKET_SESSIONS_JSON"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &sessions); err != nil {
			log.Fatal("invalid YNX_RESOURCE_MARKET_SESSIONS_JSON: ", err)
		}
	}
	svc, err := resourceproduct.New(resourceproduct.Config{StorePath: env("YNX_RESOURCE_MARKET_STORE", "tmp/resource-market/state.json"), MarketStorePath: env("YNX_RESOURCE_MARKET_ENGINE_STORE", "tmp/resource-market/market.json"), AIURL: os.Getenv("YNX_AI_GATEWAY_URL"), AIKey: os.Getenv("YNX_AI_GATEWAY_API_KEY"), AIModel: os.Getenv("YNX_AI_MODEL"), Sessions: sessions, AllowHeaderAuth: os.Getenv("YNX_RESOURCE_MARKET_DEV_HEADER_AUTH") == "1", CentralGatewayURL: os.Getenv("YNX_CENTRAL_GATEWAY_URL"), CentralClientID: env("YNX_RESOURCE_MARKET_CLIENT_ID", "ynx-resource-market-v1")})
	if err != nil {
		log.Fatal(err)
	}
	assets, _ := fs.Sub(web, "web")
	addr := env("YNX_RESOURCE_MARKET_ADDR", "127.0.0.1:6441")
	log.Printf("YNX Resource Market listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, svc.Handler(canonicalAssets(http.FileServer(http.FS(assets))))))
}

func canonicalAssets(files http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/resource-market" || r.URL.Path == "/resource-market/" {
			clone := r.Clone(r.Context())
			urlCopy := *r.URL
			urlCopy.Path = "/"
			clone.URL = &urlCopy
			files.ServeHTTP(w, clone)
			return
		}
		files.ServeHTTP(w, r)
	})
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
