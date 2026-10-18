//go:build linux

package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Ordinary CI compiles and skips this test. This is a separate authorization
// from both the local four-node case and the no-Node.Start signer process case.
// The external runner pins both precompiled binaries and all four test sources;
// nothing here builds a binary, starts a helper impersonating the daemon, or
// changes the 105s active / 15s cleanup / 48-block network bounds.
func TestPQNetworkFourValidatorRemoteSignerOriginalStateTransitionAndRestart(t *testing.T) {
	optIn := os.Getenv("YNX_PQ_NETWORK_REMOTE_E2E")
	if optIn == "" {
		t.Skip("requires a separately authorized four-node normal remote-signer window")
	}
	if optIn != "authorized-four-node-remote-signer-window" || os.Getenv("YNX_PQ_NETWORK_E2E") != "" || os.Getenv("YNX_PQ_REMOTE_PROCESS") != "" {
		t.Fatal("remote network authorization must be explicit and exclusive")
	}
	binary, pin := os.Getenv("YNX_PQ_REMOTE_SIGNER_BINARY"), os.Getenv("YNX_PQ_REMOTE_SIGNER_SHA256")
	checkRemoteProcessBinary(t, binary, pin)
	// Retain the original private network/daemon materials even on UNKNOWN.
	// The enclosing case owns TMPDIR; this is not a permanent backup promise.
	root, err := os.MkdirTemp("", "ynx-pq-remote-network-")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	custody := &pqNetworkRemoteCustody{root: root, binary: binary, binarySHA256: pin,
		proposals: map[string]bool{}, prevotes: map[string]bool{}, precommits: map[string]bool{}}
	runPQNetworkFourValidatorOriginalStateTransitionAndRestart(t, custody)
}

type pqNetworkRemoteBlock struct {
	key   ynxpq.PubKey
	index int32
	id    cmttypes.BlockID
}

type pqNetworkRemoteCustody struct {
	root, binary, binarySHA256 string
	item                       *pqNetworkE2ENode
	fixture                    *remoteProcessFixture
	process                    *remoteSignerProcess
	session                    *PQRemotePrivValidator
	immutable                  map[string][]byte
	blocks                     map[int64]pqNetworkRemoteBlock
	starts, exits              int
	stopping                   bool
	coldRecovered              bool
	threeOfFourHeight          int64
	coldCommitHeight           int64
	firstHeight, lastHeight    int64
	proposals                  map[string]bool
	prevotes                   map[string]bool
	precommits                 map[string]bool
}

func (r *pqNetworkRemoteCustody) PrivateRoot() string { return r.root }
func (r *pqNetworkRemoteCustody) IsRemote(item *pqNetworkE2ENode) bool {
	return filepath.Base(item.config.RootDir) == "validator-0"
}

func (r *pqNetworkRemoteCustody) Construct(n *pqNetworkE2E, item *pqNetworkE2ENode) {
	n.t.Helper()
	if !r.IsRemote(item) || item != n.nodes[0] || item.host != nil || item.legacyLease != nil || item.appLease == nil || r.process != nil || r.session != nil {
		n.t.Fatal("remote network custody would duplicate a signer or its original leases")
	}
	r.item = item
	if r.fixture == nil {
		r.prepare(n, item)
	}
	if r.fixture.files.State != item.appPath || r.fixture.binding.SignerStatePath != item.binding.SignerStatePath {
		n.t.Fatal("remote recovery attempted to replace the live original checkpoint or HRS path")
	}
	r.assertImmutable(n)
	beforeLegacy := pqNetworkE2ERead(n.t, item.config.PrivValidatorStateFile())
	beforePQ := pqNetworkE2ERead(n.t, item.binding.SignerStatePath)
	// Reuse the normal process helper: pinned ELF, one TCP listener, inherited
	// FD 3, bounded logs, /proc-owned readiness, original --serve entrypoint.
	r.process = r.fixture.start(n.t, n.ctx, r.binary, r.binarySHA256, item.appPath)
	r.starts++
	transport := r.fixture.engine
	transport.Address = "tcp://" + r.process.address
	conn, pin, err := DialPQRemoteConnection(n.ctx, transport)
	if err != nil {
		n.t.Fatalf("normal remote network single authenticated connection: %v", err)
	}
	nodeKey, err := LoadPQExistingNodeKey(item.config.NodeKeyFile())
	if err != nil {
		_ = conn.Close()
		n.t.Fatal(err)
	}
	item.node, r.session, err = NewPQRemoteConsensusNodeSession(item.config, item.app, conn, pin, transport.Timeout, item.binding, nodeKey, log.NewNopLogger())
	if err != nil {
		_ = conn.Close()
		n.t.Fatalf("normal remote node factory over original app/BlockStore: %v", err)
	}
	if !bytes.Equal(beforeLegacy, pqNetworkE2ERead(n.t, item.config.PrivValidatorStateFile())) || !bytes.Equal(beforePQ, pqNetworkE2ERead(n.t, item.binding.SignerStatePath)) {
		n.t.Fatal("remote constructor changed original HRS before Node.Start")
	}
	if r.starts == 2 {
		if r.exits != 1 || item.lastPQHRS.height < n.schedule.ActivationHeight {
			n.t.Fatal("cold remote restart lacks the exited original process and actual PQ HRS")
		}
		r.coldRecovered = true
	} else if r.starts != 1 {
		n.t.Fatal("remote network case attempted an unapproved reconnect or third daemon")
	}
	n.t.Logf("remote network custody: validator=0 daemonStart=%d originalAppPath=true originalHRSUnchanged=true normalBinarySHA256=%s", r.starts, r.binarySHA256)
}

