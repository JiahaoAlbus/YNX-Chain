package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const (
	pqNetworkE2EMaxBlocks = int64(48)
	// Empty blocks are disabled. A submitted transaction can require its own
	// block plus the following block that proves the changed application hash.
	pqNetworkE2ESubmissionBlocks = int64(2)
)

func pqNetworkE2EBlockBudget(initial, tip, reserve int64) error {
	if initial < 1 || tip < initial || reserve < 0 || reserve > pqNetworkE2EMaxBlocks {
		return fmt.Errorf("invalid stable network checkpoint or block reservation")
	}
	// InitialHeight itself is a real block, including when it is greater than 1.
	// Positive ordered heights also make this subtraction/addition overflow-safe.
	used := tip - initial + 1
	if used > pqNetworkE2EMaxBlocks-reserve {
		return fmt.Errorf("small-block network budget: committed=%d reserved=%d limit=%d", used, reserve, pqNetworkE2EMaxBlocks)
	}
	return nil
}

func TestPQNetworkBlockBudget(t *testing.T) {
	const largestHeight = int64(1<<63 - 1)
	for _, test := range []struct {
		name                  string
		initial, tip, reserve int64
		allowed               bool
	}{
		{"initial block counts", 7, 7, 0, true},
		{"initial block is not free", 7, 7, 48, false},
		{"46 blocks reserve transaction and proof", 7, 52, 2, true},
		{"47 blocks cannot submit", 7, 53, 2, false},
		{"48 blocks observation allowed", 7, 54, 0, true},
		{"49 blocks rejected", 7, 55, 0, false},
		{"48 blocks cannot submit", 7, 54, 2, false},
		{"large initial height exact limit", largestHeight - 47, largestHeight, 0, true},
		{"large accumulated height rejected", 1, largestHeight, 0, false},
		{"unknown initial height", 0, 0, 0, false},
		{"checkpoint before initial height", 7, 6, 0, false},
		{"negative reservation", 7, 7, -1, false},
		{"oversized reservation", 7, 7, 49, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := pqNetworkE2EBlockBudget(test.initial, test.tip, test.reserve); (err == nil) != test.allowed {
				t.Fatalf("initial=%d tip=%d reserve=%d: error=%v allowed=%v", test.initial, test.tip, test.reserve, err, test.allowed)
			}
		})
	}
}

