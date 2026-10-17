package ynxconsensusauth

import (
	"bytes"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// The sources below are explicit public QA historical-state fixtures. They
// select actual fresh keys at the requested height; no accepting crypto spy,
// zero signature or caller-provided certificate key is used in these tests.
type evidenceTestRegistry struct {
	records []KeyRecord
	heights []int64
}

func (r *evidenceTestRegistry) ConsensusKeysAt(chainID string, address []byte, height int64) (KeyRecord, error) {
	r.heights = append(r.heights, height)
	for _, record := range r.records {
		if record.ChainID == chainID && bytes.Equal(record.ValidatorAddress, address) && record.ValidFromHeight <= height && (record.ValidUntilHeight == 0 || height < record.ValidUntilHeight) {
			return record, nil
		}
	}
	return KeyRecord{}, errors.New("no historical registered pair")
}

type evidenceTestSource struct {
	state EvidenceState
	err   error
	calls int
	chain string
	at    int64
}

func (s *evidenceTestSource) ConsensusEvidenceStateAt(chainID string, height int64) (EvidenceState, error) {
	s.calls++
	s.chain, s.at = chainID, height
	return s.state, s.err
}

type evidenceFixture struct {
	policy   Policy
	key      *CandidateKey
	record   KeyRecord
	registry *evidenceTestRegistry
	source   *evidenceTestSource
	evidence *cmttypes.DuplicateVoteEvidence
	verifier *Verifier
}

func copyEvidenceVote(vote *cmttypes.Vote) *cmttypes.Vote {
	copy := *vote
	copy.ValidatorAddress = bytes.Clone(vote.ValidatorAddress)
	copy.Signature = bytes.Clone(vote.Signature)
	copy.Extension = bytes.Clone(vote.Extension)
	copy.ExtensionSignature = bytes.Clone(vote.ExtensionSignature)
	copy.BlockID.Hash = bytes.Clone(vote.BlockID.Hash)
	copy.BlockID.PartSetHeader.Hash = bytes.Clone(vote.BlockID.PartSetHeader.Hash)
	return &copy
}

func copyDuplicateEvidence(evidence *cmttypes.DuplicateVoteEvidence) *cmttypes.DuplicateVoteEvidence {
	copy := *evidence
	copy.VoteA, copy.VoteB = copyEvidenceVote(evidence.VoteA), copyEvidenceVote(evidence.VoteB)
	return &copy
}

func copyEvidenceState(state EvidenceState) EvidenceState {
	if state.Validators == nil {
		return state
	}
	vals := &cmttypes.ValidatorSet{}
	for _, validator := range state.Validators.Validators {
		copy := *validator
		copy.Address = bytes.Clone(validator.Address)
		vals.Validators = append(vals.Validators, &copy)
	}
	state.Validators = vals
	return state
}

func signMaliciousEvidenceVote(t testing.TB, key *CandidateKey, record KeyRecord, vote *cmttypes.Vote) {
	t.Helper()
	request, err := NewVoteRequest(record.ChainID, vote.ToProto())
	if err != nil {
		t.Fatal(err)
	}
	// This test models a malicious validator with raw secret-key access, so it
	// deliberately uses the package-private primitive to create REAL conflicting
	// signatures. The production durable signer does not expose this bypass.
	vote.Signature, err = key.signRequest(request, record)
	if err != nil {
		t.Fatal(err)
	}
}

func newEvidenceFixture(t testing.TB, kind cmtproto.SignedMsgType, nilBlock bool) evidenceFixture {
	t.Helper()
	policy := Policy{Version: Version, ChainID: "ynx-evidence-qa-only", ActivationHeight: 100}
	key, publicA, publicB, err := GenerateCandidateKey()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	address := bytes.Repeat([]byte{0x31}, validatorAddressSize)
	record := KeyRecord{Version: Version, ChainID: policy.ChainID, ValidatorAddress: address, Epoch: 7, ValidFromHeight: 100, ValidUntilHeight: 150, MLDSA87PublicKey: publicA, SLHDSASHA2256fPublicKey: publicB}
	registry := &evidenceTestRegistry{records: []KeyRecord{record}}
	verifier, err := NewCIRCLVerifier(policy, registry, nil)
	if err != nil {
		t.Fatal(err)
	}
	proto := fixtureVote(100)
	blockID, err := cmttypes.BlockIDFromProto(&proto.BlockID)
	if err != nil {
		t.Fatal(err)
	}
	a := &cmttypes.Vote{Type: kind, Height: 100, Round: 2, BlockID: *blockID, Timestamp: proto.Timestamp,
		ValidatorAddress: bytes.Clone(address), ValidatorIndex: 1}
	b := copyEvidenceVote(a)
	b.BlockID.Hash = bytes.Repeat([]byte{0x34}, 32)
	if nilBlock {
		b.BlockID = cmttypes.BlockID{}
	}
	// Distinct timestamps are legal in duplicate evidence; only H/R/type and
	// validator must coincide. Both timestamps remain covered by their signatures.
	b.Timestamp = b.Timestamp.Add(time.Nanosecond)
	signMaliciousEvidenceVote(t, key, record, a)
	signMaliciousEvidenceVote(t, key, record, b)
	vals := &cmttypes.ValidatorSet{Validators: []*cmttypes.Validator{
		{Address: bytes.Repeat([]byte{0x44}, validatorAddressSize), VotingPower: 7},
		{Address: bytes.Clone(address), VotingPower: 3},
	}}
	blockTime := proto.Timestamp.Add(time.Second)
	evidence, err := cmttypes.NewDuplicateVoteEvidence(a, b, blockTime, vals)
	if err != nil {
		t.Fatal(err)
	}
	source := &evidenceTestSource{state: EvidenceState{ChainID: policy.ChainID, Height: 100, BlockTime: blockTime, Validators: vals}}
	return evidenceFixture{policy: policy, key: key, record: record, registry: registry, source: source, evidence: evidence, verifier: verifier}
}

func TestRealPQDuplicateEvidenceUsesBothVotesAndHistoricalKeys(t *testing.T) {
	f := newEvidenceFixture(t, cmtproto.PrecommitType, false)
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, f.source); err != nil {
		t.Fatal(err)
	}
	if f.source.calls != 1 || f.source.chain != f.policy.ChainID || f.source.at != 100 || len(f.registry.heights) != 2 || f.registry.heights[0] != 100 || f.registry.heights[1] != 100 {
		t.Fatal("did not resolve exact historical block, validator set and both key records")
	}
	if err := f.evidence.ValidateBasic(); err == nil || !strings.Contains(err.Error(), "signature is too big") {
		t.Fatalf("stock Comet unexpectedly accepts this candidate wire: %v", err)
	}
	// A later rotation/removal must not erase the record lawful at height 100.
	newKey, publicA, publicB, err := GenerateCandidateKey()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(newKey.Destroy)
	current := f.record
	current.Epoch, current.ValidFromHeight, current.ValidUntilHeight = 8, 150, 170
	current.MLDSA87PublicKey, current.SLHDSASHA2256fPublicKey = publicA, publicB
	f.registry.records = append(f.registry.records, current)
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, f.source); err != nil {
		t.Fatal("later key rotation/revocation erased valid historical evidence:", err)
	}
	oldRecords := f.registry.records
	f.registry.records = []KeyRecord{current}
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, f.source); err == nil {
		t.Fatal("current registry was substituted for unavailable historical keys")
	}
	f.registry.records = oldRecords
	// Never let a known proposed/current key self-authorize evidence about an
	// earlier height. This negative has genuine signatures under the wrong pair.
	wrong := copyDuplicateEvidence(f.evidence)
	signMaliciousEvidenceVote(t, newKey, current, wrong.VoteA)
	signMaliciousEvidenceVote(t, newKey, current, wrong.VoteB)
	if err := f.verifier.VerifyDuplicateVoteEvidence(wrong, f.source); err == nil {
		t.Fatal("later pair authorized old-height evidence")
	}
	for _, which := range []string{"A/ML", "A/SLH", "B/ML", "B/SLH"} {
		t.Run(which, func(t *testing.T) {
			bad := copyDuplicateEvidence(f.evidence)
			vote := bad.VoteA
			if which[0] == 'B' {
				vote = bad.VoteB
			}
			envelope, err := ParseEnvelope(vote.Signature)
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasSuffix(which, "ML") {
				envelope.MLDSA87[0] ^= 1
			} else {
				envelope.SLHDSASHA2256f[0] ^= 1
			}
			vote.Signature, err = envelope.MarshalBinary()
			if err != nil {
				t.Fatal(err)
			}
			if err := f.verifier.VerifyDuplicateVoteEvidence(bad, f.source); err == nil {
				t.Fatal("one damaged real signature branch still proved equivocation")
			}
		})
	}
}

