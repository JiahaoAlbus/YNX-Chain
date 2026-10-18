package consensus

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func TestPQStakingTransportPreservesMemberAndOriginalThreeFieldBytes(t *testing.T) {
	f := newABCIRevocationFixture(t)
	wire := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: f.m.Validators[0].Address, AmountYNXT: 20}, 2, 1)
	old, err := EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	for _, originals := range [][][]byte{nil, {}} {
		raw, err := EncodePQStakingActionTransaction(wire, originals)
		if err != nil || !bytes.Equal(raw, old) {
			t.Fatalf("empty witness changed the original transport: %v", err)
		}
	}
	classic := mustStakingAction(t, f.classic, ActionStakeDelegate, StakeDelegatePayload{Validator: f.m.Validators[0].Address, AmountYNXT: 20}, 1)
	originals := [][]byte{classic}
	raw, err := EncodePQStakingActionTransaction(wire, originals)
	if err != nil {
		t.Fatal(err)
	}
	gotWire, action, gotOriginals, err := DecodePQStakingActionTransaction(raw)
	if err != nil || !bytes.Equal(gotWire, wire) || action.Kind != ActionStakeDelegate || !reflect.DeepEqual(gotOriginals, originals) || SignedTransactionHash(old) == SignedTransactionHash(raw) {
		t.Fatalf("transport changed the Member/originals or hid its distinct ABCI identity: %v", err)
	}
	for _, decode := range []func([]byte) ([]byte, ynxauth.Action, error){DecodePQNativeActionTransaction, DecodePQActionTransport} {
		got, a, err := decode(raw)
		if err != nil || !bytes.Equal(got, wire) || !reflect.DeepEqual(a, action) {
			t.Fatalf("normal action caller lost the original staking evidence: %v", err)
		}
	}
	// No extra fields, repeated keys, alternate base64, null/empty witness
	// spelling, trailing data or a noncanonical original may create a second
	// accepted encoding of one transport.
	for _, bad := range [][]byte{
		append(bytes.Clone(raw), '\n'),
		append(bytes.Clone(raw[:len(raw)-1]), []byte(`,"unknown":true}`)...),
		bytes.Replace(raw, []byte(`{"version":1,`), []byte(`{"version":1,"version":1,`), 1),
		bytes.Replace(raw, []byte(base64.StdEncoding.EncodeToString(classic)), []byte(base64.StdEncoding.EncodeToString(classic)+`\n`), 1),
		append(bytes.Clone(old[:len(old)-1]), []byte(`,"originals":null}`)...),
		append(bytes.Clone(old[:len(old)-1]), []byte(`,"originals":[]}`)...),
	} {
		if _, _, _, err := DecodePQStakingActionTransaction(bad); err == nil {
			t.Fatal("malleable staking transport was accepted")
		}
		if _, _, err := DecodePQActionTransport(bad); err == nil {
			t.Fatal("generic action decoder bypassed staking canonical encoding")
		}
	}
	for _, bad := range [][][]byte{{nil}, {append(bytes.Clone(classic), '\n')}, {make([]byte, MaxSignedActionSize+1)}} {
		if _, err := EncodePQStakingActionTransaction(wire, bad); err == nil {
			t.Fatal("invalid original classic transaction was accepted")
		}
	}
	other := pqABCIContractWire(t, f, f.key, f.owner, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1}, 2, 0)
	if _, err := EncodePQStakingActionTransaction(other, originals); err == nil {
		t.Fatal("validator staking evidence was enabled for another action")
	}
	var envelope PQStakingActionTransaction
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.WireHex = hex.EncodeToString(other)
	wrongKind, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := DecodePQActionTransport(wrongKind); err == nil {
		t.Fatal("generic action decoder accepted staking evidence on another kind")
	}
	// Keep all original byte slices shared: admission must reject the aggregate
	// at the existing bound before materializing its complete JSON encoding.
	count := MaxPQContractTransactionBytes/(4*((len(classic)+2)/3)+3) + 1
	tooMany := make([][]byte, count)
	for i := range tooMany {
		tooMany[i] = classic
	}
	if _, err := EncodePQStakingActionTransaction(wire, tooMany); err == nil {
		t.Fatal("aggregate original evidence exceeded the existing transport bound")
	}
}
