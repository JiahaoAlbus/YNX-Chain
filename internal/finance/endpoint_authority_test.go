package finance

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestNodeEndpointAuthorityRejectsMissingPartialAndRelativeConfiguration(t *testing.T) {
	gate, err := NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{})
	if err != nil {
		t.Fatal(err)
	}
	err = gate.Authorize(context.Background())
	var rejected *productsessionv2.Error
	if !errors.As(err, &rejected) || rejected.Code != "FINANCE_AUTHORITY_V2_NOT_CONFIGURED" {
		t.Fatal(err)
	}
	if _, err = NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{NodeBinary: "/bin/sh"}); err == nil {
		t.Fatal("partial config accepted")
	}
	if _, err = NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{NodeBinary: "bin/sh", Script: "/tmp/script", TrustRootFile: "/tmp/root", ManifestFile: "/tmp/manifest", CheckpointFile: "/tmp/checkpoint", TrustedTimeFile: "/tmp/time"}); err == nil {
		t.Fatal("relative executable accepted")
	}
}

func TestNodeEndpointAuthorityUsesFixedNoArgumentProcessAndStrictResponse(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "authority.sh")
	body := "#!/bin/sh\n[ \"$#\" -eq 0 ] || exit 91\n[ -n \"$YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE\" ] || exit 92\nprintf '%s\\n' '{\"schemaVersion\":\"ynx-finance-endpoint-authority-runtime/v1\",\"status\":\"VERIFIED\",\"walletGateway\":\"https://wallet-auth.ynxweb4.com\",\"financeOrigin\":\"https://finance.ynxweb4.com\",\"manifestVersion\":\"2.0.0.1\",\"payloadSha256\":\"" + strings.Repeat("a", 64) + "\",\"officialSandboxVerified\":false,\"providerVerified\":false,\"productionApproved\":false}'\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	config := NodeEndpointAuthorityConfig{NodeBinary: "/bin/sh", Script: script, TrustRootFile: filepath.Join(dir, "root"), ManifestFile: filepath.Join(dir, "manifest"), CheckpointFile: filepath.Join(dir, "checkpoint"), TrustedTimeFile: filepath.Join(dir, "time"), Timeout: time.Second}
	gate, err := NewNodeEndpointAuthority(config)
	if err != nil {
		t.Fatal(err)
	}
	if err = gate.Authorize(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(script, []byte(body+"printf warning >&2\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	err = gate.Authorize(context.Background())
	var rejected *productsessionv2.Error
	if !errors.As(err, &rejected) || rejected.Code != "FINANCE_AUTHORITY_V2_INVALID_RESPONSE" || rejected.Status != http.StatusServiceUnavailable {
		t.Fatal(err)
	}
}