func (r *pqNetworkRemoteCustody) prepare(n *pqNetworkE2E, item *pqNetworkE2ENode) {
	n.t.Helper()
	dir := filepath.Join(r.root, "remote-operator")
	if err := os.Mkdir(dir, 0700); err != nil {
		n.t.Fatal(err)
	}
	f := &remoteProcessFixture{dir: dir, layout: "atomic-json", vault: item.vaultPath,
		legacyKey: item.config.PrivValidatorKeyFile(), legacyState: item.config.PrivValidatorStateFile(),
		binding: item.binding, credential: item.credential}
	migration, err := n.migration.CanonicalJSON()
	if err != nil {
		n.t.Fatal(err)
	}
	schedule, err := json.Marshal(n.schedule)
	if err != nil {
		n.t.Fatal(err)
	}
	scheduleHash, err := n.schedule.Hash()
	if err != nil {
		n.t.Fatal(err)
	}
	binding, err := json.Marshal(item.binding)
	if err != nil {
		n.t.Fatal(err)
	}
	f.files = PQOperatorFiles{Migration: f.write(n.t, "migration.json", migration), Genesis: item.config.GenesisFile(),
		State: item.appPath, Schedule: f.write(n.t, "schedule.json", schedule), ScheduleHash: scheduleHash,
		Binding: f.write(n.t, "binding.json", binding), Pins: ConsensusBootstrapPins{
			CometGenesisSHA256: item.haltControl.GenesisSHA256, OriginalGenesisHash: n.migration.OriginalGenesisHash, MigrationStateHash: n.migration.StateHash}}
	engine, daemon := cmted.GenPrivKey(), cmted.GenPrivKey()
	defer clear(engine)
	defer clear(daemon)
	transport := func(name string, key cmted.PrivKey, peer []byte) PQRemoteTransport {
		raw, err := cmtjson.Marshal(&p2p.NodeKey{PrivKey: key})
		if err != nil {
			n.t.Fatal(err)
		}
		defer clear(raw)
		return PQRemoteTransport{TransportKey: f.write(n.t, name+"-transport.json", raw),
			PeerPin: f.write(n.t, name+"-peer.pub", []byte(hex.EncodeToString(peer)+"\n")), Timeout: 10 * time.Second}
	}
	f.engine, f.daemon = transport("engine", engine, daemon.PubKey().Bytes()), transport("daemon", daemon, engine.PubKey().Bytes())
	// These synthetic full peer pins are fixed before either normal process or
	// connection starts. No key/root/checkpoint is selected from peer messages.
	r.fixture = f
	r.immutable = map[string][]byte{}
	for _, path := range []string{f.files.Migration, f.files.Genesis, f.files.Schedule, f.files.Binding,
		f.vault, f.legacyKey, item.config.NodeKeyFile(), f.engine.TransportKey, f.engine.PeerPin, f.daemon.TransportKey, f.daemon.PeerPin} {
		r.immutable[path] = pqNetworkE2ERead(n.t, path)
	}
}

func (r *pqNetworkRemoteCustody) assertImmutable(n *pqNetworkE2E) {
	for path, original := range r.immutable {
		if !bytes.Equal(original, pqNetworkE2ERead(n.t, path)) {
			n.t.Fatal("remote network changed original operator inputs or identity")
		}
	}
}

func (r *pqNetworkRemoteCustody) Check(n *pqNetworkE2E) {
	if r.process == nil || r.stopping {
		return
	}
	select {
	case <-r.process.done:
		n.t.Fatalf("normal remote signer exited during real consensus: %s", r.process.diagnostic())
	default:
	}
	if r.session != nil {
		select {
		case <-r.session.Done():
			n.t.Fatalf("normal remote network session failed closed without reconnect: %v", r.session.Err())
		default:
		}
	}
}

