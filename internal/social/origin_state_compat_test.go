package social

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMixedOriginStatePreservesAuthenticatedEncoding(t *testing.T) {
	state := newState()
	state.WalletChallenges["legacy"] = PendingWalletChallenge{
		Challenge: ProductSessionChallenge{Version: "1"},
		Approval:  WalletApproval{Version: "1"},
	}
	state.WalletChallenges["bound"] = PendingWalletChallenge{
		Challenge: ProductSessionChallenge{Version: "2", Origin: Origin},
		Approval:  WalletApproval{Version: "2", Origin: Origin},
	}
	path := filepath.Join(t.TempDir(), "social.json")
	key := bytes.Repeat([]byte{0x37}, 32)
	if err := saveState(path, &state, key); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Challenges map[string]map[string]map[string]json.RawMessage `json:"walletChallenges"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	for _, member := range []string{"challenge", "approval"} {
		if _, present := document.Challenges["legacy"][member]["origin"]; present {
			t.Fatalf("legacy %s must not gain an origin field", member)
		}
		if _, present := document.Challenges["bound"][member]["origin"]; !present {
			t.Fatalf("bound %s must retain its origin field", member)
		}
	}
	loaded, existed, err := loadState(path, key)
	if err != nil || !existed {
		t.Fatalf("mixed state did not authenticate: existed=%v err=%v", existed, err)
	}
	if loaded.WalletChallenges["legacy"].Approval.Origin != "" || loaded.WalletChallenges["bound"].Approval.Origin != Origin {
		t.Fatal("persisted origin semantics changed")
	}
	tampered := bytes.Replace(data, []byte(Origin), []byte("https://invalid.example"), 1)
	if bytes.Equal(data, tampered) {
		t.Fatal("test failed to tamper with origin")
	}
	if err := os.WriteFile(path, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadState(path, key); err == nil {
		t.Fatal("tampered origin bypassed integrity verification")
	}
}
