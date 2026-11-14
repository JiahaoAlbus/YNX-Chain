//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadOperatorConfigStrictAndDoesNotExposeKeys(t *testing.T) {
	dir := t.TempDir()
	for _, key := range []string{"YNX_PAY_PRODUCT_INTEGRITY_KEY", "YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY"} {
		t.Setenv(key, strings.Repeat("ab", 32))
	}
	t.Setenv("YNX_PAY_PRODUCT_BOOTSTRAP_KEY", strings.Repeat("b", 24))
	t.Setenv("YNX_PAY_PRODUCT_CENTRAL_KEY", "test-central-key")
	cfg := OperatorConfig{ExpectedChainID: "ynx-test", PayStore: filepath.Join(dir, "pay"), PayPublicURL: "https://pay.example", CentralMerchantID: "merchant", CentralOrigin: "https://central.example", CentralLINKConfig: filepath.Join(dir, "link"), CloudState: filepath.Join(dir, "cloud"), CloudObjects: filepath.Join(dir, "objects"), Private: PrivateConfig{SocketPath: filepath.Join(dir, "pay.sock")}}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	got, product, err := ReadOperatorConfig(path)
	if err != nil || got.ExpectedChainID != cfg.ExpectedChainID || len(product.Products.Pay.IntegrityKey) != 32 {
		t.Fatalf("valid configuration: %v", err)
	}
	for _, input := range [][]byte{append(append([]byte{}, data[:len(data)-1]...), []byte(",\"unknown\":1}")...), []byte(strings.Replace(string(data), "\"expectedChainId\":\"ynx-test\"", "\"expectedChainId\":\"ynx-test\",\"expectedChainId\":\"ynx-test\"", 1))} {
		if err := os.WriteFile(path, input, 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := ReadOperatorConfig(path); err == nil || strings.Contains(err.Error(), "test-central-key") {
			t.Fatal("invalid configuration accepted or key leaked", err)
		}
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "symlink")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadOperatorConfig(link); err == nil {
		t.Fatal("symlink configuration accepted")
	}
	t.Setenv("YNX_PAY_PRODUCT_INTEGRITY_KEY", strings.Repeat("ab", 31))
	if _, _, err := ReadOperatorConfig(path); err == nil {
		t.Fatal("short hex key accepted")
	}
}
