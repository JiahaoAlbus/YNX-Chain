package openprotocol

import (
	"bytes"
	"encoding/binary"
)

const IdentityChallengeDomain = "YNX-OPEN/IDENTITY-CHALLENGE/1"
const IdentityAuthPurpose = "YNX-OPEN/IDENTITY-AUTH/1"

type NetworkBindingV1 struct {
	Kind          string
	Genesis       []byte
	NativeChainID uint64
	NetworkID     []byte
}
type IdentityChallengeV1DATA struct {
	Realm, Tenant, AgentID, Audience, ChannelBinding, Nonce []byte
	NetworkBinding                                          NetworkBindingV1
	Epoch, IssuedAt, ExpiresAt                              uint64
}
type IdentityChallengeV1ExpectedDATA struct {
	Realm, Tenant, AgentID, Audience, ChannelBinding []byte
	NetworkBinding                                   NetworkBindingV1
	Epoch                                            uint64
}

func AssertIdentityChallengeV1BindingDATA(c IdentityChallengeV1DATA, e IdentityChallengeV1ExpectedDATA) error {
	a, err := networkEncode(c.NetworkBinding)
	if err != nil {
		return err
	}
	b, err := networkEncode(e.NetworkBinding)
	if err != nil {
		return err
	}
	if !bytes.Equal(c.Realm, e.Realm) || !bytes.Equal(c.Tenant, e.Tenant) || !bytes.Equal(c.AgentID, e.AgentID) || !bytes.Equal(c.Audience, e.Audience) || !bytes.Equal(c.ChannelBinding, e.ChannelBinding) || c.Epoch != e.Epoch || !bytes.Equal(a, b) {
		return ErrInvalid
	}
	return nil
}
func openU64(n uint64) []byte { out := make([]byte, 8); binary.BigEndian.PutUint64(out, n); return out }
func readOpenU64(b []byte) (uint64, error) {
	if len(b) != 8 {
		return 0, ErrInvalid
	}
	return binary.BigEndian.Uint64(b), nil
}
func networkEncode(n NetworkBindingV1) ([]byte, error) {
	if n.Kind == "offchain" {
		if len(n.Genesis) != 0 || len(n.NetworkID) != 0 || n.NativeChainID != 0 {
			return nil, ErrInvalid
		}
		return EncodeFields([]byte("offchain"))
	}
	if n.Kind != "ynx-chain" || len(n.Genesis) != 32 || len(n.NetworkID) != 32 || bytes.Equal(n.Genesis, make([]byte, 32)) {
		return nil, ErrInvalid
	}
	return EncodeFields([]byte("ynx-chain"), n.Genesis, openU64(n.NativeChainID), n.NetworkID)
}
func networkDecode(wire []byte) (NetworkBindingV1, error) {
	if len(wire) < 4 {
		return NetworkBindingV1{}, ErrInvalid
	}
	if binary.BigEndian.Uint32(wire) == 1 {
		f, e := DecodeFields(wire, 1)
		if e != nil || !bytes.Equal(f[0], []byte("offchain")) {
			return NetworkBindingV1{}, ErrInvalid
		}
		return NetworkBindingV1{Kind: "offchain"}, nil
	}
	f, e := DecodeFields(wire, 4)
	if e != nil || !bytes.Equal(f[0], []byte("ynx-chain")) || len(f[1]) != 32 || len(f[3]) != 32 || bytes.Equal(f[1], make([]byte, 32)) {
		return NetworkBindingV1{}, ErrInvalid
	}
	n, e := readOpenU64(f[2])
	if e != nil {
		return NetworkBindingV1{}, e
	}
	return NetworkBindingV1{Kind: "ynx-chain", Genesis: f[1], NativeChainID: n, NetworkID: f[3]}, nil
}

// EncodeIdentityChallengeV1DATA is the newly versioned typed DATA grammar.
// Callers must separately verify current Auth state, clock, channel and replay.
func EncodeIdentityChallengeV1DATA(c IdentityChallengeV1DATA) ([]byte, error) {
	if len(c.Realm) != 16 || len(c.Tenant) != 16 || len(c.AgentID) != 16 || len(c.Audience) != 16 || len(c.ChannelBinding) != 32 || len(c.Nonce) != 32 || c.ExpiresAt <= c.IssuedAt || c.ExpiresAt-c.IssuedAt > 60000 {
		return nil, ErrInvalid
	}
	network, e := networkEncode(c.NetworkBinding)
	if e != nil {
		return nil, e
	}
	subject, e := EncodeFields(c.AgentID, openU64(c.Epoch))
	if e != nil {
		return nil, e
	}
	return EncodeFields([]byte(IdentityChallengeDomain), c.Realm, network, c.Tenant, subject, c.Audience, []byte(IdentityAuthPurpose), c.ChannelBinding, c.Nonce, openU64(c.IssuedAt), openU64(c.ExpiresAt))
}
func DecodeIdentityChallengeV1DATA(wire []byte) (IdentityChallengeV1DATA, error) {
	var c IdentityChallengeV1DATA
	f, e := DecodeFields(wire, 11)
	if e != nil {
		return c, e
	}
	if !bytes.Equal(f[0], []byte(IdentityChallengeDomain)) || !bytes.Equal(f[6], []byte(IdentityAuthPurpose)) {
		return c, ErrInvalid
	}
	subject, e := DecodeFields(f[4], 2)
	if e != nil {
		return c, e
	}
	network, e := networkDecode(f[2])
	if e != nil {
		return c, e
	}
	epoch, e := readOpenU64(subject[1])
	if e != nil {
		return c, e
	}
	issued, e := readOpenU64(f[9])
	if e != nil {
		return c, e
	}
	expires, e := readOpenU64(f[10])
	if e != nil {
		return c, e
	}
	c = IdentityChallengeV1DATA{Realm: f[1], NetworkBinding: network, Tenant: f[3], AgentID: subject[0], Epoch: epoch, Audience: f[5], ChannelBinding: f[7], Nonce: f[8], IssuedAt: issued, ExpiresAt: expires}
	canonical, e := EncodeIdentityChallengeV1DATA(c)
	if e != nil || !bytes.Equal(canonical, wire) {
		return IdentityChallengeV1DATA{}, ErrInvalid
	}
	return c, nil
}
