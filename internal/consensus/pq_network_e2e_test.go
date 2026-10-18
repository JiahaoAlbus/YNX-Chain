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
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
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
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/syndtr/goleveldb/leveldb/opt"
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

// These strings own the qualified bytes. The running network never rereads a
// mutable artifact path after this preflight has succeeded.
type pqNetworkContractFixture struct {
	source, bytecode string
}

func loadPQNetworkContractFixture(sourcePath, artifactPath string) (pqNetworkContractFixture, error) {
	read := func(path string) ([]byte, error) {
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		const maximum = 1 << 20
		raw, readErr := io.ReadAll(io.LimitReader(file, maximum+1))
		closeErr := file.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if len(raw) > maximum {
			return nil, fmt.Errorf("network contract input exceeds %d bytes", maximum)
		}
		return raw, nil
	}
	source, err := read(sourcePath)
	if err != nil {
		return pqNetworkContractFixture{}, fmt.Errorf("read original source: %w", err)
	}
	raw, err := read(artifactPath)
	if err != nil {
		return pqNetworkContractFixture{}, fmt.Errorf("read compiled artifact: %w", err)
	}
	var artifact struct {
		DeployedBytecode string `json:"deployedBytecode"`
	}
	if err := json.Unmarshal(raw, &artifact); err != nil {
		return pqNetworkContractFixture{}, fmt.Errorf("decode compiled artifact: %w", err)
	}
	fixture := pqNetworkContractFixture{source: strings.TrimSpace(string(source)), bytecode: strings.ToLower(strings.TrimSpace(artifact.DeployedBytecode))}
	if _, _, err := chain.ValidateBoundedPinnedContract("SampleEVMWriteCounter", fixture.source, fixture.bytecode); err != nil {
		return pqNetworkContractFixture{}, fmt.Errorf("qualify compiled contract: %w", err)
	}
	return fixture, nil
}