func TestDuplicateEvidenceChecksCanonicalConflictAndMetadata(t *testing.T) {
	f := newEvidenceFixture(t, cmtproto.PrecommitType, false)
	sameInstant := copyDuplicateEvidence(f.evidence)
	sameInstant.Timestamp = sameInstant.Timestamp.In(time.FixedZone("historical-block-zone", 8*60*60))
	if err := f.verifier.VerifyDuplicateVoteEvidence(sameInstant, f.source); err != nil {
		t.Fatal("equivalent historical block instant was rejected by its timezone representation:", err)
	}
	for name, change := range map[string]func(*cmttypes.DuplicateVoteEvidence){
		"same block":           func(e *cmttypes.DuplicateVoteEvidence) { e.VoteB.BlockID = e.VoteA.BlockID },
		"reverse order":        func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA, e.VoteB = e.VoteB, e.VoteA },
		"different height":     func(e *cmttypes.DuplicateVoteEvidence) { e.VoteB.Height++ },
		"different round":      func(e *cmttypes.DuplicateVoteEvidence) { e.VoteB.Round++ },
		"different type":       func(e *cmttypes.DuplicateVoteEvidence) { e.VoteB.Type = cmtproto.PrevoteType },
		"different validator":  func(e *cmttypes.DuplicateVoteEvidence) { e.VoteB.ValidatorAddress[0] ^= 1 },
		"zero height":          func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.Height, e.VoteB.Height = 0, 0 },
		"negative round":       func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.Round, e.VoteB.Round = -1, -1 },
		"negative index":       func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.ValidatorIndex = -1 },
		"wrong vote type":      func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.Type = cmtproto.ProposalType },
		"short address":        func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.ValidatorAddress = e.VoteA.ValidatorAddress[:19] },
		"incomplete block":     func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.BlockID.PartSetHeader.Total = 0 },
		"short block hash":     func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.BlockID.Hash = []byte{1} },
		"missing signature":    func(e *cmttypes.DuplicateVoteEvidence) { e.VoteB.Signature = nil },
		"trailing signature":   func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.Signature = append(e.VoteA.Signature, 0) },
		"changed signed time":  func(e *cmttypes.DuplicateVoteEvidence) { e.VoteA.Timestamp = e.VoteA.Timestamp.Add(time.Second) },
		"peer validator power": func(e *cmttypes.DuplicateVoteEvidence) { e.ValidatorPower++ },
		"peer total power":     func(e *cmttypes.DuplicateVoteEvidence) { e.TotalVotingPower++ },
		"peer block time":      func(e *cmttypes.DuplicateVoteEvidence) { e.Timestamp = e.Timestamp.Add(time.Nanosecond) },
		"nil vote":             func(e *cmttypes.DuplicateVoteEvidence) { e.VoteB = nil },
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyDuplicateEvidence(f.evidence)
			change(bad)
			if err := f.verifier.VerifyDuplicateVoteEvidence(bad, f.source); err == nil {
				t.Fatal("malformed or nonconflicting evidence accepted")
			}
		})
	}
	// Upstream evidence identity uses address, not unsigned validator-index
	// metadata. Arbitrary nonnegative indices must never select another power.
	unsignedIndex := copyDuplicateEvidence(f.evidence)
	unsignedIndex.VoteA.ValidatorIndex, unsignedIndex.VoteB.ValidatorIndex = 123, math.MaxInt32
	if err := f.verifier.VerifyDuplicateVoteEvidence(unsignedIndex, f.source); err != nil {
		t.Fatal("unsigned evidence index was incorrectly treated as authority:", err)
	}
	for _, missing := range []*cmttypes.DuplicateVoteEvidence{nil, {}} {
		if err := f.verifier.VerifyDuplicateVoteEvidence(missing, f.source); err == nil {
			t.Fatal("missing evidence accepted")
		}
	}
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, nil); err == nil {
		t.Fatal("missing trusted source accepted")
	}
	var absentVerifier *Verifier
	if err := absentVerifier.VerifyDuplicateVoteEvidence(f.evidence, f.source); err == nil {
		t.Fatal("nil verifier accepted evidence")
	}
}

