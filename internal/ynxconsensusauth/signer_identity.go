package ynxconsensusauth

import (
	"bytes"
	"errors"
)

// SignerIdentity is detached public authority, not signing state. It contains
// no private material, reservation coordinates or method for bypassing Sign.
type SignerIdentity struct {
	Policy                  Policy
	ValidatorAddress        []byte
	Epoch                   uint64
	MLDSA87PublicKey        []byte
	SLHDSASHA2256fPublicKey []byte
}

// Identity snapshots an open durable signer's complete public identity. The
// lock order is the same as Sign: signer, then key. No lock survives the call.
func (s *Signer) Identity() (SignerIdentity, error) {
	if s == nil || s.signerCore == nil {
		return SignerIdentity{}, errors.New("missing consensus signer")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.lock == nil {
		return SignerIdentity{}, errors.New("closed consensus signer")
	}
	pa, pb, err := s.key.publicMaterial()
	if err != nil {
		return SignerIdentity{}, err
	}
	if !bytes.Equal(pa, s.state.PublicA) || !bytes.Equal(pb, s.state.PublicB) {
		return SignerIdentity{}, errors.New("signer identity differs from private key")
	}
	policy := s.state.Policy
	policy.GenesisID = bytes.Clone(policy.GenesisID)
	return SignerIdentity{Policy: policy, ValidatorAddress: bytes.Clone(s.state.Address), Epoch: s.state.Epoch, MLDSA87PublicKey: pa, SLHDSASHA2256fPublicKey: pb}, nil
}
