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
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/publicprobe"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_ECONOMICS_MONITOR_HTTP_ADDR", "127.0.0.1:6438"), "economics monitor HTTP listen address")
	reserveURL := flag.String("stable-reserve-url", strings.TrimSpace(os.Getenv("YNX_PUBLIC_STABLE_RESERVE_URL")), "public HTTPS Stable Reserve endpoint")
	yusdSandboxURL := flag.String("yusd-sandbox-url", strings.TrimSpace(os.Getenv("YNX_PUBLIC_YUSD_SANDBOX_URL")), "public HTTPS YUSD Sandbox endpoint")
	interval := flag.Duration("interval", durationFromEnv("YNX_ECONOMICS_MONITOR_INTERVAL", 15*time.Second), "public probe interval")
	timeout := flag.Duration("timeout", durationFromEnv("YNX_ECONOMICS_MONITOR_TIMEOUT", 10*time.Second), "public probe timeout")
	checkConfig := flag.Bool("check-config", false, "validate monitor configuration without starting the service")
	flag.Parse()

	monitor, err := publicprobe.New(publicprobe.Config{
		StableReserveURL: *reserveURL,
		YUSDSandboxURL:   *yusdSandboxURL,
		Interval:         *interval,
		Timeout:          *timeout,
	})
	if err != nil {
		log.Fatal(err)
	}
	if *checkConfig {
		fmt.Println("ynx-economics-monitord config check passed; public Stable Reserve and YUSD Sandbox probes use HTTPS and fail-closed release truth")
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go monitor.Run(ctx)

	server := &http.Server{
		Addr:              *httpAddr,
		Handler:           monitor.Handler(currentBuildInfo()),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Economics Monitor listening on http://%s and probing %s", *httpAddr, *reserveURL)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{
		Commit: strings.TrimSpace(buildCommit), Release: strings.TrimSpace(buildRelease), BuildTime: strings.TrimSpace(buildTime),
	})
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func durationFromEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		log.Fatalf("%s must be a valid duration: %v", key, err)
	}
	return duration
}