// Ordinary CI runs this without an opt-in, a Node constructor or Node.Start.
// The positive uses the same actual compiler output required by the network;
// negative copies cannot manufacture an accepting artifact or skip pin checks.
func TestPQNetworkContractFixturePreflight(t *testing.T) {
	sourcePath := filepath.Join("..", "..", "contracts", "devtools", "SampleEVMWriteCounter.sol")
	artifactPath := filepath.Join("..", "..", "artifacts", "contracts", "devtools", "SampleEVMWriteCounter.sol", "SampleEVMWriteCounter.json")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatal(err)
	}
	qualified, err := loadPQNetworkContractFixture(sourcePath, artifactPath)
	if err != nil || qualified.source != strings.TrimSpace(string(source)) || qualified.bytecode == "" {
		t.Fatalf("actual compiled fixture failed preflight: %v", err)
	}
	partialArtifact := bytes.TrimSpace(artifact)
	partialArtifact = partialArtifact[:len(partialArtifact)-1]
	if json.Valid(partialArtifact) {
		t.Fatal("truncated artifact counterexample is still valid JSON")
	}
	mutateBytecode := func(value string) []byte {
		t.Helper()
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(artifact, &fields); err != nil {
			t.Fatal(err)
		}
		fields["deployedBytecode"], err = json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(fields)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	for _, test := range []struct {
		name                string
		source, artifact    []byte
		missing, errorMatch string
	}{
		{"missing source", source, artifact, "source", "read original source"},
		{"missing artifact", source, artifact, "artifact", "read compiled artifact"},
		{"invalid artifact JSON", source, partialArtifact, "", "decode compiled artifact"},
		{"missing compiled bytecode", source, mutateBytecode(""), "", "qualify compiled contract"},
		{"noncompiled bytecode", source, mutateBytecode("0x6000"), "", "qualify compiled contract"},
		{"changed compiled bytecode", source, mutateBytecode(qualified.bytecode + "00"), "", "qualify compiled contract"},
		{"changed source", append(bytes.Clone(source), []byte("\n// not the pinned source\n")...), artifact, "", "qualify compiled contract"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			paths := map[string]string{"source": filepath.Join(root, "source.sol"), "artifact": filepath.Join(root, "artifact.json")}
			originals := map[string][]byte{"source": test.source, "artifact": test.artifact}
			for name, raw := range originals {
				if name != test.missing {
					if err := os.WriteFile(paths[name], raw, 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			got, err := loadPQNetworkContractFixture(paths["source"], paths["artifact"])
			if err == nil || !strings.Contains(err.Error(), test.errorMatch) || got != (pqNetworkContractFixture{}) {
				t.Fatalf("invalid network input escaped pre-Node preflight: fixture=%#v err=%v", got, err)
			}
			if test.missing != "" && !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("missing input did not preserve its actual file error: %v", err)
			}
			for name, original := range originals {
				raw, err := os.ReadFile(paths[name])
				if name == test.missing {
					if !os.IsNotExist(err) {
						t.Fatal("preflight created an absent input", name, err)
					}
				} else if err != nil || !bytes.Equal(raw, original) {
					t.Fatal("preflight changed original input", name, err)
				}
			}
		})
	}
	// Replacement after capture cannot silently change the bytes later passed
	// to the real deploy transaction. A fresh load must still reject it.
	root := t.TempDir()
	copiedSource, copiedArtifact := filepath.Join(root, "source.sol"), filepath.Join(root, "artifact.json")
	for path, raw := range map[string][]byte{copiedSource: source, copiedArtifact: artifact} {
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	held, err := loadPQNetworkContractFixture(copiedSource, copiedArtifact)
	if err != nil || held != qualified {
		t.Fatal("copy of actual compiled input changed qualification", err)
	}
	if err := os.WriteFile(copiedArtifact, mutateBytecode("0x6000"), 0600); err != nil {
		t.Fatal(err)
	}
	if held != qualified {
		t.Fatal("captured immutable compiled inputs changed after path replacement")
	}
	if _, err := loadPQNetworkContractFixture(copiedSource, copiedArtifact); err == nil {
		t.Fatal("fresh preflight accepted replaced noncompiled input")
	}
	for path, original := range map[string][]byte{sourcePath: source, artifactPath: artifact} {
		raw, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(raw, original) {
			t.Fatal("original compiler materials changed", path, err)
		}
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
	if os.Getenv("YNX_PQ_NETWORK_REMOTE_E2E") != "" {
		t.Fatal("local and remote four-node windows cannot share an invocation")
	}
	runPQNetworkFourValidatorOriginalStateTransitionAndRestart(t, nil)
}

// A custody variant changes only one validator's normal signer construction.
// It cannot supply blocks, votes, authority or application execution results.
// The Linux remote variant is kept out of the default local test invocation.
type pqNetworkE2ECustody interface {
	PrivateRoot() string
	IsRemote(*pqNetworkE2ENode) bool
	Construct(*pqNetworkE2E, *pqNetworkE2ENode)
	BeforeStop(*pqNetworkE2E, *pqNetworkE2ENode)
	AfterStop(*pqNetworkE2E, *pqNetworkE2ENode)
	Check(*pqNetworkE2E)
	ColdRestart(*pqNetworkE2E, int64) int64
	Complete(*pqNetworkE2E)
}

func runPQNetworkFourValidatorOriginalStateTransitionAndRestart(t *testing.T, custody pqNetworkE2ECustody) {
	// Compiling consensus.test does not embed Hardhat's ignored output. Qualify
	// and retain the exact inputs before creating identities, stores or nodes;
	// a missing/invalid artifact must never start network/signing activity.
	contractFixture, fixtureErr := loadPQNetworkContractFixture(
		filepath.Join("..", "..", "contracts", "devtools", "SampleEVMWriteCounter.sol"),
		filepath.Join("..", "..", "artifacts", "contracts", "devtools", "SampleEVMWriteCounter.sol", "SampleEVMWriteCounter.json"))
	if fixtureErr != nil {
		t.Fatalf("network contract fixture preflight: %v", fixtureErr)
	}
	previousProcs := runtime.GOMAXPROCS(2)
	defer runtime.GOMAXPROCS(previousProcs)
	// The isolated test process has a 120-second outer timeout. Reserve its
	// final 15 seconds for normal Node.Stop and durable signer-lock cleanup.
	ctx, cancel := context.WithTimeout(context.Background(), 105*time.Second)
	defer cancel()
	network := pqNetworkE2ENew(t, ctx, custody)
	defer network.stopAll()
	network.phase = pqNetworkPhaseLegacy
	network.startLegacy()
	network.quiet(4)
	owner, recipient := network.owner, network.recipient

	// Real Ed25519 consensus first commits ordinary user state and contract
	// execution before either account or validator migration is admitted.
	ordinary := network.classicTransfer(network.ownerKey, recipient, 9)
	ordinaryHeight := network.submit(ordinary, 4)
	network.verifyNativeReceipt(ordinary, ordinaryHeight, owner, recipient, 9, 1, 4)
	deploy := IDEContractDeployPayload{Name: "SampleEVMWriteCounter", Source: contractFixture.source, DeployedBytecode: contractFixture.bytecode, ConstructorArgs: []string{"7"}, IdempotencyKey: "network-counter-deploy"}
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

	network.phase = pqNetworkPhaseAccountMigration
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
	network.phase = pqNetworkPhaseValidatorRegistration
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
	if bytes.Equal(beforeMigration, network.business()) {
		t.Fatal("fixture never committed real migration/history changes")
	}
	// Do not use submit for the final halt-driving transaction: its successor
	// proof-block wait must never ask an exactly halted node to advance again.
	h, registry = network.haltOriginalAtCommonHeight(h, registry)
	preserved := network.business()
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
	network.phase = pqNetworkPhaseActivation
	t.Logf("independent schedule pin=%s registryHeight=%d P=%d U=%d A=%d", scheduleHash, h, schedule.ParamsUpdateHeight, schedule.ValidatorUpdateHeight, schedule.ActivationHeight)
	for _, n := range network.nodes {
		network.constructPQ(n, true)
	}
	if !bytes.Equal(preserved, network.business()) {
		t.Fatal("normal PQ construction changed original account/contract/history state")
	}
	network.startConstructed(4)
	network.driveThrough(schedule.ActivationHeight+1, 4)
	for _, item := range network.nodes {
		first := item.node.BlockStore().LoadBlock(h + 1)
		prior := item.node.BlockStore().LoadBlockMeta(h)
		if first == nil || prior == nil || !first.LastBlockID.Equals(prior.BlockID) {
			t.Fatal("new profile did not continue at H+1 from the original halted block")
		}
		if !bytes.Equal(item.haltRequest, pqNetworkE2ERead(t, item.haltControl.Path)) {
			t.Fatal("new profile removed or rewrote the original halt request")
		}
	}
	network.verifyTransition()
	network.verifyCommit(ordinaryHeight, false, 4, false)
	network.verifyCommit(schedule.ActivationHeight, true, 4, false)
	network.query(0, "/ide/contracts/"+contractAddress, &contract)
	if contract.RuntimeStorage["0x"+strings.Repeat("0", 64)] != "0x"+strings.Repeat("0", 63)+"c" {
		t.Fatal("P/U/A transition reset pre-existing contract storage")
	}

	// Three original validators must actually finalize the Wallet-format
	// Member. A fourth running validator cannot conceal a 2/3 threshold bug.
	network.phase = pqNetworkPhaseThreeOfFour
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
	network.phase = pqNetworkPhaseCatchUp
	network.constructPQ(network.nodes[3], false)
	network.startConstructed(4)
	network.quiet(4)
	network.verifyCommit(pqHeight, true, 4, false)
	network.verifyNativeReceipt(ordinary, ordinaryHeight, owner, recipient, 9, 1, 4)
	network.verifyNativeReceipt(pqPayload, pqHeight, owner, recipient, 3, 1, 4)
	beforeRestart := network.business()
	history := network.blockHashes(4)
	network.phase = pqNetworkPhaseColdRestart
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
	if network.custody != nil {
		// Preserve every original cold-restart and trace assertion before the
		// remote-only transaction proves fresh signing by the resumed daemon.
		finalHeight = network.custody.ColdRestart(network, pqHeight)
		network.verifyCommit(finalHeight, true, 4, false)
	}
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
		if !bytes.Equal(item.haltRequest, pqNetworkE2ERead(t, item.haltControl.Path)) {
			t.Fatal("final cold restart removed or rewrote the original halt request")
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
	if network.custody != nil {
		network.custody.Complete(network)
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
	consensus           pqNetworkRoundStateReader
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
	appLease            *ApplicationStateWriterLease
	legacyLease         *ApplicationStateWriterLease
	haltControl         node.HeightHaltControl
	haltRequest         []byte
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
	phase                  pqNetworkProgressPhase
	progress               pqNetworkProgressLimiter
	custody                pqNetworkE2ECustody
}

func pqNetworkE2ENew(t *testing.T, ctx context.Context, custody pqNetworkE2ECustody) *pqNetworkE2E {
	t.Helper()
	n := &pqNetworkE2E{t: t, ctx: ctx, seen: map[int64][]byte{}, custody: custody}
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
		var parent string
		if custody == nil {
			parent = t.TempDir()
		} else {
			// The remote case's original vault/HRS/UNKNOWN files are retained
			// in its guard-owned TMPDIR, never deleted by testing.TempDir.
			parent = custody.PrivateRoot()
		}
		root := filepath.Join(parent, fmt.Sprintf("validator-%d", i))
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
	// Fixed before Node.Start, independently of future request/RPC responses.
	// This public synthetic QA plan is not a production deployment approval.
	session := sha256.Sum256([]byte("YNX-SYNTHETIC-FOUR-NODE-HEIGHT-HALT-SESSION/v1"))
	publicPlan, err := json.Marshal(struct {
		Version, ChainID, GenesisSHA256, SessionID string
		SyntheticOnly                              bool
	}{"YNX-SYNTHETIC-FOUR-NODE-HEIGHT-HALT-PLAN/v1", n.doc.ChainID, hex.EncodeToString(sum[:]), hex.EncodeToString(session[:]), true})
	if err != nil {
		t.Fatal(err)
	}
	planPin := sha256.Sum256(publicPlan)
	for _, item := range n.nodes {
		item.haltControl = node.HeightHaltControl{ChainID: n.doc.ChainID, GenesisSHA256: hex.EncodeToString(sum[:]), OperatorPlanSHA256: hex.EncodeToString(planPin[:]), SessionID: hex.EncodeToString(session[:])}
		item.haltControl.Path = filepath.Join(filepath.Dir(item.appPath), "operator-height-halt-"+item.haltControl.SessionID+".json")
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
		n.acquireWriterLeases(item, true)
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
		if err := item.node.ConfigureHeightHalt(item.haltControl); err != nil {
			n.t.Fatalf("normal pre-Start height halt configuration: %v", err)
		}
	}
	n.startConstructed(4)
}

func (n *pqNetworkE2E) configureStore(item *pqNetworkE2ENode) {
	env, err := item.node.ConfigureRPC()
	if err != nil {
		n.t.Fatal(err)
	}
	item.store = env.StateStore
	// ConfigureRPC exposes the same actual State used by this Node. Its public
	// RPC interface omits GetRoundState; retain only that read-only capability,
	// never the JSON state serializer (which includes private test material).
	var ok bool
	item.consensus, ok = env.ConsensusState.(pqNetworkRoundStateReader)
	if !ok {
		n.t.Fatal("actual node consensus does not expose its round-state reader")
	}
}

func (n *pqNetworkE2E) constructPQ(item *pqNetworkE2ENode, initial bool) {
	n.t.Helper()
	if item.node != nil {
		n.t.Fatal("PQ construction would replace a live original node")
	}
	remote := n.custody != nil && n.custody.IsRemote(item)
	n.acquireWriterLeases(item, !remote)
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
	if remote {
		n.custody.Construct(n, item)
	} else {
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
	if n.custody != nil {
		n.custody.BeforeStop(n, item)
	}
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
		item.consensus = nil
		if n.custody != nil {
			n.custody.AfterStop(n, item)
		}
		historyErr = n.verifyStoppedSigningHistory(item)
	}
	if item.host != nil {
		if err := item.host.Close(); err != nil {
			n.t.Errorf("close original signer: %v", err)
		}
		item.host = nil
	}
	for _, lease := range []*ApplicationStateWriterLease{item.legacyLease, item.appLease} {
		if err := lease.Close(); err != nil {
			n.t.Errorf("close original normal writer lease: %v", err)
		}
	}
	item.legacyLease, item.appLease = nil, nil
	if historyErr != nil {
		n.t.Errorf("validator %d original signing history: %v", index, historyErr)
	}
}

func (n *pqNetworkE2E) acquireWriterLeases(item *pqNetworkE2ENode, legacy bool) {
	n.t.Helper()
	if item.appLease != nil || item.legacyLease != nil {
		n.t.Fatal("normal restart attempted to replace a live writer lease")
	}
	var err error
	item.appLease, err = AcquireApplicationStateWriterLease(item.appPath)
	if err != nil {
		n.t.Fatal(err)
	}
	if legacy {
		item.legacyLease, err = AcquireApplicationStateWriterLease(item.config.PrivValidatorStateFile())
		if err != nil {
			n.t.Fatal(err)
		}
	}
}

func (n *pqNetworkE2E) haltOriginalAtCommonHeight(height int64, originalRegistry *ValidatorRegistryState) (int64, *ValidatorRegistryState) {
	n.t.Helper()
	if originalRegistry == nil || len(originalRegistry.Events) != 4 || height > math.MaxInt64-6 {
		n.t.Fatal("common height halt requires the original complete committed registry and bounded target")
	}
	if err := pqNetworkE2EBlockBudget(n.doc.InitialHeight, height, pqNetworkE2ESubmissionBlocks); err != nil {
		n.t.Fatal(err)
	}
	// This bounded fixture disables empty blocks, unlike the production default.
	// Its actual transfer requires its own block and the following AppHash proof
	// block; this does not require unfreezing writes in a production cutover.
	// No fixed sleep claims that a watcher has armed the request.
	target := height + pqNetworkE2ESubmissionBlocks
	beforeSender, beforeRecipient := n.account(0, n.recipient), n.account(0, n.owner)
	payload := n.classicTransfer(n.recipientKey, n.owner, 1)
	request := node.HeightHaltRequest{Version: "YNX-OPERATOR-HEIGHT-HALT/v1", TargetHeight: strconv.FormatInt(target, 10), ChainID: n.doc.ChainID,
		GenesisSHA256: n.nodes[0].haltControl.GenesisSHA256, OperatorPlanSHA256: n.nodes[0].haltControl.OperatorPlanSHA256, SessionID: n.nodes[0].haltControl.SessionID}
	raw, err := json.Marshal(request)
	if err != nil {
		n.t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	requestPin := hex.EncodeToString(digest[:])
	for index, item := range n.nodes {
		item.haltRequest = bytes.Clone(raw)
		publication, err := PublishHeightHaltRequest(raw, requestPin, HeightHaltPublicationOptions{ApplicationStatePath: item.appPath, Control: item.haltControl})
		if err != nil || publication.Version != "YNX-OPERATOR-HEIGHT-HALT-PUBLISHED/v1" || !publication.Published || publication.NodeStopped || publication.Activation || publication.TargetHeight != request.TargetHeight || publication.RequestSHA256 != requestPin || publication.ControlPath != item.haltControl.Path || publication.ChainID != request.ChainID || publication.GenesisSHA256 != request.GenesisSHA256 || publication.OperatorPlanSHA256 != request.OperatorPlanSHA256 || publication.SessionID != request.SessionID {
			n.t.Fatalf("validator %d normal single height-halt publication: %v %+v", index, err, publication)
		}
	}
	if response := n.check(payload); response.Code != 0 {
		n.t.Fatalf("real halt-driving mempool transaction rejected: code=%d log=%s", response.Code, response.Log)
	}
	results := make([]node.HeightHaltResult, len(n.nodes))
	n.wait("common future-height halt checkpoint", func() bool {
		ready := true
		for index, item := range n.nodes {
			if item.node.BlockStore().Height() > target {
				n.t.Fatal("original node saved a block above the approved halt target")
			}
			select {
			case <-item.node.HeightHaltDone():
				result, err := item.node.HeightHaltResult()
				if err != nil || result.Version != "YNX-OPERATOR-HEIGHT-HALT-RESULT/v1" || !result.CheckpointSaved || result.Stopped || result.TargetHeight != request.TargetHeight || result.ControlRequestSHA256 != requestPin || result.ChainID != request.ChainID || result.GenesisSHA256 != request.GenesisSHA256 || result.OperatorPlanSHA256 != request.OperatorPlanSHA256 || result.SessionID != request.SessionID {
					n.t.Fatalf("validator %d did not reach its actual durable approved halt: %v %+v", index, err, result)
				}
				results[index] = result
			default:
				ready = false
			}
		}
		return ready
	})
	// All four complete the actual target Commit before stopping any transport.
	// This avoids removing the remaining quorum while another node saves R.
	n.verifyCommit(target, false, 4, false)
	n.verifyNativeReceipt(payload, height+1, n.recipient, n.owner, 1, 1, 4)
	afterSender, afterRecipient := n.account(0, n.recipient), n.account(0, n.owner)
	if afterSender.Balance != beforeSender.Balance-2 || afterSender.Nonce != beforeSender.Nonce+1 || afterRecipient.Balance != beforeRecipient.Balance+1 || afterRecipient.Nonce != beforeRecipient.Nonce {
		n.t.Fatal("halt-driving real transaction changed unexpected balances/nonce")
	}
	beforeStop := n.business()
	history := n.blockHashes(4)
	appBytes, legacyBytes := make([][]byte, len(n.nodes)), make([][]byte, len(n.nodes))
	finalizeBytes := make([][2][]byte, len(n.nodes))
	for index, item := range n.nodes {
		item.app.mu.RLock()
		appHeight, appHash := item.app.committed.Height, item.app.committed.AppHash
		item.app.mu.RUnlock()
		actual, err := item.store.Load()
		if err != nil || actual.LastBlockHeight != target || appHeight != target || appHash != results[index].AppHash || item.node.BlockStore().Height() != target || item.node.BlockStore().LoadBlockMeta(target+1) != nil || hex.EncodeToString(actual.LastBlockID.Hash) != results[index].BlockHash || hex.EncodeToString(actual.AppHash) != results[index].AppHash {
			n.t.Fatalf("validator %d halt result differs from actual committed stores: %v", index, err)
		}
		transactionBlock := item.node.BlockStore().LoadBlock(height + 1)
		proofBlock := item.node.BlockStore().LoadBlock(target)
		response, err := item.store.LoadFinalizeBlockResponse(height + 1)
		if err != nil || transactionBlock == nil || proofBlock == nil || response == nil || len(transactionBlock.Data.Txs) != 1 || !bytes.Equal(transactionBlock.Data.Txs[0], payload) || len(response.TxResults) != 1 || response.TxResults[0] == nil || response.TxResults[0].Code != 0 || len(proofBlock.Data.Txs) != 0 || !bytes.Equal(proofBlock.LastBlockID.Hash, transactionBlock.Hash()) || !bytes.Equal(proofBlock.AppHash, response.AppHash) {
			n.t.Fatalf("validator %d halt-driving bytes/result and successor AppHash proof differ: %v", index, err)
		}
		result := response.TxResults[0]
		if result.GasWanted != 0 || result.GasUsed != 1 || result.Log != SignedTransactionType || string(result.Data) != SignedTransactionHash(payload) || !bytes.Equal(proofBlock.LastResultsHash, cmttypes.NewResults(response.TxResults).Hash()) {
			n.t.Fatal("halt-driving original execution code/data/gas lost its genuine successor result commitment")
		}
		for offset := range finalizeBytes[index] {
			persisted, err := item.store.LoadFinalizeBlockResponse(height + 1 + int64(offset))
			if err != nil || persisted == nil || offset == 1 && len(persisted.TxResults) != 0 {
				n.t.Fatalf("halt transaction/proof Finalize result missing: %v", err)
			}
			finalizeBytes[index][offset], err = persisted.Marshal()
			if err != nil {
				n.t.Fatal(err)
			}
		}
		appBytes[index] = pqNetworkE2ERead(n.t, item.appPath)
		legacyBytes[index] = pqNetworkE2ERead(n.t, item.config.PrivValidatorStateFile())
		var signed privval.FilePVLastSignState
		if err := cmtjson.Unmarshal(legacyBytes[index], &signed); err != nil || signed.Height > target {
			n.t.Fatalf("validator %d signed beyond the halt target: %v", index, err)
		}
		if index > 0 && (results[index].BlockHash != results[0].BlockHash || results[index].AppHash != results[0].AppHash || results[index].AppVersion != results[0].AppVersion) {
			n.t.Fatal("four durable halt checkpoints differ")
		}
	}
	n.stopAll()
	if n.t.Failed() {
		n.t.Fatal("normal halted Node/Host/writer-lease shutdown did not complete")
	}
	pins := ConsensusBootstrapPins{CometGenesisSHA256: request.GenesisSHA256, OriginalGenesisHash: n.migration.OriginalGenesisHash, MigrationStateHash: n.migration.StateHash}
	var coldRegistry *ValidatorRegistryState
	for index, item := range n.nodes {
		// This is the normal read-only stopped-source callee. It opens the real
		// original Comet DB and authenticates the complete App/history under the
		// existing writer locks; no test-provided checkpoint is substituted.
		checkpoint, err := InspectOperatorCheckpoint(n.migration, n.rawGenesis, pins, OperatorCheckpointOptions{
			StatePath: item.appPath, StateLayout: "atomic-json", CometDataDirectory: item.config.DBDir(), SigningStatePath: item.config.PrivValidatorStateFile()})
		if err != nil || checkpoint.Height != target || checkpoint.AppHash != results[index].AppHash || strconv.FormatUint(checkpoint.AppVersion, 10) != results[index].AppVersion || checkpoint.RegistryRoot != originalRegistry.Root || checkpoint.RegistryEventCount != 4 || !checkpoint.ReadOnly || !checkpoint.SourceReadOnly || !checkpoint.WriterExcluded || !checkpoint.SigningWriterExcluded || !checkpoint.EngineCheckpointVerified || checkpoint.PQActivationVerified || checkpoint.CommittedScheduleHash != nil {
			n.t.Fatalf("validator %d stopped-source normal inspection: %v %+v", index, err, checkpoint)
		}
		coldRaw := pqNetworkE2ERead(n.t, item.appPath)
		if !bytes.Equal(appBytes[index], coldRaw) || !bytes.Equal(legacyBytes[index], pqNetworkE2ERead(n.t, item.config.PrivValidatorStateFile())) || !bytes.Equal(item.keyBytes, pqNetworkE2ERead(n.t, item.config.PrivValidatorKeyFile())) || !bytes.Equal(item.nodeBytes, pqNetworkE2ERead(n.t, item.config.NodeKeyFile())) || !bytes.Equal(raw, pqNetworkE2ERead(n.t, item.haltControl.Path)) || item.lastLegacyHRS.height > target {
			n.t.Fatal("normal halt/shutdown/inspection rewrote original App, keys, HRS or request")
		}
		var cold CommittedState
		if err := decodeStrictJSON(coldRaw, &cold); err != nil || cold.Height != target || !reflect.DeepEqual(cold.ValidatorRegistry, originalRegistry) {
			n.t.Fatalf("cold original registry/history differs: %v", err)
		}
		coldRegistry = cold.ValidatorRegistry
		cold.Height = 0
		business, err := json.Marshal(cold)
		if err != nil || !bytes.Equal(business, beforeStop) {
			n.t.Fatal("stopped cold read lost complete original business state", err)
		}
		func() {
			stateDatabase, err := dbm.NewGoLevelDBWithOpts("state", item.config.DBDir(), &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
			if err != nil {
				n.t.Fatal(err)
			}
			defer func() {
				if err := stateDatabase.Close(); err != nil {
					n.t.Error(err)
				}
			}()
			coldStore := sm.NewStore(stateDatabase, sm.StoreOptions{DiscardABCIResponses: false})
			for offset, expected := range finalizeBytes[index] {
				persisted, err := coldStore.LoadFinalizeBlockResponse(height + 1 + int64(offset))
				if err != nil || persisted == nil {
					n.t.Fatalf("cold original Finalize response missing: %v", err)
				}
				actual, err := persisted.Marshal()
				if err != nil || !bytes.Equal(actual, expected) {
					n.t.Fatalf("cold original complete Finalize response changed: %v", err)
				}
			}
			database, err := dbm.NewGoLevelDBWithOpts("blockstore", item.config.DBDir(), &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
			if err != nil {
				n.t.Fatal(err)
			}
			blocks := blockstore.NewBlockStore(database)
			defer func() {
				if err := blocks.Close(); err != nil {
					n.t.Error(err)
				}
			}()
			if blocks.Height() != target || blocks.LoadBlockMeta(target+1) != nil {
				n.t.Fatal("cold BlockStore crossed the approved halt boundary")
			}
			for h, hash := range history {
				meta := blocks.LoadBlockMeta(h)
				if meta == nil || !bytes.Equal(meta.BlockID.Hash, hash) {
					n.t.Fatalf("cold halt lost original block %d", h)
				}
			}
		}()
	}
	n.t.Logf("actual common height halt: target=%d requestSHA256=%s blockHash=%s appHash=%s registryRoot=%s stoppedNodes=4 originalHistoryPreserved=true", target, requestPin, results[0].BlockHash, results[0].AppHash, originalRegistry.Root)
	return target, coldRegistry
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
		if n.custody != nil {
			n.custody.Check(n)
		}
		n.observeProgress(stage)
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
