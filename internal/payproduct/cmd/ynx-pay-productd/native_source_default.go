//go:build !pay_auth_source

package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"log/slog"
	"net/http"
)

func normalNativePayHandler(parent *payproduct.Service, build buildinfo.Info, logger *slog.Logger) (http.Handler, func(), func() error) {
	return payproduct.NewClosedProductionServerWithLogger(parent, build, logger).Handler(), func() {}, func() error { return nil }
}
func normalNativePaySelfCheck() map[string]any {
	return map[string]any{"sourceLinked": false, "sourceReady": false, "code": "NATIVE_PAY_SOURCE_NOT_LINKED", "rootSupplied": false, "productionFunds": false}
}
