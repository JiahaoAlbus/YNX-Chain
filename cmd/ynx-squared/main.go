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

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_SQUARE_HTTP_ADDR", "127.0.0.1:6436"), "Square HTTP listen address")
	statePath := flag.String("state", envOrDefault("YNX_SQUARE_STATE_PATH", "tmp/square/state.json"), "Square persistent state path")
	checkConfig := flag.Bool("check-config", false, "validate configuration without starting the service")
	flag.Parse()

	maxBody, err := envInt("YNX_SQUARE_MAX_BODY_BYTES", 16*1024)
	if err != nil {
		log.Fatal(err)
	}
	rateMax, err := envInt("YNX_SQUARE_RATE_LIMIT_MAX", 120)
	if err != nil {
		log.Fatal(err)
	}
	rateWindow, err := time.ParseDuration(envOrDefault("YNX_SQUARE_RATE_LIMIT_WINDOW", "1m"))
	if err != nil {
		log.Fatal("YNX_SQUARE_RATE_LIMIT_WINDOW must be a Go duration")
	}
	cfg := square.Config{StatePath: *statePath, APIKey: os.Getenv("YNX_SQUARE_API_KEY"), MaxBodyBytes: maxBody, RateLimitMax: rateMax, RateLimitWindow: rateWindow, RemoteDeployed: envBool("YNX_SQUARE_DEPLOY_ENABLED")}
	if *checkConfig {
		if err := square.ValidateConfig(cfg); err != nil {
			log.Fatal(err)
		}
		fmt.Println("ynx-squared config check passed; signed persistent social core enabled; remote/public deployment not implied")
		return
	}
	service, err := square.New(cfg)
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	server := &http.Server{Addr: *httpAddr, Handler: mutationfreeze.FromEnv(square.NewServerWithBuild(service, currentBuildInfo()).Handler()), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Square listening on http://%s; signed bounded social records; remote/public deployment not implied", *httpAddr)
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

func envInt(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", key)
	}
	return parsed, nil
}

func envBool(key string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(key)), "true")
}
