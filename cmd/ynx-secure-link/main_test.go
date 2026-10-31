package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func TestConfigRejectsUnknownTrailingAndOversizedInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	for _, wire := range []string{`{"mode":"egress","trustedProxyHeader":true}`, `{"mode":"egress"} {}`, strings.Repeat(" ", (1<<20)+1)} {
		if err := os.WriteFile(path, []byte(wire), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readConfig(path); err == nil {
			t.Fatal("invalid config accepted")
		}
	}
	if err := os.WriteFile(path, []byte(`{"mode":"egress"}`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := readConfig(path)
	if err != nil || cfg.Mode != "egress" {
		t.Fatal(err)
	}
}
func TestCommandRequiresExplicitServiceEdgePolicy(t *testing.T) {
	if err := run(config{Mode: "egress"}); !errors.Is(err, securelink.ErrBounds) {
		t.Fatal("missing policy started proxy", err)
	}
}
