package ynxconsensusauth

import (
	"bytes"
	"errors"
	"math"
)

const logicalPublicKeyDomain = "YNX-CONSENSUS-LOGICAL-PUBKEY/v1\x00"

// LogicalPublicKey is a candidate wire identity, NOT Comet crypto.PubKey. It
// deliberately has no VerifySignature/GetPubKey escape hatch. A decoded binding
// has no authority until authenticated against the exact trusted KeyHistory.
type LogicalPublicKey struct {
	GenesisID                                 []byte
	ChainID                                   string
	ValidatorAddress                          []byte
	Epoch                                     uint64
	ValidFromHeight                           int64
	RegistrationHash                          []byte
	MLDSA87PublicKey, SLHDSASHA2256fPublicKey []byte
}

func (k LogicalPublicKey) MarshalBinary() ([]byte, error) {
	if len(k.GenesisID) != 32 || regZero(k.GenesisID) || k.Epoch == 0 || len(k.RegistrationHash) != 32 || regZero(k.RegistrationHash) || len(k.MLDSA87PublicKey) != MLDSA87PublicKeySize || len(k.SLHDSASHA2256fPublicKey) != SLHDSASHA2256fPublicKeySize {
		return nil, errors.New("invalid logical PQ public-key binding")
	}
	if err := validateCoordinates(k.ChainID, k.ValidatorAddress, k.ValidFromHeight, 0); err != nil {
		return nil, err
	}
	f := [][]byte{[]byte(logicalPublicKeyDomain), regU32(RegistryVersion), k.GenesisID, []byte(k.ChainID), k.ValidatorAddress}
	f = append(f, regPair(k.Epoch)...)
	f = append(f, regPair(uint64(k.ValidFromHeight))...)
	f = append(f, k.RegistrationHash, k.MLDSA87PublicKey, k.SLHDSASHA2256fPublicKey)
	return regEncode(MaxRegistrationIntentBytes, f...)
}

func DecodeLogicalPublicKey(wire []byte) (LogicalPublicKey, error) {
	var k LogicalPublicKey
	f, err := regDecode(wire, 12, MaxRegistrationIntentBytes)
	if err != nil {
		return k, err
	}
	if string(f[0]) != logicalPublicKeyDomain || !bytes.Equal(f[1], regU32(RegistryVersion)) {
		return k, errors.New("logical public-key domain or version")
	}
	k.GenesisID, k.ChainID, k.ValidatorAddress = f[2], string(f[3]), f[4]
	k.Epoch, err = regReadPair(f[5], f[6])
	if err != nil {
		return k, err
	}
	h, err := regReadPair(f[7], f[8])
	if err != nil || h > math.MaxInt64 {
		return k, errors.New("invalid logical public-key height")
	}
	k.ValidFromHeight, k.RegistrationHash, k.MLDSA87PublicKey, k.SLHDSASHA2256fPublicKey = int64(h), f[9], f[10], f[11]
	if _, err = k.MarshalBinary(); err != nil {
		return LogicalPublicKey{}, err
	}
	return k, nil
}

func (h *KeyHistory) PublicKeyBindingAt(chainID string, address []byte, height int64) ([]byte, error) {
	r, hash, err := h.keyAt(chainID, address, height)
	if err != nil {
		return nil, err
	}
	return (LogicalPublicKey{GenesisID: h.anchor.GenesisID, ChainID: r.ChainID, ValidatorAddress: r.ValidatorAddress, Epoch: r.Epoch, ValidFromHeight: r.ValidFromHeight, RegistrationHash: hash[:], MLDSA87PublicKey: r.MLDSA87PublicKey, SLHDSASHA2256fPublicKey: r.SLHDSASHA2256fPublicKey}).MarshalBinary()
}

func (h *KeyHistory) AuthenticatePublicKeyBinding(wire []byte, height int64) (KeyRecord, error) {
	k, err := DecodeLogicalPublicKey(wire)
	if err != nil {
		return KeyRecord{}, err
	}
	expected, err := h.PublicKeyBindingAt(k.ChainID, k.ValidatorAddress, height)
	if err != nil {
		return KeyRecord{}, err
	}
	if !bytes.Equal(expected, wire) {
		return KeyRecord{}, errors.New("logical PQ key binding is not authorized by this anchored history")
	}
	return h.ConsensusKeysAt(k.ChainID, k.ValidatorAddress, height)
}
