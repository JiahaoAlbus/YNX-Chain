package ynxauth

import (
	"bytes"
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	// PolicyVersion stays v1. Only the first admitted permanent revocation
	// explicitly upgrades the state; old v1 documents and signing bytes are intact.
	PolicyRevocationVersion = "YNX-ACCOUNT-POLICY/v2"
	RevocationIntentDomain  = "YNX-ACCOUNT-REVOCATION/v1"
	RevocationDomain        = "YNX-ACCOUNT-REVOCATION-ENVELOPE/v1"
	RevocationPurpose       = "ACCOUNT-REVOCATION"
	MaxRevocationBytes      = 128 << 10
)

func supportedPolicyVersion(version string) bool {
	return version == PolicyVersion || version == PolicyRevocationVersion
}

// RevocationRecord is an immutable terminal tombstone, not a new key revision.
// It invalidates all this owner's registered keys at RevokedFrom, including a
// previously admitted pending rotation. The complete original records remain.
// No classic, replacement-key-only, recovery or delegation fallback is created.
type RevocationRecord struct {
	Owner               string `json:"owner"`
	AuthorizingRevision uint64 `json:"authorizingRevision"`
	ThroughRevision     uint64 `json:"throughRevision"`
	RegisteredAt        uint64 `json:"registeredAt"`
	RevokedFrom         uint64 `json:"revokedFrom"`
	LedgerNonce         uint64 `json:"ledgerNonce"`
}

func (s State) revocationFor(owner string) (RevocationRecord, bool) {
	for _, r := range s.Revocations {
		if r.Owner == owner {
			return r, true
		}
	}
	return RevocationRecord{}, false
}

// RevocationAt selects effective revocation at the requested historical height.
// Before RevokedFrom it returns false. Pending tombstones remain in Revocations;
// neither this method nor PolicyAt replaces Validate or cryptographic admission.
func (s State) RevocationAt(owner string, height uint64) (RevocationRecord, bool) {
	r, found := s.revocationFor(owner)
	if !found || height < r.RevokedFrom {
		return RevocationRecord{}, false
	}
	return r, true
}

func (s State) validateRevocations() error {
	if s.Version == PolicyVersion {
		if len(s.Revocations) != 0 {
			return errors.New("v1 account policy cannot contain revocations")
		}
		return nil
	}
	if s.Version != PolicyRevocationVersion || len(s.Revocations) == 0 {
		return errors.New("v2 account policy requires a revocation tombstone")
	}
	for i, revoked := range s.Revocations {
		if !accountaddress.IsCanonical(revoked.Owner) || revoked.AuthorizingRevision == 0 || revoked.ThroughRevision < revoked.AuthorizingRevision || revoked.RegisteredAt < s.EnableAt || revoked.RegisteredAt == math.MaxUint64 || revoked.RevokedFrom != revoked.RegisteredAt+1 || revoked.LedgerNonce == 0 {
			return errors.New("invalid account revocation")
		}
		if i > 0 && s.Revocations[i-1].Owner >= revoked.Owner {
			return errors.New("account revocations are not unique and sorted")
		}
		var latest Record
		for _, r := range s.Records {
			if r.Owner == revoked.Owner {
				if r.RegisteredAt > revoked.RegisteredAt {
					return errors.New("registration after terminal revocation")
				}
				latest = r
			}
		}
		authority, active := s.PolicyAt(revoked.Owner, revoked.RegisteredAt)
		if !active || authority.Revision != revoked.AuthorizingRevision || latest.Revision != revoked.ThroughRevision || latest.LedgerNonce >= revoked.LedgerNonce {
			return errors.New("revocation differs from its complete registration history")
		}
	}
	return nil
}

