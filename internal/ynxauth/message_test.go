package ynxauth

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"math"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const qaFrom = "0x1234567890abcdef1234567890abcdef12345678"
const qaTo = "0xabcdef1234567890abcdef1234567890abcdef12"

func authOK(t testing.TB, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func authReject(t testing.TB, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("unexpected authorization acceptance")
	}
}
func authNetwork(t testing.TB) []byte {
	t.Helper()
	network := make([]byte, 32)
	_, err := rand.Read(network)
	authOK(t, err)
	return network
}
func authFrame(t testing.TB, fields [][]byte) []byte {
	t.Helper()
	wire, err := ynxbatch.EncodeFields(fields...)
	authOK(t, err)
	return wire
}
func authFields(t testing.TB, wire []byte, count int) [][]byte {
	t.Helper()
	fields, err := ynxbatch.DecodeFields(wire, count, ynxbatch.MaxWholeBytes)
	authOK(t, err)
	return fields
}

func TestTransferFullMessageAndUint64Boundaries(t *testing.T) {
	original := Transfer{ChainID: authNetwork(t), NativeChainID: 1<<48 + 11, From: qaFrom, To: qaTo,
		Amount: 1<<45 + 17, Fee: 1<<34 + 3, Nonce: math.MaxUint64}
	wire, err := original.SigningBytes()
	authOK(t, err)
	decoded, err := DecodeTransfer(wire)
	authOK(t, err)
	if !reflect.DeepEqual(decoded, original) {
		t.Fatal("transfer roundtrip changed a field")
	}
	fields := authFields(t, wire, 13)
	for _, item := range []struct {
		index     int
		high, low uint32
	}{
		{3, 1 << 16, 11}, {7, 1 << 13, 17}, {9, 4, 3}, {11, math.MaxUint32, math.MaxUint32},
	} {
		if len(fields[item.index]) != 4 || len(fields[item.index+1]) != 4 ||
			binary.BigEndian.Uint32(fields[item.index]) != item.high || binary.BigEndian.Uint32(fields[item.index+1]) != item.low {
			t.Fatal("uint64 high/low pair was truncated or reordered")
		}
	}
	for name, change := range map[string]func(*Transfer){
		"chain hash":        func(v *Transfer) { v.ChainID[0] ^= 1 },
		"native chain high": func(v *Transfer) { v.NativeChainID += 1 << 32 },
		"from":              func(v *Transfer) { v.From = "0x3333333333333333333333333333333333333333" },
		"to":                func(v *Transfer) { v.To = "0x4444444444444444444444444444444444444444" },
		"amount high":       func(v *Transfer) { v.Amount += 1 << 32 },
		"fee high":          func(v *Transfer) { v.Fee += 1 << 32 },
		"nonce high":        func(v *Transfer) { v.Nonce -= 1 << 32 },
	} {
		t.Run(name, func(t *testing.T) {
			changed := original
			changed.ChainID = bytes.Clone(original.ChainID)
			change(&changed)
			other, err := changed.SigningBytes()
			authOK(t, err)
			if bytes.Equal(wire, other) {
				t.Fatal("execution field was omitted from signing bytes")
			}
		})
	}
	clear(wire)
	if !bytes.Equal(decoded.ChainID, original.ChainID) {
		t.Fatal("decoder retained caller wire")
	}
}

func TestTransferRejectsMalformedFieldsAndArithmetic(t *testing.T) {
	valid := Transfer{ChainID: authNetwork(t), NativeChainID: 1, From: qaFrom, To: qaTo, Amount: 1, Nonce: 1}
	wire, err := valid.SigningBytes()
	authOK(t, err)
	for name, change := range map[string]func(*Transfer){
		"network length":           func(v *Transfer) { v.ChainID = v.ChainID[:31] },
		"zero native chain":        func(v *Transfer) { v.NativeChainID = 0 },
		"native chain overflow":    func(v *Transfer) { v.NativeChainID = math.MaxUint64 },
		"noncanonical address":     func(v *Transfer) { v.From = "0X1234567890abcdef1234567890abcdef12345678" },
		"same account":             func(v *Transfer) { v.To = v.From },
		"zero amount":              func(v *Transfer) { v.Amount = 0 },
		"amount overflow":          func(v *Transfer) { v.Amount = math.MaxUint64 },
		"fee overflow":             func(v *Transfer) { v.Fee = math.MaxUint64 },
		"amount plus fee overflow": func(v *Transfer) { v.Amount = math.MaxInt64; v.Fee = 1 },
		"zero nonce":               func(v *Transfer) { v.Nonce = 0 },
	} {
		t.Run(name, func(t *testing.T) { bad := valid; change(&bad); _, err := bad.SigningBytes(); authReject(t, err) })
	}
	for name, change := range map[string]func([][]byte){
		"domain":            func(f [][]byte) { f[0] = []byte(RegistrationDomain) },
		"version":           func(f [][]byte) { f[1] = ynxbatch.U32(3) },
		"chain bytes":       func(f [][]byte) { f[2] = make([]byte, 31) },
		"short high":        func(f [][]byte) { f[3] = make([]byte, 3) },
		"long low":          func(f [][]byte) { f[12] = make([]byte, 8) },
		"noncanonical from": func(f [][]byte) { f[5] = []byte(" " + qaFrom) },
	} {
		t.Run(name, func(t *testing.T) {
			f := authFields(t, wire, 13)
			change(f)
			_, err := DecodeTransfer(authFrame(t, f))
			authReject(t, err)
		})
	}
	badCount := bytes.Clone(wire)
	binary.BigEndian.PutUint32(badCount, 12)
	badLength := bytes.Clone(wire)
	binary.BigEndian.PutUint32(badLength[4:], math.MaxUint32)
	for _, input := range [][]byte{nil, wire[:3], wire[:len(wire)-1], append(bytes.Clone(wire), 0), badCount, badLength, make([]byte, 1025)} {
		_, err := DecodeTransfer(input)
		authReject(t, err)
	}
}

