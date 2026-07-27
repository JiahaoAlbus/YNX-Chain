package main

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func TestDecodeProviderEventKeySet(t *testing.T) {
	hexKey := strings.Repeat("ab", 32)
	base64Key := base64.RawStdEncoding.EncodeToString(bytes.Repeat([]byte{0x61}, 32))
	keys, err := decodeKeySet(`{"provider-2026-06":"` + hexKey + `","provider-2026-07":"` + base64Key + `"}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 || len(keys["provider-2026-06"]) != 32 || len(keys["provider-2026-07"]) != 32 {
		t.Fatalf("decoded provider key set is incomplete: %#v", keys)
	}

	for _, raw := range []string{
		`{}`,
		`[]`,
		`{"provider-2026-07":"short"}`,
		`{"provider-2026-07":7}`,
	} {
		if _, err := decodeKeySet(raw); err == nil {
			t.Fatalf("unsafe provider key set accepted: %s", raw)
		}
	}
}