// This is a deliberately opt-in, bounded local-network integration test, not a
// benchmark. Ordinary CI only compiles it. Running it requires a separately
// authorized four-node window and YNX_PQ_NETWORK_E2E=authorized-four-node-window.
// Every Comet block below comes from Node.Start, the real mempool/gossip,
// proposer, voting, Finalize and Commit path. No helper calls FinalizeBlock,
// creates a synthetic Commit, supplies MockPV, or approves external signatures.
// The native migration is fresh synthetic genesis input, never represented as
// pre-existing Comet block history. Secrets stay in this test's private TempDir.
func TestPQNetworkFourValidatorOriginalStateTransitionAndRestart(t *testing.T) {
	optIn := os.Getenv("YNX_PQ_NETWORK_E2E")
	if optIn == "" {
		t.Skip("opt-in four-node network execution requires a separately authorized window")
	}
	if optIn != "authorized-four-node-window" {
		t.Fatal("invalid YNX_PQ_NETWORK_E2E value; this is not an authorized four-node window")
	}
	previousProcs := runtime.GOMAXPROCS(2)
	defer runtime.GOMAXPROCS(previousProcs)
	// The isolated test process has a 120-second outer timeout. Reserve its
	// final 15 seconds for normal Node.Stop and durable signer-lock cleanup.
	ctx, cancel := context.WithTimeout(context.Background(), 105*time.Second)
	defer cancel()
	network := pqNetworkE2ENew(t, ctx)
	defer network.stopAll()
	network.startLegacy()
	network.quiet(4)
	owner, recipient := network.owner, network.recipient

	// Real Ed25519 consensus first commits ordinary user state and contract
	// execution before either account or validator migration is admitted.
	ordinary := network.classicTransfer(network.ownerKey, recipient, 9)
	ordinaryHeight := network.submit(ordinary, 4)
	network.verifyNativeReceipt(ordinary, ordinaryHeight, owner, recipient, 9, 1, 4)
	source, bytecode := boundedContractFixture(t, "SampleEVMWriteCounter")
	deploy := IDEContractDeployPayload{Name: "SampleEVMWriteCounter", Source: source, DeployedBytecode: bytecode, ConstructorArgs: []string{"7"}, IdempotencyKey: "network-counter-deploy"}
	deploy.RequestHash = IDEDeployRequestHash(deploy.Name, deploy.Source, deploy.DeployedBytecode, deploy.ConstructorArgs, deploy.IdempotencyKey)
	deployRaw := mustIDEAction(t, network.ownerKey, ActionIDEContractDeploy, deploy, network.account(0, owner).Nonce+1)
	network.submit(deployRaw, 4)
	contractAddress := ideContractAddress(owner, ApplicationActionHash(deployRaw))
	call := IDEContractCallPayload{Address: contractAddress, Calldata: "0x7cf5dab0" + strings.Repeat("0", 63) + "5", IdempotencyKey: "network-counter-increment"}
	call.RequestHash = IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	callRaw := mustIDEAction(t, network.ownerKey, ActionIDEContractCall, call, network.account(0, owner).Nonce+1)
	network.submit(callRaw, 4)
	var contract BFTContract
	network.query(0, "/ide/contracts/"+contractAddress, &contract)
	if contract.RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatal("real Ed-stage counter execution did not preserve 7+5")
	}
	beforeMigration := network.business()
	network.verifyCommit(ordinaryHeight, false, 4, false)
	t.Logf("actual Ed25519 network: initial Comet height=%d, ordinary transaction height=%d, Counter storage=12", network.doc.InitialHeight, ordinaryHeight)

	walletKey, walletPublic, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer walletKey.Destroy()
	h := network.quiet(4)
	intent := ynxauth.RegistrationIntent{ChainID: network.nativeGenesis, Owner: owner, PKA: walletPublic.PKA, PKB: walletPublic.PKB, NewRevision: 1, LedgerNonce: network.account(0, owner).Nonce + 1, ActivateAt: uint64(h + 2)}
	migrationWire := abciRegistrationWire(t, network.ownerKey, nil, walletKey, intent)
	network.submit(mustPQEnvelope(t, PQMigrationType, migrationWire), 4)
	// Drive only a bounded number of actual classic transactions if the
	// application-hash proof block has not already crossed account activation.
	network.driveThrough(int64(intent.ActivateAt), 4)
	rejected := network.classicTransfer(network.ownerKey, recipient, 1)
	beforeReject := network.business()
	if response := network.check(rejected); response.Code == 0 {
		t.Fatal("classic account signature accepted after actual account migration")
	}
	if !bytes.Equal(beforeReject, network.business()) {
		t.Fatal("rejected legacy account transaction changed committed state")
	}

	// Each approval binds its exact, currently quiet next execution height.
	// Only one validator transaction is injected at a time; no race-dependent
	// batch or fabricated ApprovedAt is used to evade the real ingress rule.
	for i, member := range network.bootstrap.record.Members {
		h = network.quiet(4)
		n := network.nodeForAddress(member.Address)
		registration := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(network.bootstrap.genesisID), ChainID: network.doc.ChainID, ValidatorAddress: bytes.Clone(member.Address), Sequence: 1, Epoch: 1, ApprovedAt: h + 1, EffectiveAt: h + 3, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.Ed25519), MLDSA87PublicKey: bytes.Clone(n.material.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(n.material.PublicB)}
		approval, err := registration.AuthoritySigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		a, b, err := n.pqKey.RegistrationPossession(registration)
		if err != nil {
			t.Fatal(err)
		}
		wire, err := (ynxconsensusauth.Registration{Intent: registration, LegacyApproval: ed25519.Sign(n.legacy, approval), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		payload, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		if got := network.submit(payload, 4); got != h+1 {
			t.Fatalf("validator %d approval executed at %d, signed for %d", i, got, h+1)
		}
	}
	h = network.quiet(4)
	var registry *ValidatorRegistryState
	network.query(0, "/validator-registry", &registry)
	if registry == nil || len(registry.Events) != 4 {
		t.Fatal("normal ingress did not commit all four dual possession proofs")
	}
	preserved := network.business()
	if bytes.Equal(beforeMigration, preserved) {
		t.Fatal("fixture never committed real migration/history changes")
	}
	network.stopAll()
	// The schedule's pin is external startup input derived once from the
	// independently compared original network checkpoint, not read back from
	// each state file as self-authority. No registry or checkpoint is invented.
	schedule, err := NewPQEngineSchedule(network.bootstrap, registry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	rawSchedule, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewPQEngineAuthorization(rawSchedule, strings.Repeat("01", 32)); err == nil {
		t.Fatal("self-reported schedule bypassed the independent startup pin")
	}
	network.authorization, err = NewPQEngineAuthorization(rawSchedule, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	network.schedule = schedule
	t.Logf("independent schedule pin=%s registryHeight=%d P=%d U=%d A=%d", scheduleHash, h, schedule.ParamsUpdateHeight, schedule.ValidatorUpdateHeight, schedule.ActivationHeight)
	for _, n := range network.nodes {
		network.constructPQ(n, true)
	}
	if !bytes.Equal(preserved, network.business()) {
		t.Fatal("normal PQ construction changed original account/contract/history state")
	}
	network.startConstructed(4)
	network.driveThrough(schedule.ActivationHeight+1, 4)
	network.verifyTransition()
	network.verifyCommit(ordinaryHeight, false, 4, false)
	network.verifyCommit(schedule.ActivationHeight, true, 4, false)
	network.query(0, "/ide/contracts/"+contractAddress, &contract)
	if contract.RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatal("P/U/A transition reset pre-existing contract storage")
	}

	// Three original validators must actually finalize the Wallet-format
	// Member. A fourth running validator cannot conceal a 2/3 threshold bug.
	network.quiet(4)
	network.stop(3)
	beforePQ, beforeRecipient := network.account(0, owner), network.account(0, recipient)
	beforeTrace := network.traceInventory(0)
	message, err := (ynxauth.Transfer{ChainID: network.nativeGenesis, NativeChainID: 6423, From: owner, To: recipient, Amount: 3, Fee: 1, Nonce: beforePQ.Nonce + 1}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, memberWire := consensusPQProof(t, walletKey, network.nativeGenesis, owner, ynxauth.TransactionPurpose, message)
	pqPayload := mustPQEnvelope(t, PQTransferType, memberWire)
	pqHeight := network.submit(pqPayload, 3)
	network.verifyCommit(pqHeight, true, 3, true)
	network.verifyNativeReceipt(pqPayload, pqHeight, owner, recipient, 3, 1, 3)
	t.Logf("actual 3/4 PQ Commit: height=%d ABCI transaction=%s", pqHeight, SignedTransactionHash(pqPayload))
	afterPQ, afterRecipient := network.account(0, owner), network.account(0, recipient)
	if afterPQ.Balance != beforePQ.Balance-4 || afterPQ.Nonce != beforePQ.Nonce+1 || afterRecipient.Balance != beforeRecipient.Balance+3 || afterRecipient.Nonce != beforeRecipient.Nonce {
		t.Fatal("real three-validator block did not execute exact Wallet transfer fee/nonce/balances")
	}
	network.verifyTransferTrace(beforeTrace, beforePQ, afterPQ, SignedTransactionHash(pqPayload), 3)
	network.rejectOldConsensusCommit(pqHeight)
	network.constructPQ(network.nodes[3], false)
	network.startConstructed(4)
	network.quiet(4)
	network.verifyCommit(pqHeight, true, 4, false)
	network.verifyNativeReceipt(ordinary, ordinaryHeight, owner, recipient, 9, 1, 4)
	network.verifyNativeReceipt(pqPayload, pqHeight, owner, recipient, 3, 1, 4)
	beforeRestart := network.business()
	history := network.blockHashes(4)
	network.stopAll()
	for _, n := range network.nodes {
		network.constructPQ(n, false)
	}
	if !bytes.Equal(beforeRestart, network.business()) {
		t.Fatal("normal cold restart changed original account/contract/history state")
	}
	network.startConstructed(4)
	finalHeight := network.quiet(4)
	if !bytes.Equal(beforeRestart, network.business()) {
		t.Fatal("normal restarted consensus changed user state without a transaction")
	}
	for height, hash := range history {
		for _, n := range network.nodes {
			meta := n.node.BlockStore().LoadBlockMeta(height)
			if meta == nil || !bytes.Equal(meta.BlockID.Hash, hash) {
				t.Fatalf("restart lost original Comet block %d", height)
			}
		}
	}
	network.verifyCommit(ordinaryHeight, false, 4, false)
	network.verifyCommit(pqHeight, true, 4, false)
	network.verifyCommit(finalHeight, true, 4, false)
	network.verifyNativeReceipt(ordinary, ordinaryHeight, owner, recipient, 9, 1, 4)
	network.verifyNativeReceipt(pqPayload, pqHeight, owner, recipient, 3, 1, 4)
	network.verifyTransferTrace(beforeTrace, beforePQ, afterPQ, SignedTransactionHash(pqPayload), 4)
	publicNodes := make([]map[string]any, len(network.nodes))
	var finalAppHash, finalBlockHash string
	for index, item := range network.nodes {
		item.app.mu.RLock()
		height, appHash := item.app.committed.Height, item.app.committed.AppHash
		item.app.mu.RUnlock()
		meta := item.node.BlockStore().LoadBlockMeta(finalHeight)
		if height != finalHeight || appHash == "" || meta == nil || item.node.BlockStore().Height() != finalHeight {
			t.Fatal("final restarted node lost the actual common checkpoint")
		}
		blockHash := hex.EncodeToString(meta.BlockID.Hash)
		if index == 0 {
			finalAppHash, finalBlockHash = appHash, blockHash
		} else if appHash != finalAppHash || blockHash != finalBlockHash {
			t.Fatal("final restarted nodes disagree on actual AppHash or block hash")
		}
		publicNodes[index] = map[string]any{"index": index, "height": height, "appHash": appHash, "blockHash": blockHash}
	}
	// Finish the original Node/Host cleanup and read their actual H/R/S before
	// emitting success evidence. No key, credential or private path is logged.
	network.stopAll()
	if t.Failed() {
		return
	}
	for index, item := range network.nodes {
		publicNodes[index]["legacyHRS"] = map[string]any{"height": item.lastLegacyHRS.height, "round": item.lastLegacyHRS.round, "step": item.lastLegacyHRS.step}
		publicNodes[index]["pqHRS"] = map[string]any{"height": item.lastPQHRS.height, "round": item.lastPQHRS.round, "step": item.lastPQHRS.step}
	}
	summary, err := json.Marshal(map[string]any{
		"version": "ynx-pq-four-node-e2e/v1", "syntheticOnly": true,
		"initialHeight": network.doc.InitialHeight, "finalHeight": finalHeight,
		"blockCount":              finalHeight - network.doc.InitialHeight + 1,
		"preservedOriginalBlocks": len(history), "scheduleHash": scheduleHash,
		"ordinaryTransferHeight": ordinaryHeight, "pqTransferHeight": pqHeight,
		"pqTransactionHash": SignedTransactionHash(pqPayload), "nodes": publicNodes,
		"nativeReceiptsVerified": true, "traceLineageVerified": true,
		"threeOfFourCommitVerified": true, "twoOfFourRejected": true,
		"coldRestartVerified": true, "nodeStopAndHostCloseCompleted": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("PQ_NETWORK_E2E_SUMMARY %s", summary)
}

type pqNetworkE2ENode struct {
	config              *cfg.Config
	node                *node.Node
	app                 *Application
	store               sm.Store
	legacy              ed25519.PrivateKey
	address             []byte
	nodeKey             *p2p.NodeKey
	keyBytes, nodeBytes []byte
	pqKey               *ynxconsensusauth.CandidateKey
	material            ynxconsensusauth.CandidateKeyMaterial
	credential          []byte
	binding             ynxconsensusauth.HostKeyBinding
	host                *ynxconsensusauth.HostSigner
	appPath, vaultPath  string
	lastLegacyHRS       pqNetworkE2EHRS
	lastPQHRS           pqNetworkE2EHRS
	legacySignedHeight  int64
	pqSignedHeight      int64
}

type pqNetworkE2EHRS struct {
	height int64
	round  int32
	step   uint32
}

func (p pqNetworkE2EHRS) before(other pqNetworkE2EHRS) bool {
	return p.height < other.height || p.height == other.height && (p.round < other.round || p.round == other.round && p.step < other.step)
}

type pqNetworkE2E struct {
	t                      *testing.T
	ctx                    context.Context
	nodes                  []*pqNetworkE2ENode
	migration              chain.ConsensusMigrationState
	bootstrap              *ConsensusBootstrap
	doc                    *cmttypes.GenesisDoc
	rawGenesis             []byte
	nativeGenesis          []byte
	ownerKey, recipientKey *secp256k1.PrivateKey
	owner, recipient       string
	authorization          *PQEngineAuthorization
	schedule               *PQEngineSchedule
	seen                   map[int64][]byte
}

func pqNetworkE2ENew(t *testing.T, ctx context.Context) *pqNetworkE2E {
	t.Helper()
	n := &pqNetworkE2E{t: t, ctx: ctx, seen: map[int64][]byte{}}
	var err error
	n.ownerKey, err = secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	n.recipientKey, err = secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	n.owner, n.recipient = mustNativeAddress(t, n.ownerKey), mustNativeAddress(t, n.recipientKey)
	validators := make([]chain.Validator, 4)
	for i := range validators {
		validators[i] = chain.Validator{Address: fmt.Sprintf("ynx_validator_network_%d", i), Moniker: fmt.Sprintf("network-%d", i), VotingPower: 1, Active: true}
	}
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	for _, address := range []string{n.owner, n.recipient} {
		if _, err := d.Faucet(address, 100_000); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	var bindings []chain.ConsensusValidatorKeyBinding
	var listeners []net.Listener
	defer func() {
		for _, listener := range listeners {
			_ = listener.Close()
		}
	}()
	for i, validator := range migration.Validators {
		public, private, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		address := sha256.Sum256(public)
		root := filepath.Join(t.TempDir(), fmt.Sprintf("validator-%d", i))
		config := cfg.DefaultConfig().SetRoot(root)
		for _, directory := range []string{filepath.Dir(config.GenesisFile()), filepath.Dir(config.PrivValidatorStateFile())} {
			if err := os.MkdirAll(directory, 0700); err != nil {
				t.Fatal(err)
			}
		}
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		listeners = append(listeners, listener)
		config.P2P.ListenAddress = "tcp://" + listener.Addr().String()
		config.P2P.AllowDuplicateIP = true
		config.P2P.AddrBookStrict = false
		config.P2P.PexReactor = false
		config.P2P.MaxNumInboundPeers = 8
		config.P2P.MaxNumOutboundPeers = 8
		config.P2P.PersistentPeersMaxDialPeriod = time.Second
		config.RPC.ListenAddress = ""
		config.RPC.PprofListenAddress = ""
		config.Instrumentation.Prometheus = false
		config.TxIndex.Indexer = "kv"
		config.Storage.DiscardABCIResponses = false
		config.Consensus.CreateEmptyBlocks = false
		config.Consensus.TimeoutCommit = 150 * time.Millisecond
		config.Consensus.TimeoutPropose = 2 * time.Second
		config.Consensus.TimeoutPrevote = time.Second
		config.Consensus.TimeoutPrecommit = time.Second
		config.Consensus.TimeoutProposeDelta = 250 * time.Millisecond
		config.Consensus.TimeoutPrevoteDelta = 250 * time.Millisecond
		config.Consensus.TimeoutPrecommitDelta = 250 * time.Millisecond
		pv := privval.NewFilePV(cmted.PrivKey(bytes.Clone(private)), config.PrivValidatorKeyFile(), config.PrivValidatorStateFile())
		pv.Save()
		nodeKey := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
		if err := nodeKey.SaveAs(config.NodeKeyFile()); err != nil {
			t.Fatal(err)
		}
		key, material, err := ynxconsensusauth.GenerateCandidateKeyMaterial()
		if err != nil {
			t.Fatal(err)
		}
		item := &pqNetworkE2ENode{config: config, legacy: private, address: bytes.Clone(address[:20]), nodeKey: nodeKey, pqKey: key, material: material, appPath: filepath.Join(root, "data", "application.json"), vaultPath: filepath.Join(root, "data", "validator-pq.encrypted")}
		item.keyBytes = pqNetworkE2ERead(t, config.PrivValidatorKeyFile())
		item.nodeBytes = pqNetworkE2ERead(t, config.NodeKeyFile())
		n.nodes = append(n.nodes, item)
		t.Cleanup(func() { key.Destroy(); material.Clear(); clear(private) })
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: validator.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	if len(n.nodes) != 4 {
		t.Fatal("fixture is not exactly four original validators")
	}
	n.migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	n.doc, err = BuildCometGenesis(n.migration, time.Now().Add(-time.Minute).UTC())
	if err != nil {
		t.Fatal(err)
	}
	n.rawGenesis, err = cmtjson.Marshal(n.doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(n.rawGenesis)
	n.bootstrap, err = NewConsensusBootstrap(n.rawGenesis, ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: n.migration.OriginalGenesisHash, MigrationStateHash: n.migration.StateHash}, n.migration)
	if err != nil {
		t.Fatal(err)
	}
	n.nativeGenesis, err = hex.DecodeString(n.migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	for i, item := range n.nodes {
		if err := os.WriteFile(item.config.GenesisFile(), n.rawGenesis, 0600); err != nil {
			t.Fatal(err)
		}
		var peers []string
		for j, other := range n.nodes {
			if i != j {
				peers = append(peers, string(other.nodeKey.ID())+"@"+strings.TrimPrefix(other.config.P2P.ListenAddress, "tcp://"))
			}
		}
		item.config.P2P.PersistentPeers = strings.Join(peers, ",")
		if err := item.config.ValidateBasic(); err != nil {
			t.Fatal(err)
		}
	}
	return n
}

func (n *pqNetworkE2E) startLegacy() {
	n.t.Helper()
	for _, item := range n.nodes {
		app, err := NewPersistentApplicationWithBootstrap(n.migration, item.appPath, n.bootstrap)
		if err != nil {
			n.t.Fatal(err)
		}
		item.app = app
		pv := privval.LoadFilePV(item.config.PrivValidatorKeyFile(), item.config.PrivValidatorStateFile())
		item.node, err = node.NewNodeWithConsensusAuthority(item.config, pv, item.nodeKey, proxy.NewLocalClientCreator(app), func() (*cmttypes.GenesisDoc, error) {
			var doc cmttypes.GenesisDoc
			err := cmtjson.Unmarshal(n.rawGenesis, &doc)
			return &doc, err
		}, cfg.DefaultDBProvider, node.DefaultMetricsProvider(item.config.Instrumentation), log.NewNopLogger(), app)
		if err != nil {
			n.t.Fatalf("normal Ed node constructor: %v", err)
		}
		if item.node.BlockStore().Height() != 0 {
			n.t.Fatal("fresh node invented pre-existing Comet blocks")
		}
		n.configureStore(item)
	}
	n.startConstructed(4)
}

func (n *pqNetworkE2E) configureStore(item *pqNetworkE2ENode) {
	env, err := item.node.ConfigureRPC()
	if err != nil {
		n.t.Fatal(err)
	}
	item.store = env.StateStore
}

func (n *pqNetworkE2E) constructPQ(item *pqNetworkE2ENode, initial bool) {
	n.t.Helper()
	if item.node != nil {
		n.t.Fatal("PQ construction would replace a live original node")
	}
	app, err := NewPersistentApplicationWithEngineAuthorization(n.migration, item.appPath, n.bootstrap, n.authorization)
	if err != nil {
		n.t.Fatalf("normal pinned application restart: %v", err)
	}
	item.app = app
	registry, err := NewPQCommittedSignerRegistry(app, n.bootstrap)
	if err != nil {
		n.t.Fatal(err)
	}
	if initial {
		item.binding = ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(n.bootstrap.genesisID), ChainID: n.doc.ChainID, ActivationHeight: n.schedule.ActivationHeight}, ValidatorAddress: bytes.Clone(item.address), Epoch: 1, MLDSA87PublicKey: bytes.Clone(item.material.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(item.material.PublicB), SignerStatePath: filepath.Join(item.config.RootDir, "data", "pq-sign-state.json")}
		signer, err := ynxconsensusauth.CreateSigner(item.binding.SignerStatePath, item.pqKey, item.binding.Policy, registry, item.address, 1)
		if err != nil {
			n.t.Fatalf("new epoch durable signer: %v", err)
		}
		if err := signer.Close(); err != nil {
			n.t.Fatal(err)
		}
		item.credential, err = ynxconsensusauth.GenerateHostRecoveryCredential()
		if err != nil {
			n.t.Fatal(err)
		}
		n.t.Cleanup(func() { clear(item.credential) })
		vault, err := ynxconsensusauth.SealHostKeyEnvelope(item.material, item.binding, item.credential)
		if err != nil {
			n.t.Fatal(err)
		}
		if err := os.WriteFile(item.vaultPath, vault, 0600); err != nil {
			n.t.Fatal(err)
		}
		item.material.Clear()
		item.pqKey.Destroy()
	}
	beforePQ := pqNetworkE2ERead(n.t, item.binding.SignerStatePath)
	beforeLegacy := pqNetworkE2ERead(n.t, item.config.PrivValidatorStateFile())
	item.host, err = ynxconsensusauth.ResumeHostSigner(item.vaultPath, item.credential, item.binding, registry)
	if err != nil {
		n.t.Fatalf("normal host signer recovery: %v", err)
	}
	signer, err := item.host.Signer()
	if err != nil {
		n.t.Fatal(err)
	}
	pv := privval.LoadFilePV(item.config.PrivValidatorKeyFile(), item.config.PrivValidatorStateFile())
	nodeKey, err := p2p.LoadNodeKey(item.config.NodeKeyFile())
	if err != nil {
		n.t.Fatal(err)
	}
	item.node, err = NewPQConsensusNode(item.config, app, pv, signer, nodeKey, log.NewNopLogger())
	if err != nil {
		n.t.Fatalf("normal PQ factory over original BlockStore/HRS: %v", err)
	}
	if !bytes.Equal(item.keyBytes, pqNetworkE2ERead(n.t, item.config.PrivValidatorKeyFile())) || !bytes.Equal(item.nodeBytes, pqNetworkE2ERead(n.t, item.config.NodeKeyFile())) || !bytes.Equal(beforeLegacy, pqNetworkE2ERead(n.t, item.config.PrivValidatorStateFile())) || !bytes.Equal(beforePQ, pqNetworkE2ERead(n.t, item.binding.SignerStatePath)) {
		n.t.Fatal("normal recovery replaced original validator/P2P identity or HRS")
	}
	app.mu.RLock()
	height := app.committed.Height
	app.mu.RUnlock()
	if item.node.BlockStore().Height() != height {
		n.t.Fatal("restart has application height without original matching Comet BlockStore")
	}
	n.configureStore(item)
}

func (n *pqNetworkE2E) startConstructed(count int) {
	n.t.Helper()
	for i := 0; i < count; i++ {
		if !n.nodes[i].node.IsRunning() {
			if err := n.nodes[i].node.Start(); err != nil {
				n.t.Fatalf("real Node.Start %d: %v", i, err)
			}
		}
	}
	n.wait("real peer mesh", func() bool {
		for i := 0; i < count; i++ {
			if n.nodes[i].node.Switch().Peers().Size() < count-1 {
				return false
			}
		}
		return true
	})
}

func (n *pqNetworkE2E) stop(index int) {
	item := n.nodes[index]
	var historyErr error
	if item.node != nil {
		if item.node.IsRunning() {
			if err := item.node.Stop(); err != nil {
				n.t.Errorf("normal Node.Stop %d: %v", index, err)
			}
			item.node.Wait()
		} else {
			item.node.OnStop()
		}
		_ = item.node.ProxyApp().Stop()
		item.node = nil
		item.store = nil
		historyErr = n.verifyStoppedSigningHistory(item)
	}
	if item.host != nil {
		if err := item.host.Close(); err != nil {
			n.t.Errorf("close original signer: %v", err)
		}
		item.host = nil
	}
	if historyErr != nil {
		n.t.Errorf("validator %d original signing history: %v", index, historyErr)
	}
}

// Read only this isolated fixture's original anti-equivocation files after
// Node.Stop. No private-key file is decoded here, and no H/R/S is reset or
// synthesized. ResumeHostSigner below independently verifies the full record.
func (n *pqNetworkE2E) verifyStoppedSigningHistory(item *pqNetworkE2ENode) error {
	n.t.Helper()
	var legacy privval.FilePVLastSignState
	raw, err := os.ReadFile(item.config.PrivValidatorStateFile())
	if err != nil {
		return err
	}
	if err := cmtjson.Unmarshal(raw, &legacy); err != nil {
		return fmt.Errorf("read original FilePV history after stop: %w", err)
	}
	current := pqNetworkE2EHRS{height: legacy.Height, round: legacy.Round, step: uint32(legacy.Step)}
	if current.before(item.lastLegacyHRS) || legacy.Height < item.legacySignedHeight || legacy.Height > 0 && (legacy.Round < 0 || legacy.Step < 1 || legacy.Step > 3 || len(legacy.Signature) != ed25519.SignatureSize || len(legacy.SignBytes) == 0) {
		return fmt.Errorf("original FilePV history regressed or lost an actual consensus signature")
	}
	item.lastLegacyHRS = current
	if item.binding.SignerStatePath == "" {
		return nil
	}
	var pq struct {
		Version   string                `json:"version"`
		Height    int64                 `json:"height"`
		Round     int32                 `json:"round"`
		Kind      ynxconsensusauth.Kind `json:"kind"`
		Message   []byte                `json:"message"`
		Signature []byte                `json:"signature"`
	}
	raw, err = os.ReadFile(item.binding.SignerStatePath)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, &pq); err != nil {
		return fmt.Errorf("read original PQ history after stop: %w", err)
	}
	current = pqNetworkE2EHRS{height: pq.Height, round: pq.Round, step: uint32(pq.Kind)}
	if pq.Version != "YNX-CONSENSUS-SIGNER/v2" || current.before(item.lastPQHRS) || pq.Height < item.pqSignedHeight || pq.Height > 0 && (pq.Round < 0 || pq.Kind < ynxconsensusauth.Proposal || pq.Kind > ynxconsensusauth.VoteExtension || len(pq.Message) == 0 || len(pq.Signature) <= 64) {
		return fmt.Errorf("original PQ H/R/S regressed or lost an actual consensus signature")
	}
	item.lastPQHRS = current
	return nil
}
func (n *pqNetworkE2E) stopAll() {
	for i := range n.nodes {
		n.stop(i)
	}
}
func (n *pqNetworkE2E) nodeForAddress(address []byte) *pqNetworkE2ENode {
	for _, item := range n.nodes {
		if bytes.Equal(item.address, address) {
			return item
		}
	}
	n.t.Fatal("original validator missing")
	return nil
}
func pqNetworkE2ERead(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (n *pqNetworkE2E) wait(stage string, ready func() bool) {
	n.t.Helper()
	deadline := time.NewTimer(15 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		if ready() {
			return
		}
		select {
		case <-n.ctx.Done():
			n.t.Fatalf("bounded network deadline at %s: %v", stage, n.ctx.Err())
		case <-deadline.C:
			n.t.Fatalf("normal network path stalled at %s (no synthetic fallback)", stage)
		case <-ticker.C:
		}
	}
}

func (n *pqNetworkE2E) quiet(count int) int64 {
	n.t.Helper()
	var height int64
	var stable time.Time
	n.wait("same committed checkpoint and idle mempools", func() bool {
		h := n.nodes[0].node.BlockStore().Height()
		if h < n.doc.InitialHeight {
			return false
		}
		if err := pqNetworkE2EBlockBudget(n.doc.InitialHeight, h, 0); err != nil {
			n.t.Fatal(err)
		}
		var expectedHash string
		for i := 0; i < count; i++ {
			item := n.nodes[i]
			item.app.mu.RLock()
			ah, hash := item.app.committed.Height, item.app.committed.AppHash
			item.app.mu.RUnlock()
			if item.node.BlockStore().Height() != h || ah != h || item.node.Mempool().Size() != 0 {
				stable = time.Time{}
				return false
			}
			if i == 0 {
				expectedHash = hash
			} else if hash != expectedHash {
				n.t.Fatal("validators committed different AppHash at identical height")
			}
		}
		if h != height || stable.IsZero() {
			height = h
			stable = time.Now()
			return false
		}
		return time.Since(stable) >= 750*time.Millisecond
	})
	n.blockHashes(count)
	return height
}

func (n *pqNetworkE2E) check(payload []byte) *abci.ResponseCheckTx {
	n.t.Helper()
	results := make(chan *abci.ResponseCheckTx, 1)
	failures := make(chan error, 1)
	pool := n.nodes[0].node.Mempool()
	go func() {
		failures <- pool.CheckTx(cmttypes.Tx(payload), func(response *abci.ResponseCheckTx) { results <- response }, mempool.TxInfo{})
	}()
	select {
	case err := <-failures:
		if err != nil {
			n.t.Fatalf("normal mempool admission: %v", err)
		}
	case <-n.ctx.Done():
		n.t.Fatal("mempool admission exceeded network deadline")
	}
	select {
	case response := <-results:
		if response == nil {
			n.t.Fatal("normal mempool returned an empty CheckTx response")
		}
		return response
	case <-n.ctx.Done():
		n.t.Fatal("normal CheckTx callback missing before deadline")
	}
	return nil
}

func (n *pqNetworkE2E) submit(payload []byte, count int) int64 {
	n.t.Helper()
	checkpoint := n.quiet(count)
	if err := pqNetworkE2EBlockBudget(n.doc.InitialHeight, checkpoint, pqNetworkE2ESubmissionBlocks); err != nil {
		n.t.Fatalf("refuse transaction before mempool admission: %v", err)
	}
	if response := n.check(payload); response.Code != 0 {
		n.t.Fatalf("normal signed mempool transaction rejected: code=%d log=%s", response.Code, response.Log)
	}
	var height int64
	n.wait("original bytes included and committed", func() bool {
		tip := n.nodes[0].node.BlockStore().Height()
		for h := n.doc.InitialHeight; h <= tip; h++ {
			block := n.nodes[0].node.BlockStore().LoadBlock(h)
			if block == nil {
				continue
			}
			for index, raw := range block.Data.Txs {
				if !bytes.Equal(raw, payload) {
					continue
				}
				for i := 0; i < count; i++ {
					item := n.nodes[i]
					other := item.node.BlockStore().LoadBlock(h)
					if other == nil || !bytes.Equal(other.Hash(), block.Hash()) {
						return false
					}
					result, err := item.store.LoadFinalizeBlockResponse(h)
					if err != nil || index >= len(result.TxResults) {
						return false
					}
					if result.TxResults[index].Code != 0 {
						n.t.Fatalf("included transaction failed execution: %s", result.TxResults[index].Log)
					}
				}
				height = h
				return true
			}
		}
		return false
	})
	n.quiet(count)
	return height
}
func (n *pqNetworkE2E) query(index int, path string, out any) {
	n.t.Helper()
	response, err := n.nodes[index].app.Query(n.ctx, &abci.RequestQuery{Path: path})
	if err != nil || response.Code != 0 {
		n.t.Fatalf("query %s: %v %+v", path, err, response)
	}
	if err := json.Unmarshal(response.Value, out); err != nil {
		n.t.Fatal(err)
	}
}
func (n *pqNetworkE2E) account(index int, address string) chain.ConsensusAccount {
	var out chain.ConsensusAccount
	n.query(index, "/accounts/"+address, &out)
	return out
}

func (n *pqNetworkE2E) traceInventory(index int) map[string]chain.TrustTraceLot {
	n.t.Helper()
	item := n.nodes[index]
	item.app.mu.RLock()
	defer item.app.mu.RUnlock()
	return cloneTraceLots(item.app.committed.TraceLots)
}

func (n *pqNetworkE2E) verifyNativeReceipt(payload []byte, height int64, from, to string, amount, fee int64, count int) {
	n.t.Helper()
	hash := SignedTransactionHash(payload)
	for i := 0; i < count; i++ {
		item := n.nodes[i]
		block := item.node.BlockStore().LoadBlock(height)
		if block == nil {
			n.t.Fatal("native receipt has no original Comet block")
		}
		want := BFTNativeTransfer{TransactionHash: hash, From: from, To: to, Amount: amount, Fee: fee, BlockHeight: height, CommittedAt: block.Time.UTC()}
		item.app.mu.RLock()
		receipts := append([]BFTNativeTransfer(nil), item.app.committed.NativeTransfers...)
		item.app.mu.RUnlock()
		matched := 0
		previous := ""
		for _, receipt := range receipts {
			if receipt.TransactionHash <= previous {
				n.t.Fatal("actual network receipts are duplicated or unsorted")
			}
			previous = receipt.TransactionHash
			if receipt.TransactionHash == hash {
				matched++
				if !reflect.DeepEqual(receipt, want) {
					n.t.Fatal("actual receipt differs from the signed transfer or original block time")
				}
			}
		}
		if matched != 1 {
			n.t.Fatal("actual signed native transfer did not retain exactly one complete receipt")
		}
	}
}

func (n *pqNetworkE2E) verifyTransferTrace(before map[string]chain.TrustTraceLot, senderBefore, senderAfter chain.ConsensusAccount, hash string, count int) {
	n.t.Helper()
	changed := 0
	for i := 0; i < count; i++ {
		after := n.traceInventory(i)
		if len(after) != len(before) {
			n.t.Fatal("actual PQ transfer changed the original trace inventory")
		}
		for id, original := range before {
			expected := original
			if senderAfter.Lots[id] < senderBefore.Lots[id] {
				expected.LastInbound = hash
				if i == 0 {
					changed++
				}
			}
			if current, ok := after[id]; !ok || !reflect.DeepEqual(current, expected) {
				n.t.Fatal("actual PQ transfer did not preserve and update the exact original trace lineage")
			}
		}
	}
	if changed == 0 {
		n.t.Fatal("PQ transfer fixture never moved a real original trace lot")
	}
}
func (n *pqNetworkE2E) classicTransfer(key *secp256k1.PrivateKey, to string, amount int64) []byte {
	n.t.Helper()
	from := mustNativeAddress(n.t, key)
	signed, err := NewSignedTransfer(key, 6423, to, amount, n.account(0, from).Nonce+1)
	if err != nil {
		n.t.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(signed)
	if err != nil {
		n.t.Fatal(err)
	}
	return raw
}
func (n *pqNetworkE2E) driveThrough(height int64, count int) {
	n.t.Helper()
	for step := 0; step < 8; step++ {
		checkpoint := n.quiet(count)
		if checkpoint >= height {
			return
		}
		if err := pqNetworkE2EBlockBudget(n.doc.InitialHeight, checkpoint, pqNetworkE2ESubmissionBlocks); err != nil {
			n.t.Fatalf("refuse P/U/A driver transaction before signing: %v", err)
		}
		n.submit(n.classicTransfer(n.recipientKey, n.owner, 1), count)
	}
	n.t.Fatal("P/U/A did not advance within bounded genuine transaction budget")
}

func (n *pqNetworkE2E) business() []byte {
	n.t.Helper()
	var expected []byte
	for _, item := range n.nodes {
		if item.app == nil {
			continue
		}
		item.app.mu.RLock()
		s := item.app.committed
		// Height alone may advance in an otherwise empty proof block. Retain
		// every execution field, complete source history, and actual AppHash.
		s.Height = 0
		raw, err := json.Marshal(s)
		item.app.mu.RUnlock()
		if err != nil {
			n.t.Fatal(err)
		}
		if expected == nil {
			expected = raw
		} else if !bytes.Equal(expected, raw) {
			n.t.Fatal("normal replicas disagree on complete business history")
		}
	}
	return expected
}

func (n *pqNetworkE2E) blockHashes(count int) map[int64][]byte {
	n.t.Helper()
	tip := n.nodes[0].node.BlockStore().Height()
	for height := n.doc.InitialHeight; height <= tip; height++ {
		first := n.nodes[0].node.BlockStore().LoadBlockMeta(height)
		if first == nil {
			n.t.Fatal("original block metadata missing")
		}
		for i := 1; i < count; i++ {
			other := n.nodes[i].node.BlockStore().LoadBlockMeta(height)
			if other == nil || !bytes.Equal(first.BlockID.Hash, other.BlockID.Hash) {
				n.t.Fatal("replicas disagree on original block hash")
			}
		}
		if old := n.seen[height]; old != nil && !bytes.Equal(old, first.BlockID.Hash) {
			n.t.Fatal("previously committed network block changed")
		}
		n.seen[height] = bytes.Clone(first.BlockID.Hash)
	}
	out := make(map[int64][]byte, len(n.seen))
	for height, hash := range n.seen {
		out[height] = bytes.Clone(hash)
	}
	return out
}

func (n *pqNetworkE2E) verifyCommit(height int64, pq bool, count int, exactThree bool) {
	n.t.Helper()
	var expected []byte
	for i := 0; i < count; i++ {
		item := n.nodes[i]
		block := item.node.BlockStore().LoadBlock(height)
		commit := item.node.BlockStore().LoadSeenCommit(height)
		set, err := item.store.LoadValidators(height)
		if err != nil || block == nil || commit == nil || set == nil {
			n.t.Fatalf("actual block/commit/validator history missing at %d: %v", height, err)
		}
		if len(set.Validators) != 4 || set.TotalVotingPower() != 4 {
			n.t.Fatal("original four-validator voting power changed")
		}
		if expected == nil {
			expected = bytes.Clone(set.Hash())
		} else if !bytes.Equal(expected, set.Hash()) {
			n.t.Fatal("replicas disagree on actual validator set")
		}
		if err := set.VerifyCommit(n.doc.ChainID, commit.BlockID, height, commit); err != nil {
			n.t.Fatalf("real Comet Commit fails full validator verification: %v", err)
		}
		if !bytes.Equal(commit.BlockID.Hash, block.Hash()) {
			n.t.Fatal("Commit does not bind its actual block")
		}
		signed := 0
		for index, sig := range commit.Signatures {
			if sig.BlockIDFlag != cmttypes.BlockIDFlagCommit {
				continue
			}
			signed++
			signer := n.nodeForAddress(sig.ValidatorAddress)
			key := set.Validators[index].PubKey
			if pq {
				if key.Type() != ynxpq.KeyType || len(sig.Signature) <= 64 {
					n.t.Fatal("activated commit used legacy/placeholder signatures")
				}
				if height > signer.pqSignedHeight {
					signer.pqSignedHeight = height
				}
			} else if key.Type() != cmted.KeyType || len(sig.Signature) != ed25519.SignatureSize {
				n.t.Fatal("pre-activation commit lost original Ed25519 signature profile")
			} else if height > signer.legacySignedHeight {
				signer.legacySignedHeight = height
			}
		}
		if signed < 3 || (exactThree && signed != 3) {
			n.t.Fatalf("strict >2/3 quorum missing: %d/4", signed)
		}
		if pq && i == 0 {
			two := commit.Clone()
			kept := 0
			for index, sig := range two.Signatures {
				if sig.BlockIDFlag == cmttypes.BlockIDFlagCommit && kept < 2 {
					kept++
					continue
				}
				two.Signatures[index] = cmttypes.NewCommitSigAbsent()
			}
			if err := set.VerifyCommit(n.doc.ChainID, two.BlockID, height, two); err == nil {
				n.t.Fatal("two genuine PQ signatures incorrectly finalized a four-validator block")
			}
		}
	}
}

func (n *pqNetworkE2E) verifyTransition() {
	n.t.Helper()
	s := n.schedule
	profile, err := s.ProfileBytes()
	if err != nil {
		n.t.Fatal(err)
	}
	for _, item := range n.nodes {
		p, err := item.store.LoadFinalizeBlockResponse(s.ParamsUpdateHeight)
		if err != nil || p.ConsensusParamUpdates == nil || !bytes.Equal(p.ConsensusParamUpdates.YnxProfile, profile) {
			n.t.Fatalf("real P block did not emit exact independently pinned profile: %v", err)
		}
		beforeParams, err := item.store.LoadConsensusParams(s.ParamsUpdateHeight)
		if err != nil || len(beforeParams.YNXProfile) != 0 {
			n.t.Fatalf("profile took effect before its real P+1 boundary: %v", err)
		}
		afterParams, err := item.store.LoadConsensusParams(s.ParamsUpdateHeight + 1)
		if err != nil || !bytes.Equal(afterParams.YNXProfile, profile) {
			n.t.Fatalf("real P+1 state lost the exact pinned profile: %v", err)
		}
		u, err := item.store.LoadFinalizeBlockResponse(s.ValidatorUpdateHeight)
		if err != nil || len(u.ValidatorUpdates) != 4 {
			n.t.Fatalf("real U block did not emit four original validator replacements: %v", err)
		}
		pre, err := item.store.LoadValidators(s.ActivationHeight - 1)
		if err != nil {
			n.t.Fatal(err)
		}
		active, err := item.store.LoadValidators(s.ActivationHeight)
		if err != nil {
			n.t.Fatal(err)
		}
		if hex.EncodeToString(pre.Hash()) != s.OriginalValidatorSetHash || hex.EncodeToString(active.Hash()) != s.ActivationValidatorSetHash {
			n.t.Fatal("actual H+2 membership activation differs from independent pins")
		}
		item.app.mu.RLock()
		same := reflect.DeepEqual(item.app.committed.PQEngineSchedule, s)
		item.app.mu.RUnlock()
		if !same {
			n.t.Fatal("committed engine schedule changed")
		}
	}
}

func (n *pqNetworkE2E) rejectOldConsensusCommit(height int64) {
	n.t.Helper()
	item := n.nodes[0]
	original := item.node.BlockStore().LoadSeenCommit(height)
	set, err := item.store.LoadValidators(height)
	if err != nil {
		n.t.Fatal(err)
	}
	forged := original.Clone()
	for index, sig := range forged.Signatures {
		if sig.BlockIDFlag != cmttypes.BlockIDFlagCommit {
			continue
		}
		vote := forged.GetVote(int32(index)).ToProto()
		private := n.nodeForAddress(sig.ValidatorAddress).legacy
		forged.Signatures[index].Signature = ed25519.Sign(private, cmttypes.VoteSignBytes(n.doc.ChainID, vote))
	}
	if err := set.VerifyCommit(n.doc.ChainID, forged.BlockID, height, forged); err == nil {
		n.t.Fatal("post-activation Commit accepted original Ed25519-only signatures")
	}
}
