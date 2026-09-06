package main

import (
	"strings"
	"testing"
)

func TestEthereumNativeMainnetConfigFailsBeforeStartup(t *testing.T) {
	_, err := loadNodeStartupInputs(nodeRuntimeConfig{Network: "mainnet", EthereumNativeTransfers: true})
	if err == nil || !strings.Contains(err.Error(), "not enabled for mainnet") {
		t.Fatalf("mainnet adapter must fail configuration validation: %v", err)
	}
}
