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

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	cutoverAuthorizedDefault, err := envBool("YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED", false)
	if err != nil {
		log.Fatal(err)
	}
	httpAddr := flag.String("http", envOrDefault("YNX_BFT_GATEWAY_HTTP_ADDR", "127.0.0.1:27620"), "BFT compatibility gateway HTTP listen address")
	cometRPCURL := flag.String("comet-rpc", envOrDefault("YNX_BFT_GATEWAY_COMET_RPC_URL", "http://127.0.0.1:27757"), "private CometBFT RPC URL")
	publicCutoverAuthorized := flag.Bool("public-cutover-authorized", cutoverAuthorizedDefault, "explicitly authorize public-cutover readiness after all other gates pass")
	flag.Parse()

	gateway, err := bftgateway.New(bftgateway.Config{CometRPCURL: *cometRPCURL, Build: currentBuildInfo(), PublicCutoverAuthorized: *publicCutoverAuthorized})
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	server := &http.Server{Addr: *httpAddr, Handler: gateway.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX BFT Gateway listening on http://%s with private CometBFT RPC %s", *httpAddr, *cometRPCURL)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func envBool(key string, fallback bool) (bool, error) {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback, nil
	}
	if value == "true" {
		return true, nil
	}
	if value == "false" {
		return false, nil
	}
	return false, fmt.Errorf("%s must be true or false", key)
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{
		Commit:    strings.TrimSpace(buildCommit),
		Release:   strings.TrimSpace(buildRelease),
		BuildTime: strings.TrimSpace(buildTime),
	})
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
