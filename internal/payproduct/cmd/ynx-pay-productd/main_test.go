package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"testing"
	"time"
)

func TestDecodeVerifierMapAcceptsExactEd25519PublicKeys(t *testing.T) {
	publicOne := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize)).Public().(ed25519.PublicKey)
	seedTwo := make([]byte, ed25519.SeedSize)
	seedTwo[0] = 1
	publicTwo := ed25519.NewKeyFromSeed(seedTwo).Public().(ed25519.PublicKey)
	raw := `{"quant-ledger-v1":"` + hex.EncodeToString(publicOne) + `","quant-ledger-v2":"` + base64.RawStdEncoding.EncodeToString(publicTwo) + `"}`
	decoded, err := decodeVerifierMap(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 2 || !decoded["quant-ledger-v1"].Equal(publicOne) || !decoded["quant-ledger-v2"].Equal(publicTwo) {
		t.Fatalf("unexpected verifier map: %+v", decoded)
	}
	decoded["quant-ledger-v1"][0] ^= 1
	if publicOne[0] == decoded["quant-ledger-v1"][0] {
		t.Fatal("decoded verifier map aliases its input")
	}
}

func TestDecodeVerifierMapFailsClosed(t *testing.T) {
	cases := []string{
		`{"quant-ledger-v1":"bad"}`,
		`[]`,
		`{"quant-ledger-v1":1}`,
	}
	for _, raw := range cases {
		if _, err := decodeVerifierMap(raw); err == nil {
			t.Fatalf("invalid verifier configuration was accepted: %s", raw)
		}
	}
	empty, err := decodeVerifierMap("")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty optional verifier map failed: %+v %v", empty, err)
	}
}

func TestDecodeKeyDoesNotDowngradeShortHexToBase64(t *testing.T) {
	key := bytes.Repeat([]byte{0x4a}, 32)
	for name, encoded := range map[string]string{
		"hex":        hex.EncodeToString(key),
		"prefixed":   "0x" + hex.EncodeToString(key),
		"raw-base64": base64.RawStdEncoding.EncodeToString(key),
	} {
		t.Run(name, func(t *testing.T) {
			decoded, err := decodeKey(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(decoded, key) {
				t.Fatalf("decoded key mismatch: got %x want %x", decoded, key)
			}
		})
	}
	if _, err := decodeKey(hex.EncodeToString(bytes.Repeat([]byte{1}, 31))); err == nil {
		t.Fatal("short hex key was accepted through format fallback")
	}
	if _, err := decodeKey("not-a-key"); err == nil {
		t.Fatal("invalid key was accepted")
	}
}

func TestOptionalMinutesUsesBoundedPositiveInput(t *testing.T) {
	t.Setenv("YNX_TEST_MINUTES", "15")
	value, err := optionalMinutes("YNX_TEST_MINUTES", 60)
	if err != nil || value != 15*time.Minute {
		t.Fatalf("unexpected parsed duration: %v %v", value, err)
	}
	t.Setenv("YNX_TEST_MINUTES", "0")
	if _, err := optionalMinutes("YNX_TEST_MINUTES", 60); err == nil {
		t.Fatal("zero duration was accepted")
	}
	t.Setenv("YNX_TEST_MINUTES", "")
	value, err = optionalMinutes("YNX_TEST_MINUTES", 60)
	if err != nil || value != time.Hour {
		t.Fatalf("fallback duration failed: %v %v", value, err)
	}
}
