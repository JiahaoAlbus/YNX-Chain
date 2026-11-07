// Package ynxauth defines versioned account authorization messages. It does not
// invent account authority, change addresses or execute ledger transitions.
package ynxauth

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const TransferDomain = "YNX-NATIVE-TRANSFER/v2"
const RegistrationDomain = "YNX-ACCOUNT-REGISTRATION/v1"
const MigrationPurpose = "ACCOUNT-MIGRATION"
const TransactionPurpose = "TX-BATCH"

// Uint64 ledger values use two separately framed U32 fields, high then low.
// No nonce/amount/height is truncated to fit a single 32-bit field.
func pair(n uint64) [][]byte { return [][]byte{ynxbatch.U32(uint32(n >> 32)), ynxbatch.U32(uint32(n))} }
func readPair(a, b []byte) (uint64, error) {
	if len(a) != 4 || len(b) != 4 {
		return 0, errors.New("noncanonical uint64 pair")
	}
	return uint64(binary.BigEndian.Uint32(a))<<32 | uint64(binary.BigEndian.Uint32(b)), nil
}
func frame(input []byte, count, max int) ([][]byte, error) {
	if len(input) > max || len(input) < 4 || binary.BigEndian.Uint32(input) != uint32(count) || len(input) < 4+4*count {
		return nil, errors.New("invalid authorization frame")
	}
	fields := make([][]byte, 0, count)
	at := 4
	for i := 0; i < count; i++ {
		if at+4 > len(input) {
			return nil, errors.New("truncated field")
		}
		n := uint64(binary.BigEndian.Uint32(input[at:]))
		at += 4
		if n > uint64(len(input)-at) {
			return nil, errors.New("field length")
		}
		fields = append(fields, append([]byte(nil), input[at:at+int(n)]...))
		at += int(n)
	}
	if at != len(input) {
		return nil, errors.New("trailing bytes")
	}
	return fields, nil
}

// Transfer authorizes one native transfer. Canonical bytes cover all execution
// fields; the registration keys, owner and chain are also covered by YNX context.
type Transfer struct {
	ChainID       []byte
	NativeChainID uint64
	From, To      string
	Amount, Fee   uint64
	Nonce         uint64
}

func (t Transfer) Validate() error {
	if len(t.ChainID) != 32 || t.NativeChainID == 0 || t.NativeChainID > math.MaxInt64 {
		return errors.New("invalid network identity")
	}
	if !accountaddress.IsCanonical(t.From) || !accountaddress.IsCanonical(t.To) || t.From == t.To {
		return errors.New("invalid transfer address")
	}
	if t.Amount == 0 || t.Amount > math.MaxInt64 || t.Fee > math.MaxInt64 || t.Amount > math.MaxInt64-t.Fee || t.Nonce == 0 {
		return errors.New("invalid transfer values")
	}
	return nil
}
func (t Transfer) SigningBytes() ([]byte, error) {
	if err := t.Validate(); err != nil {
		return nil, err
	}
	fields := [][]byte{[]byte(TransferDomain), ynxbatch.U32(2), t.ChainID}
	fields = append(fields, pair(t.NativeChainID)...)
	fields = append(fields, []byte(t.From), []byte(t.To))
	fields = append(fields, pair(t.Amount)...)
	fields = append(fields, pair(t.Fee)...)
	fields = append(fields, pair(t.Nonce)...)
	return ynxbatch.EncodeFields(fields...)
}
func DecodeTransfer(input []byte) (Transfer, error) {
	var t Transfer
	f, err := frame(input, 13, 1024)
	if err != nil {
		return t, err
	}
	if !bytes.Equal(f[0], []byte(TransferDomain)) || !bytes.Equal(f[1], ynxbatch.U32(2)) {
		return t, errors.New("unsupported transfer version")
	}
	t.ChainID = f[2]
	t.NativeChainID, err = readPair(f[3], f[4])
	if err != nil {
		return t, err
	}
	t.From, t.To = string(f[5]), string(f[6])
	t.Amount, err = readPair(f[7], f[8])
	if err != nil {
		return t, err
	}
	t.Fee, err = readPair(f[9], f[10])
	if err != nil {
		return t, err
	}
	t.Nonce, err = readPair(f[11], f[12])
	if err != nil {
		return t, err
	}
	return t, t.Validate()
}

// RegistrationIntent is signed by the current lawful policy and independently
// by BOTH proposed keys as a one-member ACCOUNT-MIGRATION batch.
type RegistrationIntent struct {
	ChainID                    []byte
	Owner                      string
	PKA, PKB                   []byte
	PriorRevision, NewRevision uint64
	LedgerNonce, ActivateAt    uint64
}

func (r RegistrationIntent) Validate() error {
	if len(r.ChainID) != 32 || !accountaddress.IsCanonical(r.Owner) || len(r.PKA) != 2592 || len(r.PKB) != 64 {
		return errors.New("invalid full registration identity")
	}
	if r.PriorRevision == math.MaxUint64 || r.NewRevision != r.PriorRevision+1 || r.LedgerNonce == 0 || r.ActivateAt == 0 {
		return errors.New("invalid registration sequence")
	}
	return nil
}
func (r RegistrationIntent) SigningBytes() ([]byte, error) {
	if err := r.Validate(); err != nil {
		return nil, err
	}
	fields := [][]byte{[]byte(RegistrationDomain), ynxbatch.U32(1), r.ChainID, []byte(r.Owner), []byte("YNX-BATCH/v0.1"), r.PKA, r.PKB}
	for _, n := range []uint64{r.PriorRevision, r.NewRevision, r.LedgerNonce, r.ActivateAt} {
		fields = append(fields, pair(n)...)
	}
	return ynxbatch.EncodeFields(fields...)
}
func DecodeRegistrationIntent(input []byte) (RegistrationIntent, error) {
	var r RegistrationIntent
	f, err := frame(input, 15, 4096)
	if err != nil {
		return r, err
	}
	if !bytes.Equal(f[0], []byte(RegistrationDomain)) || !bytes.Equal(f[1], ynxbatch.U32(1)) || string(f[4]) != "YNX-BATCH/v0.1" {
		return r, errors.New("registration domain/version")
	}
	r.ChainID, r.Owner, r.PKA, r.PKB = f[2], string(f[3]), f[5], f[6]
	out := []*uint64{&r.PriorRevision, &r.NewRevision, &r.LedgerNonce, &r.ActivateAt}
	for i, p := range out {
		*p, err = readPair(f[7+i*2], f[8+i*2])
		if err != nil {
			return r, err
		}
	}
	return r, r.Validate()
}
