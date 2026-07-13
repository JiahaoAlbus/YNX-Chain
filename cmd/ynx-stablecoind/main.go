package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
	"github.com/JiahaoAlbus/YNX-Chain/internal/stablecoinissuer"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_STABLECOIN_HTTP_ADDR", "127.0.0.1:6434"), "Stablecoin control HTTP listen address")
	statePath := flag.String("state", envOrDefault("YNX_STABLECOIN_STATE_PATH", "tmp/stablecoin/state.json"), "Stablecoin control persistent state path")
	checkConfig := flag.Bool("check-config", false, "validate configuration without starting the service")
	flag.Parse()

	cfg := stablecoinissuer.Config{StatePath: *statePath, APIKey: os.Getenv("YNX_STABLECOIN_API_KEY")}
	if *checkConfig {
		if err := stablecoinissuer.ValidateConfig(cfg); err != nil {
			log.Fatal(err)
		}
		fmt.Println("ynx-stablecoind config check passed; issuer support and external execution remain disabled")
		return
	}
	service, err := stablecoinissuer.New(cfg)
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	server := &http.Server{Addr: *httpAddr, Handler: mutationfreeze.FromEnv(stablecoinissuer.NewServerWithBuild(service, currentBuildInfo()).Handler()), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Stablecoin Issuer Control listening on http://%s; issuer support and external execution disabled", *httpAddr)
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