// Capture independently verified historical keys while the original store is
// still open; inspect actual local WAL messages only after Node.Stop flushed it.
func (r *pqNetworkRemoteCustody) BeforeStop(n *pqNetworkE2E, item *pqNetworkE2ENode) {
	if item != r.item || r.process == nil {
		return
	}
	r.stopping = true
	r.blocks = map[int64]pqNetworkRemoteBlock{}
	if item.node != nil && item.store != nil && !n.t.Failed() {
		for height := n.schedule.ActivationHeight; height <= item.node.BlockStore().Height(); height++ {
			set, err := item.store.LoadValidators(height)
			meta := item.node.BlockStore().LoadBlockMeta(height)
			if err != nil || set == nil || meta == nil {
				n.t.Errorf("remote WAL lacks real committed validator/block history at %d: %v", height, err)
				break
			}
			index, member := set.GetByAddress(item.address)
			if member == nil {
				n.t.Error("remote validator missing from actual committed set")
				break
			}
			key, ok := member.PubKey.(ynxpq.PubKey)
			if !ok {
				n.t.Error("actual remote validator history attempted classic fallback")
				break
			}
			r.blocks[height] = pqNetworkRemoteBlock{key: key, index: index, id: meta.BlockID}
		}
	}
	// Same lifecycle order as the normal node CLI: close the sole remote
	// connection before stopping the node, so no blocked signing call survives.
	if r.session != nil {
		_ = r.session.Close()
		r.session = nil
	}
	r.process.stop(n.t)
	r.process = nil
	r.exits++
}

func (r *pqNetworkRemoteCustody) AfterStop(n *pqNetworkE2E, item *pqNetworkE2ENode) {
	if item != r.item || !r.stopping {
		return
	}
	r.stopping = false
	r.assertImmutable(n)
	if !n.t.Failed() {
		r.readStoppedWAL(n)
	}
}

func (r *pqNetworkRemoteCustody) readStoppedWAL(n *pqNetworkE2E) {
	n.t.Helper()
	paths, err := filepath.Glob(r.item.config.Consensus.WalFile() + "*")
	if err != nil || len(paths) == 0 {
		n.t.Fatal("remote network produced no original consensus WAL", err)
	}
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			n.t.Fatal(err)
		}
		decoder := cmtconsensus.NewWALDecoder(file)
		for {
			record, err := decoder.Decode()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				_ = file.Close()
				n.t.Fatal("original stopped WAL cannot be decoded", err)
			}
			proto, err := cmtconsensus.WALToProto(record.Msg)
			if err != nil {
				_ = file.Close()
				n.t.Fatal(err)
			}
			info := proto.GetMsgInfo()
			if info == nil || info.PeerID != "" {
				continue // Count only this engine's actual locally signed messages.
			}
			if message := info.Msg.GetProposal(); message != nil {
				proposal := &message.Proposal
				block, ok := r.blocks[proposal.Height]
				if !ok || !bytes.Equal(proposal.BlockID.Hash, block.id.Hash) || proposal.BlockID.PartSetHeader.Total != block.id.PartSetHeader.Total || !bytes.Equal(proposal.BlockID.PartSetHeader.Hash, block.id.PartSetHeader.Hash) {
					continue
				}
				if !block.key.VerifyProposal(n.doc.ChainID, proposal) {
					_ = file.Close()
					n.t.Fatal("actual remote local proposal failed full dual verification")
				}
				r.proposals[hex.EncodeToString(proposal.Signature)] = true
			}
			if message := info.Msg.GetVote(); message != nil && message.Vote != nil {
				vote := message.Vote
				block, ok := r.blocks[vote.Height]
				if !ok || !bytes.Equal(vote.ValidatorAddress, r.item.address) {
					continue
				}
				if vote.ValidatorIndex != block.index || !block.key.VerifyVote(n.doc.ChainID, vote) {
					_ = file.Close()
					n.t.Fatal("actual remote local vote failed full dual verification")
				}
				if vote.Type == cmtproto.PrevoteType {
					r.prevotes[hex.EncodeToString(vote.Signature)] = true
				} else if vote.Type == cmtproto.PrecommitType {
					r.precommits[hex.EncodeToString(vote.Signature)] = true
				} else {
					_ = file.Close()
					n.t.Fatal("actual local consensus WAL contains an invalid vote type")
				}
				if r.firstHeight == 0 || vote.Height < r.firstHeight {
					r.firstHeight = vote.Height
				}
				if vote.Height > r.lastHeight {
					r.lastHeight = vote.Height
				}
			}
		}
		if err := file.Close(); err != nil {
			n.t.Fatal(err)
		}
	}
}

