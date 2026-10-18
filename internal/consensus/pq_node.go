package consensus

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/proxy"
	cmttypes "github.com/cometbft/cometbft/types"
)

// NewPQConsensusNode constructs the real fork node using the existing app,
// original legacy validator, original P2P identity and an already resumed PQ
// signer. It generates no identities and starts no listener itself. The caller
// retains ownership of signing-state locks and key custody for the node's life.
func NewPQConsensusNode(config *cmtconfig.Config, app *Application, legacy cmttypes.PrivValidator, resumedPQSigner *ynxconsensusauth.Signer, nodeKey *p2p.NodeKey, logger log.Logger) (*node.Node, error) {
	if config == nil || app == nil || legacy == nil || resumedPQSigner == nil || nodeKey == nil || nodeKey.PrivKey == nil || logger == nil {
		return nil, errors.New("PQ node requires existing app, both validator identities, original node key and logger")
	}
	if config.PrivValidatorListenAddr != "" {
		return nil, errors.New("local PQ node cannot silently replace its supplied signer with a remote socket signer")
	}
	app.mu.RLock()
	bootstrap, authorization := app.bootstrap, app.pqEngineAuthorization
	app.mu.RUnlock()
	if bootstrap == nil || authorization == nil {
		return nil, errors.New("PQ node requires independently pinned bootstrap and activation schedule")
	}
	rawGenesis, err := os.ReadFile(config.GenesisFile())
	if err != nil {
		return nil, fmt.Errorf("read original node genesis: %w", err)
	}
	hash := sha256.Sum256(rawGenesis)
	if !bytes.Equal(hash[:], bootstrap.genesisID) {
		return nil, errors.New("node genesis differs from independently pinned application genesis")
	}
	pq, err := NewPQPrivValidator(resumedPQSigner, app)
	if err != nil {
		return nil, err
	}
	transition, err := NewPQTransitionPrivValidator(legacy, pq, bootstrap, authorization)
	if err != nil {
		return nil, err
	}
	// Parse the checked immutable bytes on every provider call, not a path that
	// could be replaced after its hash check. Bootstrap already validated all
	// required fields without completing or inventing genesis defaults.
	genesisProvider := func() (*cmttypes.GenesisDoc, error) {
		var genesis cmttypes.GenesisDoc
		if err := cmtjson.Unmarshal(rawGenesis, &genesis); err != nil {
			return nil, err
		}
		return &genesis, nil
	}
	return node.NewNodeWithConsensusAuthority(config, transition, nodeKey,
		proxy.NewLocalClientCreator(app), genesisProvider, cmtconfig.DefaultDBProvider,
		node.DefaultMetricsProvider(config.Instrumentation), logger, app)
}
