//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/crypto"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

func validatePQRemoteBinding(bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization, binding ynxconsensusauth.HostKeyBinding) error {
	if err := binding.Validate(); err != nil {
		return err
	}
	if bootstrap == nil || authorization == nil || authorization.schedule == nil {
		return errors.New("remote signing requires independent bootstrap and activation pins")
	}
	p := binding.Policy
	s := authorization.schedule
	if p.ChainID != bootstrap.record.ChainID || p.ChainID != s.ChainID || !bytes.Equal(p.GenesisID, bootstrap.genesisID) || !bytes.Equal(p.GenesisID, s.GenesisID) || p.ActivationHeight != s.ActivationHeight {
		return errors.New("public remote binding differs from original genesis or activation")
	}
	if _, ok := bootstrap.members[string(binding.ValidatorAddress)]; !ok {
		return errors.New("remote validator is not in original pinned membership")
	}
	return nil
}

// PQRemotePrivValidator additionally enforces the operator's complete public
// custody binding. The remote peer cannot silently select another registered
// epoch even when it has valid signatures for that other key.
type PQRemotePrivValidator struct {
	client   *privval.ContextSignerClient
	binding  ynxconsensusauth.HostKeyBinding
	legacy   ed25519.PubKey
	mu       sync.Mutex
	terminal error
	done     chan struct{}
}

var _ cmttypes.PrivValidator = (*PQRemotePrivValidator)(nil)
var _ cmttypes.HeightPrivValidator = (*PQRemotePrivValidator)(nil)
var _ cmttypes.ConsensusCheckpointSigningContextSetter = (*PQRemotePrivValidator)(nil)

func NewPQRemotePrivValidator(conn *p2pconn.SecretConnection, peerPin crypto.PubKey, timeout time.Duration, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization, binding ynxconsensusauth.HostKeyBinding, authority cmttypes.ConsensusAuthoritySource) (*PQRemotePrivValidator, error) {
	if err := validatePQRemoteBinding(bootstrap, authorization, binding); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(binding)
	if err != nil {
		return nil, err
	}
	var detached ynxconsensusauth.HostKeyBinding
	if err = json.Unmarshal(encoded, &detached); err != nil {
		return nil, err
	}
	legacy := ed25519.PubKey(bytes.Clone(bootstrap.members[string(detached.ValidatorAddress)].Ed25519))
	client, err := privval.NewContextSignerClient(conn, peerPin, timeout, detached.Policy.ChainID, legacy, authority)
	if err != nil {
		return nil, err
	}
	return &PQRemotePrivValidator{client: client, binding: detached, legacy: legacy, done: make(chan struct{})}, nil
}
func (p *PQRemotePrivValidator) Close() error          { return p.client.Close() }
func (p *PQRemotePrivValidator) Done() <-chan struct{} { return p.done }

// Err preserves the first failure and original UNKNOWN request across later
// engine calls. No later call reconnects or replaces it with a closed-socket error.
func (p *PQRemotePrivValidator) Err() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return clonePQRemoteError(p.terminal)
}
func clonePQRemoteError(err error) error {
	var unknown *privval.RemoteConsensusUnknown
	if errors.As(err, &unknown) {
		return &privval.RemoteConsensusUnknown{RequestHash: unknown.RequestHash, Request: bytes.Clone(unknown.Request), Cause: unknown.Cause}
	}
	return err
}
func (p *PQRemotePrivValidator) fail(err error) error {
	if err == nil {
		return nil
	}
	p.mu.Lock()
	if p.terminal == nil {
		p.terminal = clonePQRemoteError(err)
		close(p.done)
	}
	original := clonePQRemoteError(p.terminal)
	p.mu.Unlock()
	_ = p.client.Close()
	return original
}
func (p *PQRemotePrivValidator) checkKey(key crypto.PubKey, height int64) error {
	if key == nil {
		return errors.New("remote validator returned no public key")
	}
	if height < p.binding.Policy.ActivationHeight {
		if !p.legacy.Equals(key) {
			return errors.New("remote preactivation identity differs from original Ed validator")
		}
		return nil
	}
	pq, ok := key.(ynxpq.PubKey)
	if !ok {
		return errors.New("remote activated validator attempted classic fallback")
	}
	logical, err := ynxconsensusauth.DecodeLogicalPublicKey(pq.Bytes())
	if err != nil {
		return err
	}
	b := p.binding
	if logical.ChainID != b.Policy.ChainID || !bytes.Equal(logical.GenesisID, b.Policy.GenesisID) || !bytes.Equal(logical.ValidatorAddress, b.ValidatorAddress) || logical.Epoch != b.Epoch || !bytes.Equal(logical.MLDSA87PublicKey, b.MLDSA87PublicKey) || !bytes.Equal(logical.SLHDSASHA2256fPublicKey, b.SLHDSASHA2256fPublicKey) {
		return errors.New("remote full key differs from independent operator custody binding")
	}
	return nil
}
func (p *PQRemotePrivValidator) GetPubKey() (out crypto.PubKey, result error) {
	if err := p.Err(); err != nil {
		return nil, err
	}
	defer func() { result = p.fail(result) }()
	key, err := p.client.GetPubKey()
	if err != nil {
		return nil, err
	}
	if key == nil {
		return nil, errors.New("remote validator returned no public identity")
	}
	height := p.binding.Policy.ActivationHeight
	if key.Type() == ed25519.KeyType {
		height = 0
	}
	if err = p.checkKey(key, height); err != nil {
		return nil, err
	}
	return key, nil
}
func (p *PQRemotePrivValidator) GetPubKeyForHeight(chain string, height int64) (out crypto.PubKey, result error) {
	if err := p.Err(); err != nil {
		return nil, err
	}
	defer func() { result = p.fail(result) }()
	key, err := p.client.GetPubKeyForHeight(chain, height)
	if err != nil {
		return nil, err
	}
	if err = p.checkKey(key, height); err != nil {
		return nil, err
	}
	return key, nil
}
func (p *PQRemotePrivValidator) SetConsensusCheckpointSigningContext(chain string, committed int64, hash []byte, height int64, round int32, set *cmttypes.ValidatorSet) (result error) {
	if err := p.Err(); err != nil {
		return err
	}
	defer func() { result = p.fail(result) }()
	if chain != p.binding.Policy.ChainID || set == nil {
		_ = p.client.SetConsensusSigningContext(chain, height, round, nil)
		return errors.New("remote context differs from operator chain or lacks set")
	}
	_, member := set.GetByAddress(p.binding.ValidatorAddress)
	if member == nil {
		_ = p.client.SetConsensusSigningContext(chain, height, round, nil)
		return errors.New("operator validator missing from current set")
	}
	if err := p.checkKey(member.PubKey, height); err != nil {
		_ = p.client.SetConsensusSigningContext(chain, height, round, nil)
		return err
	}
	return p.client.SetConsensusCheckpointSigningContext(chain, committed, hash, height, round, set)
}
func (p *PQRemotePrivValidator) SignVote(chain string, vote *cmtproto.Vote) (result error) {
	if err := p.Err(); err != nil {
		return err
	}
	defer func() { result = p.fail(result) }()
	if vote == nil {
		return errors.New("missing vote")
	}
	if _, err := p.GetPubKeyForHeight(chain, vote.Height); err != nil {
		return err
	}
	return p.client.SignVote(chain, vote)
}
func (p *PQRemotePrivValidator) SignProposal(chain string, proposal *cmtproto.Proposal) (result error) {
	if err := p.Err(); err != nil {
		return err
	}
	defer func() { result = p.fail(result) }()
	if proposal == nil {
		return errors.New("missing proposal")
	}
	if _, err := p.GetPubKeyForHeight(chain, proposal.Height); err != nil {
		return err
	}
	return p.client.SignProposal(chain, proposal)
}

