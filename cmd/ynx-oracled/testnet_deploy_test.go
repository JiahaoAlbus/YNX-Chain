package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle"
	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle/providers"
)

type testnetProviderDeployment struct {
	ID              string `json:"id"`
	Adapter         string `json:"adapter"`
	Symbol          string `json:"symbol"`
	Market          string `json:"market"`
	Scale           int64  `json:"scale"`
	IntervalSeconds int64  `json:"intervalSeconds"`
	SignerPath      string `json:"signerPath"`
}

func testnetRegistryProvider(t *testing.T, adapter, symbol string, now time.Time) (oracle.Provider, ed25519.PrivateKey) {
	t.Helper()
	route, err := providers.ResolveOfficialRoute(adapter, symbol)
	if err != nil {
		t.Fatal(err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	provider := oracle.Provider{
		ID: route.ProviderID, Name: "Approved Testnet " + route.ProviderID,
		Endpoint: route.Endpoint, APIVersion: route.APIVersion, AssetMarketCoverage: []string{"BTC/USD"},
		License: "isolated test fixture", TermsURL: "https://terms.test.ynx.invalid/" + route.ProviderID,
		PermittedStorage: "isolated test fixture", Authentication: "Ed25519 reporter signature",
		RateLimit: "one request per five seconds", TimestampSemantics: "official venue event time",
		Precision: "1e-6", Timezone: "UTC", Region: "isolated test", Jurisdiction: "isolated test",
		Cost: "not applicable", Retention: "test lifetime", DataRights: "isolated test fixture",
		Fallback: "fail closed", DecommissionPlan: "delete isolated test fixture", Status: "active",
		ReporterID: "reporter:" + route.ProviderID, ReporterPublicKeyHex: hex.EncodeToString(publicKey),
		WeightPPM: 1_000_000, UpdatedAt: now,
	}
	if err := provider.Validate(); err != nil {
		t.Fatal(err)
	}
	return provider, privateKey
}

func TestOracleTestnetPackageAndConfigPreflight(t *testing.T) {
	if testing.Short() {
		t.Skip("cross-compiling the Testnet release bundle is an integration check")
	}
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", ".."))
	now := time.Date(2026, 7, 27, 0, 0, 0, 0, time.UTC)
	fixtureDir := t.TempDir()
	definitions := []struct{ adapter, symbol string }{
		{"coinbase", "BTC-USD"},
		{"kraken", "BTC/USD"},
		{"bitstamp", "btcusd"},
	}
	registry := registryFile{Schema: oracle.SchemaVersion}
	deployments := make([]testnetProviderDeployment, 0, len(definitions))
	localSignerPaths := make(map[string]string, len(definitions))
	for _, definition := range definitions {
		provider, privateKey := testnetRegistryProvider(t, definition.adapter, definition.symbol, now)
		registry.Providers = append(registry.Providers, provider)
		signerPath := filepath.Join(fixtureDir, provider.ID+".key")
		if err := os.WriteFile(signerPath, []byte(hex.EncodeToString(privateKey)+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		localSignerPaths[provider.ID] = signerPath
		deployments = append(deployments, testnetProviderDeployment{
			ID: provider.ID, Adapter: definition.adapter, Symbol: definition.symbol, Market: "BTC/USD",
			Scale: 1_000_000, IntervalSeconds: 5,
			SignerPath: "/etc/ynx-oracle/signers/" + provider.ID + ".key",
		})
	}
	registryPath := filepath.Join(fixtureDir, "providers.json")
	registryData, err := json.Marshal(registry)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(registryPath, registryData, 0o600); err != nil {
		t.Fatal(err)
	}
	deploymentPath := filepath.Join(fixtureDir, "deployment.json")
	deploymentData, err := json.Marshal(map[string]any{
		"schema": "ynx.oracle.testnet-deployment.v1", "providers": deployments,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(deploymentPath, deploymentData, 0o600); err != nil {
		t.Fatal(err)
	}

	oracleCheck := exec.Command("go", "run", "./cmd/ynx-oracled",
		"--state", filepath.Join(fixtureDir, "state.json"),
		"--providers", registryPath,
		"--nonce-domain", "ynx-oracle-testnet-v1",
		"--public-origin", "https://oracle-web.test.ynx.invalid",
		"--check-config",
	)
	oracleCheck.Dir = root
	oracleCheck.Env = append(os.Environ(), "YNX_ORACLE_STATE_HMAC_KEY_HEX="+strings.Repeat("ab", 32))
	if output, err := oracleCheck.CombinedOutput(); err != nil {
		t.Fatalf("Oracle config preflight failed: %v\n%s", err, output)
	}
	for _, deployment := range deployments {
		providerCheck := exec.Command("go", "run", "./cmd/ynx-oracle-provider",
			"--providers", registryPath,
			"--provider-id", deployment.ID,
			"--adapter", deployment.Adapter,
			"--symbol", deployment.Symbol,
			"--market", deployment.Market,
			"--scale", "1000000",
			"--oracle", "http://127.0.0.1:6470",
			"--signer", localSignerPaths[deployment.ID],
			"--sequence-state", filepath.Join(fixtureDir, deployment.ID+".sequence"),
			"--nonce-domain", "ynx-oracle-testnet-v1",
			"--interval", "5s",
			"--check-config",
		)
		providerCheck.Dir = root
		if output, err := providerCheck.CombinedOutput(); err != nil {
			t.Fatalf("%s config preflight failed: %v\n%s", deployment.ID, err, output)
		}
	}
	tamperedRegistry := registry
	tamperedRegistry.Providers = append([]oracle.Provider(nil), registry.Providers...)
	tamperedRegistry.Providers[0].Endpoint = "https://unregistered.test.ynx.invalid/ticker"
	tamperedPath := filepath.Join(fixtureDir, "tampered-providers.json")
	tamperedData, err := json.Marshal(tamperedRegistry)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tamperedPath, tamperedData, 0o600); err != nil {
		t.Fatal(err)
	}
	first := deployments[0]
	tamperedCheck := exec.Command("go", "run", "./cmd/ynx-oracle-provider",
		"--providers", tamperedPath,
		"--provider-id", first.ID,
		"--adapter", first.Adapter,
		"--symbol", first.Symbol,
		"--market", first.Market,
		"--scale", "1000000",
		"--oracle", "http://127.0.0.1:6470",
		"--signer", localSignerPaths[first.ID],
		"--sequence-state", filepath.Join(fixtureDir, first.ID+"-tampered.sequence"),
		"--nonce-domain", "ynx-oracle-testnet-v1",
		"--interval", "5s",
		"--check-config",
	)
	tamperedCheck.Dir = root
	if output, err := tamperedCheck.CombinedOutput(); err == nil || !strings.Contains(string(output), "does not match provider registry authority") {
		t.Fatalf("tampered official route was not rejected: err=%v\n%s", err, output)
	}

	commitOutput, err := exec.Command("git", "-C", root, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	commit := strings.TrimSpace(string(commitOutput))
	tarball := filepath.Join(root, "tmp", "deploy", "ynx-oracle-"+commit+"-linux-amd64.tar.gz")
	t.Cleanup(func() { _ = os.Remove(tarball) })
	packageCommand := exec.Command("bash", filepath.Join(root, "scripts", "deploy", "deploy-oracle-testnet.sh"))
	packageCommand.Dir = root
	packageCommand.Env = append(os.Environ(),
		"PACKAGE_ONLY=1",
		"ORACLE_API_DOMAIN=oracle-api.test.ynx.invalid",
		"ORACLE_PUBLIC_ORIGIN=https://oracle-web.test.ynx.invalid",
		"ORACLE_PROVIDER_REGISTRY="+registryPath,
		"ORACLE_PROVIDER_DEPLOYMENT_JSON="+deploymentPath,
		"ORACLE_NONCE_DOMAIN=ynx-oracle-testnet-v1",
		"ORACLE_TARGET_ARCH=amd64",
	)
	if output, err := packageCommand.CombinedOutput(); err != nil {
		t.Fatalf("Testnet package failed: %v\n%s", err, output)
	}
	archiveCheck := exec.Command("tar", "-tzf", tarball)
	archive, err := archiveCheck.Output()
	if err != nil {
		t.Fatal(err)
	}
	listing := string(archive)
	for _, required := range []string{
		"/bin/ynx-oracled",
		"/bin/ynx-oracle-provider",
		"/config/providers.json",
		"/config/release.json",
		"/systemd/ynx-oracled.service",
		"/systemd/ynx-oracle-provider-coinbase-exchange.service",
		"/caddy/ynx-oracle.caddy",
		"/SHA256SUMS",
	} {
		if !strings.Contains(listing, required) {
			t.Fatalf("release archive missing %s:\n%s", required, listing)
		}
	}
}
