package consensus

import (
	"bytes"
	"errors"
	"fmt"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmttypes "github.com/cometbft/cometbft/types"
)

// PQEngineSnapshot is a detached authenticated view. It owns no application
// locks, mutable singleton, peer resolver or pending Finalize pointer. Its
// history is the existing cryptographically replayed ynxconsensusauth registry.
type PQEngineSnapshot struct {
	bootstrap *ConsensusBootstrap
	registry  *ValidatorRegistryState
	history   *ynxconsensusauth.KeyHistory
	schedule  *PQEngineSchedule
	through   int64
}

var _ ynxpq.Authorizer = (*PQEngineSnapshot)(nil)
var _ ynxconsensusauth.Registry = (*PQEngineSnapshot)(nil)
var _ cmttypes.ConsensusAuthority = (*PQEngineSnapshot)(nil)
var _ cmttypes.ConsensusEvidenceAuthority = (*PQEngineSnapshot)(nil)

// CommittedPQEngineSnapshot publishes only the successfully committed state.
// Expensive replay occurs after releasing Application.mu. In-lock candidate
// validation must call newPQEngineSnapshot directly, not recurse here.
func (a *Application) CommittedPQEngineSnapshot() (*PQEngineSnapshot, error) {
	a.mu.RLock()
	b := a.bootstrap
	registry := cloneValidatorRegistry(a.committed.ValidatorRegistry)
	schedule := clonePQEngineSchedule(a.committed.PQEngineSchedule)
	authorization := a.pqEngineAuthorization
	through := a.committed.Height
	a.mu.RUnlock()
	if err := authorization.ValidateCommittedSchedule(schedule, through); err != nil {
		return nil, err
	}
	return newPQEngineSnapshot(b, registry, schedule, through)
}

func newPQEngineSnapshot(b *ConsensusBootstrap, registry *ValidatorRegistryState, schedule *PQEngineSchedule, through int64) (*PQEngineSnapshot, error) {
	if b == nil || through < b.record.InitialHeight-1 || through > math.MaxInt64-2 {
		return nil, errors.New("engine snapshot requires pinned genesis and bounded committed height")
	}
	registry = cloneValidatorRegistry(registry)
	schedule = clonePQEngineSchedule(schedule)
	history, err := replayValidatorRegistry(registry, b, through)
	if err != nil {
		return nil, err
	}
	if err = validatePQEngineSchedule(schedule, b, registry, through); err != nil {
		return nil, err
	}
	if err = validatePQEngineFutureMembership(b, history, registry, schedule); err != nil {
		return nil, err
	}
	s := &PQEngineSnapshot{bootstrap: b, registry: registry, history: history, schedule: schedule, through: through}
	// Comet already knows the next two validator sets. Refuse a history that
	// would make either empty/unresolvable before any state is published.
	for _, height := range []int64{through + 1, through + 2} {
		if _, err = s.expectedMembersAt(height); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *PQEngineSnapshot) Anchor() ynxconsensusauth.RegistryAnchor {
	if s == nil || s.history == nil {
		return ynxconsensusauth.RegistryAnchor{}
	}
	return s.history.Anchor()
}

func (s *PQEngineSnapshot) Policy() (ynxconsensusauth.Policy, error) {
	if s == nil || s.schedule == nil {
		return ynxconsensusauth.Policy{}, errors.New("PQ engine profile has not been committed")
	}
	return ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(s.bootstrap.genesisID), ChainID: s.bootstrap.record.ChainID, ActivationHeight: s.schedule.ActivationHeight}, nil
}