// TrustedRegistration is the shared full-key resolver for Member AND Whole
// verification. PolicyAt alone must never be converted to Enabled:true. Resolve
// again for every authenticated-handle use under the caller's ledger lock. A
// pending tombstone changes the cache identity without invalidating old heights.
func (s State) TrustedRegistration(owner, purpose string, height uint64) (ynxbatch.Registration, error) {
	if err := s.Validate(s.NetworkID); err != nil {
		return ynxbatch.Registration{}, err
	}
	if !supportedPolicyVersion(s.Version) || height < s.EnableAt {
		return ynxbatch.Registration{}, ErrPolicy
	}
	r, active := s.PolicyAt(owner, height)
	if !active {
		return ynxbatch.Registration{}, ErrPolicy
	}
	trusted := registration(r, s.NetworkID, purpose)
	if revoked, exists := s.revocationFor(owner); exists {
		if height >= revoked.RevokedFrom {
			return ynxbatch.Registration{}, ErrPolicy
		}
		at := revoked.RevokedFrom
		trusted.RevokedAt = &at
	}
	return trusted, nil
}

// RevocationIntent requires the full CURRENT lawful pair, not proposed keys.
// ThroughRevision binds the complete known registration schedule. ExecuteAt is
// exact, and RevokeAt must be ExecuteAt+1, preventing delayed intent replay and
// preserving earlier transactions admitted in the same block.
type RevocationIntent struct {
	ChainID                []byte
	Owner                  string
	PKA, PKB               []byte
	AuthorizingRevision    uint64
	ThroughRevision        uint64
	LedgerNonce, ExecuteAt uint64
	RevokeAt               uint64
}

func (r RevocationIntent) Validate() error {
	if len(r.ChainID) != 32 || !accountaddress.IsCanonical(r.Owner) || len(r.PKA) != ynxbatch.PublicKeyASize || len(r.PKB) != ynxbatch.PublicKeyBSize {
		return errors.New("invalid full revocation identity")
	}
	if r.AuthorizingRevision == 0 || r.ThroughRevision < r.AuthorizingRevision || r.LedgerNonce == 0 || r.ExecuteAt == 0 || r.ExecuteAt == math.MaxUint64 || r.RevokeAt != r.ExecuteAt+1 {
		return errors.New("invalid revocation sequence or height")
	}
	return nil
}

func (r RevocationIntent) SigningBytes() ([]byte, error) {
	if err := r.Validate(); err != nil {
		return nil, err
	}
	fields := [][]byte{[]byte(RevocationIntentDomain), ynxbatch.U32(1), r.ChainID, []byte(r.Owner), []byte(ynxbatch.Version), r.PKA, r.PKB}
	for _, value := range []uint64{r.AuthorizingRevision, r.ThroughRevision, r.LedgerNonce, r.ExecuteAt, r.RevokeAt} {
		fields = append(fields, pair(value)...)
	}
	return ynxbatch.EncodeFields(fields...)
}

func DecodeRevocationIntent(wire []byte) (RevocationIntent, error) {
	var r RevocationIntent
	fields, err := frame(wire, 17, 4096)
	if err != nil {
		return r, err
	}
	if string(fields[0]) != RevocationIntentDomain || !bytes.Equal(fields[1], ynxbatch.U32(1)) || string(fields[4]) != ynxbatch.Version {
		return r, errors.New("revocation intent domain or version")
	}
	r.ChainID, r.Owner, r.PKA, r.PKB = fields[2], string(fields[3]), fields[5], fields[6]
	for i, value := range []*uint64{&r.AuthorizingRevision, &r.ThroughRevision, &r.LedgerNonce, &r.ExecuteAt, &r.RevokeAt} {
		*value, err = readPair(fields[7+2*i], fields[8+2*i])
		if err != nil {
			return r, err
		}
	}
	return r, r.Validate()
}

// Revocation carries exactly one current-pair MemberWire. It has no classic
// field, proposed-key field, secret-key bytes or alternate authorization branch.
type Revocation struct {
	Intent         RevocationIntent
	CurrentPQProof []byte
}

