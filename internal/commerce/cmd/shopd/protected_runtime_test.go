package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	"testing"
)

func TestShopRuntimeEmptyRetainsPublicOnly(t *testing.T) {
	r, err := prepareOriginalShopRuntime(context.Background(), originalShopFiles{})
	if err != nil || r == nil {
		t.Fatalf("runtime %v err %v", r, err)
	}
	b, s, i, bd, sd, err := r.servers(context.Background(), nil, commerce.ServerConfig{})
	if err != nil || b != nil || s != nil || i != nil || bd != nil || sd != nil {
		t.Fatal("empty input activated private")
	}
}
func TestShopRuntimePartialAndUnattestedInputsClosed(t *testing.T) {
	for _, f := range []originalShopFiles{{keyID: "partial"}, {keyID: "unattested", keyFile: "/must-not-read-key", sealFile: "/must-not-read-seal"}} {
		if _, err := prepareOriginalShopRuntime(context.Background(), f); err == nil {
			t.Fatal("missing source guard accepted")
		}
	}
}
func TestShopRuntimeCanceledBeforeConfiguration(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := prepareOriginalShopRuntime(ctx, originalShopFiles{}); err == nil {
		t.Fatal("canceled runtime accepted")
	}
}