func (s *PQEngineSnapshot) ConsensusKeysAt(chainID string, address []byte, height int64) (ynxconsensusauth.KeyRecord, error) {
	if s == nil || s.schedule == nil || chainID != s.bootstrap.record.ChainID || height < s.schedule.ActivationHeight || height > s.through+2 {
		return ynxconsensusauth.KeyRecord{}, ynxconsensusauth.ErrValidatorKeyUnavailable
	}
	if _, ok := s.bootstrap.members[string(address)]; !ok {
		return ynxconsensusauth.KeyRecord{}, ynxconsensusauth.ErrValidatorKeyUnavailable
	}
	return s.history.ConsensusKeysAt(chainID, bytes.Clone(address), height)
}

func (s *PQEngineSnapshot) AuthorizeConsensusKey(binding []byte, height int64, round int32, kind ynxpq.Kind) error {
	if s == nil || s.schedule == nil || height < s.schedule.ActivationHeight || height > s.through+2 || round < 0 || kind < ynxpq.Proposal || kind > ynxpq.VoteExtension {
		return errors.New("consensus request outside committed PQ profile or known history")
	}
	key, err := ynxconsensusauth.DecodeLogicalPublicKey(binding)
	if err != nil {
		return err
	}
	if !bytes.Equal(key.GenesisID, s.bootstrap.genesisID) || key.ChainID != s.bootstrap.record.ChainID {
		return errors.New("engine key differs from independently pinned consensus genesis")
	}
	member, ok := s.bootstrap.members[string(key.ValidatorAddress)]
	if !ok || member.Power <= 0 {
		return errors.New("engine key not in authenticated original membership")
	}
	record, err := s.history.AuthenticatePublicKeyBinding(binding, height)
	if err != nil {
		return err
	}
	if record.Epoch != key.Epoch || record.ValidFromHeight > height || (record.ValidUntilHeight != 0 && height >= record.ValidUntilHeight) {
		return errors.New("engine key epoch or revocation interval mismatch")
	}
	if kind == ynxpq.VoteExtension {
		params, err := s.ParamsAt(height)
		if err != nil {
			return err
		}
		if !params.ABCI.VoteExtensionsEnabled(height) {
			return errors.New("vote extensions disabled by actual historical params")
		}
	}
	return nil
}

func (s *PQEngineSnapshot) ParamsAt(height int64) (cmttypes.ConsensusParams, error) {
	if s == nil || height < s.bootstrap.record.InitialHeight || height > s.through+2 {
		return cmttypes.ConsensusParams{}, errors.New("consensus params outside known bootstrap history")
	}
	params := cmttypes.ConsensusParamsFromProto(s.bootstrap.record.Params)
	params.Validator.PubKeyTypes = append([]string(nil), params.Validator.PubKeyTypes...)
	if s.schedule != nil && height > s.schedule.ParamsUpdateHeight {
		params.Validator.PubKeyTypes = []string{ed25519.KeyType, ynxpq.KeyType}
		var err error
		params.YNXProfile, err = s.schedule.ProfileBytes()
		if err != nil {
			return cmttypes.ConsensusParams{}, err
		}
	}
	if err := params.ValidateBasic(); err != nil {
		return cmttypes.ConsensusParams{}, err
	}
	return params, nil
}

// expectedMembersAt is for membership/hash checking only. Its freshly created
// proposer priorities MUST NOT be used as the actual engine proposer selection.
func (s *PQEngineSnapshot) expectedMembersAt(height int64) (*cmttypes.ValidatorSet, error) {
	if s == nil || height < s.bootstrap.record.InitialHeight || height > s.through+2 {
		return nil, errors.New("validator set outside authenticated bootstrap history")
	}
	if s.schedule == nil || height < s.schedule.ActivationHeight {
		return legacyEngineMembers(s.bootstrap), nil
	}
	return pqMembersAt(s.bootstrap, s.history, s.registry, height)
}

func (s *PQEngineSnapshot) ExpectedValidatorHash(height int64) ([]byte, error) {
	set, err := s.expectedMembersAt(height)
	if err != nil {
		return nil, err
	}
	return bytes.Clone(set.Hash()), nil
}

