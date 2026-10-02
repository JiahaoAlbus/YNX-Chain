package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMatrixDirectoryUsesExplicitPublicExistingBindingsOnly(t *testing.T) {
	if directory, err := loadMatrixDirectory(""); err != nil || directory != nil {
		t.Fatal("missing configuration fabricated a homeserver")
	}
	path := filepath.Join(t.TempDir(), "existing-public-matrix-directory.json")
	account := "ynx1" + strings.Repeat("a", 38)
	content := `{"schemaVersion":"ynx-social-matrix-directory/v1","bindings":[{"account":"` + account + `","homeserver":"https://matrix.example.test/","serverName":"matrix.example.test","userId":"@old-user:matrix.example.test"}]}`
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	directory, err := loadMatrixDirectory(path)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := directory.Resolve(account)
	if err != nil || identity.UserID != "@old-user:matrix.example.test" {
		t.Fatal("historical mapping replaced")
	}
	if _, err := loadMatrixDirectory(path + ".missing"); err == nil {
		t.Fatal("configured missing file silently ignored")
	}
	if err := os.WriteFile(path, []byte(`{"accessToken":"fixture"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadMatrixDirectory(path); err == nil {
		t.Fatal("credentials accepted as public mapping")
	}
}
