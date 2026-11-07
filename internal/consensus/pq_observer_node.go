package consensus

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"

	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/proxy"
	cmttypes "github.com/cometbft/cometbft/types"
)

// NewPQObserverNode constructs the normal non-validator full node. The caller
// owns the existing application writer lease and distinct existing P2P identity
// for its lifetime. There is no validator, HRS, vault, remote signer or signing
// option. Original application/runtime/schedule and all received consensus
// signatures are still verified. It starts no Node or listener.
func NewPQObserverNode(config *cfg.Config, app *Application, nodeKey *p2p.NodeKey, logger log.Logger) (*node.Node, error) {
	if config == nil || app == nil || nodeKey == nil || nodeKey.PrivKey == nil || logger == nil || config.PrivValidatorListenAddr != "" {
		return nil, errors.New("observer requires its original application and P2P identity; private validator sockets are forbidden")
	}
	if err := app.ValidateNormalRuntime(); err != nil {
		return nil, err
	}
	app.mu.RLock()
	bootstrap, pending, alreadyBound := app.bootstrap, app.pending != nil, app.pqWalletPolicyLive != nil
	app.mu.RUnlock()
	if bootstrap == nil || pending || alreadyBound {
		return nil, errors.New("observer requires an independently pinned committed application")
	}
	if err := bootstrap.matchesMigration(app.migration); err != nil {
		return nil, err
	}
	private, ok := nodeKey.PrivKey.(cmted.PrivKey)
	if !ok || len(private) != ed25519.PrivateKeySize {
		return nil, errors.New("observer P2P identity requires an existing full Ed25519 key")
	}
	derived := ed25519.NewKeyFromSeed(private[:ed25519.SeedSize])
	defer clear(derived)
	if !bytes.Equal(derived, private) {
		return nil, errors.New("observer P2P public/private mismatch")
	}
	// A transport identity is not a validator identity or a source of voting
	// authority. Do not borrow an original validator key for this role.
	public := nodeKey.PrivKey.PubKey()
	if public == nil {
		return nil, errors.New("observer P2P public identity unavailable")
	}
	for _, member := range bootstrap.record.Members {
		if bytes.Equal(public.Bytes(), member.Ed25519) {
			return nil, errors.New("observer P2P identity must not reuse an original validator key")
		}
	}
	raw, err := os.ReadFile(config.GenesisFile())
	if err != nil {
		return nil, fmt.Errorf("read original observer genesis: %w", err)
	}
	digest := sha256.Sum256(raw)
	if !bytes.Equal(digest[:], bootstrap.genesisID) {
		return nil, errors.New("observer genesis differs from independent application bootstrap")
	}
	genesis := func() (*cmttypes.GenesisDoc, error) {
		var doc cmttypes.GenesisDoc
		if err := cmtjson.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		return &doc, nil
	}
	n, err := node.NewObserverNodeWithConsensusAuthority(config, nodeKey, proxy.NewLocalClientCreator(app), genesis, cfg.DefaultDBProvider, node.DefaultMetricsProvider(config.Instrumentation), logger, app)
	if err != nil {
		return nil, err
	}
	// Original normal-owner binding, supplied by the separate live-reader owner.
	// It owns the single node consumer and retires/drains before stores close.
	if err = bindPQWalletPolicyLiveSource(n, app); err != nil {
		n.OnStop()
		return nil, err
	}
	return n, nil
}
