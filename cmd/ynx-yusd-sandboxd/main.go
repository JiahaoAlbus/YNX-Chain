package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
	"github.com/JiahaoAlbus/YNX-Chain/internal/yusdsandbox"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	addr := flag.String("http", envOrDefault("YNX_YUSD_SANDBOX_ADDR", "127.0.0.1:6490"), "YUSD Sandbox HTTP listen address")
	statePath := flag.String("state", strings.TrimSpace(os.Getenv("YNX_YUSD_SANDBOX_STATE_PATH")), "YUSD Sandbox persistent state path")
	checkConfig := flag.Bool("check-config", false, "validate YUSD Sandbox configuration without starting the service")
	flag.Parse()

	cfg := yusdsandbox.Config{StatePath: *statePath, APIKey: os.Getenv("YNX_YUSD_SANDBOX_API_KEY")}
	if *checkConfig {
		if err := yusdsandbox.ValidateConfig(cfg); err != nil {
			log.Fatal(err)
		}
		fmt.Println("ynx-yusd-sandboxd config check passed; Testnet-only 1:1 reserve sandbox has no real-world value")
		return
	}
	service, err := yusdsandbox.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *addr, Handler: mutationfreeze.FromEnv(yusdsandbox.NewServerWithBuild(service, currentBuildInfo()).Handler()), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YUSD Sandbox listening on %s (testnet-only, no real value)", *addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
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
