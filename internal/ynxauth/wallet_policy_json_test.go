package ynxauth

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func walletPolicyProjectionFixture() (State, string) {
	owner := "0x" + strings.Repeat("1", 40)
	return State{Version: PolicyVersion, NetworkID: bytes.Repeat([]byte{0xab}, 32), EnableAt: 1,
		Records: []Record{{AlgorithmVersion: ynxbatch.Version, Owner: owner,
			PKA: bytes.Repeat([]byte{0xcd}, ynxbatch.PublicKeyASize), PKB: bytes.Repeat([]byte{0xef}, ynxbatch.PublicKeyBSize),
			Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 9007199254740993}}}, owner
}

func TestWalletPolicyProjectionPreservesWideIntegersAndFullKeys(t *testing.T) {
	s, owner := walletPolicyProjectionFixture()
	raw, err := EncodeWalletPolicyProjection(s, owner)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"ledgerNonce":"9007199254740993"`)) || !bytes.Contains(raw, []byte(`"networkId":"abab`)) || !bytes.Contains(raw, []byte(`"pkA":"cdcd`)) {
		t.Fatal("projection changed the node's decimal-string/full-hex representation")
	}
	actual, err := DecodeWalletPolicyProjection(raw, s.NetworkID, owner)
	if err != nil || !reflect.DeepEqual(s, actual) {
		t.Fatalf("owner projection changed complete typed policy: %v", err)
	}
	actual.Records[0].PKA[0] ^= 1
	actual.NetworkID[0] ^= 1
	if s.Records[0].PKA[0] != 0xcd || s.NetworkID[0] != 0xab {
		t.Fatal("decoder aliased caller-owned public data")
	}
}

func TestWalletPolicyProjectionRejectsNoncanonicalAndCrossOwnerData(t *testing.T) {
	s, owner := walletPolicyProjectionFixture()
	raw, err := EncodeWalletPolicyProjection(s, owner)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"trailing newline": append(bytes.Clone(raw), '\n'),
		"trailing value":   append(bytes.Clone(raw), []byte(`{}`)...),
		"unknown":          bytes.Replace(raw, []byte(`{"version":`), []byte(`{"unknown":false,"version":`), 1),
		"duplicate":        bytes.Replace(raw, []byte(`{"version":`), []byte(`{"version":"ignored","version":`), 1),
		"number":           bytes.Replace(raw, []byte(`"enableAt":"1"`), []byte(`"enableAt":1`), 1),
		"wide number":      bytes.Replace(raw, []byte(`"ledgerNonce":"9007199254740993"`), []byte(`"ledgerNonce":9007199254740993`), 1),
		"leading zero":     bytes.Replace(raw, []byte(`"enableAt":"1"`), []byte(`"enableAt":"01"`), 1),
		"uppercase hex":    bytes.Replace(raw, []byte(`"networkId":"ab`), []byte(`"networkId":"AB`), 1),
		"wrong owner":      bytes.ReplaceAll(raw, []byte(owner), []byte("0x"+strings.Repeat("2", 40))),
		"short key":        bytes.Replace(raw, []byte(`"pkB":"`+strings.Repeat("ef", 64)), []byte(`"pkB":"ef`), 1),
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeWalletPolicyProjection(value, s.NetworkID, owner); err == nil {
				t.Fatal("accepted changed or noncanonical projection")
			}
		})
	}
	other := bytes.Clone(s.NetworkID)
	other[0] ^= 1
	if _, err := DecodeWalletPolicyProjection(raw, other, owner); err == nil {
		t.Fatal("accepted a different independently selected network")
	}
	if _, err := DecodeWalletPolicyProjection(raw, s.NetworkID, "0x"+strings.Repeat("2", 40)); err == nil {
		t.Fatal("accepted a different independently selected owner")
	}
	goState, _ := json.Marshal(s)
	if _, err := DecodeWalletPolicyProjection(goState, s.NetworkID, owner); err == nil {
		t.Fatal("accepted internal base64/numeric State JSON as the HTTP projection")
	}
}

func TestWalletPolicyProjectionBoundsAndEmptyState(t *testing.T) {
	s, owner := walletPolicyProjectionFixture()
	if _, err := EncodeWalletPolicyProjection(State{}, owner); err == nil {
		t.Fatal("empty legacy marker is not an enabled owner policy")
	}
	if _, err := DecodeWalletPolicyProjection(make([]byte, MaxWalletPolicyProjectionBytes+1), s.NetworkID, owner); err == nil {
		t.Fatal("accepted an oversized projection")
	}
	s.Records = make([]Record, MaxWalletPolicyProjectionRecords+1)
	if _, err := EncodeWalletPolicyProjection(s, owner); err == nil {
		t.Fatal("accepted too many records")
	}
}
