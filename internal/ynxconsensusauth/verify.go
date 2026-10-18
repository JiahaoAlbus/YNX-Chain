package ynxconsensusauth

import (
	"bytes"
	"errors"
	"fmt"
)

// Provider must implement strict FIPS 204 ML-DSA-87.Verify and FIPS 205
// SLH-DSA-SHA2-256f.Verify in pure-message mode with empty context. A nil
// error means verified; no provider is installed by default. Implementations
// may not substitute parameter sets, prehashes, or historical signatures.
type Provider interface {
	VerifyMLDSA87(publicKey, message, signature []byte) error
	VerifySLHDSASHA2256f(publicKey, message, signature []byte) error
}

// HistoricalVerifier resolves the exact historical key and rules from trusted
// state. Anchor must be authenticated independently of peers and fixed for the
// source lifetime. VerifyHistorical must resolve keys and the permitted block
// identity at the requested genesis and historical height. canonical remains
// the unchanged upstream Comet bytes; old signatures do NOT contain genesis.
type HistoricalVerifier interface {
	Anchor() RegistryAnchor
	VerifyHistorical(genesisID []byte, chainID string, address []byte, height int64, kind Kind, canonical, signature []byte) error
}

// KeyRecord must originate from a committed, authenticated validator-key
// registration with old-authority approval and both new-key possession proofs.
// ValidUntilHeight is exclusive; zero means no scheduled expiry. Records are
// retained for historical evidence and light-client verification after rotation.
type KeyRecord struct {
	Version                 uint32
	ChainID                 string
	ValidatorAddress        []byte
	Epoch                   uint64
	ValidFromHeight         int64
	ValidUntilHeight        int64
	MLDSA87PublicKey        []byte
	SLHDSASHA2256fPublicKey []byte
}

// Registry returns an immutable anchor and detached or immutable key records.
// A candidate KeyHistory is trusted only after its owner commits it.
type Registry interface {
	Anchor() RegistryAnchor
	ConsensusKeysAt(chainID string, address []byte, height int64) (KeyRecord, error)
}

// Policy is supplied from authenticated consensus state/checkpoints, never from
// the peer's envelope or local wall clock. Zero is unconfigured and fails shut.
type Policy struct {
	GenesisID        []byte
	Version          uint32
	ChainID          string
	ActivationHeight int64
}

type Verifier struct {
	policy     Policy
	registry   Registry
	provider   Provider
	historical HistoricalVerifier
}

func NewVerifier(policy Policy, registry Registry, provider Provider, historical HistoricalVerifier) (*Verifier, error) {
	if policy.Version != ConsensusGenesisVersion || policy.ActivationHeight <= 0 {
		return nil, errors.New("missing or unsupported authenticated activation policy")
	}
	if err := (RegistryAnchor{GenesisID: policy.GenesisID, ChainID: policy.ChainID}).validate(); err != nil {
		return nil, err
	}
	policy.GenesisID = bytes.Clone(policy.GenesisID)
	v := &Verifier{policy: policy, registry: registry, provider: provider, historical: historical}
	if err := v.validateAnchors(); err != nil {
		return nil, err
	}
	return v, nil
}

// Verify authenticates one request. Commit quorum, validator power/index,
// proposer selection, nil-vote semantics and timestamp rules remain Comet's
// obligations. A valid individual signature is not a valid Commit.
func (v *Verifier) Verify(request Request, signature []byte) error {
	if v == nil {
		return errors.New("missing verifier")
	}
	if err := request.validate(); err != nil {
		return err
	}
	if request.chainID != v.policy.ChainID || !bytes.Equal(request.genesisID, v.policy.GenesisID) {
		return errors.New("wrong consensus genesis or chain")
	}
	if err := v.validateAnchors(); err != nil {
		return err
	}
	if request.height < v.policy.ActivationHeight {
		if v.historical == nil || len(signature) == 0 || len(signature) > 64 {
			return errors.New("missing historical verifier or invalid historical signature size")
		}
		return v.historical.VerifyHistorical(bytes.Clone(request.genesisID), request.chainID, bytes.Clone(request.address), request.height, request.kind, bytes.Clone(request.legacy), bytes.Clone(signature))
	}
	if v.registry == nil || v.provider == nil {
		return errors.New("dual PQ registry and provider are required")
	}
	envelope, err := ParseEnvelope(signature)
	if err != nil {
		return err
	}
	record, err := v.registry.ConsensusKeysAt(request.chainID, bytes.Clone(request.address), request.height)
	if err != nil {
		return fmt.Errorf("resolve historical consensus key pair: %w", err)
	}
	if record.Version != Version || record.ChainID != request.chainID || !bytes.Equal(record.ValidatorAddress, request.address) || record.Epoch != envelope.KeyEpoch || record.Epoch == 0 || record.ValidFromHeight <= 0 || record.ValidFromHeight > request.height || (record.ValidUntilHeight != 0 && record.ValidUntilHeight <= request.height) || len(record.MLDSA87PublicKey) != MLDSA87PublicKeySize || len(record.SLHDSASHA2256fPublicKey) != SLHDSASHA2256fPublicKeySize {
		return errors.New("consensus key pair is not authorized at request height")
	}
	message, err := request.SigningBytes(record.Epoch)
	if err != nil {
		return err
	}
	// Snapshot inputs before either callback. A provider must not be able to
	// mutate the complete second-branch message or the registry's owned bytes.
	pkA, pkB := bytes.Clone(record.MLDSA87PublicKey), bytes.Clone(record.SLHDSASHA2256fPublicKey)
	messageA, messageB := bytes.Clone(message), bytes.Clone(message)
	errA := v.provider.VerifyMLDSA87(pkA, messageA, envelope.MLDSA87)
	errB := v.provider.VerifySLHDSASHA2256f(pkB, messageB, envelope.SLHDSASHA2256f)
	if errA != nil || errB != nil {
		return fmt.Errorf("dual PQ consensus authentication failed: %w", errors.Join(errA, errB))
	}
	return nil
}

func validatePolicyAnchor(policy Policy, anchor RegistryAnchor) error {
	if err := anchor.validate(); err != nil {
		return err
	}
	if policy.ChainID != anchor.ChainID || !bytes.Equal(policy.GenesisID, anchor.GenesisID) {
		return errors.New("consensus policy and trusted source genesis/chain differ")
	}
	return nil
}
func (v *Verifier) validateAnchors() error {
	if v.registry != nil {
		if err := validatePolicyAnchor(v.policy, v.registry.Anchor()); err != nil {
			return err
		}
	}
	if v.historical != nil {
		if err := validatePolicyAnchor(v.policy, v.historical.Anchor()); err != nil {
			return err
		}
	}
	return nil
}
