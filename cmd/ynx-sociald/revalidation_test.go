package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestSocialRevalidationPairedConfiguration(t *testing.T) {
	clients, web, err := newSocialProductClients()
	if err != nil {
		t.Fatal(err)
	}
	if reader, err := loadSocialRevalidator(web, "", ""); err != nil || reader != nil {
		t.Fatal("disabled configuration must not require a key")
	}
	for _, pair := range [][2]string{{"synthetic-test-id", ""}, {"", "/never-open-partial"}, {" synthetic-test-id", "/never-open-invalid"}, {"synthetic-test-id", " /never-open-invalid"}, {"synthetic-test-id", "/missing-sensitive-test-key"}} {
		reader, err := loadSocialRevalidator(web, pair[0], pair[1])
		if err == nil || reader != nil || err.Error() != socialRevalidationConfigMessage || strings.Contains(err.Error(), pair[1]) && pair[1] != "" {
			t.Fatal("invalid configuration must be refused without exposing path or key")
		}
	}
	// Isolated software-QA key only, never a production producer/registry key.
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal("synthetic key fixture failed")
	}
	defer clear(private)
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal("synthetic key encoding failed")
	}
	defer clear(der)
	dir := t.TempDir()
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal("synthetic fixture physical directory unavailable")
	}
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "synthetic-qa-only.pem")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	reader, err := loadSocialRevalidator(web, "synthetic-test-id", file)
	if err != nil || reader == nil {
		t.Fatalf("approved shared protected loader/web constructor rejected isolated fixture: %v", err)
	}
	native := clients["android"].(*productsessionv2.Client)
	if reader, err := loadSocialRevalidator(native, "synthetic-test-id", file); err == nil || reader != nil {
		t.Fatal("web-only reader must not be bound to native client")
	}
	if err := os.Chmod(file, 0644); err != nil {
		t.Fatal(err)
	}
	if reader, err := loadSocialRevalidator(web, "synthetic-test-id", file); err == nil || reader != nil || err.Error() != socialRevalidationConfigMessage {
		t.Fatal("unsafe file permissions were accepted or disclosed")
	}
}
