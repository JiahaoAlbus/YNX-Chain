package ynxconsensusauth

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"math"
)

const (
	RegistryVersion              uint32 = 1
	MaxRegistrationIntentBytes          = 8 << 10
	MaxRegistrationBytes                = 128 << 10
	registrationIntentDomain            = "YNX-CONSENSUS-KEY-INTENT/v1\x00"
	registrationDomain                  = "YNX-CONSENSUS-KEY-OP/v1\x00"
	registrationAuthorityDomain         = "YNX-CONSENSUS-KEY-AUTH/v1\x00"
	registrationPossessionDomain        = "YNX-CONSENSUS-KEY-POP/v1\x00"
	registrationHashDomain              = "YNX-CONSENSUS-KEY-EVENT/v1\x00"
)

type RegistrationKind uint32

const (
	RegisterValidator RegistrationKind = 1
	RotateValidator   RegistrationKind = 2
	RevokeValidator   RegistrationKind = 3
)

// RegistrationIntent commits to the complete old authority and proposed pair.
// ApprovedAt is the exact execution height, not a peer's authorization to write
// state. EffectiveAt is at least ApprovedAt+2. Sequence orders this logical
// validator's events; Epoch on revocation names the latest registered epoch,
// including a pending rotation, while AuthorizingEpoch must be active at H.
type RegistrationIntent struct {
	Kind                                                        RegistrationKind
	GenesisID                                                   []byte
	ChainID                                                     string
	ValidatorAddress                                            []byte
	Sequence, AuthorizingEpoch, Epoch                           uint64
	ApprovedAt, EffectiveAt                                     int64
	PreviousEventHash                                           []byte
	LegacyEd25519PublicKey                                      []byte
	AuthorityMLDSA87PublicKey, AuthoritySLHDSASHA2256fPublicKey []byte
	MLDSA87PublicKey, SLHDSASHA2256fPublicKey                   []byte
}

func (r RegistrationIntent) Validate() error {
	if len(r.GenesisID) != sha256.Size || regZero(r.GenesisID) || len(r.PreviousEventHash) != sha256.Size {
		return errors.New("invalid registration genesis or previous event hash")
	}
	if err := validateCoordinates(r.ChainID, r.ValidatorAddress, r.ApprovedAt, 0); err != nil {
		return err
	}
	if r.ApprovedAt > math.MaxInt64-2 || r.EffectiveAt < r.ApprovedAt+2 || r.Sequence == 0 || r.Epoch == 0 {
		return errors.New("invalid registration sequence or H+2 boundary")
	}
	switch r.Kind {
	case RegisterValidator:
		if r.Sequence != 1 || r.AuthorizingEpoch != 0 || r.Epoch != 1 || !regZero(r.PreviousEventHash) || len(r.LegacyEd25519PublicKey) != ed25519.PublicKeySize || len(r.AuthorityMLDSA87PublicKey) != 0 || len(r.AuthoritySLHDSASHA2256fPublicKey) != 0 {
			return errors.New("invalid first-registration authority")
		}
	case RotateValidator, RevokeValidator:
		if r.Sequence < 2 || r.AuthorizingEpoch == 0 || regZero(r.PreviousEventHash) || len(r.LegacyEd25519PublicKey) != 0 || len(r.AuthorityMLDSA87PublicKey) != MLDSA87PublicKeySize || len(r.AuthoritySLHDSASHA2256fPublicKey) != SLHDSASHA2256fPublicKeySize {
			return errors.New("invalid current-pair registration authority")
		}
		if r.Kind == RotateValidator && (r.AuthorizingEpoch == math.MaxUint64 || r.Epoch != r.AuthorizingEpoch+1) {
			return errors.New("rotation must advance exactly one active epoch")
		}
		if r.Kind == RevokeValidator && r.Epoch < r.AuthorizingEpoch {
			return errors.New("revocation omits the authorizing epoch")
		}
	default:
		return errors.New("unknown validator registration kind")
	}
	if r.Kind == RevokeValidator {
		if len(r.MLDSA87PublicKey) != 0 || len(r.SLHDSASHA2256fPublicKey) != 0 {
			return errors.New("terminal revocation cannot propose keys")
		}
	} else if len(r.MLDSA87PublicKey) != MLDSA87PublicKeySize || len(r.SLHDSASHA2256fPublicKey) != SLHDSASHA2256fPublicKeySize {
		return errors.New("registration requires the complete fixed-suite new pair")
	}
	return nil
}