func TestRegistrationIntentFullMessageAndUint64Boundaries(t *testing.T) {
	// Syntax-only key bytes here; policy_test.go uses fresh standard key generation.
	original := RegistrationIntent{ChainID: authNetwork(t), Owner: qaFrom,
		PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize),
		PriorRevision: 1<<40 + 5, NewRevision: 1<<40 + 6, LedgerNonce: math.MaxUint64, ActivateAt: 1<<60 + 9}
	wire, err := original.SigningBytes()
	authOK(t, err)
	decoded, err := DecodeRegistrationIntent(wire)
	authOK(t, err)
	if !reflect.DeepEqual(decoded, original) {
		t.Fatal("registration roundtrip changed a field")
	}
	f := authFields(t, wire, 15)
	for _, item := range []struct {
		index     int
		high, low uint32
	}{
		{7, 256, 5}, {9, 256, 6}, {11, math.MaxUint32, math.MaxUint32}, {13, 1 << 28, 9},
	} {
		if len(f[item.index]) != 4 || len(f[item.index+1]) != 4 ||
			binary.BigEndian.Uint32(f[item.index]) != item.high || binary.BigEndian.Uint32(f[item.index+1]) != item.low {
			t.Fatal("registration uint64 high/low pair was truncated or reordered")
		}
	}
	for name, change := range map[string]func(*RegistrationIntent){
		"network":         func(v *RegistrationIntent) { v.ChainID[0] ^= 1 },
		"owner":           func(v *RegistrationIntent) { v.Owner = qaTo },
		"ML public":       func(v *RegistrationIntent) { v.PKA[0] ^= 1 },
		"SLH public":      func(v *RegistrationIntent) { v.PKB[0] ^= 1 },
		"revisions high":  func(v *RegistrationIntent) { v.PriorRevision += 1 << 32; v.NewRevision += 1 << 32 },
		"nonce high":      func(v *RegistrationIntent) { v.LedgerNonce -= 1 << 32 },
		"activation high": func(v *RegistrationIntent) { v.ActivateAt += 1 << 32 },
	} {
		t.Run(name, func(t *testing.T) {
			v := original
			v.ChainID = bytes.Clone(original.ChainID)
			v.PKA = bytes.Clone(original.PKA)
			v.PKB = bytes.Clone(original.PKB)
			change(&v)
			other, err := v.SigningBytes()
			authOK(t, err)
			if bytes.Equal(wire, other) {
				t.Fatal("registration field omitted from signing bytes")
			}
		})
	}
	clear(wire)
	if !bytes.Equal(decoded.ChainID, original.ChainID) {
		t.Fatal("registration decoder retained wire")
	}
}

func TestRegistrationIntentRejectsMalformedProfileAndSequence(t *testing.T) {
	valid := RegistrationIntent{ChainID: authNetwork(t), Owner: qaFrom, PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize), NewRevision: 1, LedgerNonce: 1, ActivateAt: 1}
	wire, err := valid.SigningBytes()
	authOK(t, err)
	for name, change := range map[string]func(*RegistrationIntent){
		"chain length":      func(v *RegistrationIntent) { v.ChainID = v.ChainID[:31] },
		"owner":             func(v *RegistrationIntent) { v.Owner = "qa-owner" },
		"ML length":         func(v *RegistrationIntent) { v.PKA = v.PKA[:2591] },
		"SLH length":        func(v *RegistrationIntent) { v.PKB = v.PKB[:63] },
		"revision skip":     func(v *RegistrationIntent) { v.NewRevision = 2 },
		"revision overflow": func(v *RegistrationIntent) { v.PriorRevision = math.MaxUint64; v.NewRevision = 0 },
		"zero nonce":        func(v *RegistrationIntent) { v.LedgerNonce = 0 },
		"zero activation":   func(v *RegistrationIntent) { v.ActivateAt = 0 },
	} {
		t.Run(name, func(t *testing.T) { bad := valid; change(&bad); _, err := bad.SigningBytes(); authReject(t, err) })
	}
	for _, index := range []int{7, 8, 9, 10, 11, 12, 13, 14} {
		f := authFields(t, wire, 15)
		f[index] = make([]byte, 8)
		_, err := DecodeRegistrationIntent(authFrame(t, f))
		authReject(t, err)
	}
	for _, index := range []int{0, 1, 4} {
		f := authFields(t, wire, 15)
		f[index] = []byte("wrong-domain-or-version")
		_, err := DecodeRegistrationIntent(authFrame(t, f))
		authReject(t, err)
	}
	for _, input := range [][]byte{nil, wire[:3], wire[:len(wire)-1], append(bytes.Clone(wire), 0), make([]byte, 4097)} {
		_, err := DecodeRegistrationIntent(input)
		authReject(t, err)
	}
}
