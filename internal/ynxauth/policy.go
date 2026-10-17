package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

const PolicyVersion = "YNX-ACCOUNT-POLICY/v1"
const MigrationDomain = "YNX-ACCOUNT-MIGRATION/v1"
const MaxMigrationBytes = 256 << 10

var ErrPolicy = errors.New("account requires its active dual post-quantum authorization")

// Record is immutable once admitted. Earlier records are retained to verify
// historical authorization at the original execution height. A later revision
// supersedes its predecessor only at ActiveFrom.
type Record struct {
	AlgorithmVersion string `json:"algorithmVersion"`
	Owner            string `json:"owner"`
	PKA              []byte `json:"pkA"`
	PKB              []byte `json:"pkB"`
	Revision         uint64 `json:"revision"`
	RegisteredAt     uint64 `json:"registeredAt"`
	ActiveFrom       uint64 `json:"activeFrom"`
	LedgerNonce      uint64 `json:"ledgerNonce"`
}

// State is part of the authoritative persisted ledger. NetworkID is the raw
// original genesis hash; it is not supplied by an HTTP client. EnableAt is the
// coordinated protocol admission height, independent of each account's switch.
// Empty state preserves historical legacy networks without choosing a rollout.
type State struct {
	Version   string   `json:"version"`
	NetworkID []byte   `json:"networkId"`
	EnableAt  uint64   `json:"enableAt"`
	Records   []Record `json:"records"`
}

func (s State) Validate(network []byte) error {
	if s.Version == "" && len(s.NetworkID) == 0 && s.EnableAt == 0 && len(s.Records) == 0 {
		return nil
	}
	if s.Version != PolicyVersion || len(network) != 32 || !bytes.Equal(s.NetworkID, network) || s.EnableAt == 0 {
		return errors.New("invalid account policy network or activation")
	}
	var prior Record
	for i, r := range s.Records {
		if r.AlgorithmVersion != ynxbatch.Version || !accountaddress.IsCanonical(r.Owner) || len(r.PKA) != ynxbatch.PublicKeyASize || len(r.PKB) != ynxbatch.PublicKeyBSize || r.Revision == 0 || r.RegisteredAt < s.EnableAt || r.ActiveFrom <= r.RegisteredAt || r.LedgerNonce == 0 {
			return errors.New("invalid account registration")
		}
		if i > 0 && r.Owner < prior.Owner {
			return errors.New("account registrations are not sorted")
		}
		if i == 0 || r.Owner != prior.Owner {
			if r.Revision != 1 {
				return errors.New("missing initial account registration")
			}
		} else if prior.Revision == math.MaxUint64 || r.Revision != prior.Revision+1 || r.RegisteredAt < prior.ActiveFrom || r.ActiveFrom <= prior.ActiveFrom || r.LedgerNonce <= prior.LedgerNonce {
			return errors.New("invalid account registration history")
		}
		prior = r
	}
	return nil
}

func (s State) Clone() State {
	s.NetworkID = bytes.Clone(s.NetworkID)
	s.Records = append([]Record(nil), s.Records...)
	for i := range s.Records {
		s.Records[i].PKA = bytes.Clone(s.Records[i].PKA)
		s.Records[i].PKB = bytes.Clone(s.Records[i].PKB)
	}
	return s
}

// PolicyAt never treats a pending revision as active and never restores classic
// authorization after the first activation. The caller holds its state lock or
// supplies an immutable ledger snapshot for the entire verification/transition.
func (s State) PolicyAt(owner string, height uint64) (Record, bool) {
	var found Record
	active := false
	for _, r := range s.Records {
		if r.Owner == owner && r.ActiveFrom <= height {
			found = r
			active = true
		}
	}
	if active {
		found.PKA = bytes.Clone(found.PKA)
		found.PKB = bytes.Clone(found.PKB)
	}
	return found, active
}

func (s State) RequireLegacy(owner string, height uint64) error {
	if !accountaddress.IsCanonical(owner) {
		return errors.New("authorization owner must be canonical")
	}
	if err := s.Validate(s.NetworkID); err != nil {
		return err
	}
	if _, active := s.PolicyAt(owner, height); active {
		return ErrPolicy
	}
	return nil
}

