//go:build pay_pq && pay_cloud && pay_auth_source

package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct/nativehost"
	"log/slog"
	"net/http"
)

func normalNativePayHandler(parent *payproduct.Service, build buildinfo.Info, logger *slog.Logger) (http.Handler, func(), func() error) {
	// This standalone daemon has no original in-process Core/Cloud parents.
	// Consume the real factory, retain its composition partial, and keep the
	// closed routes without original engine resources. The owning process uses
	// the same host's mutually exclusive Native or BFT boot composition.
	runtime, err := nativehost.New(parent, nativehost.Resources{}, nil, build, logger)
	if err != nil {
		logger.Info("native_source_unavailable", "source_linked", true, "source_ready", false)
		return payproduct.NewClosedProductionServerWithLogger(parent, build, logger).Handler(), runtime.Retire, runtime.Close
	}
	return runtime.Handler(), runtime.Retire, runtime.Close
}
func normalNativePaySelfCheck() map[string]any {
	runtime, err := nativehost.New(nil, nativehost.Resources{}, nil, buildinfo.Info{}, nil)
	code := ""
	if err != nil {
		code = err.Error()
	}
	partial := runtime != nil && runtime.PartialRetained()
	ready := runtime != nil && runtime.Ready()
	var cleanup error
	if runtime != nil {
		runtime.Retire()
		cleanup = runtime.Close()
	}
	return map[string]any{"sourceLinked": true, "sourceReady": ready, "sourcePartialRetained": partial, "code": code, "cleanupComplete": cleanup == nil, "rootSupplied": false, "productionFunds": false}
}