func (r *pqNetworkRemoteCustody) requireCommit(n *pqNetworkE2E, height int64) {
	n.t.Helper()
	commit := n.nodes[0].node.BlockStore().LoadSeenCommit(height)
	if commit == nil {
		n.t.Fatal("remote network commit is missing")
	}
	for _, signature := range commit.Signatures {
		if signature.BlockIDFlag == cmttypes.BlockIDFlagCommit && bytes.Equal(signature.ValidatorAddress, r.item.address) {
			return // verifyCommit already checked all present dual signatures.
		}
	}
	n.t.Fatal("actual three-of-four commit did not include the remote validator")
}

func (r *pqNetworkRemoteCustody) ColdRestart(n *pqNetworkE2E, originalPQHeight int64) int64 {
	n.t.Helper()
	if r.starts != 2 || r.exits != 1 || !r.coldRecovered {
		n.t.Fatal("remote network did not cold-resume the original normal daemon")
	}
	// Use the shared trajectory's exact original 3/4 transfer height, not an
	// arbitrary three-signature subset from a four-node block.
	n.verifyCommit(originalPQHeight, true, 4, true)
	r.requireCommit(n, originalPQHeight)
	r.threeOfFourHeight = originalPQHeight
	// Require new signing after the cold restart. Keep exactly three original
	// validators online so three local signers cannot conceal a dead daemon.
	n.stop(3)
	beforeSender, beforeRecipient := n.account(0, n.recipient), n.account(0, n.owner)
	beforeTrace := n.traceInventory(0)
	payload := n.classicTransfer(n.recipientKey, n.owner, 1)
	r.coldCommitHeight = n.submit(payload, 3)
	n.verifyCommit(r.coldCommitHeight, true, 3, true)
	r.requireCommit(n, r.coldCommitHeight)
	n.verifyNativeReceipt(payload, r.coldCommitHeight, n.recipient, n.owner, 1, 1, 3)
	afterSender, afterRecipient := n.account(0, n.recipient), n.account(0, n.owner)
	if afterSender.Balance != beforeSender.Balance-2 || afterSender.Nonce != beforeSender.Nonce+1 || afterRecipient.Balance != beforeRecipient.Balance+1 || afterRecipient.Nonce != beforeRecipient.Nonce {
		n.t.Fatal("remote cold network block did not execute its real fee/nonce/balances")
	}
	n.verifyTransferTrace(beforeTrace, beforeSender, afterSender, SignedTransactionHash(payload), 3)
	n.constructPQ(n.nodes[3], false)
	n.startConstructed(4)
	height := n.quiet(4)
	n.verifyCommit(r.coldCommitHeight, true, 4, false)
	n.verifyNativeReceipt(payload, r.coldCommitHeight, n.recipient, n.owner, 1, 1, 4)
	n.verifyTransferTrace(beforeTrace, beforeSender, afterSender, SignedTransactionHash(payload), 4)
	return height
}

func (r *pqNetworkRemoteCustody) Complete(n *pqNetworkE2E) {
	if r.starts != 2 || r.exits != 2 || r.process != nil || r.session != nil || !r.coldRecovered || r.item.host != nil || r.coldCommitHeight <= r.threeOfFourHeight || r.lastHeight < r.coldCommitHeight || len(r.proposals) == 0 || len(r.prevotes) == 0 || len(r.precommits) == 0 {
		n.t.Fatal("remote network did not complete actual proposal/vote/commit/cold-process evidence")
	}
	checkRemoteProcessBinary(n.t, r.binary, r.binarySHA256)
	r.assertImmutable(n)
	result, err := json.Marshal(map[string]any{
		"version": "ynx-pq-four-node-remote-e2e/v1", "syntheticOnly": true, "remoteValidatorIndex": 0,
		"normalBinarySHA256": r.binarySHA256, "daemonStarts": r.starts, "daemonExits": r.exits,
		"checkpointPathSharedWithOriginalApp": true, "originalHRSColdRecovered": true,
		"remoteProposalVerified": true, "remotePrevoteVerified": true, "remotePrecommitVerified": true,
		"remoteThreeOfFourCommitVerified": true, "remoteColdCommitVerified": true,
		"proposalCount": len(r.proposals), "prevoteCount": len(r.prevotes), "precommitCount": len(r.precommits),
		"firstRemoteHeight": r.firstHeight, "lastRemoteHeight": r.lastHeight,
		"threeOfFourCommitHeight": r.threeOfFourHeight, "coldCommitHeight": r.coldCommitHeight,
		"automaticReconnect": false, "localSignerForRemoteValidator": false, "publicDeployment": false,
	})
	if err != nil || strings.Contains(string(result), r.root) {
		n.t.Fatal("remote evidence encoding failed or exposed a private path", err)
	}
	n.t.Logf("PQ_NETWORK_REMOTE_E2E_SUMMARY %s", result)
}