// BindValidatorSet authenticates the actual engine/current/last/evidence/light
// set before attaching local verification authority. It retains real proposer
// priorities instead of inventing them from a reconstructed membership list.
func (s *PQEngineSnapshot) BindValidatorSet(height int64, actual *cmttypes.ValidatorSet) (*cmttypes.ValidatorSet, error) {
	expected, err := s.expectedMembersAt(height)
	if err != nil {
		return nil, err
	}
	if actual == nil {
		return nil, errors.New("missing actual engine validator set")
	}
	if err = actual.ValidateBasic(); err != nil {
		return nil, err
	}
	if len(actual.Validators) != len(expected.Validators) || !bytes.Equal(actual.Hash(), expected.Hash()) {
		return nil, errors.New("actual engine validator hash differs from authenticated height-specific membership")
	}
	for _, member := range actual.Validators {
		if err = member.ValidateBasic(); err != nil {
			return nil, err
		}
		_, want := expected.GetByAddress(member.Address)
		if want == nil || want.VotingPower != member.VotingPower || !want.PubKey.Equals(member.PubKey) {
			return nil, errors.New("actual engine validator full key/address/power mismatch")
		}
	}
	bound, err := actual.WithConsensusAuthorizer(s)
	if err != nil {
		return nil, err
	}
	detach := func(v *cmttypes.Validator) {
		if v == nil {
			return
		}
		v.Address = bytes.Clone(v.Address)
		if key, ok := v.PubKey.(ed25519.PubKey); ok {
			v.PubKey = ed25519.PubKey(bytes.Clone(key))
		}
	}
	for _, v := range bound.Validators {
		detach(v)
	}
	detach(bound.Proposer)
	if bound.Proposer != nil {
		_, member := bound.GetByAddress(bound.Proposer.Address)
		if member == nil || member.VotingPower != bound.Proposer.VotingPower || !member.PubKey.Equals(bound.Proposer.PubKey) {
			return nil, errors.New("actual selected proposer not in authenticated set")
		}
	}
	return bound, nil
}

func (s *PQEngineSnapshot) ValidateNextValidatorsHash(proposalHeight int64, actual []byte) error {
	if s == nil || proposalHeight != s.through+1 {
		return errors.New("proposal must follow committed engine snapshot")
	}
	expected, err := s.ExpectedValidatorHash(proposalHeight + 1)
	if err != nil {
		return err
	}
	if !bytes.Equal(actual, expected) {
		return fmt.Errorf("wrong next validator hash at proposal height %d", proposalHeight)
	}
	return nil
}

// BindEvidenceValidatorSet preserves a conflicting set's claimed powers so
// the normal evidence verifier can prove that claim was malicious. Authority
// is limited to independently registered full keys at the evidence height;
// this method cannot authorize a real engine or light-client validator set.
func (s *PQEngineSnapshot) BindEvidenceValidatorSet(height int64, actual *cmttypes.ValidatorSet) (*cmttypes.ValidatorSet, error) {
	expected, err := s.expectedMembersAt(height)
	if err != nil {
		return nil, err
	}
	if actual == nil {
		return nil, errors.New("missing conflicting evidence validator set")
	}
	if err := actual.ValidateBasic(); err != nil {
		return nil, err
	}
	if s.schedule == nil || height < s.schedule.ActivationHeight {
		if cmttypes.ValidatorSetRequiresConsensusAuthority(actual) {
			return nil, errors.New("PQ evidence key before consensus activation")
		}
		// Preserve stock preactivation evidence semantics, including a
		// conflicting Ed set, without reinterpreting old signed history.
		return actual.Copy(), nil
	}
	for _, member := range actual.Validators {
		_, registered := expected.GetByAddress(member.Address)
		if registered == nil || !registered.PubKey.Equals(member.PubKey) {
			return nil, errors.New("conflicting evidence key is not registered at its historical height")
		}
	}
	return actual.WithConsensusAuthorizer(s)
}
