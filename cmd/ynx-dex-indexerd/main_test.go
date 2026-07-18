package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadTokensStrictIdentityAndEmptyStatus(t *testing.T) {
	valid := filepath.Join(t.TempDir(), "valid.json")
	if err := os.WriteFile(valid, []byte(`{"schemaVersion":1,"productId":"ynx-dex","chainId":6423,"mainnet":false,"tokens":[],"status":"no-owner-reviewed-test-tokens"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tokens, err := loadTokens(valid)
	if err != nil || len(tokens) != 0 {
		t.Fatalf("valid empty list: %v", err)
	}
	for name, body := range map[string]string{
		"unknown":   `{"schemaVersion":1,"productId":"ynx-dex","chainId":6423,"mainnet":false,"tokens":[],"status":"no-owner-reviewed-test-tokens","extra":true}`,
		"mainnet":   `{"schemaVersion":1,"productId":"ynx-dex","chainId":6423,"mainnet":true,"tokens":[],"status":"no-owner-reviewed-test-tokens"}`,
		"dishonest": `{"schemaVersion":1,"productId":"ynx-dex","chainId":6423,"mainnet":false,"tokens":[],"status":"owner-reviewed-testnet"}`,
	} {
		path := filepath.Join(t.TempDir(), name+".json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadTokens(path); err == nil {
			t.Fatalf("accepted %s token list", name)
		}
	}
}

func TestLoadTokensReviewedEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	body := `{"schemaVersion":1,"productId":"ynx-dex","chainId":6423,"mainnet":false,"tokens":[{"chainId":6423,"address":"0x0000000000000000000000000000000000000001","symbol":"TYNX","name":"Test YNX","decimals":18,"standard":"ERC-20","reviewStatus":"owner-reviewed-testnet"}],"status":"owner-reviewed-testnet"}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	tokens, err := loadTokens(path)
	if err != nil || len(tokens) != 1 || !strings.EqualFold(tokens[0].Address, "0x0000000000000000000000000000000000000001") {
		t.Fatalf("reviewed list: %#v %v", tokens, err)
	}
}
