package main

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativePayNotificationOriginalCredentialFileIsExplicitPrivateAndFinite(t *testing.T) {
	if rows, err := loadOriginalNativePayNotificationReceivers(""); err != nil || len(rows) != 0 {
		t.Fatal("default enabled a receiver")
	}
	root := t.TempDir()
	path := filepath.Join(root, "PUBLIC-credentials.json")
	secret := []byte(strings.Repeat("PUBLIC-", 8))
	body := `{"version":"ynx.shop.native-pay-notification-receivers/v1","receivers":[{"merchantId":"mer_original","storeId":"store_original","secretVersion":2,"secretHex":"` + hex.EncodeToString(secret) + `"}]}`
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	rows, err := loadOriginalNativePayNotificationReceivers(path)
	if err != nil || len(rows) != 1 || rows[0].SecretVersion != 2 || string(rows[0].Secret) != string(secret) {
		t.Fatal("original explicit credential did not load", err)
	}
	for _, mode := range []string{"relative", "public-permissions", "symlink", "unknown-field", "wrong-purpose", "duplicate-merchant", "weak-key", "oversized"} {
		p := path
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, 0600); err != nil {
			t.Fatal(err)
		}
		switch mode {
		case "relative":
			p = "PUBLIC-credentials.json"
		case "public-permissions":
			os.Chmod(path, 0644)
		case "symlink":
			p = filepath.Join(root, "alias")
			if err := os.Symlink(path, p); err != nil {
				t.Fatal(err)
			}
		case "unknown-field":
			os.WriteFile(path, []byte(strings.Replace(body, `"version":`, `"SourceGrant":true,"version":`, 1)), 0600)
		case "wrong-purpose":
			os.WriteFile(path, []byte(strings.Replace(body, "ynx.shop.native-pay-notification-receivers/v1", "other-purpose", 1)), 0600)
		case "duplicate-merchant":
			start := strings.Index(body, `[{`) + 1
			end := strings.LastIndex(body, `]`)
			os.WriteFile(path, []byte(body[:end]+","+body[start:end]+body[end:]), 0600)
		case "weak-key":
			os.WriteFile(path, []byte(strings.Replace(body, hex.EncodeToString(secret), "abcd", 1)), 0600)
		case "oversized":
			os.WriteFile(path, []byte(strings.Repeat(" ", 65537)), 0600)
		}
		if _, err := loadOriginalNativePayNotificationReceivers(p); err == nil {
			t.Fatal("accepted", mode)
		}
	}
}
