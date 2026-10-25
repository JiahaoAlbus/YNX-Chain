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

// NewRuntimeUpgradeConsensusNode uses the normal engine and original Ed signer
// when upgrading application execution alone. A PQ schedule requires the
// separately authorized transition/remote factory, never a legacy fallback.
func NewRuntimeUpgradeConsensusNode(config *cfg.Config, app *Application, original cmttypes.PrivValidator, nodeKey *p2p.NodeKey, logger log.Logger) (*node.Node, error) {
	if config == nil || app == nil || original == nil || nodeKey == nil || logger == nil || config.PrivValidatorListenAddr != "" {
		return nil, errors.New("runtime upgrade requires the original local node and validator identities")
	}
	app.mu.RLock()
	bootstrap, runtime, pq := app.bootstrap, app.runtimeUpgradeAuthorization, app.pqEngineAuthorization
	app.mu.RUnlock()
	if bootstrap == nil || runtime == nil || pq != nil {
		return nil, errors.New("runtime-only node requires its independent upgrade pin and no PQ activation schedule")
	}
	key, err := original.GetPubKey()
	if err != nil || key == nil || key.Type() != ed25519.KeyType {
		return nil, errors.New("runtime-only node requires its original complete Ed25519 key")
	}
	member, ok := bootstrap.members[string(key.Address())]
	if !ok || !bytes.Equal(member.Ed25519, key.Bytes()) {
		return nil, errors.New("runtime-only signer differs from pinned original membership")
	}
	return newPQNodeWithValidator(config, app, original, nodeKey, logger)
}
