package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	musicapp "github.com/JiahaoAlbus/YNX-Chain/apps/music"
	"github.com/JiahaoAlbus/YNX-Chain/internal/appgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
)

func main() {
	httpAddr := flag.String("http", env("YNX_MUSIC_HTTP_ADDR", "127.0.0.1:6436"), "HTTP listen address")
	dataDir := flag.String("data", env("YNX_MUSIC_DATA_DIR", filepath.Join(os.TempDir(), "ynx-music")), "absolute private data directory")
	publicOrigin := flag.String("origin", env("YNX_MUSIC_ORIGIN", "https://music.ynxweb4.com"), "exact product origin binding")
	flag.Parse()
	svc, err := music.New(music.Config{StatePath: filepath.Join(*dataDir, "state.json"), MediaDir: filepath.Join(*dataDir, "media"), MaxUploadBytes: 50 << 20, AIGatewayURL: os.Getenv("YNX_MUSIC_AI_GATEWAY_URL"), AIGatewayKey: os.Getenv("YNX_MUSIC_AI_GATEWAY_KEY")})
	if err != nil {
		log.Fatal(err)
	}
	auth, err := appgateway.New(appgateway.Config{ChatURL: "http://127.0.0.1:6429", ChatAPIKey: "unused-music-chat-key", SquareURL: "http://127.0.0.1:6428", SquareAPIKey: "unused-music-square-key", PayURL: "http://127.0.0.1:6424", PayAPIKey: "unused-music-pay-key", AllowedOrigins: []string{*publicOrigin}, MaxBodyBytes: 1 << 20, MaxResponseBytes: 4 << 20, RateLimitMax: 120, RateLimitWindow: time.Minute, StatePath: filepath.Join(*dataDir, "auth.json"), ChainID: 6423, ChallengeTTL: 5 * time.Minute, SessionTTL: 12 * time.Hour})
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *httpAddr, Handler: music.NewServer(svc, auth, *publicOrigin, musicapp.Web()).Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX Music listening on http://%s; public licensed catalog=false", *httpAddr)
	log.Fatal(server.ListenAndServe())
}
func env(k, v string) string {
	if x := os.Getenv(k); x != "" {
		return x
	}
	return v
}
