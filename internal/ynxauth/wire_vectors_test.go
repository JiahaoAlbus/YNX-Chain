package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type authWireVector struct {
	Fields  map[string]string `json:"fields"`
	WireHex string            `json:"wireHex"`
	Bytes   int               `json:"bytes"`
	SHA256  string            `json:"sha256"`
}

func vectorUint64(t testing.TB, fields map[string]string, name string) uint64 {
	t.Helper()
	decimal, ok := fields[name]
	if !ok {
		t.Fatalf("missing decimal string %s", name)
	}
	n, err := strconv.ParseUint(decimal, 10, 64)
	authOK(t, err)
	if strconv.FormatUint(n, 10) != decimal {
		t.Fatalf("noncanonical decimal string %s", name)
	}
	return n
}

func vectorHex(t testing.TB, raw string) []byte {
	t.Helper()
	decoded, err := hex.DecodeString(raw)
	authOK(t, err)
	if raw == "" || hex.EncodeToString(decoded) != raw {
		t.Fatal("noncanonical raw hex in vector")
	}
	return decoded
}

func checkAuthVectorWire(t testing.TB, actual []byte, vector authWireVector, expectedSize int) []byte {
	t.Helper()
	expected := vectorHex(t, vector.WireHex)
	if vector.Bytes != expectedSize || len(expected) != expectedSize || len(actual) != expectedSize {
		t.Fatal("authorization wire length differs from the frozen JS vector")
	}
	if !bytes.Equal(actual, expected) {
		t.Fatal("Go signing bytes differ from JS reference framing")
	}
	for _, wire := range [][]byte{actual, expected} {
		digest := sha256.Sum256(wire)
		if hex.EncodeToString(digest[:]) != vector.SHA256 {
			t.Fatal("authorization wire SHA256 differs from vector")
		}
	}
	return expected
}

func TestJSReferenceAuthorizationWireVectors(t *testing.T) {
	// These are unsigned synthetic codec fixtures, never account authority or PoP.
	raw, err := os.ReadFile("testdata/wire-v1.json")
	authOK(t, err)
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != "77ab4704ba3abb1333d86d9d649561bc69284ba3630b7e342cc52c2b463604d8" {
		t.Fatal("frozen JS wire-v1.json source digest changed")
	}
	var vectors struct {
		Format         string         `json:"format"`
		Scope          string         `json:"scope"`
		NetworkBinding string         `json:"networkBinding"`
		Transfer       authWireVector `json:"transfer"`
		Registration   authWireVector `json:"registration"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	authOK(t, decoder.Decode(&vectors))
	if vectors.Format != "YNX-ACCOUNT-AUTH-CODEC-VECTORS/v1" {
		t.Fatal("unknown authorization vector format")
	}
	t.Run("transfer", func(t *testing.T) {
		f := vectors.Transfer.Fields
		transfer := Transfer{ChainID: vectorHex(t, f["chainId"]), NativeChainID: vectorUint64(t, f, "nativeChainId"),
			From: f["from"], To: f["to"], Amount: vectorUint64(t, f, "amount"), Fee: vectorUint64(t, f, "fee"), Nonce: vectorUint64(t, f, "nonce")}
		actual, err := transfer.SigningBytes()
		authOK(t, err)
		expected := checkAuthVectorWire(t, actual, vectors.Transfer, 230)
		decoded, err := DecodeTransfer(expected)
		authOK(t, err)
		if !reflect.DeepEqual(decoded, transfer) {
			t.Fatal("JS transfer decode changed a full-width field")
		}
		roundtrip, err := decoded.SigningBytes()
		authOK(t, err)
		if !bytes.Equal(roundtrip, expected) {
			t.Fatal("JS transfer wire did not roundtrip canonically")
		}
		if decoded.Nonce != 9007199254740993 || decoded.Amount != 4294967297 {
			t.Fatal("JS precision boundary or U32 carry was lost")
		}
	})
	t.Run("registration", func(t *testing.T) {
		f := vectors.Registration.Fields
		if f["algorithmVersion"] != ynxbatch.Version {
			t.Fatal("wrong vector algorithm version")
		}
		intent := RegistrationIntent{ChainID: vectorHex(t, f["chainId"]), Owner: f["owner"],
			PKA: vectorHex(t, f["pkA"]), PKB: vectorHex(t, f["pkB"]),
			PriorRevision: vectorUint64(t, f, "priorRevision"), NewRevision: vectorUint64(t, f, "newRevision"),
			LedgerNonce: vectorUint64(t, f, "ledgerNonce"), ActivateAt: vectorUint64(t, f, "activateAt")}
		actual, err := intent.SigningBytes()
		authOK(t, err)
		expected := checkAuthVectorWire(t, actual, vectors.Registration, 2871)
		decoded, err := DecodeRegistrationIntent(expected)
		authOK(t, err)
		if !reflect.DeepEqual(decoded, intent) {
			t.Fatal("JS registration decode changed a full-width field or public key")
		}
		roundtrip, err := decoded.SigningBytes()
		authOK(t, err)
		if !bytes.Equal(roundtrip, expected) {
			t.Fatal("JS registration wire did not roundtrip canonically")
		}
		if decoded.NewRevision != 4294967296 || decoded.LedgerNonce != 9007199254740993 || decoded.ActivateAt != 9007199254741024 {
			t.Fatal("registration integer high bits were lost")
		}
	})
}
