//go:build pay_pq && pay_cloud && pay_auth_source

// Original product private host. Operator config selects owned product paths
// and a registered local caller; it never supplies Source/Root/engine grants.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct/nativehost"
)

type config struct {
	Pay struct {
		StorePath, BootstrapKey, PublicBaseURL, CentralMerchantID string
		IntegrityKey, GatewayKey                                  []byte
	}
	Central payproduct.NormalCentralPayEndpoint
	Cloud   struct{ StatePath, ObjectDir string }
	Private nativehost.PrivateConfig
}

var buildCommit, buildRelease, buildTime = "unknown", "local", "unknown"

func main() { os.Exit(run()) }
func run() int {
	file := flag.String("config", "", "explicit private operator configuration file")
	flag.Parse()
	if *file == "" {
		fmt.Fprintln(os.Stderr, "private product host configuration required")
		return 2
	}
	f, err := os.Open(*file)
	if err != nil {
		fmt.Fprintln(os.Stderr, "private product host configuration unavailable")
		return 2
	}
	var cfg config
	decoder := json.NewDecoder(io.LimitReader(f, 1<<20))
	decoder.DisallowUnknownFields()
	err = decoder.Decode(&cfg)
	var extra any
	if err != nil || decoder.Decode(&extra) != io.EOF {
		_ = f.Close()
		fmt.Fprintln(os.Stderr, "private product host configuration invalid")
		return 2
	}
	_ = f.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	products, openErr := nativehost.OpenProducts(ctx, nativehost.ProductsConfig{Pay: payproduct.Config{StorePath: cfg.Pay.StorePath, IntegrityKey: cfg.Pay.IntegrityKey, GatewayKey: cfg.Pay.GatewayKey, BootstrapKey: cfg.Pay.BootstrapKey, PublicBaseURL: cfg.Pay.PublicBaseURL, CentralMerchantID: cfg.Pay.CentralMerchantID}, Central: cfg.Central, Cloud: cloud.OriginalPrivateHostConfig{Cloud: cloud.Config{StatePath: cfg.Cloud.StatePath, ObjectDir: cfg.Cloud.ObjectDir}}}, buildinfo.Normalize(buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}), logger)
	if openErr != nil {
		if products != nil {
			drain, stop := context.WithTimeout(context.Background(), 30*time.Second)
			defer stop()
			if err = products.Join(drain); err == nil {
				err = products.Close()
			}
		}
		logger.Error("private_products_unavailable", "cleanupComplete", err == nil)
		return 1
	}
	private, err := nativehost.OpenPrivate(products, cfg.Private)
	if err != nil {
		logger.Error("private_listener_unavailable")
	} else {
		sourceCode := ""
		if sourceErr := products.NativeSourceStatus(); sourceErr != nil {
			sourceCode = sourceErr.Error()
		}
		logger.Info("private_products_started", "nativeSourceReady", products.NativeSourceStatus() == nil, "sourceCode", sourceCode)
		select {
		case <-ctx.Done():
		case <-private.Done():
		}
	}
	drain, stop := context.WithTimeout(context.Background(), 30*time.Second)
	defer stop()
	closeErr := private.Shutdown(drain)
	if err != nil || closeErr != nil {
		logger.Error("private_products_exit", "cleanupComplete", closeErr == nil)
		return 1
	}
	logger.Info("private_products_stopped", "cleanupComplete", true, "nativeSourceReady", false)
	return 0
}
