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
	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
	"github.com/JiahaoAlbus/YNX-Chain/internal/explorer"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_EXPLORER_HTTP_ADDR", "127.0.0.1:6427"), "explorer HTTP listen address")
	rpcURL := flag.String("rpc", envOrDefault("YNX_EXPLORER_RPC_URL", "http://127.0.0.1:6420"), "YNX Chain RPC URL")
	indexerURL := flag.String("indexer", envOrDefault("YNX_EXPLORER_INDEXER_URL", "http://127.0.0.1:6426"), "YNX indexer URL")
	publicRPCURL := flag.String("public-rpc", envOrDefault("YNX_EXPLORER_PUBLIC_RPC_URL", *rpcURL), "wallet-visible public RPC URL")
	publicExplorerURL := flag.String("public-url", envOrDefault("YNX_EXPLORER_PUBLIC_URL", "http://127.0.0.1:6427"), "wallet-visible public explorer URL")
	reserveAttestation := flag.String("reserve-attestation", strings.TrimSpace(os.Getenv("YNX_STABLE_RESERVE_ATTESTATION_PATH")), "provider-signed stable reserve attestation JSON")
	reservePublicKey := flag.String("reserve-public-key", strings.TrimSpace(os.Getenv("YNX_STABLE_RESERVE_PUBLIC_KEY")), "base64 raw provider Ed25519 public key")
	reserveKeyID := flag.String("reserve-key-id", strings.TrimSpace(os.Getenv("YNX_STABLE_RESERVE_KEY_ID")), "provider reserve attestation key ID")
	reserveAsset := flag.String("reserve-asset", envOrDefault("YNX_STABLE_RESERVE_ASSET", "YUSD"), "expected reserve asset")
	reserveNetwork := flag.String("reserve-network", envOrDefault("YNX_STABLE_RESERVE_NETWORK", "ynx-testnet"), "expected reserve network")
	reserveSourceCommit := flag.String("reserve-source-commit", envOrDefault("YNX_STABLE_RESERVE_SOURCE_COMMIT", strings.TrimSpace(buildCommit)), "full source commit for reserve integration evidence")
	reserveAdapterReleaseClass := flag.String("reserve-adapter-release-class", envOrDefault("YNX_STABLE_RESERVE_ADAPTER_RELEASE_CLASS", "local_candidate"), "reserve adapter release class: local_candidate, central_testnet or public_testnet")
	reserveMaxAge := flag.Duration("reserve-max-age", 24*time.Hour, "maximum accepted reserve attestation age")
	checkConfig := flag.Bool("check-config", false, "validate explorer and reserve configuration without starting the service")
	flag.Parse()

	service, err := explorer.New(explorer.Config{
		RPCURL:              *rpcURL,
		IndexerURL:          *indexerURL,
		PublicRPCURL:        *publicRPCURL,
		PublicExplorerURL:   *publicExplorerURL,
		ResourceUpstreamKey: os.Getenv("YNX_RESOURCE_GATEWAY_UPSTREAM_KEY"),
	})
	if err != nil {
		log.Fatal(err)
	}
	reserveAdapterRelease, err := explorer.StableReserveAdapterReleaseStates(*reserveAdapterReleaseClass)
	if err != nil {
		log.Fatal(err)
	}

	var reserveIntegration *economics.StableReserveIntegration
	reserveConfigured := strings.TrimSpace(*reserveAttestation) != "" || strings.TrimSpace(*reservePublicKey) != "" || strings.TrimSpace(*reserveKeyID) != ""
	if reserveConfigured {
		reserveIntegration, err = explorer.LoadStableReserveIntegration(*reserveAttestation, *reservePublicKey, *reserveKeyID, *reserveAsset, *reserveNetwork, *reserveSourceCommit, *reserveMaxAge)
		if err != nil {
			log.Fatal(err)
		}
	}
	if *checkConfig {
		fmt.Printf("ynx-explorerd config check passed; stable reserve attestation configured=%t adapterReleaseClass=%s\n", reserveIntegration != nil, *reserveAdapterReleaseClass)
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{Addr: *httpAddr, Handler: explorer.NewServerWithBuildAndStableReserveRelease(service, currentBuildInfo(), reserveIntegration, reserveAdapterRelease, *reserveAdapterReleaseClass).Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX Explorer listening on http://%s with RPC %s and indexer %s", *httpAddr, *rpcURL, *indexerURL)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{
		Commit:    strings.TrimSpace(buildCommit),
		Release:   strings.TrimSpace(buildRelease),
		BuildTime: strings.TrimSpace(buildTime),
	})
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
