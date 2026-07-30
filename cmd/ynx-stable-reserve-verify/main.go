package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/stablereserve"
)

func main() {
	inputPath := flag.String("input", "", "path to a provider-signed reserve attestation JSON")
	publicKeyValue := flag.String("public-key", "", "base64 raw Ed25519 public key")
	keyID := flag.String("key-id", "", "expected attestation key ID")
	asset := flag.String("asset", "YUSD", "expected asset")
	network := flag.String("network", "ynx-testnet", "expected network")
	maxAge := flag.Duration("max-age", 24*time.Hour, "maximum accepted attestation age")
	flag.Parse()
	if strings.TrimSpace(*inputPath) == "" || strings.TrimSpace(*publicKeyValue) == "" || strings.TrimSpace(*keyID) == "" {
		exitError("input, public-key and key-id are required")
	}
	raw, err := os.ReadFile(*inputPath)
	if err != nil {
		exitError(err.Error())
	}
	var attestation stablereserve.Attestation
	if err := json.Unmarshal(raw, &attestation); err != nil {
		exitError("decode attestation: " + err.Error())
	}
	publicKey, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(*publicKeyValue))
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		exitError("public-key must be a base64 raw Ed25519 public key")
	}
	snapshot, err := (stablereserve.Verifier{
		Keys:   map[string]ed25519.PublicKey{strings.TrimSpace(*keyID): publicKey},
		MaxAge: *maxAge, Asset: strings.TrimSpace(*asset), Network: strings.TrimSpace(*network),
	}).Verify(attestation)
	if err != nil {
		exitError(err.Error())
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(snapshot); err != nil {
		exitError(err.Error())
	}
	if snapshot.Failure {
		os.Exit(2)
	}
}

func exitError(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