// MarshalBinary uses E(fields): each field has one four-byte big-endian length.
// Every integer component is four bytes; uint64 values use high then low U32.
func (r RegistrationIntent) MarshalBinary() ([]byte, error) {
	if err := r.Validate(); err != nil {
		return nil, err
	}
	f := [][]byte{[]byte(registrationIntentDomain), regU32(RegistryVersion), regU32(uint32(r.Kind)), r.GenesisID, []byte(r.ChainID), r.ValidatorAddress}
	for _, n := range []uint64{r.Sequence, r.AuthorizingEpoch, r.Epoch, uint64(r.ApprovedAt), uint64(r.EffectiveAt)} {
		f = append(f, regPair(n)...)
	}
	f = append(f, r.PreviousEventHash, r.LegacyEd25519PublicKey, r.AuthorityMLDSA87PublicKey, r.AuthoritySLHDSASHA2256fPublicKey, r.MLDSA87PublicKey, r.SLHDSASHA2256fPublicKey)
	return regEncode(MaxRegistrationIntentBytes, f...)
}

func DecodeRegistrationIntent(wire []byte) (RegistrationIntent, error) {
	var r RegistrationIntent
	f, err := regDecode(wire, 22, MaxRegistrationIntentBytes)
	if err != nil {
		return r, err
	}
	if string(f[0]) != registrationIntentDomain || !bytes.Equal(f[1], regU32(RegistryVersion)) || len(f[2]) != 4 {
		return r, errors.New("registration intent domain, version or kind")
	}
	r.Kind = RegistrationKind(binary.BigEndian.Uint32(f[2]))
	r.GenesisID, r.ChainID, r.ValidatorAddress = f[3], string(f[4]), f[5]
	n := make([]uint64, 5)
	for i := range n {
		n[i], err = regReadPair(f[6+2*i], f[7+2*i])
		if err != nil {
			return RegistrationIntent{}, err
		}
	}
	if n[3] > math.MaxInt64 || n[4] > math.MaxInt64 {
		return RegistrationIntent{}, errors.New("registration height exceeds int64")
	}
	r.Sequence, r.AuthorizingEpoch, r.Epoch = n[0], n[1], n[2]
	r.ApprovedAt, r.EffectiveAt = int64(n[3]), int64(n[4])
	r.PreviousEventHash, r.LegacyEd25519PublicKey = f[16], f[17]
	r.AuthorityMLDSA87PublicKey, r.AuthoritySLHDSASHA2256fPublicKey = f[18], f[19]
	r.MLDSA87PublicKey, r.SLHDSASHA2256fPublicKey = f[20], f[21]
	return r, r.Validate()
}

func (r RegistrationIntent) AuthoritySigningBytes() ([]byte, error) {
	body, err := r.MarshalBinary()
	if err != nil {
		return nil, err
	}
	return regEncode(MaxRegistrationIntentBytes+128, []byte(registrationAuthorityDomain), regU32(RegistryVersion), body)
}

func (r RegistrationIntent) PossessionSigningBytes() ([]byte, error) {
	if r.Kind == RevokeValidator {
		return nil, errors.New("revocation has no new-key possession branch")
	}
	body, err := r.MarshalBinary()
	if err != nil {
		return nil, err
	}
	return regEncode(MaxRegistrationIntentBytes+128, []byte(registrationPossessionDomain), regU32(RegistryVersion), body)
}

// Registration carries raw, exact-size signatures, not arbitrary consensus
// envelopes. The operation's domain and full intent prevent using consensus
// votes or a possession proof as current-authority approval.
type Registration struct {
	Intent                                      RegistrationIntent
	LegacyApproval                              []byte
	AuthorityMLDSA87, AuthoritySLHDSASHA2256f   []byte
	PossessionMLDSA87, PossessionSLHDSASHA2256f []byte
}

func (r Registration) validateProofShape() error {
	if r.Intent.Kind == RegisterValidator {
		if len(r.LegacyApproval) != ed25519.SignatureSize || len(r.AuthorityMLDSA87) != 0 || len(r.AuthoritySLHDSASHA2256f) != 0 {
			return errors.New("first registration requires only legacy approval in authority slot")
		}
	} else if len(r.LegacyApproval) != 0 || len(r.AuthorityMLDSA87) != MLDSA87SignatureSize || len(r.AuthoritySLHDSASHA2256f) != SLHDSASHA2256fSignatureSize {
		return errors.New("rotation/revocation requires both current-PQ authority signatures")
	}
	if r.Intent.Kind == RevokeValidator {
		if len(r.PossessionMLDSA87) != 0 || len(r.PossessionSLHDSASHA2256f) != 0 {
			return errors.New("revocation has extraneous possession proof")
		}
	} else if len(r.PossessionMLDSA87) != MLDSA87SignatureSize || len(r.PossessionSLHDSASHA2256f) != SLHDSASHA2256fSignatureSize {
		return errors.New("new pair requires both possession proofs")
	}
	return nil
}

func (r Registration) MarshalBinary() ([]byte, error) {
	body, err := r.Intent.MarshalBinary()
	if err != nil {
		return nil, err
	}
	if err := r.validateProofShape(); err != nil {
		return nil, err
	}
	return regEncode(MaxRegistrationBytes, []byte(registrationDomain), regU32(RegistryVersion), body, r.LegacyApproval, r.AuthorityMLDSA87, r.AuthoritySLHDSASHA2256f, r.PossessionMLDSA87, r.PossessionSLHDSASHA2256f)
}

