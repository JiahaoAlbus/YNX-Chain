package node

import (
	"errors"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/proxy"
	"github.com/cometbft/cometbft/types"
)

type observerNeverAuthority struct{}

// Test-only original validator: any accidental signing is an immediate failure.
type observerNeverSignValidator struct {
	types.MockPV
	t *testing.T
}

func (v observerNeverSignValidator) SignVote(string, *cmtproto.Vote) error {
	v.t.Fatal("constructor signed a vote")
	return errors.New("no test signature")
}
func (v observerNeverSignValidator) SignProposal(string, *cmtproto.Proposal) error {
	v.t.Fatal("constructor signed a proposal")
	return errors.New("no test signature")
}

func (observerNeverAuthority) ConsensusAuthorityForState(string, int64, []byte) (types.ConsensusAuthority, error) {
	return nil, errors.New("PUBLIC refusal test must not read authority")
}

func TestObserverNodePUBLICExplicitRoleRefusesMissingAuthorityAndRemoteSigner(t *testing.T) {
	conf := cfg.DefaultConfig().SetRoot(t.TempDir())
	key := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	defer clear(key.PrivKey.Bytes())
	creator := proxy.NewLocalClientCreator(&abci.BaseApplication{})
	genesis := func() (*types.GenesisDoc, error) {
		t.Fatal("refusal reached genesis/DB construction")
		return nil, errors.New("unreachable")
	}
	for _, remote := range []bool{false, true} {
		var source types.ConsensusAuthoritySource
		if remote {
			source = observerNeverAuthority{}
			conf.PrivValidatorListenAddr = "tcp://127.0.0.1:1"
		}
		if n, err := NewObserverNodeWithConsensusAuthority(conf, key, creator, genesis, cfg.DefaultDBProvider, DefaultMetricsProvider(conf.Instrumentation), log.NewNopLogger(), source); err == nil || n != nil {
			t.Fatal("observer accepted missing authority or remote signer")
		}
	}
	conf.PrivValidatorListenAddr = ""
	if n, err := NewNode(conf, nil, key, creator, genesis, cfg.DefaultDBProvider, DefaultMetricsProvider(conf.Instrumentation), log.NewNopLogger()); err == nil || n != nil {
		t.Fatal("ordinary validator API silently became observer")
	}
	n := &Node{observer: true, privValidator: types.NewMockPVWithParams(key.PrivKey, false, false)}
	if _, err := n.ConfigureRPC(); err == nil {
		t.Fatal("observer RPC accepted a validator")
	}
	t.Run("original-validator-positive", func(t *testing.T) {
		conf := cfg.DefaultConfig().SetRoot(t.TempDir())
		conf.TxIndex.Indexer, conf.RPC.ListenAddress, conf.RPC.PprofListenAddress = "null", "", ""
		conf.P2P.PexReactor = false
		validator := observerNeverSignValidator{MockPV: types.NewMockPVWithParams(key.PrivKey, false, false), t: t}
		public := key.PrivKey.PubKey()
		genesis := func() (*types.GenesisDoc, error) {
			return &types.GenesisDoc{GenesisTime: time.Unix(1802736000, 0).UTC(), ChainID: "observer-original-validator-regression", InitialHeight: 1, ConsensusParams: types.DefaultConsensusParams(), Validators: []types.GenesisValidator{{PubKey: public, Power: 1}}}, nil
		}
		n, err := NewNode(conf, validator, key, creator, genesis, cfg.DefaultDBProvider, DefaultMetricsProvider(conf.Instrumentation), log.NewNopLogger())
		if err != nil {
			t.Fatal("original validator constructor changed", err)
		}
		defer n.OnStop()
		if n.IsRunning() || n.observer || n.PrivValidator() == nil {
			t.Fatal("original validator was converted to observer")
		}
		env, err := n.ConfigureRPC()
		if err != nil {
			t.Fatal(err)
		}
		status, err := env.Status(nil)
		if err != nil || status.ValidatorInfo.PubKey == nil || !status.ValidatorInfo.PubKey.Equals(public) || status.ValidatorInfo.VotingPower != 1 {
			t.Fatal("original validator RPC identity/power changed", err)
		}
	})
}
