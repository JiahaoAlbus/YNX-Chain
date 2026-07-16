package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/video"
)

func main() {
	root := required("YNX_VIDEO_DATA")
	moderators := map[string]bool{}
	for _, account := range strings.Split(os.Getenv("YNX_VIDEO_MODERATORS"), ",") {
		if account = strings.TrimSpace(account); account != "" {
			moderators[account] = true
		}
	}
	max := int64Env("YNX_VIDEO_MAX_OBJECT_BYTES", 512<<20)
	quota := int64Env("YNX_VIDEO_ACCOUNT_QUOTA_BYTES", 5<<30)
	var ai video.AIProvider
	if os.Getenv("YNX_VIDEO_AI_GATEWAY") != "" {
		ai = video.GatewayAI{Endpoint: os.Getenv("YNX_VIDEO_AI_GATEWAY"), Token: required("YNX_VIDEO_AI_TOKEN")}
	}
	var pay video.PayVerifier
	if os.Getenv("YNX_VIDEO_PAY_ENDPOINT") != "" {
		pay = video.PayClient{Endpoint: os.Getenv("YNX_VIDEO_PAY_ENDPOINT"), Token: required("YNX_VIDEO_PAY_TOKEN")}
	}
	svc, err := video.NewService(video.Config{Root: root, IntegrityKey: []byte(required("YNX_VIDEO_INTEGRITY_KEY")), MaxObjectBytes: max, AccountQuotaBytes: quota, Scanner: video.CommandScanner{Command: required("YNX_VIDEO_SCANNER")}, Processor: video.FFmpegProcessor{FFmpeg: os.Getenv("YNX_VIDEO_FFMPEG")}, AI: ai, Pay: pay})
	if err != nil {
		log.Fatal(err)
	}
	addr := os.Getenv("YNX_VIDEO_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8423"
	}
	clients := map[string]video.GatewayClient{
		"ynx-video-mobile-v1":       {BundleID: "com.ynxweb4.video", Scopes: []string{"video.comment", "video.history", "video.read", "video.report", "video.subscribe"}},
		"ynx-video-web-v1":          {BundleID: "com.ynxweb4.video.web", Scopes: []string{"video.comment", "video.history", "video.read", "video.report", "video.subscribe"}},
		"ynx-creator-studio-web-v1": {BundleID: "com.ynxweb4.creator-studio.web", Scopes: []string{"ai.video.propose", "pay.payout.intent", "video.creator", "video.read"}},
	}
	auth := video.GatewaySessionAuth{Service: svc, Key: []byte(required("YNX_VIDEO_GATEWAY_ATTESTATION_KEY")), Clients: clients, Moderators: moderators}
	srv := &http.Server{Addr: addr, Handler: video.NewServer(svc, auth).Handler(), ReadHeaderTimeout: 10_000_000_000, MaxHeaderBytes: 1 << 20}
	log.Printf("YNX Video listening on %s", addr)
	log.Fatal(srv.ListenAndServe())
}
func required(k string) string {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		log.Fatalf("%s is required", k)
	}
	return v
}
func int64Env(k string, d int64) int64 {
	v := os.Getenv(k)
	if v == "" {
		return d
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		log.Fatalf("%s must be positive", k)
	}
	return n
}