func DecodeRegistration(wire []byte) (Registration, error) {
	var r Registration
	f, err := regDecode(wire, 8, MaxRegistrationBytes)
	if err != nil {
		return r, err
	}
	if string(f[0]) != registrationDomain || !bytes.Equal(f[1], regU32(RegistryVersion)) {
		return r, errors.New("registration operation domain or version")
	}
	r.Intent, err = DecodeRegistrationIntent(f[2])
	if err != nil {
		return r, err
	}
	r.LegacyApproval, r.AuthorityMLDSA87, r.AuthoritySLHDSASHA2256f, r.PossessionMLDSA87, r.PossessionSLHDSASHA2256f = f[3], f[4], f[5], f[6], f[7]
	return r, r.validateProofShape()
}

// RegistrationHash hashes the entire canonical operation, including every
// signature. It identifies exact audit bytes, not just an unsigned intent.
func RegistrationHash(wire []byte) ([32]byte, error) {
	if _, err := DecodeRegistration(wire); err != nil {
		return [32]byte{}, err
	}
	framed, err := regEncode(MaxRegistrationBytes+128, []byte(registrationHashDomain), wire)
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(framed), nil
}

func verifyRegistration(r Registration) error {
	auth, err := r.Intent.AuthoritySigningBytes()
	if err != nil {
		return err
	}
	var authorityErr error
	if r.Intent.Kind == RegisterValidator {
		if !ed25519.Verify(ed25519.PublicKey(r.Intent.LegacyEd25519PublicKey), auth, r.LegacyApproval) {
			authorityErr = errors.New("legacy validator did not approve registration")
		}
	} else {
		authorityErr = verifyRegistrationPair(CIRCLProvider{}, r.Intent.AuthorityMLDSA87PublicKey, r.Intent.AuthoritySLHDSASHA2256fPublicKey, auth, r.AuthorityMLDSA87, r.AuthoritySLHDSASHA2256f)
	}
	var possessionErr error
	if r.Intent.Kind != RevokeValidator {
		pop, err := r.Intent.PossessionSigningBytes()
		if err != nil {
			return err
		}
		possessionErr = verifyRegistrationPair(CIRCLProvider{}, r.Intent.MLDSA87PublicKey, r.Intent.SLHDSASHA2256fPublicKey, pop, r.PossessionMLDSA87, r.PossessionSLHDSASHA2256f)
	}
	return errors.Join(authorityErr, possessionErr)
}

// The production caller always installs CIRCLProvider. Detached inputs and
// unconditional calls preserve AND semantics even when either branch fails.
func verifyRegistrationPair(p Provider, a, b, msg, sa, sb []byte) error {
	if p == nil {
		return errors.New("missing registration provider")
	}
	ea := p.VerifyMLDSA87(bytes.Clone(a), bytes.Clone(msg), bytes.Clone(sa))
	eb := p.VerifySLHDSASHA2256f(bytes.Clone(b), bytes.Clone(msg), bytes.Clone(sb))
	return errors.Join(ea, eb)
}

func regZero(b []byte) bool {
	for _, v := range b {
		if v != 0 {
			return false
		}
	}
	return true
}
func regU32(n uint32) []byte    { b := make([]byte, 4); binary.BigEndian.PutUint32(b, n); return b }
func regPair(n uint64) [][]byte { return [][]byte{regU32(uint32(n >> 32)), regU32(uint32(n))} }
func regReadPair(a, b []byte) (uint64, error) {
	if len(a) != 4 || len(b) != 4 {
		return 0, errors.New("registration integer components must be U32")
	}
	return uint64(binary.BigEndian.Uint32(a))<<32 | uint64(binary.BigEndian.Uint32(b)), nil
}

func regEncode(max int, fields ...[]byte) ([]byte, error) {
	total := 0
	for _, f := range fields {
		if max < 4 || total > max-4 || len(f) > max-total-4 || uint64(len(f)) > math.MaxUint32 {
			return nil, errors.New("registration encoding exceeds limit")
		}
		total += 4 + len(f)
	}
	out := make([]byte, 0, total)
	for _, f := range fields {
		out = appendField(out, f)
	}
	return out, nil
}

func regDecode(wire []byte, expected, max int) ([][]byte, error) {
	if max < 0 || len(wire) > max || expected < 0 || expected > len(wire)/4 {
		return nil, errors.New("registration frame exceeds limit or lacks fields")
	}
	fields := make([][]byte, 0, expected)
	left := wire
	for range expected {
		if len(left) < 4 {
			return nil, errors.New("truncated registration frame")
		}
		n := uint64(binary.BigEndian.Uint32(left[:4]))
		left = left[4:]
		if n > uint64(len(left)) {
			return nil, errors.New("registration field length exceeds frame")
		}
		fields = append(fields, bytes.Clone(left[:int(n)]))
		left = left[int(n):]
	}
	if len(left) != 0 {
		return nil, errors.New("trailing registration fields")
	}
	return fields, nil
}
