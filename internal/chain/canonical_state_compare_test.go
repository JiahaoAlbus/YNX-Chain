package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"testing"
)

func TestCombinedDetachedValidatorKeysCanonicalComparisonDoesNotGrantValidation(t *testing.T) {
	s := ConsensusMigrationState{}
	// The zero state is intentionally invalid. Matching its bytes cannot grant authority.
	if s.Validate() == nil {
		t.Fatal("invalid fixture unexpectedly validated")
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	same, err := s.MatchesCanonicalJSON(sum, len(raw))
	if err != nil || !same {
		t.Fatal("canonical byte comparison differs", same, err)
	}
	if ok, err := s.MatchesCanonicalJSON(sum, len(raw)+1); err != nil || ok {
		t.Fatal("wrong length matched", ok, err)
	}
	sum[0] ^= 1
	if ok, err := s.MatchesCanonicalJSON(sum, len(raw)); err != nil || ok {
		t.Fatal("wrong digest matched", ok, err)
	}
	var out bytes.Buffer
	if err := writeCanonicalStateJSON(&out, s, true); err != nil || !bytes.Equal(out.Bytes(), raw) {
		t.Fatal("original writer mismatch", err)
	}
}