func registration(r Record, network []byte, purpose string) ynxbatch.Registration {
	return ynxbatch.Registration{AlgorithmVersion: r.AlgorithmVersion, Owner: r.Owner, Purpose: purpose, PolicyRevision: strconv.FormatUint(r.Revision, 10), ChainID: bytes.Clone(network), PKA: bytes.Clone(r.PKA), PKB: bytes.Clone(r.PKB), Enabled: true, ActiveFrom: r.ActiveFrom}
}

// VerifyMember checks both full keys against the ledger at this exact height.
// It also binds the complete application message; a valid certificate by itself
// cannot authorize different decoded execution fields.
func (s State) VerifyMember(owner, purpose string, message, wire []byte, height uint64) error {
	if err := s.Validate(s.NetworkID); err != nil {
		return err
	}
	if s.Version != PolicyVersion || height < s.EnableAt {
		return ErrPolicy
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return err
	}
	if m.Certificate.Owner != owner || !bytes.Equal(m.Message, message) {
		return errors.New("authorization message or sender mismatch")
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: s.NetworkID, Purpose: purpose, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		r, ok := s.PolicyAt(req.Owner, req.Height)
		if !ok {
			return ynxbatch.Registration{}, ErrPolicy
		}
		return registration(r, s.NetworkID, purpose), nil
	}})
	if err != nil {
		return err
	}
	return v.VerifyOne(wire, height)
}

// Migration contains raw bytes only. NewKeyProof is a one-message WholeWire
// under the proposed pair. CurrentPQProof is a one-message MemberWire under the
// active old pair, or empty when classic authorization is still lawful.
type Migration struct {
	Intent                             RegistrationIntent
	ClassicPublicKey, ClassicSignature []byte
	CurrentPQProof, NewKeyProof        []byte
}

func (m Migration) Encode() ([]byte, error) {
	intent, err := m.Intent.SigningBytes()
	if err != nil {
		return nil, err
	}
	w, err := ynxbatch.EncodeFields([]byte(MigrationDomain), intent, m.ClassicPublicKey, m.ClassicSignature, m.CurrentPQProof, m.NewKeyProof)
	if err != nil {
		return nil, err
	}
	if len(w) > MaxMigrationBytes {
		return nil, errors.New("migration exceeds bound")
	}
	return w, nil
}

func DecodeMigration(wire []byte) (Migration, error) {
	var m Migration
	f, err := frame(wire, 6, MaxMigrationBytes)
	if err != nil {
		return m, err
	}
	if string(f[0]) != MigrationDomain {
		return m, errors.New("migration domain")
	}
	m.Intent, err = DecodeRegistrationIntent(f[1])
	if err != nil {
		return m, err
	}
	m.ClassicPublicKey, m.ClassicSignature, m.CurrentPQProof, m.NewKeyProof = f[2], f[3], f[4], f[5]
	return m, nil
}

// VerifyClassicMigration uses the existing account address derivation and
// canonical low-S secp256k1 rule over SHA256(full registration intent). It is
// legal only before PQ activation; callers cannot use it to recover an active
// PQ account with its old mnemonic.
func VerifyClassicMigration(owner string, message, pub, sig []byte) error {
	if len(pub) != 33 || len(sig) == 0 || len(sig) > 72 {
		return errors.New("classic migration signature format")
	}
	p, err := secp256k1.ParsePubKey(pub)
	if err != nil {
		return err
	}
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(p.SerializeUncompressed()[1:])
	sum := h.Sum(nil)
	if owner != "0x"+hex.EncodeToString(sum[len(sum)-20:]) {
		return errors.New("classic migration signer mismatch")
	}
	s, err := ecdsa.ParseDERSignature(sig)
	if err != nil {
		return err
	}
	sv := s.S()
	if sv.IsOverHalfOrder() || !bytes.Equal(s.Serialize(), sig) {
		return errors.New("noncanonical classic migration signature")
	}
	digest := sha256.Sum256(message)
	if !s.Verify(digest[:], p) {
		return errors.New("classic migration signature rejected")
	}
	return nil
}

