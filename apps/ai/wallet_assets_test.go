package main

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestEmbeddedDerivedWalletMatchesReviewedSource(t *testing.T) {
	bytes, err := assets.ReadFile("web/vendor/wallet-connection-ai039-shared1a8.mjs")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(bytes)
	if len(bytes) != 562596 || hex.EncodeToString(digest[:]) != "9b55c017830bbfdf67bf4715a00f15f172d596b0a2b22468e8ce4de32ffa1865" {
		t.Fatal("embedded Wallet vendor differs from reviewed derived asset")
	}
	client, err := assets.ReadFile("web/wallet-client.mjs")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(client), "import('./vendor/wallet-connection-ai039-shared1a8.mjs')") {
		t.Fatal("embedded consumer does not load the current vendor")
	}
}
