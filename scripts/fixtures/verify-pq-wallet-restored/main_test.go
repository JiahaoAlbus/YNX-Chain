package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// These are public bytes produced by the actual Wallet R24 worker after
// encrypted-vault recovery in a distinct process. No private vault, password or
// key material is copied here; the original policy/message predate recovery.
func TestActualWalletR24RestoredSignatureMatchesOriginalFullKeysAndMessage(t *testing.T) {
	dir := "testdata/r24-wallet-fresh-process"
	pins := map[string]string{
		"state.json":  "1676d4db31c308c708d093cdd94cf024b943ae7746805a2db9905b69fd8d97c3",
		"message.bin": "ec0e34acf10e102337d441c507abeced867ef928e2d0a9e345c73a4d580225a4",
		"member.bin":  "6f09d79a1fa6e04cd986ec9425f1fdf71a2df445379f07d5b0d1ddd1fea2753f",
	}
	files := make(map[string][]byte)
	for name, pin := range pins {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprintf("%x", sha256.Sum256(raw)) != pin {
			t.Fatalf("changed original Wallet public input: %s", name)
		}
		files[name] = raw
	}
	raw, err := os.ReadFile(filepath.Join(dir, "binding.json"))
	if err != nil {
		t.Fatal(err)
	}
	var b binding
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatal(err)
	}
	original, err := json.Marshal(b.Policy)
	if err != nil {
		t.Fatal(err)
	}
	var publicPolicy ynxauth.State
	if err := json.Unmarshal(files["state.json"], &publicPolicy); err != nil {
		t.Fatal(err)
	}
	expected, err := json.Marshal(publicPolicy)
	if err != nil || !bytes.Equal(original, expected) {
		t.Fatal("verification binding differs from the original parent policy")
	}
	transfer, err := ynxauth.DecodeTransfer(files["message.bin"])
	if err != nil || transfer.Nonce != 9007199254740994 {
		t.Fatal("original exact-u64 Wallet typed transfer was changed")
	}
	result, err := verify(raw, files["message.bin"], files["member.bin"])
	if err != nil || result["verified"] != true || result["actionKind"] != "transfer" {
		t.Fatalf("actual Wallet recovered-key dual signature failed Go verification: %v %v", result, err)
	}
	t.Log("actual Wallet R24 public signature verified against original full keys and exact parent message; ledger/GUI authority is separate")
}

func restoreFixture(t *testing.T) (binding, []byte, []byte) {
	t.Helper()
	k, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer k.Destroy()
	network := bytes.Repeat([]byte{0x81}, 32)
	owner := "0x1111111111111111111111111111111111111111"
	payload, err := ynxauth.EncodeActionPayload(ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1})
	if err != nil {
		t.Fatal(err)
	}
	a := ynxauth.Action{ChainID: network, NativeChainID: 6423, Owner: owner, Nonce: 2, Fee: 1, Kind: ynxauth.ActionStake, Payload: payload}
	message, err := a.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	batch, err := ynxbatch.BatchSign(k, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message, message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 1)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	b := binding{Version: bindingVersion, Owner: owner, ExecutionHeight: "3", NativeChainID: "6423", Policy: ynxauth.State{
		Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: 1,
		Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: owner, PKA: public.PKA, PKB: public.PKB, Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}},
	}}
	return b, message, wire
}

func TestRestoreVerifierBindsOriginalPublicKeysBothBranchesAndIntent(t *testing.T) {
	b, message, wire := restoreFixture(t)
	raw, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := verify(raw, message, wire); err != nil || result["verified"] != true || result["authorizesLedgerExecution"] != false {
		t.Fatalf("real dual-signature positive control: %v %v", result, err)
	}
	for _, branch := range []string{"signature A", "signature B", "path A", "path B"} {
		t.Run(branch, func(t *testing.T) {
			m, err := ynxbatch.DecodeMember(wire)
			if err != nil {
				t.Fatal(err)
			}
			switch branch {
			case "signature A":
				m.Certificate.SigmaA[0] ^= 1
			case "signature B":
				m.Certificate.SigmaB[0] ^= 1
			case "path A":
				m.PathA[0][0] ^= 1
			case "path B":
				m.PathB[0][0] ^= 1
			}
			changed, err := ynxbatch.EncodeMember(m)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := verify(raw, message, changed); err == nil {
				t.Fatal("independent invalid branch accepted")
			}
		})
	}
	for _, kind := range []string{"public key A", "public key B", "network", "height", "native chain", "owner"} {
		t.Run(kind, func(t *testing.T) {
			var changed binding
			if err := json.Unmarshal(raw, &changed); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "public key A":
				changed.Policy.Records[0].PKA[0] ^= 1
			case "public key B":
				changed.Policy.Records[0].PKB[0] ^= 1
			case "network":
				changed.Policy.NetworkID[0] ^= 1
			case "height":
				changed.ExecutionHeight = "1"
			case "native chain":
				changed.NativeChainID = "6424"
			case "owner":
				changed.Owner = "0x2222222222222222222222222222222222222222"
			}
			encoded, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := verify(encoded, message, wire); err == nil {
				t.Fatal("changed original test binding accepted")
			}
		})
	}
	a, err := ynxauth.DecodeAction(message)
	if err != nil {
		t.Fatal(err)
	}
	a.Nonce++
	changed, err := a.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verify(raw, changed, wire); err == nil {
		t.Fatal("different original intent accepted")
	}
}

func TestRestoreVerifierCommandConsumesOnlyBoundedPublicFiles(t *testing.T) {
	b, message, wire := restoreFixture(t)
	raw, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	args := []string{}
	for _, file := range []struct {
		name string
		raw  []byte
	}{{"binding", raw}, {"message", message}, {"member", wire}} {
		path := filepath.Join(dir, file.name)
		if err := os.WriteFile(path, file.raw, 0600); err != nil {
			t.Fatal(err)
		}
		args = append(args, "-"+file.name, path)
	}
	var out bytes.Buffer
	if err := run(args, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || result["scope"] != "wallet-restore-public-signature-verification" || result["freshProcessRestoreVerified"] != false {
		t.Fatalf("unexpected public readback: %v %v", result, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "member"), make([]byte, (128<<10)+1), 0600); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if err := run(args, &out); err == nil || out.Len() != 0 {
		t.Fatal("oversized evidence returned verification success")
	}
}
