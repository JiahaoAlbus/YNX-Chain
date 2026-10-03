package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
)

func TestDecodeIntegrityKeyMatchesProductServerFormats(t *testing.T) {
	key := bytes.Repeat([]byte{0x5a}, 32)
	for name, encoded := range map[string]string{
		"hex":        hex.EncodeToString(key),
		"prefixed":   "0x" + hex.EncodeToString(key),
		"raw-base64": base64.RawStdEncoding.EncodeToString(key),
	} {
		t.Run(name, func(t *testing.T) {
			decoded, err := decodeIntegrityKey(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(decoded, key) {
				t.Fatalf("decoded key mismatch: got %x want %x", decoded, key)
			}
		})
	}
}

func TestDecodeIntegrityKeyFailsClosed(t *testing.T) {
	for name, encoded := range map[string]string{
		"missing": "",
		"invalid": "not-a-valid-key",
		"short":   hex.EncodeToString(bytes.Repeat([]byte{1}, 31)),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeIntegrityKey(encoded); err == nil {
				t.Fatalf("invalid integrity key %q was accepted", name)
			}
		})
	}
}

func TestRunRejectsUnknownCommandsAndMissingFlags(t *testing.T) {
	key := hex.EncodeToString(bytes.Repeat([]byte{0x33}, 32))
	t.Setenv("YNX_PAY_PRODUCT_INTEGRITY_KEY", key)

	for name, args := range map[string][]string{
		"missing command":             nil,
		"unknown command":             {"erase"},
		"verify missing store":        {"verify"},
		"backup missing output":       {"backup", "--store", "state.json"},
		"restore missing destination": {"restore", "--backup", "backup.json"},
	} {
		t.Run(name, func(t *testing.T) {
			err := run(args)
			if err == nil {
				t.Fatal("invalid command was accepted")
			}
			if strings.TrimSpace(err.Error()) == "" {
				t.Fatal("invalid command returned an empty error")
			}
		})
	}
}

func TestRunRequiresIntegrityKeyBeforeFileAccess(t *testing.T) {
	t.Setenv("YNX_PAY_PRODUCT_INTEGRITY_KEY", "")
	if err := run([]string{"verify", "--store", "missing.json"}); err == nil || !strings.Contains(err.Error(), "YNX_PAY_PRODUCT_INTEGRITY_KEY") {
		t.Fatalf("missing integrity key did not fail closed: %v", err)
	}
}
