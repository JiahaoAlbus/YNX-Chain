package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadFaucetCoreTokenPrivateFile(t *testing.T) {
	dir := t.TempDir()
	token := strings.Repeat("a", 64)
	for _, tc := range []struct {
		name, content string
		mode          os.FileMode
		ok            bool
	}{
		{"valid", token, 0600, true}, {"newline", token + "\n", 0600, true}, {"world-readable", token, 0644, false},
		{"empty", "", 0600, false}, {"placeholder", "configured", 0600, false}, {"uppercase", strings.ToUpper(token), 0600, false},
		{"large", strings.Repeat("a", 66), 0600, false}, {"leading-space", " " + token, 0600, false}, {"CRLF", token + "\r\n", 0600, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := filepath.Join(dir, tc.name)
			if err := os.WriteFile(p, []byte(tc.content), tc.mode); err != nil {
				t.Fatal(err)
			}
			got, err := loadFaucetCoreToken(p)
			if (err == nil) != tc.ok {
				t.Fatalf("accepted=%v", err == nil)
			}
			if tc.ok && got != token {
				t.Fatal("wrong token")
			}
			if err != nil && strings.Contains(err.Error(), token) {
				t.Fatal("token leaked")
			}
		})
	}
	p := filepath.Join(dir, "link")
	if err := os.Symlink(filepath.Join(dir, "valid"), p); err != nil {
		t.Fatal(err)
	}
	if _, err := loadFaucetCoreToken(p); err == nil {
		t.Fatal("symlink accepted")
	}
	if value, err := loadFaucetCoreToken(""); err != nil || value != "" {
		t.Fatal("absent token must preserve read-only startup")
	}
}
