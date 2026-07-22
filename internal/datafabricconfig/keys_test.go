package datafabricconfig

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadEventKeysRequiresStrictFilesProductBindingAndNoTrailingJSON(t *testing.T) {
	root := t.TempDir()
	keyPath := filepath.Join(root, "pay.key")
	registryPath := filepath.Join(root, "registry.json")
	if err := os.WriteFile(keyPath, []byte("0123456789abcdef0123456789abcdef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	registry := fmt.Sprintf(`{"keys":[{"keyId":"key.pay.testnet.0001","product":"pay","keyFile":%q}]}`, keyPath)
	if err := os.WriteFile(registryPath, []byte(registry), 0o600); err != nil {
		t.Fatal(err)
	}
	keys, products, err := LoadEventKeys(registryPath)
	if err != nil || string(keys["key.pay.testnet.0001"]) != "0123456789abcdef0123456789abcdef" || products["key.pay.testnet.0001"] != "pay" {
		t.Fatalf("valid registry rejected: %v", err)
	}

	if err := os.Chmod(registryPath, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadEventKeys(registryPath); err == nil || !strings.Contains(err.Error(), "group/world") {
		t.Fatalf("unsafe registry mode accepted: %v", err)
	}
	if err := os.Chmod(registryPath, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(registryPath, []byte(registry+` {}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadEventKeys(registryPath); err == nil || !strings.Contains(err.Error(), "trailing") {
		t.Fatalf("trailing JSON accepted: %v", err)
	}
}
