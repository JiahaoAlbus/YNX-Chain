package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/appgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_APP_GATEWAY_HTTP_ADDR", "127.0.0.1:6437"), "App Gateway HTTP listen address")
	checkConfig := flag.Bool("check-config", false, "validate configuration without starting the service")
	flag.Parse()
	maxBody, err := envInt64("YNX_APP_GATEWAY_MAX_BODY_BYTES", 128*1024)
	if err != nil {
		log.Fatal(err)
	}
	maxResponse, err := envInt64("YNX_APP_GATEWAY_MAX_RESPONSE_BYTES", 1024*1024)
	if err != nil {
		log.Fatal(err)
	}
	rateMax, err := envInt("YNX_APP_GATEWAY_RATE_LIMIT_MAX", 300)
	if err != nil {
		log.Fatal(err)
	}
	rateWindow, err := time.ParseDuration(envOrDefault("YNX_APP_GATEWAY_RATE_LIMIT_WINDOW", "1m"))
	if err != nil {
		log.Fatal("YNX_APP_GATEWAY_RATE_LIMIT_WINDOW must be a Go duration")
	}
	chainID, err := envInt64("YNX_APP_GATEWAY_CHAIN_ID", 6423)
	if err != nil {
		log.Fatal(err)
	}
	challengeTTL, err := time.ParseDuration(envOrDefault("YNX_APP_GATEWAY_CHALLENGE_TTL", "5m"))
	if err != nil {
		log.Fatal("YNX_APP_GATEWAY_CHALLENGE_TTL must be a Go duration")
	}
	sessionTTL, err := time.ParseDuration(envOrDefault("YNX_APP_GATEWAY_SESSION_TTL", "30m"))
	if err != nil {
		log.Fatal("YNX_APP_GATEWAY_SESSION_TTL must be a Go duration")
	}
	cfg := appgateway.Config{
		ChatURL: envOrDefault("YNX_APP_GATEWAY_CHAT_URL", "http://127.0.0.1:6435"), ChatAPIKey: os.Getenv("YNX_APP_GATEWAY_CHAT_API_KEY"),
		SquareURL: envOrDefault("YNX_APP_GATEWAY_SQUARE_URL", "http://127.0.0.1:6436"), SquareAPIKey: os.Getenv("YNX_APP_GATEWAY_SQUARE_API_KEY"),
		SocialURL: envOrDefault("YNX_APP_GATEWAY_SOCIAL_URL", "http://127.0.0.1:6434"), SocialAPIKey: os.Getenv("YNX_APP_GATEWAY_SOCIAL_API_KEY"),
		PayURL: envOrDefault("YNX_APP_GATEWAY_PAY_URL", "http://127.0.0.1:6430"), PayAPIKey: os.Getenv("YNX_APP_GATEWAY_PAY_API_KEY"),
		AllowedOrigins: splitCSV(os.Getenv("YNX_APP_GATEWAY_ALLOWED_ORIGINS")), MaxBodyBytes: maxBody, MaxResponseBytes: maxResponse,
		RateLimitMax: rateMax, RateLimitWindow: rateWindow, StatePath: envOrDefault("YNX_APP_GATEWAY_STATE_PATH", "/var/lib/ynx-chain/app-gateway/state.json"),
		ChainID: chainID, ChallengeTTL: challengeTTL, SessionTTL: sessionTTL, RemoteDeployed: envBool("YNX_APP_GATEWAY_DEPLOY_ENABLED"),
	}
	if *checkConfig {
		if err := appgateway.ValidateConfig(cfg); err != nil {
			log.Fatal(err)
		}
		fmt.Println("ynx-app-gatewayd config check passed; ynx1 ownership challenges, persistent hashed sessions, exact browser allowlists, and the bounded native-mobile client enabled; public deployment not implied")
		return
	}
	gateway, err := appgateway.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	server := &http.Server{Addr: *httpAddr, Handler: appgateway.NewServerWithBuild(gateway, currentBuildInfo()).Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX App Gateway listening on http://%s; server-side service credentials, exact browser allowlists, and the bounded native-mobile client enabled", *httpAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{Commit: strings.TrimSpace(buildCommit), Release: strings.TrimSpace(buildRelease), BuildTime: strings.TrimSpace(buildTime)})
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	var result []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func envInt(key string, fallback int) (int, error) {
	value, err := envInt64(key, int64(fallback))
	return int(value), err
}

func envInt64(key string, fallback int64) (int64, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", key)
	}
	return parsed, nil
}

func envBool(key string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(key)), "true")
}