func TestDuplicateEvidenceRejectsWrongHeightSetAndForgedPower(t *testing.T) {
	f := newEvidenceFixture(t, cmtproto.PrecommitType, false)
	for name, change := range map[string]func(*EvidenceState){
		"wrong chain":      func(s *EvidenceState) { s.ChainID += "-other" },
		"current height":   func(s *EvidenceState) { s.Height++ },
		"wrong block time": func(s *EvidenceState) { s.BlockTime = s.BlockTime.Add(time.Second) },
		"missing time":     func(s *EvidenceState) { s.BlockTime = time.Time{} },
		"missing set":      func(s *EvidenceState) { s.Validators = nil },
		"empty set":        func(s *EvidenceState) { s.Validators.Validators = nil },
		"nil validator":    func(s *EvidenceState) { s.Validators.Validators[0] = nil },
		"missing signer":   func(s *EvidenceState) { s.Validators.Validators = s.Validators.Validators[:1] },
		"duplicate address": func(s *EvidenceState) {
			s.Validators.Validators[0].Address = bytes.Clone(s.Validators.Validators[1].Address)
		},
		"short address":          func(s *EvidenceState) { s.Validators.Validators[0].Address = []byte{1} },
		"zero power":             func(s *EvidenceState) { s.Validators.Validators[1].VotingPower = 0 },
		"negative power":         func(s *EvidenceState) { s.Validators.Validators[1].VotingPower = -1 },
		"power overflow":         func(s *EvidenceState) { s.Validators.Validators[1].VotingPower = cmttypes.MaxTotalVotingPower },
		"power over bound":       func(s *EvidenceState) { s.Validators.Validators[1].VotingPower = cmttypes.MaxTotalVotingPower + 1 },
		"different signer power": func(s *EvidenceState) { s.Validators.Validators[1].VotingPower++ },
	} {
		t.Run(name, func(t *testing.T) {
			source := &evidenceTestSource{state: copyEvidenceState(f.source.state)}
			change(&source.state)
			if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, source); err == nil {
				t.Fatal("unbound historical set, time or voting power accepted")
			}
		})
	}
	unavailable := &evidenceTestSource{state: f.source.state, err: errors.New("historical block unavailable")}
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, unavailable); err == nil {
		t.Fatal("unavailable historical source fell back to current state")
	}
	// A stale cached total cannot hide real per-validator power changes.
	stale := copyEvidenceState(f.source.state)
	if stale.Validators.TotalVotingPower() != 10 {
		t.Fatal("bad QA total")
	}
	stale.Validators.Validators[0].VotingPower++
	if stale.Validators.TotalVotingPower() != 10 {
		t.Fatal("QA fixture did not retain the upstream total cache")
	}
	if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, &evidenceTestSource{state: stale}); err == nil {
		t.Fatal("evidence trusted the stale cached total")
	}
	// The exact legal total bound remains usable without addition overflow.
	maxState := copyEvidenceState(f.source.state)
	maxState.Validators.Validators = maxState.Validators.Validators[1:]
	maxState.Validators.Validators[0].VotingPower = cmttypes.MaxTotalVotingPower
	maxEvidence := copyDuplicateEvidence(f.evidence)
	maxEvidence.ValidatorPower, maxEvidence.TotalVotingPower = cmttypes.MaxTotalVotingPower, cmttypes.MaxTotalVotingPower
	if err := f.verifier.VerifyDuplicateVoteEvidence(maxEvidence, &evidenceTestSource{state: maxState}); err != nil {
		t.Fatal("legal maximum historical voting power rejected:", err)
	}
}

