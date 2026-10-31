package node

import (
	"testing"

	"github.com/stretchr/testify/require"

	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/libs/service"
	mempl "github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/p2p/conn"
)

// This exercises normal Option/Switch/channel registration before any listen,
// node process, validator or consensus starts. It is not a node load baseline.
func losslessRegistrationNode(t *testing.T) *Node {
	t.Helper()
	config := cfg.TestConfig().SetRoot(t.TempDir())
	key := p2p.NodeKey{PrivKey: ed25519.GenPrivKey()}
	info := p2p.DefaultNodeInfo{DefaultNodeID: key.ID(), ListenAddr: "127.0.0.1:12345", Network: "isolated-lossless-registration", Version: "0.38.23", Channels: []byte{mempl.MempoolChannel}, Moniker: "isolated-source-lab", Other: p2p.DefaultNodeInfoOther{TxIndex: "off"}}
	transport := p2p.NewMultiplexTransport(info, key, conn.DefaultMConnConfig())
	sw := p2p.NewSwitch(config.P2P, transport)
	sw.SetNodeInfo(info)
	reactor := mempl.NewReactor(config.Mempool, nil)
	sw.AddReactor("MEMPOOL", reactor)
	n := &Node{config: config, nodeInfo: info, nodeKey: &key, transport: transport, sw: sw, mempoolReactor: reactor}
	n.BaseService = *service.NewBaseService(log.NewNopLogger(), "isolated-registration", n)
	return n
}

func TestLosslessHexNodeExplicitNormalRegistrationAndDefaultOff(t *testing.T) {
	n := losslessRegistrationNode(t)
	require.False(t, n.nodeInfo.(p2p.DefaultNodeInfo).HasChannel(mempl.LosslessHexV1Channel))
	require.Len(t, n.mempoolReactor.GetChannels(), 1)
	ExperimentalMempoolLosslessHex(mempl.LosslessHexLimits{})(n)
	require.NoError(t, n.experimentalMempoolWireError)
	require.True(t, n.nodeInfo.(p2p.DefaultNodeInfo).HasChannel(mempl.LosslessHexV1Channel))
	require.True(t, n.sw.NodeInfo().(p2p.DefaultNodeInfo).HasChannel(mempl.LosslessHexV1Channel))
	require.Same(t, n.mempoolReactor, n.sw.Reactor("MEMPOOL"))
	require.Len(t, n.mempoolReactor.GetChannels(), 2)
	require.True(t, n.mempoolReactor.(*mempl.Reactor).ExperimentalLosslessHexSnapshot().Enabled)
	ExperimentalMempoolLosslessHex(mempl.LosslessHexLimits{})(n)
	require.Error(t, n.experimentalMempoolWireError)
}

func TestLosslessHexNodeBadOptionLeavesLegacyRegistration(t *testing.T) {
	n := losslessRegistrationNode(t)
	ExperimentalMempoolLosslessHex(mempl.LosslessHexLimits{MaxFrameBytes: 1})(n)
	require.Error(t, n.experimentalMempoolWireError)
	require.False(t, n.nodeInfo.(p2p.DefaultNodeInfo).HasChannel(mempl.LosslessHexV1Channel))
	require.Same(t, n.mempoolReactor, n.sw.Reactor("MEMPOOL"))
	require.Len(t, n.mempoolReactor.GetChannels(), 1)
}
