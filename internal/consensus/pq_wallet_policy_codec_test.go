package consensus

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestPQWalletPolicyProjectionNativeCodecUsesActualHTTPBytes(t *testing.T) {
	owner := "0x" + strings.Repeat("1", 40)
	policy := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: bytes.Repeat([]byte{0xab}, 32), EnableAt: 1,
		Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: owner, PKA: bytes.Repeat([]byte{0xcd}, 2592), PKB: bytes.Repeat([]byte{0xef}, 64), Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 9007199254740993}}}
	raw, err := json.Marshal(PQWalletAccountView{Owner: owner, Policy: &policy})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	exact, err := ynxauth.EncodeWalletPolicyProjection(policy, owner)
	if err != nil || !bytes.Equal(fields["policy"], exact) {
		t.Fatalf("normal HTTP policy and native input diverged: %v", err)
	}
	actual, err := ynxauth.DecodeWalletPolicyProjection(fields["policy"], policy.NetworkID, owner)
	if err != nil || !reflect.DeepEqual(actual, policy) {
		t.Fatalf("actual node policy bytes cannot be consumed natively: %v", err)
	}
}