func TestDuplicateEvidencePermitsNilConflictAndPrevoteUnderOriginalRules(t *testing.T) {
	for _, kind := range []cmtproto.SignedMsgType{cmtproto.PrevoteType, cmtproto.PrecommitType} {
		f := newEvidenceFixture(t, kind, true)
		if !f.evidence.VoteA.BlockID.IsZero() || f.evidence.VoteB.BlockID.IsZero() {
			t.Fatal("QA constructor did not put nil block first")
		}
		if err := f.verifier.VerifyDuplicateVoteEvidence(f.evidence, f.source); err != nil {
			t.Fatal("valid nil versus non-nil conflict rejected:", err)
		}
		for _, voteIndex := range []int{0, 1} {
			bad := copyDuplicateEvidence(f.evidence)
			vote := bad.VoteA
			if voteIndex == 1 {
				vote = bad.VoteB
			}
			if vote.Type == cmtproto.PrecommitType && !vote.BlockID.IsZero() {
				continue
			}
			vote.Extension = []byte("forbidden extension")
			vote.ExtensionSignature = bytes.Clone(vote.Signature)
			if err := f.verifier.VerifyDuplicateVoteEvidence(bad, f.source); err == nil {
				t.Fatal("nil/pre-vote extension was accepted")
			}
		}
	}
}