func (r Revocation) Encode() ([]byte, error) {
	intent, err := r.Intent.SigningBytes()
	if err != nil {
		return nil, err
	}
	if len(r.CurrentPQProof) == 0 || len(r.CurrentPQProof) > MaxRevocationBytes {
		return nil, errors.New("revocation proof bounds")
	}
	wire, err := ynxbatch.EncodeFields([]byte(RevocationDomain), intent, r.CurrentPQProof)
	if err != nil {
		return nil, err
	}
	if len(wire) > MaxRevocationBytes {
		return nil, errors.New("revocation exceeds bound")
	}
	return wire, nil
}

func DecodeRevocation(wire []byte) (Revocation, error) {
	var r Revocation
	fields, err := frame(wire, 3, MaxRevocationBytes)
	if err != nil {
		return r, err
	}
	if string(fields[0]) != RevocationDomain || len(fields[2]) == 0 {
		return r, errors.New("revocation envelope domain or missing proof")
	}
	r.Intent, err = DecodeRevocationIntent(fields[1])
	if err != nil {
		return r, err
	}
	r.CurrentPQProof = fields[2]
	return r, nil
}

// AdmitRevocation returns a detached terminal policy only after a genuine dual
// proof from the current lawful pair. It consumes no nonce or fee and writes no
// file. The ledger adapter MUST atomically persist its nonce, fee, audit wire and
// tombstone, and must not enable v2 until snapshot/history/Whole/query adapters
// also understand revocations. A retry is handled by the original ledger receipt;
// this method does not silently admit the same nonce twice.
func (s State) AdmitRevocation(r Revocation, height, currentNonce uint64) (State, error) {
	if _, err := r.Encode(); err != nil {
		return State{}, err
	}
	if err := s.Validate(s.NetworkID); err != nil {
		return State{}, err
	}
	if !supportedPolicyVersion(s.Version) || height < s.EnableAt || !bytes.Equal(r.Intent.ChainID, s.NetworkID) {
		return State{}, ErrPolicy
	}
	if r.Intent.ExecuteAt != height || currentNonce == math.MaxUint64 || r.Intent.LedgerNonce != currentNonce+1 {
		return State{}, errors.New("revocation execution height or nonce mismatch")
	}
	if _, exists := s.revocationFor(r.Intent.Owner); exists {
		return State{}, ErrPolicy
	}
	current, active := s.PolicyAt(r.Intent.Owner, height)
	if !active || current.Revision != r.Intent.AuthorizingRevision || !bytes.Equal(current.PKA, r.Intent.PKA) || !bytes.Equal(current.PKB, r.Intent.PKB) {
		return State{}, ErrPolicy
	}
	var latest Record
	for _, record := range s.Records {
		if record.Owner == r.Intent.Owner {
			latest = record
		}
	}
	if latest.Revision != r.Intent.ThroughRevision || latest.RegisteredAt > height || latest.LedgerNonce > currentNonce {
		return State{}, errors.New("revocation omits or precedes the latest registration")
	}
	member, err := ynxbatch.DecodeMember(r.CurrentPQProof)
	if err != nil {
		return State{}, err
	}
	if member.Certificate.N != 1 || member.Proof.Index != 0 {
		return State{}, errors.New("revocation requires one complete current-pair message")
	}
	message, err := r.Intent.SigningBytes()
	if err != nil {
		return State{}, err
	}
	if err = s.VerifyMember(r.Intent.Owner, RevocationPurpose, message, r.CurrentPQProof, height); err != nil {
		return State{}, err
	}
	out := s.Clone()
	out.Version = PolicyRevocationVersion
	tombstone := RevocationRecord{Owner: r.Intent.Owner, AuthorizingRevision: r.Intent.AuthorizingRevision, ThroughRevision: r.Intent.ThroughRevision, RegisteredAt: height, RevokedFrom: r.Intent.RevokeAt, LedgerNonce: r.Intent.LedgerNonce}
	at := len(out.Revocations)
	for i, existing := range out.Revocations {
		if existing.Owner > tombstone.Owner {
			at = i
			break
		}
	}
	out.Revocations = append(out.Revocations, RevocationRecord{})
	copy(out.Revocations[at+1:], out.Revocations[at:])
	out.Revocations[at] = tombstone
	return out, out.Validate(out.NetworkID)
}
