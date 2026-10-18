package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const PQEngineScheduleStateVersion = 17

// PQEngineAuthorization is independent local operator configuration. It is
// neither persisted as authority in the ledger nor constructed by an API peer.
// Every validator must explicitly pin the same candidate before its exact
// AuthorizedAt height; a missed height is an error, never an automatic retry.
type PQEngineAuthorization struct {
	schedule *PQEngineSchedule
	hash     string
}

func NewPQEngineAuthorization(rawCanonicalJSON []byte, expectedScheduleHash string) (*PQEngineAuthorization, error) {
	if len(rawCanonicalJSON) == 0 || len(rawCanonicalJSON) > 32<<10 {
		return nil, errors.New("invalid operator schedule JSON size")
	}
	if _, err := canonicalBootstrapHash(expectedScheduleHash); err != nil {
		return nil, err
	}
	var schedule PQEngineSchedule
	decoder := json.NewDecoder(bytes.NewReader(rawCanonicalJSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&schedule); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(schedule)
	if err != nil || !bytes.Equal(canonical, bytes.TrimSpace(rawCanonicalJSON)) {
		return nil, errors.New("operator schedule must be canonical JSON without duplicate/unknown/trailing fields")
	}
	if schedule.Version != 1 || len(schedule.GenesisID) != 32 || bytes.Equal(schedule.GenesisID, make([]byte, 32)) || len(schedule.ChainID) == 0 || len(schedule.ChainID) > 50 || !utf8.ValidString(schedule.ChainID) || schedule.RegistryHeight <= 0 || schedule.RegistryHeight > math.MaxInt64-4 || schedule.AuthorizedAt != schedule.RegistryHeight+1 || schedule.ParamsUpdateHeight != schedule.AuthorizedAt || schedule.ActivationHeight < schedule.AuthorizedAt+3 || schedule.ValidatorUpdateHeight != schedule.ActivationHeight-2 || schedule.RegistryEventCount == 0 {
		return nil, errors.New("invalid independently configured engine schedule")
	}
	for _, hash := range []string{schedule.RegistryRoot, schedule.OriginalValidatorSetHash, schedule.ActivationValidatorSetHash} {
		if _, err := canonicalBootstrapHash(hash); err != nil {
			return nil, err
		}
	}
	hash, err := schedule.Hash()
	if err != nil || hash != expectedScheduleHash {
		return nil, errors.New("operator schedule differs from independent expected hash")
	}
	return &PQEngineAuthorization{schedule: clonePQEngineSchedule(&schedule), hash: hash}, nil
}

// ValidateCommittedSchedule is required on startup/recovery before publishing
// a restored scheduled state. The expected hash must come from startup config,
// never from the same persisted state being authenticated.
func (a *PQEngineAuthorization) ValidateCommittedSchedule(schedule *PQEngineSchedule, height int64) error {
	if a != nil && (a.schedule == nil || a.hash == "") {
		return errors.New("uninitialized operator engine authorization")
	}
	if schedule == nil {
		if a != nil && height >= a.schedule.AuthorizedAt {
			return errors.New("operator schedule activation admission height was missed")
		}
		return nil
	}
	if a == nil {
		return errors.New("committed PQ engine schedule requires independent operator pin")
	}
	hash, err := schedule.Hash()
	if err != nil || hash != a.hash || !reflect.DeepEqual(schedule, a.schedule) {
		return errors.New("committed schedule differs from independent operator authorization")
	}
	if height < schedule.AuthorizedAt {
		return errors.New("committed schedule precedes its actual authorization height")
	}
	return nil
}

// preparePQEngineExecution must run before each Check/Prepare/Process/Finalize
// transaction loop. It installs an authorized schedule ONLY in the working
// state at the exact configured height, so same-block registrations are checked
// against it and cannot evade the final seal's rules.
func preparePQEngineExecution(state executionState, height int64, authorization *PQEngineAuthorization) (executionState, error) {
	if authorization != nil && (authorization.schedule == nil || authorization.hash == "") {
		return state, errors.New("uninitialized operator engine authorization")
	}
	if state.pqEngineSchedule != nil {
		if err := authorization.ValidateCommittedSchedule(state.pqEngineSchedule, height); err != nil {
			return state, err
		}
		return state, nil
	}
	if authorization == nil || height < authorization.schedule.AuthorizedAt {
		return state, nil
	}
	if height != authorization.schedule.AuthorizedAt {
		return state, errors.New("missed operator-authorized engine schedule height")
	}
	candidate := state
	candidate.pqEngineSchedule = clonePQEngineSchedule(authorization.schedule)
	if _, err := newPQEngineSnapshot(candidate.bootstrap, candidate.validatorRegistry, candidate.pqEngineSchedule, height); err != nil {
		return state, err
	}
	return candidate, nil
}

// PQEngineSchedule is committed configuration, not a peer request. Admission
// requires an independently operator-pinned schedule hash in the application
// owner. A candidate returned by NewPQEngineSchedule does not activate a node.
// The registry prefix pins all initial key proofs before the profile change.
type PQEngineSchedule struct {
	Version                    uint32 `json:"version"`
	GenesisID                  []byte `json:"genesisId"`
	ChainID                    string `json:"chainId"`
	AuthorizedAt               int64  `json:"authorizedAt"`
	ParamsUpdateHeight         int64  `json:"paramsUpdateHeight"`
	ValidatorUpdateHeight      int64  `json:"validatorUpdateHeight"`
	ActivationHeight           int64  `json:"activationHeight"`
	RegistryHeight             int64  `json:"registryHeight"`
	RegistryEventCount         uint64 `json:"registryEventCount"`
	RegistryRoot               string `json:"registryRoot"`
	OriginalValidatorSetHash   string `json:"originalValidatorSetHash"`
	ActivationValidatorSetHash string `json:"activationValidatorSetHash"`
}

func clonePQEngineSchedule(s *PQEngineSchedule) *PQEngineSchedule {
	if s == nil {
		return nil
	}
	out := *s
	out.GenesisID = bytes.Clone(s.GenesisID)
	return &out
}

func (s *PQEngineSchedule) Hash() (string, error) {
	if s == nil {
		return "", errors.New("missing engine schedule")
	}
	raw, err := json.Marshal(struct {
		Domain   string            `json:"domain"`
		Schedule *PQEngineSchedule `json:"schedule"`
	}{"YNX-CONSENSUS-ENGINE-SCHEDULE/v1", s})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// ProfileBytes is the exact field carried by Comet ConsensusParams and its
// post-profile ConsensusHash. It binds this application-committed schedule and
// original registry prefix without substituting either native genesis or a
// peer-provided claim for the independent Comet genesis pin.
func (s *PQEngineSchedule) ProfileBytes() ([]byte, error) {
	if s == nil {
		return nil, errors.New("missing engine schedule")
	}
	hash, err := s.Hash()
	if err != nil {
		return nil, err
	}
	scheduleHash, err := canonicalBootstrapHash(hash)
	if err != nil {
		return nil, err
	}
	root, err := canonicalBootstrapHash(s.RegistryRoot)
	if err != nil {
		return nil, err
	}
	return (ynxpq.ConsensusProfile{GenesisID: bytes.Clone(s.GenesisID), ChainID: s.ChainID, ParamsUpdateHeight: s.ParamsUpdateHeight, ActivationHeight: s.ActivationHeight, ScheduleHash: scheduleHash, RegistryRoot: root}).MarshalBinary()
}

// NewPQEngineSchedule constructs a reviewable candidate from an already
// committed complete registry. Authorization is at registryHeight+1. Params
// change in that Finalize, take effect one height later; the key update must be
// emitted at least one height after the params update, and applies at H+2.
func NewPQEngineSchedule(b *ConsensusBootstrap, registry *ValidatorRegistryState, registryHeight, activationHeight int64) (*PQEngineSchedule, error) {
	if b == nil || registry == nil || registryHeight < b.record.InitialHeight || registryHeight > math.MaxInt64-4 || activationHeight < registryHeight+4 {
		return nil, errors.New("engine activation requires committed registry and params H+1 / keys H+2 lead time")
	}
	history, err := replayValidatorRegistry(registry, b, registryHeight)
	if err != nil {
		return nil, err
	}
	set, err := pqMembersAt(b, history, registry, activationHeight)
	if err != nil {
		return nil, err
	}
	if len(set.Validators) != len(b.record.Members) {
		return nil, errors.New("initial PQ profile requires every original active member")
	}
	s := &PQEngineSchedule{Version: 1, GenesisID: bytes.Clone(b.genesisID), ChainID: b.record.ChainID,
		AuthorizedAt: registryHeight + 1, ParamsUpdateHeight: registryHeight + 1,
		ValidatorUpdateHeight: activationHeight - 2, ActivationHeight: activationHeight,
		RegistryHeight: registryHeight, RegistryEventCount: uint64(len(registry.Events)), RegistryRoot: registry.Root,
		OriginalValidatorSetHash: b.record.ValidatorSetHash, ActivationValidatorSetHash: hex.EncodeToString(set.Hash())}
	if err := validatePQEngineFutureMembership(b, history, registry, s); err != nil {
		return nil, err
	}
	return s, nil
}

// validatePQEngineRegistryTransition is an admission gate, not just a seal
// check. The registry transaction owner calls it after Append and before
// assigning nextRegistry to the working execution state.
func validatePQEngineRegistryTransition(state executionState, nextRegistry *ValidatorRegistryState, height int64) error {
	if state.pqEngineSchedule == nil {
		return nil
	}
	if state.validatorRegistry == nil || nextRegistry == nil || len(nextRegistry.Events) != len(state.validatorRegistry.Events)+1 {
		return errors.New("engine registry transition must append exactly one original event")
	}
	for i := range state.validatorRegistry.Events {
		if !reflect.DeepEqual(state.validatorRegistry.Events[i], nextRegistry.Events[i]) {
			return errors.New("engine registry transition rewrote original history")
		}
	}
	last := nextRegistry.Events[len(nextRegistry.Events)-1]
	reg, err := ynxconsensusauth.DecodeRegistration(last.Wire)
	if err != nil {
		return err
	}
	if height > math.MaxInt64-2 || last.Height != height || reg.Intent.ApprovedAt != height || reg.Intent.EffectiveAt < height+2 {
		return errors.New("key event cannot be applied by actual Comet H+2 update timing")
	}
	_, err = newPQEngineSnapshot(state.bootstrap, nextRegistry, state.pqEngineSchedule, height)
	return err
}

// Validate every declared effective boundary, not only tip+2. This prevents an
// accepted distant revocation from deterministically emptying the set later.
func validatePQEngineFutureMembership(b *ConsensusBootstrap, history *ynxconsensusauth.KeyHistory, registry *ValidatorRegistryState, schedule *PQEngineSchedule) error {
	if schedule == nil {
		return nil
	}
	heights := map[int64]bool{schedule.ActivationHeight: true}
	for _, event := range registry.Events {
		reg, err := ynxconsensusauth.DecodeRegistration(event.Wire)
		if err != nil {
			return err
		}
		if reg.Intent.EffectiveAt >= schedule.ActivationHeight {
			heights[reg.Intent.EffectiveAt] = true
		}
	}
	for height := range heights {
		if _, err := pqMembersAt(b, history, registry, height); err != nil {
			return err
		}
	}
	return nil
}

func validatePQEngineSchedule(s *PQEngineSchedule, b *ConsensusBootstrap, registry *ValidatorRegistryState, through int64) error {
	if s == nil {
		return nil
	}
	if b == nil || registry == nil || s.Version != 1 || !bytes.Equal(s.GenesisID, b.genesisID) || s.ChainID != b.record.ChainID || s.RegistryHeight < b.record.InitialHeight || s.RegistryHeight > math.MaxInt64-4 || s.AuthorizedAt != s.RegistryHeight+1 || s.AuthorizedAt > through || s.ParamsUpdateHeight != s.AuthorizedAt || s.ActivationHeight < s.AuthorizedAt+3 || s.ValidatorUpdateHeight != s.ActivationHeight-2 || s.OriginalValidatorSetHash != b.record.ValidatorSetHash || s.RegistryEventCount == 0 || s.RegistryEventCount > uint64(len(registry.Events)) {
		return errors.New("invalid engine schedule anchor or actual H+1/H+2 ordering")
	}
	prefix := cloneValidatorRegistry(registry)
	prefix.Events = prefix.Events[:int(s.RegistryEventCount)]
	prefix.Root = s.RegistryRoot
	history, err := replayValidatorRegistry(prefix, b, s.RegistryHeight)
	if err != nil {
		return err
	}
	set, err := pqMembersAt(b, history, prefix, s.ActivationHeight)
	if err != nil {
		return err
	}
	if len(set.Validators) != len(b.record.Members) || hex.EncodeToString(set.Hash()) != s.ActivationValidatorSetHash {
		return errors.New("engine schedule changed complete initial PQ membership")
	}
	for _, event := range registry.Events[int(s.RegistryEventCount):] {
		reg, err := ynxconsensusauth.DecodeRegistration(event.Wire)
		if err != nil {
			return err
		}
		if reg.Intent.EffectiveAt <= s.ActivationHeight {
			return errors.New("later key event conflicts with committed initial activation")
		}
	}
	return nil
}

func validatePQEngineScheduleContinuation(previous, next *PQEngineSchedule) error {
	if previous != nil && !reflect.DeepEqual(previous, next) {
		return errors.New("committed engine activation schedule is immutable and cannot be removed")
	}
	return nil
}

func pqMembersAt(b *ConsensusBootstrap, history *ynxconsensusauth.KeyHistory, registry *ValidatorRegistryState, height int64) (*cmttypes.ValidatorSet, error) {
	var vals []*cmttypes.Validator
	for _, member := range b.record.Members {
		revoked := false
		for _, event := range registry.Events {
			reg, err := ynxconsensusauth.DecodeRegistration(event.Wire)
			if err != nil {
				return nil, err
			}
			if reg.Intent.Kind == ynxconsensusauth.RevokeValidator && bytes.Equal(reg.Intent.ValidatorAddress, member.Address) && reg.Intent.EffectiveAt <= height {
				revoked = true
			}
		}
		if revoked {
			continue
		}
		wire, err := history.PublicKeyBindingAt(b.record.ChainID, member.Address, height)
		if err != nil {
			return nil, err
		}
		key, err := ynxpq.DecodePubKey(wire)
		if err != nil {
			return nil, err
		}
		vals = append(vals, cmttypes.NewValidator(key, member.Power))
	}
	if len(vals) == 0 {
		return nil, errors.New("PQ history removes every validator")
	}
	return cmttypes.NewValidatorSet(vals), nil
}

func legacyEngineMembers(b *ConsensusBootstrap) *cmttypes.ValidatorSet {
	vals := make([]*cmttypes.Validator, 0, len(b.record.Members))
	for _, m := range b.record.Members {
		vals = append(vals, cmttypes.NewValidator(ed25519.PubKey(bytes.Clone(m.Ed25519)), m.Power))
	}
	return cmttypes.NewValidatorSet(vals)
}

// UpdatesAt is called on the finalized candidate snapshot at the actual H.
// Root must persist the same schedule/registry and return these exact updates
// from FinalizeBlock. Params are admitted BEFORE the first PQ-key update.
func (s *PQEngineSnapshot) UpdatesAt(height int64) (*cmtproto.ConsensusParams, []abci.ValidatorUpdate, error) {
	if s == nil || height != s.through {
		return nil, nil, errors.New("updates require exact finalized snapshot height")
	}
	if s.schedule == nil {
		return nil, nil, nil
	}
	var params *cmtproto.ConsensusParams
	if height == s.schedule.ParamsUpdateHeight {
		profile, err := s.schedule.ProfileBytes()
		if err != nil {
			return nil, nil, err
		}
		params = &cmtproto.ConsensusParams{YnxProfile: profile, Validator: &cmtproto.ValidatorParams{PubKeyTypes: []string{ed25519.KeyType, ynxpq.KeyType}}}
	}
	before, err := s.expectedMembersAt(height + 1)
	if err != nil {
		return nil, nil, err
	}
	after, err := s.expectedMembersAt(height + 2)
	if err != nil {
		return nil, nil, err
	}
	if bytes.Equal(before.Hash(), after.Hash()) {
		return params, nil, nil
	}
	if height <= s.schedule.ParamsUpdateHeight {
		return nil, nil, errors.New("PQ validator update before allowlist became effective")
	}
	var updates []abci.ValidatorUpdate
	for _, old := range before.Validators {
		_, next := after.GetByAddress(old.Address)
		if next == nil {
			key, err := cryptoenc.PubKeyToProto(old.PubKey)
			if err != nil {
				return nil, nil, err
			}
			updates = append(updates, abci.ValidatorUpdate{PubKey: key, Power: 0})
		}
	}
	for _, next := range after.Validators {
		_, old := before.GetByAddress(next.Address)
		if old != nil && old.VotingPower == next.VotingPower && old.PubKey.Equals(next.PubKey) {
			continue
		}
		key, err := cryptoenc.PubKeyToProto(next.PubKey)
		if err != nil {
			return nil, nil, err
		}
		updates = append(updates, abci.ValidatorUpdate{PubKey: key, Power: next.VotingPower})
	}
	return params, updates, nil
}