func TestDuplicateEvidenceBoundsExtensionsWithoutClaimingTheirAuthentication(t *testing.T) {
	f := newEvidenceFixture(t, cmtproto.PrecommitType, false)
	for name, change := range map[string]func(*cmttypes.Vote){
		"missing extension signature": func(v *cmttypes.Vote) { v.Extension = []byte{1} },
		"oversized extension data": func(v *cmttypes.Vote) {
			v.Extension, v.ExtensionSignature = make([]byte, (1<<20)+1), bytes.Clone(v.Signature)
		},
		"oversized extension signature": func(v *cmttypes.Vote) { v.ExtensionSignature = make([]byte, EnvelopeSize+1) },
		"legacy extension at PQ height": func(v *cmttypes.Vote) { v.ExtensionSignature = make([]byte, 64) },
		"malformed extension envelope":  func(v *cmttypes.Vote) { v.ExtensionSignature = make([]byte, EnvelopeSize) },
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyDuplicateEvidence(f.evidence)
			change(bad.VoteA)
			if err := f.verifier.VerifyDuplicateVoteEvidence(bad, f.source); err == nil {
				t.Fatal("unbounded or structurally invalid extension accepted")
			}
		})
	}
	ordinaryOnly := copyDuplicateEvidence(f.evidence)
	vote := ordinaryOnly.VoteA
	vote.Extension = []byte("QA extension is a separate authorization scope")
	extension, err := NewVoteExtensionRequest(f.policy.ChainID, vote.ToProto())
	if err != nil {
		t.Fatal(err)
	}
	vote.ExtensionSignature, err = f.key.signRequest(extension, f.record)
	if err != nil {
		t.Fatal(err)
	}
	vote.ExtensionSignature[len(vote.ExtensionSignature)-1] ^= 1
	if err := f.verifier.Verify(extension, vote.ExtensionSignature); err == nil {
		t.Fatal("damaged extension fixture was unexpectedly authentic")
	}
	if err := f.verifier.VerifyDuplicateVoteEvidence(ordinaryOnly, f.source); err != nil {
		t.Fatal("real ordinary equivocation was confused with extension authentication:", err)
	}
}

