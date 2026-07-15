package main

import (
	"embed"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/resourceproduct"
	"io/fs"
	"log"
	"net/http"
	"os"
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
	svc, err := resourceproduct.New(resourceproduct.Config{StorePath: env("YNX_RESOURCE_MARKET_STORE", "tmp/resource-market/state.json"), AIURL: os.Getenv("YNX_AI_GATEWAY_URL"), AIKey: os.Getenv("YNX_AI_GATEWAY_API_KEY"), AIModel: os.Getenv("YNX_AI_MODEL"), Sessions: sessions, AllowHeaderAuth: os.Getenv("YNX_RESOURCE_MARKET_DEV_HEADER_AUTH") == "1"})
	if err != nil {
		log.Fatal(err)
	}
	assets, _ := fs.Sub(web, "web")
	addr := env("YNX_RESOURCE_MARKET_ADDR", "127.0.0.1:6441")
	log.Printf("YNX Resource Market listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, svc.Handler(http.FileServer(http.FS(assets)))))
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
