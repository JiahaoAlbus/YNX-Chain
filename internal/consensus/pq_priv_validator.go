package consensus

import (
	"bytes"
	"errors"
	"fmt"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// PQEngineSnapshotSource must read authenticated committed state. In-process
// Application and the independently height/AppHash-pinned file source can
// implement it. Pending state or a peer-supplied snapshot cannot be used here.
type PQEngineSnapshotSource interface {
	CommittedPQEngineSnapshot() (*PQEngineSnapshot, error)
}

// PQCommittedSignerRegistry keeps Signer's original registry interface live
// across commits without a second H/R/S store. Its independent anchor is fixed
// at construction; every key lookup uses a fresh committed snapshot.
type PQCommittedSignerRegistry struct {
	source PQEngineSnapshotSource
	anchor ynxconsensusauth.RegistryAnchor
}

func NewPQCommittedSignerRegistry(source PQEngineSnapshotSource, bootstrap *ConsensusBootstrap) (*PQCommittedSignerRegistry, error) {
	if source == nil || bootstrap == nil {
		return nil, errors.New("missing committed signer registry source or independent bootstrap")
	}
	anchor := ynxconsensusauth.RegistryAnchor{GenesisID: bytes.Clone(bootstrap.genesisID), ChainID: bootstrap.record.ChainID}
	if len(anchor.GenesisID) != 32 || anchor.ChainID == "" {
		return nil, errors.New("committed signer registry requires independently pinned genesis")
	}
	return &PQCommittedSignerRegistry{source: source, anchor: anchor}, nil
}

func (r *PQCommittedSignerRegistry) Anchor() ynxconsensusauth.RegistryAnchor {
	if r == nil {
		return ynxconsensusauth.RegistryAnchor{}
	}
	a := r.anchor
	a.GenesisID = bytes.Clone(a.GenesisID)
	return a
}

func (r *PQCommittedSignerRegistry) ConsensusKeysAt(chainID string, address []byte, height int64) (ynxconsensusauth.KeyRecord, error) {
	if r == nil || r.source == nil {
		return ynxconsensusauth.KeyRecord{}, errors.New("missing committed signer registry")
	}
	snapshot, err := r.source.CommittedPQEngineSnapshot()
	if err != nil {
		return ynxconsensusauth.KeyRecord{}, err
	}
	a := snapshot.Anchor()
	if a.ChainID != r.anchor.ChainID || !bytes.Equal(a.GenesisID, r.anchor.GenesisID) {
		return ynxconsensusauth.KeyRecord{}, errors.New("committed signer registry anchor changed")
	}
	return snapshot.ConsensusKeysAt(chainID, bytes.Clone(address), height)
}

// PQPrivValidator is the actual fork PrivValidator adapter. Copies share the
// existing durable Signer and one operation/context mutex. The sole signing
// implementation is ObjectSigner; no raw signer or alternative H/R/S exists.
type PQPrivValidator struct{ core *pqPrivValidatorCore }

type pqPrivValidatorCore struct {
	mu               sync.Mutex
	signer           *ynxconsensusauth.Signer
	objects          *ynxconsensusauth.ObjectSigner
	source           PQEngineSnapshotSource
	identity         ynxconsensusauth.SignerIdentity
	context          *pqSigningContext
	active           *PQEngineSnapshot
	observedHeight   int64
	observedRoot     string
	observedSchedule string
}

type pqSigningContext struct {
	height int64
	round  int32
	set    *cmttypes.ValidatorSet
}

var _ cmttypes.PrivValidator = (*PQPrivValidator)(nil)
var _ cmttypes.HeightPrivValidator = (*PQPrivValidator)(nil)
var _ cmttypes.ConsensusSigningContextSetter = (*PQPrivValidator)(nil)
var _ ynxconsensusauth.Registry = (*PQCommittedSignerRegistry)(nil)
var _ ynxconsensusauth.ObjectSigningStateSource = (*pqPrivValidatorCore)(nil)

func NewPQPrivValidator(signer *ynxconsensusauth.Signer, source PQEngineSnapshotSource) (*PQPrivValidator, error) {
	if source == nil {
		return nil, errors.New("PQ private validator requires committed snapshot source")
	}
	identity, err := signer.Identity()
	if err != nil {
		return nil, err
	}
	c := &pqPrivValidatorCore{signer: signer, source: source, identity: identity}
	// Node startup precedes handshake. Identity alone permits construction;
	// every key publication and signature still needs fresh committed authority.
	c.objects, err = ynxconsensusauth.NewObjectSigner(signer, c)
	if err != nil {
		return nil, err
	}
	return &PQPrivValidator{core: c}, nil
}

// snapshot is called with the operation mutex held (or before publication).
// This bounded high-water observation guards the authority source, not signing
// H/R/S. The durable Signer remains the only anti-equivocation state machine.
func (c *pqPrivValidatorCore) snapshot() (*PQEngineSnapshot, error) {
	snapshot, err := c.source.CommittedPQEngineSnapshot()
	if err != nil {
		return nil, err
	}
	want := c.identity.Policy
	anchor := snapshot.Anchor()
	if anchor.ChainID != want.ChainID || !bytes.Equal(anchor.GenesisID, want.GenesisID) || snapshot == nil || snapshot.registry == nil || snapshot.history == nil {
		return nil, errors.New("committed engine policy differs from durable signer identity")
	}
	scheduleHash := ""
	if snapshot.schedule != nil {
		policy, err := snapshot.Policy()
		if err != nil || policy.Version != want.Version || policy.ActivationHeight != want.ActivationHeight {
			return nil, errors.New("committed engine activation differs from durable signer policy")
		}
		scheduleHash, err = snapshot.schedule.Hash()
		if err != nil {
			return nil, err
		}
	} else if snapshot.through+1 >= want.ActivationHeight {
		return nil, errors.New("missing committed PQ profile at signer activation")
	}
	if snapshot.through < c.observedHeight || (snapshot.through == c.observedHeight && c.observedRoot != "" && (snapshot.registry.Root != c.observedRoot || scheduleHash != c.observedSchedule)) {
		return nil, errors.New("committed signing authority regressed or changed at the same height")
	}
	c.observedHeight, c.observedRoot, c.observedSchedule = snapshot.through, snapshot.registry.Root, scheduleHash
	return snapshot, nil
}

func (c *pqPrivValidatorCore) publicKey(snapshot *PQEngineSnapshot, chainID string, height int64) (crypto.PubKey, error) {
	if chainID != c.identity.Policy.ChainID {
		return nil, errors.New("wrong private validator chain")
	}
	identity, err := c.signer.Identity()
	if err != nil {
		return nil, err
	}
	record, err := snapshot.ConsensusKeysAt(chainID, identity.ValidatorAddress, height)
	if err != nil {
		return nil, err
	}
	if record.Epoch != identity.Epoch || !bytes.Equal(record.MLDSA87PublicKey, identity.MLDSA87PublicKey) || !bytes.Equal(record.SLHDSASHA2256fPublicKey, identity.SLHDSASHA2256fPublicKey) {
		return nil, errors.New("committed full key epoch differs from durable signer")
	}
	wire, err := snapshot.history.PublicKeyBindingAt(chainID, identity.ValidatorAddress, height)
	if err != nil {
		return nil, err
	}
	if err = snapshot.AuthorizeConsensusKey(wire, height, 0, ynxpq.Prevote); err != nil {
		return nil, err
	}
	key, err := ynxpq.DecodePubKey(wire)
	if err != nil {
		return nil, err
	}
	return key.WithAuthorizer(snapshot), nil
}

// GetPubKey uses the next committed execution height. The fork's height-aware
// path must use GetPubKeyForHeight when loading a particular validator set.
func (p *PQPrivValidator) GetPubKey() (crypto.PubKey, error) {
	if p == nil || p.core == nil {
		return nil, errors.New("missing PQ private validator")
	}
	c := p.core
	c.mu.Lock()
	defer c.mu.Unlock()
	snapshot, err := c.snapshot()
	if err != nil {
		return nil, err
	}
	return c.publicKey(snapshot, c.identity.Policy.ChainID, snapshot.through+1)
}

func (p *PQPrivValidator) GetPubKeyForHeight(chainID string, height int64) (crypto.PubKey, error) {
	if p == nil || p.core == nil {
		return nil, errors.New("missing PQ private validator")
	}
	c := p.core
	c.mu.Lock()
	defer c.mu.Unlock()
	snapshot, err := c.snapshot()
	if err != nil {
		return nil, err
	}
	return c.publicKey(snapshot, chainID, height)
}

// SetConsensusSigningContext receives the actual engine round set while the
// engine holds its own lock. It never calls back into that engine. A failed set
// clears the prior context. Callers must not mutate validators during this call.
func (p *PQPrivValidator) SetConsensusSigningContext(chainID string, height int64, round int32, validators *cmttypes.ValidatorSet) error {
	if p == nil || p.core == nil {
		return errors.New("missing PQ private validator")
	}
	c := p.core
	c.mu.Lock()
	defer c.mu.Unlock()
	c.context = nil
	snapshot, err := c.snapshot()
	if err != nil {
		return err
	}
	if height != snapshot.through+1 || round < 0 {
		return errors.New("signing context must be the actual next committed height and nonnegative round")
	}
	if _, err = c.publicKey(snapshot, chainID, height); err != nil {
		return err
	}
	set, err := snapshot.BindValidatorSet(height, validators)
	if err != nil {
		return err
	}
	if set.Proposer == nil {
		return errors.New("actual signing context has no selected proposer")
	}
	c.context = &pqSigningContext{height: height, round: round, set: set}
	return nil
}

// ConsensusSigningStateAt is private to ObjectSigner. SignVote/SignProposal
// hold c.mu and install a fresh detached authority for both signing phases.
func (c *pqPrivValidatorCore) ConsensusSigningStateAt(genesis []byte, chainID string, address []byte, height int64, round int32) (ynxconsensusauth.ObjectSigningState, error) {
	if c.active == nil || c.context == nil || c.context.height != height || c.context.round != round || chainID != c.identity.Policy.ChainID || !bytes.Equal(genesis, c.identity.Policy.GenesisID) || !bytes.Equal(address, c.identity.ValidatorAddress) {
		return ynxconsensusauth.ObjectSigningState{}, errors.New("missing or mismatched actual consensus signing context")
	}
	set, err := c.active.BindValidatorSet(height, c.context.set)
	if err != nil {
		return ynxconsensusauth.ObjectSigningState{}, err
	}
	index, validator := set.GetByAddress(address)
	if validator == nil || set.Proposer == nil {
		return ynxconsensusauth.ObjectSigningState{}, errors.New("local signer or proposer absent from actual validator set")
	}
	params, err := c.active.ParamsAt(height)
	if err != nil {
		return ynxconsensusauth.ObjectSigningState{}, err
	}
	return ynxconsensusauth.ObjectSigningState{GenesisID: bytes.Clone(genesis), ChainID: chainID, Height: height, Round: round, ValidatorAddress: bytes.Clone(address), ValidatorIndex: index, ProposerAddress: bytes.Clone(set.Proposer.Address), Params: params}, nil
}

func (c *pqPrivValidatorCore) prepare(chainID string, height int64, round int32) error {
	if c.context == nil || c.context.height != height || c.context.round != round {
		return errors.New("actual engine signing context is missing or stale")
	}
	snapshot, err := c.snapshot()
	if err != nil {
		return err
	}
	if height != snapshot.through+1 {
		return errors.New("signing height does not follow committed authority")
	}
	if _, err = c.publicKey(snapshot, chainID, height); err != nil {
		return err
	}
	if _, err = snapshot.BindValidatorSet(height, c.context.set); err != nil {
		return err
	}
	c.active = snapshot
	return nil
}

func (p *PQPrivValidator) SignProposal(chainID string, proposal *cmtproto.Proposal) error {
	if p == nil || p.core == nil || proposal == nil {
		return errors.New("missing PQ private validator or proposal")
	}
	c := p.core
	c.mu.Lock()
	defer c.mu.Unlock()
	defer func() { c.active = nil }()
	if err := c.prepare(chainID, proposal.Height, proposal.Round); err != nil {
		return fmt.Errorf("PQ proposal signing authority: %w", err)
	}
	return c.objects.SignProposal(chainID, proposal)
}

func (p *PQPrivValidator) SignVote(chainID string, vote *cmtproto.Vote) error {
	if p == nil || p.core == nil || vote == nil {
		return errors.New("missing PQ private validator or vote")
	}
	c := p.core
	c.mu.Lock()
	defer c.mu.Unlock()
	defer func() { c.active = nil }()
	if err := c.prepare(chainID, vote.Height, vote.Round); err != nil {
		return fmt.Errorf("PQ vote signing authority: %w", err)
	}
	return c.objects.SignVote(chainID, vote)
}

// PQTransitionPrivValidator routes only by the independently pinned activation
// height. The explicit original legacy signer is preserved before activation;
// no error ever selects the other algorithm or creates/replaces either key.
type PQTransitionPrivValidator struct{ *pqTransitionCore }

type pqTransitionCore struct {
	mu              sync.Mutex
	legacy          cmttypes.PrivValidator
	pq              *PQPrivValidator
	bootstrap       *ConsensusBootstrap
	authorization   *PQEngineAuthorization
	context         *pqSigningContext
	startupIdentity bool
}

var _ cmttypes.PrivValidator = (*PQTransitionPrivValidator)(nil)
var _ cmttypes.HeightPrivValidator = (*PQTransitionPrivValidator)(nil)
var _ cmttypes.ConsensusSigningContextSetter = (*PQTransitionPrivValidator)(nil)

func NewPQTransitionPrivValidator(legacy cmttypes.PrivValidator, pq *PQPrivValidator, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization) (*PQTransitionPrivValidator, error) {
	if legacy == nil || pq == nil || pq.core == nil || bootstrap == nil || authorization == nil || authorization.schedule == nil {
		return nil, errors.New("transition requires original legacy signer, durable PQ signer and independent bootstrap/schedule")
	}
	id := pq.core.identity
	schedule := authorization.schedule
	if schedule.ActivationHeight != id.Policy.ActivationHeight || schedule.ChainID != id.Policy.ChainID || !bytes.Equal(schedule.GenesisID, id.Policy.GenesisID) || bootstrap.record.ChainID != id.Policy.ChainID || !bytes.Equal(bootstrap.genesisID, id.Policy.GenesisID) {
		return nil, errors.New("transition anchors or activation differ")
	}
	p := &PQTransitionPrivValidator{&pqTransitionCore{legacy: legacy, pq: pq, bootstrap: bootstrap, authorization: authorization, startupIdentity: true}}
	if _, err := p.legacyKey(); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *PQTransitionPrivValidator) legacyKey() (crypto.PubKey, error) {
	key, err := p.legacy.GetPubKey()
	if err != nil {
		return nil, err
	}
	ed, ok := key.(ed25519.PubKey)
	member, exists := p.bootstrap.members[string(p.pq.core.identity.ValidatorAddress)]
	if !ok || !exists || !bytes.Equal(ed, member.Ed25519) || !bytes.Equal(ed.Address(), member.Address) {
		return nil, errors.New("legacy signer differs from independently authenticated original validator key")
	}
	return ed25519.PubKey(bytes.Clone(ed)), nil
}

func (p *PQTransitionPrivValidator) snapshot() (*PQEngineSnapshot, error) {
	c := p.pq.core
	c.mu.Lock()
	defer c.mu.Unlock()
	snapshot, err := c.snapshot()
	if err != nil {
		return nil, err
	}
	if err = p.authorization.ValidateCommittedSchedule(snapshot.schedule, snapshot.through); err != nil {
		return nil, err
	}
	return snapshot, nil
}

func (p *PQTransitionPrivValidator) GetPubKey() (crypto.PubKey, error) {
	if p == nil || p.pqTransitionCore == nil || p.pq == nil {
		return nil, errors.New("missing transition private validator")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	// Before the engine supplies its first trusted checkpoint, node startup
	// needs only the stable original address. This key never authorizes Sign.
	// Once the height-aware engine path starts, this exception cannot recur.
	if p.startupIdentity {
		return p.legacyKey()
	}
	snapshot, err := p.snapshot()
	if err != nil {
		return nil, err
	}
	return p.keyAt(snapshot, p.bootstrap.record.ChainID, snapshot.through+1)
}

func (p *PQTransitionPrivValidator) GetPubKeyForHeight(chainID string, height int64) (crypto.PubKey, error) {
	if p == nil || p.pqTransitionCore == nil || p.pq == nil {
		return nil, errors.New("missing transition private validator")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.startupIdentity = false
	snapshot, err := p.snapshot()
	if err != nil {
		return nil, err
	}
	return p.keyAt(snapshot, chainID, height)
}

func (p *PQTransitionPrivValidator) keyAt(snapshot *PQEngineSnapshot, chainID string, height int64) (crypto.PubKey, error) {
	if chainID != p.bootstrap.record.ChainID || height < p.bootstrap.record.InitialHeight || height > snapshot.through+2 {
		return nil, errors.New("transition public key outside authenticated chain/height")
	}
	if height < p.authorization.schedule.ActivationHeight {
		return p.legacyKey()
	}
	return p.pq.GetPubKeyForHeight(chainID, height)
}

func (p *PQTransitionPrivValidator) SetConsensusSigningContext(chainID string, height int64, round int32, validators *cmttypes.ValidatorSet) error {
	if p == nil || p.pqTransitionCore == nil || p.pq == nil {
		return errors.New("missing transition private validator")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.startupIdentity = false
	p.context = nil
	p.pq.core.mu.Lock()
	p.pq.core.context = nil
	p.pq.core.mu.Unlock()
	snapshot, err := p.snapshot()
	if err != nil {
		return err
	}
	if chainID != p.bootstrap.record.ChainID || height != snapshot.through+1 || round < 0 {
		return errors.New("transition context must follow committed height and chain")
	}
	if height >= p.authorization.schedule.ActivationHeight {
		if err = p.pq.SetConsensusSigningContext(chainID, height, round, validators); err != nil {
			return err
		}
		p.context = &pqSigningContext{height: height, round: round}
		return nil
	}
	if _, err = p.legacyKey(); err != nil {
		return err
	}
	set, err := snapshot.BindValidatorSet(height, validators)
	if err != nil {
		return err
	}
	if set.Proposer == nil {
		return errors.New("legacy round has no actual selected proposer")
	}
	p.context = &pqSigningContext{height: height, round: round, set: set}
	return nil
}

func (p *PQTransitionPrivValidator) legacyContext(snapshot *PQEngineSnapshot, chainID string, height int64, round int32) (*cmttypes.ValidatorSet, error) {
	if chainID != p.bootstrap.record.ChainID || height != snapshot.through+1 || p.context == nil || p.context.height != height || p.context.round != round {
		return nil, errors.New("missing or stale actual legacy signing context")
	}
	if _, err := p.legacyKey(); err != nil {
		return nil, err
	}
	return snapshot.BindValidatorSet(height, p.context.set)
}

func (p *PQTransitionPrivValidator) SignProposal(chainID string, proposal *cmtproto.Proposal) error {
	if p == nil || p.pqTransitionCore == nil || p.pq == nil || proposal == nil {
		return errors.New("missing transition signer or proposal")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.startupIdentity = false
	if p.context == nil || p.context.height != proposal.Height || p.context.round != proposal.Round {
		return errors.New("transition proposal has no matching actual engine context")
	}
	snapshot, err := p.snapshot()
	if err != nil {
		return err
	}
	if proposal.Height >= p.authorization.schedule.ActivationHeight {
		return p.pq.SignProposal(chainID, proposal)
	}
	set, err := p.legacyContext(snapshot, chainID, proposal.Height, proposal.Round)
	if err != nil {
		return err
	}
	if set.Proposer == nil || !bytes.Equal(set.Proposer.Address, p.pq.core.identity.ValidatorAddress) {
		return errors.New("legacy signer is not actual selected proposer")
	}
	copy := *proposal
	copy.BlockID = copyPQSigningBlock(proposal.BlockID)
	copy.Signature = bytes.Clone(proposal.Signature)
	if err = p.legacy.SignProposal(chainID, &copy); err != nil {
		clear(copy.Signature)
		return err
	}
	*proposal = copy
	return nil
}

func (p *PQTransitionPrivValidator) SignVote(chainID string, vote *cmtproto.Vote) error {
	if p == nil || p.pqTransitionCore == nil || p.pq == nil || vote == nil {
		return errors.New("missing transition signer or vote")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.startupIdentity = false
	if p.context == nil || p.context.height != vote.Height || p.context.round != vote.Round {
		return errors.New("transition vote has no matching actual engine context")
	}
	snapshot, err := p.snapshot()
	if err != nil {
		return err
	}
	if vote.Height >= p.authorization.schedule.ActivationHeight {
		return p.pq.SignVote(chainID, vote)
	}
	set, err := p.legacyContext(snapshot, chainID, vote.Height, vote.Round)
	if err != nil {
		return err
	}
	index, validator := set.GetByAddress(p.pq.core.identity.ValidatorAddress)
	if validator == nil || vote.ValidatorIndex != index || !bytes.Equal(vote.ValidatorAddress, validator.Address) {
		return errors.New("legacy vote differs from actual local validator")
	}
	copy := *vote
	copy.BlockID = copyPQSigningBlock(vote.BlockID)
	copy.ValidatorAddress, copy.Extension = bytes.Clone(vote.ValidatorAddress), bytes.Clone(vote.Extension)
	copy.Signature, copy.ExtensionSignature = bytes.Clone(vote.Signature), bytes.Clone(vote.ExtensionSignature)
	if err = p.legacy.SignVote(chainID, &copy); err != nil {
		clear(copy.Signature)
		clear(copy.ExtensionSignature)
		return err
	}
	*vote = copy
	return nil
}

func copyPQSigningBlock(block cmtproto.BlockID) cmtproto.BlockID {
	block.Hash = bytes.Clone(block.Hash)
	block.PartSetHeader.Hash = bytes.Clone(block.PartSetHeader.Hash)
	return block
}