type evidenceHistoricalKeys struct {
	chainID string
	height  int64
	key     ed25519.PubKey
}

func (h evidenceHistoricalKeys) VerifyHistorical(chainID string, address []byte, height int64, kind Kind, canonical, signature []byte) error {
	if chainID != h.chainID || height != h.height || (kind != Prevote && kind != Precommit) || !bytes.Equal(address, h.key.Address()) || !h.key.VerifySignature(canonical, signature) {
		return errors.New("historical evidence signature rejected")
	}
	return nil
}

func TestDuplicateEvidenceHistoricalProfileDoesNotAuthorizeActivationHeight(t *testing.T) {
	key := ed25519.GenPrivKey()
	public := key.PubKey().(ed25519.PubKey)
	policy := Policy{Version: Version, ChainID: "ynx-historical-evidence-qa", ActivationHeight: 100}
	proto := fixtureVote(99)
	blockID, err := cmttypes.BlockIDFromProto(&proto.BlockID)
	if err != nil {
		t.Fatal(err)
	}
	a := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: 99, Round: 0, BlockID: *blockID, Timestamp: proto.Timestamp, ValidatorAddress: public.Address(), ValidatorIndex: 0}
	b := copyEvidenceVote(a)
	b.BlockID.Hash[0]++
	for _, vote := range []*cmttypes.Vote{a, b} {
		vote.Signature, err = key.Sign(cmttypes.VoteSignBytes(policy.ChainID, vote.ToProto()))
		if err != nil {
			t.Fatal(err)
		}
	}
	vals := &cmttypes.ValidatorSet{Validators: []*cmttypes.Validator{{Address: public.Address(), PubKey: public, VotingPower: 7}}}
	evidence, err := cmttypes.NewDuplicateVoteEvidence(a, b, proto.Timestamp, vals)
	if err != nil {
		t.Fatal(err)
	}
	if err := evidence.ValidateBasic(); err != nil {
		t.Fatal("real historical evidence failed unchanged stock shape:", err)
	}
	history := evidenceHistoricalKeys{chainID: policy.ChainID, height: 99, key: public}
	verifier, err := NewCIRCLVerifier(policy, nil, history)
	if err != nil {
		t.Fatal(err)
	}
	source := &evidenceTestSource{state: EvidenceState{ChainID: policy.ChainID, Height: 99, BlockTime: proto.Timestamp, Validators: vals}}
	if err := verifier.VerifyDuplicateVoteEvidence(evidence, source); err != nil {
		t.Fatal("real historical evidence lost its original signature rules:", err)
	}
	damaged := copyDuplicateEvidence(evidence)
	damaged.VoteB.Signature[0] ^= 1
	if err := verifier.VerifyDuplicateVoteEvidence(damaged, source); err == nil {
		t.Fatal("damaged historical signature was accepted")
	}
	// Re-sign the changed height with the real classic key. Failure must result
	// from the activated policy boundary, not merely a stale signature.
	active := copyDuplicateEvidence(evidence)
	for _, vote := range []*cmttypes.Vote{active.VoteA, active.VoteB} {
		vote.Height = 100
		vote.Signature, err = key.Sign(cmttypes.VoteSignBytes(policy.ChainID, vote.ToProto()))
		if err != nil {
			t.Fatal(err)
		}
	}
	activeSource := &evidenceTestSource{state: source.state}
	activeSource.state.Height = 100
	if err := verifier.VerifyDuplicateVoteEvidence(active, activeSource); err == nil {
		t.Fatal("fresh classic signatures authorized active PQ-height evidence")
	}
}