// AdmitMigration returns a new detached state only after both the CURRENT
// lawful account authorization and BOTH proposed-key proofs pass. It does not
// change a balance/nonce or persist anything; the ledger must commit the state,
// consumed nonce, fee and audit transaction atomically under the same lock.
func (s State) AdmitMigration(m Migration, height, currentNonce uint64) (State, error) {
	if len(m.ClassicPublicKey) > 33 || len(m.ClassicSignature) > 72 || len(m.CurrentPQProof) > 128<<10 || len(m.NewKeyProof) > 128<<10 {
		return State{}, errors.New("migration proof bounds")
	}
	if _, err := m.Encode(); err != nil {
		return State{}, err
	}
	if err := s.Validate(s.NetworkID); err != nil {
		return State{}, err
	}
	if s.Version != PolicyVersion || height < s.EnableAt || !bytes.Equal(m.Intent.ChainID, s.NetworkID) {
		return State{}, ErrPolicy
	}
	msg, err := m.Intent.SigningBytes()
	if err != nil {
		return State{}, err
	}
	if currentNonce == math.MaxUint64 || m.Intent.LedgerNonce != currentNonce+1 || m.Intent.ActivateAt <= height {
		return State{}, errors.New("migration nonce or activation invalid")
	}
	var latest Record
	for _, r := range s.Records {
		if r.Owner == m.Intent.Owner {
			latest = r
		}
	}
	if latest.Revision != m.Intent.PriorRevision || (latest.Revision > 0 && height < latest.ActiveFrom) {
		return State{}, errors.New("migration revision mismatch or pending activation")
	}
	if _, active := s.PolicyAt(m.Intent.Owner, height); active {
		if len(m.ClassicPublicKey) > 0 || len(m.ClassicSignature) > 0 {
			return State{}, ErrPolicy
		}
		if err = s.VerifyMember(m.Intent.Owner, MigrationPurpose, msg, m.CurrentPQProof, height); err != nil {
			return State{}, err
		}
	} else {
		if len(m.CurrentPQProof) > 0 {
			return State{}, errors.New("unexpected current PQ proof")
		}
		if err = VerifyClassicMigration(m.Intent.Owner, msg, m.ClassicPublicKey, m.ClassicSignature); err != nil {
			return State{}, err
		}
	}
	whole, err := ynxbatch.DecodeWhole(m.NewKeyProof)
	if err != nil {
		return State{}, err
	}
	if whole.Certificate.N != 1 || len(whole.Messages) != 1 || !bytes.Equal(whole.Messages[0], msg) || whole.Certificate.Owner != m.Intent.Owner || !bytes.Equal(whole.Certificate.PKA, m.Intent.PKA) || !bytes.Equal(whole.Certificate.PKB, m.Intent.PKB) {
		return State{}, errors.New("new-key possession proof mismatch")
	}
	// This temporary resolver attests only proposed-key possession, never the
	// account's authority. Current authority was separately checked above.
	proposed := Record{AlgorithmVersion: ynxbatch.Version, Owner: m.Intent.Owner, PKA: m.Intent.PKA, PKB: m.Intent.PKB, Revision: m.Intent.NewRevision}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: s.NetworkID, Purpose: MigrationPurpose, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		if req.Owner != proposed.Owner {
			return ynxbatch.Registration{}, ErrPolicy
		}
		return registration(proposed, s.NetworkID, MigrationPurpose), nil
	}})
	if err != nil {
		return State{}, err
	}
	if err = v.VerifyWhole(m.NewKeyProof, height); err != nil {
		return State{}, fmt.Errorf("new dual-key possession: %w", err)
	}
	proposed.RegisteredAt, proposed.ActiveFrom, proposed.LedgerNonce = height, m.Intent.ActivateAt, m.Intent.LedgerNonce
	out := s.Clone()
	at := len(out.Records)
	for i, r := range out.Records {
		if r.Owner > proposed.Owner {
			at = i
			break
		}
	}
	out.Records = append(out.Records, Record{})
	copy(out.Records[at+1:], out.Records[at:])
	out.Records[at] = proposed
	out = out.Clone()
	return out, out.Validate(out.NetworkID)
}
