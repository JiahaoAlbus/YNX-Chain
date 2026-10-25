package consensus

import (
	"bytes"
	"errors"

	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	cmttypes "github.com/cometbft/cometbft/types"
)

// ValidateOriginalValidator checks the full pinned original membership before
// a normal operator opens a new application journal. It grants no PQ signing
// authority and never loads, creates, saves or repairs a private key or HRS.
func (b *ConsensusBootstrap) ValidateOriginalValidator(original cmttypes.PrivValidator) error {
	if b == nil || original == nil {
		return errors.New("bootstrap requires its independently pinned original validator")
	}
	key, err := original.GetPubKey()
	if err != nil || key == nil || key.Type() != ed25519.KeyType || len(key.Bytes()) != ed25519.PubKeySize {
		return errors.New("bootstrap requires the complete original Ed25519 public key")
	}
	member, ok := b.members[string(key.Address())]
	if !ok || member.Power <= 0 || !bytes.Equal(member.Address, key.Address()) || !bytes.Equal(member.Ed25519, key.Bytes()) {
		return errors.New("bootstrap signer differs from independently pinned original membership")
	}
	return nil
}

// NewBootstrapConsensusNode runs the original Ed25519 chain and key registry
// through one in-process Application. Bootstrap is not an activation schedule:
// it cannot replace a required runtime upgrade or continue a stored PQ profile.
// The caller holds the application writer and original FilePV HRS leases for
// the complete node lifetime. This constructor starts no node or listener.
func NewBootstrapConsensusNode(config *cfg.Config, app *Application, original cmttypes.PrivValidator, nodeKey *p2p.NodeKey, logger log.Logger) (*node.Node, error) {
	if config == nil || app == nil || original == nil || nodeKey == nil || nodeKey.PrivKey == nil || logger == nil || config.PrivValidatorListenAddr != "" {
		return nil, errors.New("bootstrap node requires its existing local node and validator identities")
	}
	app.mu.RLock()
	bootstrap := app.bootstrap
	invalidMode := app.runtimeUpgradeAuthorization != nil || app.pqEngineAuthorization != nil || app.committed.PQEngineSchedule != nil || app.pending != nil
	app.mu.RUnlock()
	if bootstrap == nil || invalidMode {
		return nil, errors.New("bootstrap-only node requires independent genesis pins and no runtime, PQ schedule or pending candidate")
	}
	if err := bootstrap.ValidateOriginalValidator(original); err != nil {
		return nil, err
	}
	// The shared normal constructor preserves ValidateNormalRuntime, exact raw
	// genesis identity, the real Handshake and engine checkpoint callbacks.
	return newPQNodeWithValidator(config, app, original, nodeKey, logger)
}