// NewPQRemoteConsensusNode is the explicit remote branch of the normal node
// factory. It uses the same local Application, authority, databases and fork
// constructor as local custody; no remote ABCI state or parallel ledger exists.
func NewPQRemoteConsensusNode(config *cfg.Config, app *Application, conn *p2pconn.SecretConnection, peerPin crypto.PubKey, timeout time.Duration, binding ynxconsensusauth.HostKeyBinding, nodeKey *p2p.NodeKey, logger log.Logger) (*node.Node, error) {
	n, _, err := NewPQRemoteConsensusNodeSession(config, app, conn, peerPin, timeout, binding, nodeKey, logger)
	return n, err
}

// The normal CLI retains this exact session to terminate on its first failure.
func NewPQRemoteConsensusNodeSession(config *cfg.Config, app *Application, conn *p2pconn.SecretConnection, peerPin crypto.PubKey, timeout time.Duration, binding ynxconsensusauth.HostKeyBinding, nodeKey *p2p.NodeKey, logger log.Logger) (*node.Node, *PQRemotePrivValidator, error) {
	return newPQRemoteConsensusNode(config, app, conn, peerPin, timeout, binding, nodeKey, logger, cfg.DefaultDBProvider)
}

func newPQRemoteConsensusNode(config *cfg.Config, app *Application, conn *p2pconn.SecretConnection, peerPin crypto.PubKey, timeout time.Duration, binding ynxconsensusauth.HostKeyBinding, nodeKey *p2p.NodeKey, logger log.Logger, database cfg.DBProvider) (*node.Node, *PQRemotePrivValidator, error) {
	if config == nil || app == nil || conn == nil || peerPin == nil || nodeKey == nil || nodeKey.PrivKey == nil || logger == nil {
		return nil, nil, errors.New("remote node requires original config, app, node identity and authenticated pinned connection")
	}
	if config.PrivValidatorListenAddr != "" {
		return nil, nil, errors.New("private PQ remote ABI cannot be replaced by stock remote socket configuration")
	}
	app.mu.RLock()
	bootstrap, authorization := app.bootstrap, app.pqEngineAuthorization
	app.mu.RUnlock()
	remote, err := NewPQRemotePrivValidator(conn, peerPin, timeout, bootstrap, authorization, binding, app)
	if err != nil {
		return nil, nil, err
	}
	n, err := newPQNodeWithDatabase(config, app, remote, nodeKey, logger, database)
	if err != nil {
		_ = remote.Close()
		return nil, nil, err
	}
	// Comet SetPrivValidator logs a key/context failure. The explicit factory
	// must surface that failure instead of publishing a non-signing success.
	if err = remote.Err(); err != nil {
		_ = remote.Close()
		n.OnStop()
		_ = n.ProxyApp().Stop()
		return nil, nil, err
	}
	return n, remote, nil
}
