package main

import (
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	musicapp "github.com/JiahaoAlbus/YNX-Chain/apps/music"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
)

var (
	commit    = "unknown"
	release   = "local"
	buildTime = "unknown"
)

func main() {
	httpAddr := flag.String("http", env("YNX_MUSIC_HTTP_ADDR", "127.0.0.1:6436"), "HTTP listen address")
	dataDir := flag.String("data", env("YNX_MUSIC_DATA_DIR", filepath.Join(os.TempDir(), "ynx-music")), "absolute private data directory")
	publicOrigin := flag.String("origin", env("YNX_MUSIC_ORIGIN", "https://music.ynxweb4.com"), "exact product origin binding")
	backupDir := flag.String("backup", "", "create a verified state-and-media backup at this absolute path, then exit")
	restoreDir := flag.String("restore", "", "restore a verified backup from this absolute path into a clean data directory, then exit")
	flag.Parse()
	if *backupDir != "" && *restoreDir != "" {
		log.Fatal("backup and restore modes are mutually exclusive")
	}
	statePath := filepath.Join(*dataDir, "state.json")
	mediaDir := filepath.Join(*dataDir, "media")
	if *restoreDir != "" {
		if err := music.RestoreBackup(*restoreDir, statePath, mediaDir); err != nil {
			log.Fatal(err)
		}
		log.Printf("YNX Music backup restored into %s", *dataDir)
		return
	}
	svc, err := music.New(music.Config{StatePath: statePath, MediaDir: mediaDir, MaxUploadBytes: 50 << 20, AIGatewayURL: os.Getenv("YNX_MUSIC_AI_GATEWAY_URL"), AIGatewayKey: os.Getenv("YNX_MUSIC_AI_GATEWAY_KEY"), WalletChallengeURL: os.Getenv("YNX_MUSIC_WALLET_CHALLENGE_URL"), WalletSessionURL: os.Getenv("YNX_MUSIC_WALLET_SESSION_URL"), WalletVerifyURL: os.Getenv("YNX_MUSIC_WALLET_VERIFY_URL"), WalletGatewayKey: os.Getenv("YNX_MUSIC_WALLET_GATEWAY_KEY"), PayGatewayURL: os.Getenv("YNX_MUSIC_PAY_GATEWAY_URL"), PayGatewayKey: os.Getenv("YNX_MUSIC_PAY_GATEWAY_KEY"), TrustGatewayURL: os.Getenv("YNX_MUSIC_TRUST_GATEWAY_URL"), TrustGatewayKey: os.Getenv("YNX_MUSIC_TRUST_GATEWAY_KEY")})
	if err != nil {
		log.Fatal(err)
	}
	if *backupDir != "" {
		manifest, err := svc.CreateBackup(*backupDir)
		if err != nil {
			log.Fatal(err)
		}
		if err := json.NewEncoder(os.Stdout).Encode(manifest); err != nil {
			log.Fatal(err)
		}
		return
	}
	build := buildinfo.Info{Commit: commit, Release: release, BuildTime: buildTime}
	server := &http.Server{Addr: *httpAddr, Handler: music.NewServerWithBuild(svc, *publicOrigin, musicapp.Web(), build).Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX Music listening on http://%s; public licensed catalog=false", *httpAddr)
	log.Fatal(server.ListenAndServe())
}
func env(k, v string) string {
	if x := os.Getenv(k); x != "" {
		return x
	}
	return v
}
