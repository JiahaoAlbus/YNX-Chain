package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/cometbft/cometbft/proxy"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const (
	pqFreshOptIn        = "authorized-fresh-four-node-business-window"
	pqFreshClientCommit = "70e7e450997a0ae77dbad5a8be3682f482c6ddd8"
	// The whole repository tree, not cmd/ynx-consensus-perf-client's subtree.
	pqFreshClientTree = "4866cc3924c060eb6a29939915d39b1c5c625607"
	pqFreshSenders    = 16
	pqFreshAccounts   = pqFreshSenders + 1
	pqFreshInFlight   = 4
	pqFreshInterval   = 500 * time.Millisecond
	pqFreshClock      = "test-process time.Now monotonic elapsed; not a cross-process or wall-clock subtraction"
	pqFreshPhaseMaxNs = int64(120 * time.Second)
)

// This is a new, explicit profile. The retained-history/contract E2E and the
// previously frozen 3f5b client profile remain unchanged. All four ELFs and all
// three test leaves are pinned before any identity, listener or node is created.
type pqFreshBuild struct {
	Version                 string                             `json:"version"`
	ProtocolCommit          string                             `json:"protocolCommit"`
	PerformanceClientCommit string                             `json:"performanceClientCommit"`
	PerformanceClientTree   string                             `json:"performanceClientTree"`
	SourceRoot              string                             `json:"sourceRoot"`
	SourceLeaves            map[string]string                  `json:"sourceLeaves"`
	Binaries                map[string]pqNetworkBusinessBinary `json:"binaries"`
}

func pqFreshBuildManifest(raw []byte, pin, commit, source, executable string) (pqFreshBuild, error) {
	var m pqFreshBuild
	if len(raw) > 64<<10 || !pqBusinessPin(pin, 32) || pqBusinessHash(raw) != pin || !pqBusinessPin(commit, 20) || pqLightUniqueJSON(raw) != nil {
		return m, errors.New("independent fresh build manifest pin required")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&m) != nil || d.Decode(new(any)) != io.EOF || m.Version != "YNX-PQ-NETWORK-FRESH-BUSINESS-BUILD/v1" || m.ProtocolCommit != commit || m.PerformanceClientCommit != pqFreshClientCommit || m.PerformanceClientTree != pqFreshClientTree || m.SourceRoot != source {
		return m, errors.New("closed normal fresh source/client identity differs")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) != 7 {
		return m, errors.New("exact fresh manifest field names required")
	}
	for _, field := range []string{"version", "protocolCommit", "performanceClientCommit", "performanceClientTree", "sourceRoot", "sourceLeaves", "binaries"} {
		if len(fields[field]) == 0 || bytes.Equal(fields[field], []byte("null")) {
			return m, errors.New("fresh manifest alias or missing field")
		}
	}
	leaves := []string{"internal/consensus/pq_network_e2e_test.go", "internal/consensus/pq_network_business_test.go", "internal/consensus/pq_network_fresh_business_test.go"}
	if len(m.SourceLeaves) != len(leaves) || len(m.Binaries) != 4 {
		return m, errors.New("exact three source/four executable allowlist required")
	}
	for _, leaf := range leaves {
		data, err := pqBusinessRead(filepath.Join(source, leaf), 256<<10)
		if err != nil || !pqBusinessPin(m.SourceLeaves[leaf], 32) || pqBusinessHash(data) != m.SourceLeaves[leaf] {
			return m, errors.New("fresh test source differs from normal build pin")
		}
	}
	var shapes map[string]map[string]json.RawMessage
	if json.Unmarshal(fields["binaries"], &shapes) != nil {
		return m, errors.New("closed executable records required")
	}
	seen := map[string]bool{}
	var total int64
	for _, name := range []string{"consensus.test", "ynx-bft-gatewayd", "ynx-consensus-perf-client", "ynx-consensus-proof-verify"} {
		p, ok := m.Binaries[name]
		shape := shapes[name]
		wanted := commit
		if name == "ynx-consensus-perf-client" {
			wanted = pqFreshClientCommit
		}
		if !ok || len(shape) != 4 || len(shape["path"]) == 0 || len(shape["sha256"]) == 0 || len(shape["commit"]) == 0 || len(shape["bytes"]) == 0 || p.Commit != wanted || seen[p.SHA256] || pqBusinessCheckBinary(p) != nil || name == "consensus.test" && p.Path != executable {
			return m, errors.New("fresh actual original executable/source differs")
		}
		seen[p.SHA256] = true
		total += p.Bytes
	}
	if total > 512<<20 {
		return m, errors.New("original bounded build budget exceeded")
	}
	return m, nil
}

type pqFreshAccount struct {
	owner   string
	key     *ynxbatch.PrivateKey
	pair    ynxbatch.PublicKey
	funding string
}

type pqFreshBirth struct {
	Owner                    string `json:"owner"`
	FundingHash              string `json:"fundingHash"`
	ABCITransactionHash      string `json:"abciTransactionHash"`
	NativeTransactionHash    string `json:"nativeTransactionHash"`
	Height                   int64  `json:"height"`
	Index                    int    `json:"index"`
	ActivationHeight         int64  `json:"activationHeight"`
	RegistrationFinalized    bool   `json:"registrationFinalized"`
	FinalizedBusinessMembers int    `json:"finalizedBusinessMembers"`
}

// Both wrappers delegate to the actual Application. The sample is captured
// synchronously before returning Commit to Comet's actual BlockExecutor, so an
// empty successor block cannot overwrite the only timing sample for a business H.
type pqFreshTraceRow struct {
	Node            int                `json:"node"`
	PID             int                `json:"pid"`
	Clock           string             `json:"clock"`
	ClockDomain     string             `json:"clockDomain"`
	Height          int64              `json:"height"`
	Transactions    int                `json:"transactions"`
	FinalizeNs      int64              `json:"finalizeNs"`
	CommitCallNs    int64              `json:"commitCallNs"`
	FinalizeStartNs int64              `json:"finalizeStartNs"`
	FinalizeEndNs   int64              `json:"finalizeEndNs"`
	CommitStartNs   int64              `json:"commitStartNs"`
	CommitEndNs     int64              `json:"commitEndNs"`
	FinalizeOK      bool               `json:"finalizeOK"`
	CommitOK        bool               `json:"commitOK"`
	ExecutionCodes  []uint32           `json:"executionCodes"`
	TimingAvailable bool               `json:"timingAvailable"`
	Persistence     CommitTimingSample `json:"persistence"`
}

type pqFreshTrace struct {
	*Application
	mu      sync.Mutex
	index   int
	initial int64
	origin  time.Time
	domain  string
	pending *pqFreshTraceRow
	rows    []pqFreshTraceRow
	failure string
}

func (p *pqFreshTrace) FinalizeBlock(ctx context.Context, request *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	if request == nil || pqNetworkE2EBlockBudget(p.initial, request.Height, 0) != nil {
		return nil, errors.New("original small-block fresh window exhausted before FinalizeBlock")
	}
	started := time.Now()
	response, err := p.Application.FinalizeBlock(ctx, request)
	ended := time.Now()
	row := pqFreshTraceRow{Node: p.index, PID: os.Getpid(), Clock: pqFreshClock, ClockDomain: p.domain, Height: request.Height, Transactions: len(request.Txs), FinalizeNs: ended.Sub(started).Nanoseconds(), FinalizeStartNs: started.Sub(p.origin).Nanoseconds(), FinalizeEndNs: ended.Sub(p.origin).Nanoseconds(), FinalizeOK: err == nil && response != nil}
	if response != nil {
		for _, result := range response.TxResults {
			if result == nil {
				row.FinalizeOK = false
				continue
			}
			row.ExecutionCodes = append(row.ExecutionCodes, result.Code)
		}
	}
	p.mu.Lock()
	if p.pending != nil {
		p.failure = "FinalizeBlock replaced an uncommitted trace height"
	}
	if !row.FinalizeOK {
		p.failure = "actual FinalizeBlock failed"
	}
	p.pending = &row
	p.mu.Unlock()
	return response, err
}

func (p *pqFreshTrace) Commit(ctx context.Context, request *abci.RequestCommit) (*abci.ResponseCommit, error) {
	started := time.Now()
	response, err := p.Application.Commit(ctx, request)
	ended := time.Now()
	sample, available := p.Application.LastCommitTiming()
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pending == nil || len(p.rows) >= int(pqNetworkE2EMaxBlocks) {
		p.failure = "Commit without its bounded original FinalizeBlock trace"
		return response, err
	}
	row := *p.pending
	p.pending = nil
	row.CommitCallNs, row.CommitOK = ended.Sub(started).Nanoseconds(), err == nil && response != nil
	row.CommitStartNs = started.Sub(p.origin).Nanoseconds()
	row.CommitEndNs = ended.Sub(p.origin).Nanoseconds()
	row.Persistence, row.TimingAvailable = sample, available
	if !available || sample.Height != row.Height || !sample.Durable || !row.FinalizeOK || !row.CommitOK || len(row.ExecutionCodes) != row.Transactions {
		p.failure = "actual Commit/Finalize/persistence height or durability differs"
	}
	p.rows = append(p.rows, row)
	return response, err
}

func (p *pqFreshTrace) snapshot() ([]pqFreshTraceRow, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	rows := append([]pqFreshTraceRow(nil), p.rows...)
	for i := range rows {
		rows[i].ExecutionCodes = append([]uint32(nil), rows[i].ExecutionCodes...)
		stages := make(map[string]int64, len(rows[i].Persistence.StagesNs))
		for k, v := range rows[i].Persistence.StagesNs {
			stages[k] = v
		}
		rows[i].Persistence.StagesNs = stages
	}
	return rows, p.failure
}

// Keep all NewPQConsensusNode/newPQNodeWithDatabase checks. The only changed
// dependency is the local ABCI client creator's observation wrapper; app itself
// still supplies the fork's authority, validator set and normal runtime rules.
func pqFreshObservedNode(config *cfg.Config, app *Application, legacy cmttypes.PrivValidator, signer *ynxconsensusauth.Signer, nodeKey *p2p.NodeKey, logger log.Logger, trace *pqFreshTrace) (*node.Node, error) {
	if config == nil || app == nil || legacy == nil || signer == nil || nodeKey == nil || nodeKey.PrivKey == nil || logger == nil || trace == nil || trace.Application != app {
		return nil, errors.New("existing app, both original identities, node key, logger and attached trace required")
	}
	if config.PrivValidatorListenAddr != "" {
		return nil, errors.New("local observed node cannot replace its supplied signer with a socket signer")
	}
	app.mu.RLock()
	bootstrap, authorization := app.bootstrap, app.pqEngineAuthorization
	app.mu.RUnlock()
	if bootstrap == nil || authorization == nil {
		return nil, errors.New("independent bootstrap and activation schedule required")
	}
	pq, err := NewPQPrivValidator(signer, app)
	if err != nil {
		return nil, err
	}
	transition, err := NewPQTransitionPrivValidator(legacy, pq, bootstrap, authorization)
	if err != nil {
		return nil, err
	}
	if err = app.ValidateNormalRuntime(); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(config.GenesisFile())
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(raw)
	if !bytes.Equal(hash[:], bootstrap.genesisID) {
		return nil, errors.New("observed node genesis differs from independent application pin")
	}
	genesis := func() (*cmttypes.GenesisDoc, error) {
		var doc cmttypes.GenesisDoc
		if err := cmtjson.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		return &doc, nil
	}
	return node.NewNodeWithConsensusAuthority(config, transition, nodeKey, proxy.NewLocalClientCreator(trace), genesis, cfg.DefaultDBProvider, node.DefaultMetricsProvider(config.Instrumentation), logger, app)
}

// Canonicalize only the public Genesis bindings. The caller's sender/account
// order and its owner-to-key/funding assignments remain unchanged.
func pqFreshEncodeInitialGenesis(raw []byte, migration chain.ConsensusMigrationState, configuration PQInitialAccountConfiguration) ([]byte, error) {
	configuration.Accounts = append([]PQInitialAccountBinding(nil), configuration.Accounts...)
	sort.Slice(configuration.Accounts, func(i, j int) bool {
		return configuration.Accounts[i].Owner < configuration.Accounts[j].Owner
	})
	return EncodePQInitialAccountGenesis(raw, migration, configuration)
}

func pqFreshNew(n *pqNetworkE2E, b *pqNetworkBusiness) []pqFreshAccount {
	t := n.t
	accounts := []pqFreshAccount{{owner: b.initial, key: b.initialKey, pair: b.initialPair}}
	for i := 0; i < pqFreshSenders; i++ {
		key, pair, err := ynxbatch.KeyGen()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(key.Destroy)
		address, err := secp256k1.GeneratePrivateKey()
		if err != nil {
			t.Fatal(err)
		}
		accounts = append(accounts, pqFreshAccount{owner: mustNativeAddress(t, address), key: key, pair: pair})
		address.Zero()
	}
	// The original helper has made no Node yet. Rebuild a fresh normal source,
	// not an old application's account map, and retain its actual Faucet anchors.
	validators := make([]chain.Validator, 4)
	bindings := make([]chain.ConsensusValidatorKeyBinding, 4)
	for i, v := range n.migration.Validators {
		validators[i] = chain.Validator{Address: v.Address, Moniker: v.Moniker, VotingPower: v.VotingPower, Active: v.Active}
		bindings[i] = chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: v.ConsensusKeyType, PublicKey: v.ConsensusPubKey, ConsensusAddress: v.ConsensusAddress}
	}
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	for _, owner := range []string{n.owner, n.recipient} {
		if _, err := d.Faucet(owner, 100_000); err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]bool{}
	for i := range accounts {
		if seen[accounts[i].owner] {
			t.Fatal("fresh account collision; do not substitute an existing account")
		}
		seen[accounts[i].owner] = true
		funding, err := d.Faucet(accounts[i].owner, 1000)
		if err != nil {
			t.Fatal(err)
		}
		accounts[i].funding = funding.Hash
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	n.migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	n.doc, err = BuildCometGenesis(n.migration, time.Now().Add(-time.Minute).UTC())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(n.doc)
	if err != nil {
		t.Fatal(err)
	}
	configuration := PQInitialAccountConfiguration{Version: PQInitialAccountsVersion, NetworkID: n.migration.OriginalGenesisHash, EnableAt: strconv.FormatUint(n.migration.AccountPolicy.EnableAt, 10), BirthFee: "0"}
	for _, account := range accounts {
		binding, err := PreparePQInitialPreparedFundingBinding(n.migration, account.owner, account.pair.PKA, account.pair.PKB, account.funding)
		if err != nil {
			t.Fatal("fresh account lacks its actual normal Faucet anchor:", err)
		}
		configuration.Accounts = append(configuration.Accounts, binding)
	}
	n.rawGenesis, err = pqFreshEncodeInitialGenesis(raw, n.migration, configuration)
	if err != nil {
		t.Fatal("actual fresh initial-account genesis encoding rejected:", err)
	}
	if err := cmtjson.Unmarshal(n.rawGenesis, n.doc); err != nil {
		t.Fatal("actual fresh initial-account genesis decoding rejected:", err)
	}
	pin := pqBusinessHash(n.rawGenesis)
	n.bootstrap, err = NewConsensusBootstrap(n.rawGenesis, ConsensusBootstrapPins{CometGenesisSHA256: pin, OriginalGenesisHash: n.migration.OriginalGenesisHash, MigrationStateHash: n.migration.StateHash}, n.migration)
	if err != nil {
		t.Fatal(err)
	}
	n.nativeGenesis, err = hex.DecodeString(n.migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	// Same synthetic pre-Start height-halt producer as the existing harness.
	// Rebind only the not-yet-started test source's changed genesis pin.
	session := sha256.Sum256([]byte("YNX-SYNTHETIC-FOUR-NODE-HEIGHT-HALT-SESSION/v1"))
	publicPlan, err := json.Marshal(struct {
		Version, ChainID, GenesisSHA256, SessionID string
		SyntheticOnly                              bool
	}{"YNX-SYNTHETIC-FOUR-NODE-HEIGHT-HALT-PLAN/v1", n.doc.ChainID, pin, hex.EncodeToString(session[:]), true})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range n.nodes {
		if item.node != nil || item.app != nil || item.host != nil || item.binding.SignerStatePath != "" {
			t.Fatal("fresh source may only be selected before original node construction")
		}
		item.haltControl.GenesisSHA256 = pin
		item.haltControl.OperatorPlanSHA256 = pqBusinessHash(publicPlan)
		if err := os.WriteFile(item.config.GenesisFile(), n.rawGenesis, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return accounts
}

// This bounded progress stream is retained even when the enclosing process
// deadline interrupts a later phase. It contains coordinator-clock DATA only,
// never keys, transaction bytes, inferred completion or a new timeout budget.
func pqFreshStage(t *testing.T, origin time.Time, arm, phase string, node, index int) func() {
	t.Helper()
	started := time.Now()
	t.Logf("PQ_NETWORK_FRESH_PROGRESS arm=%s phase=%s node=%d index=%d event=begin offsetNs=%d durationNs=0", arm, phase, node, index, started.Sub(origin).Nanoseconds())
	return func() {
		t.Helper()
		ended := time.Now()
		t.Logf("PQ_NETWORK_FRESH_PROGRESS arm=%s phase=%s node=%d index=%d event=complete offsetNs=%d durationNs=%d", arm, phase, node, index, ended.Sub(origin).Nanoseconds(), ended.Sub(started).Nanoseconds())
	}
}

// Many distinct transactions can share a committed block. Verify each actual
// block and its successor once per immutable evidence set, without changing
// transaction order, per-account checks or any independent transaction proof.
// This is a bounded local plan, not a cross-commit authentication cache.
func pqFreshCommitHeightPlan(initial int64, heights []int64) ([]int64, error) {
	if len(heights) == 0 || len(heights) > pqFreshAccounts {
		return nil, errors.New("bounded nonempty fresh transaction heights required")
	}
	seen := make(map[int64]bool, 2*len(heights))
	for _, height := range heights {
		if height == 1<<63-1 {
			return nil, errors.New("fresh successor height would overflow")
		}
		if err := pqNetworkE2EBlockBudget(initial, height, 1); err != nil {
			return nil, err
		}
		seen[height], seen[height+1] = true, true
	}
	plan := make([]int64, 0, len(seen))
	for height := range seen {
		plan = append(plan, height)
	}
	sort.Slice(plan, func(i, j int) bool { return plan[i] < plan[j] })
	return plan, nil
}

func pqFreshVerifyCommits(n *pqNetworkE2E, heights []int64) {
	n.t.Helper()
	plan, err := pqFreshCommitHeightPlan(n.doc.InitialHeight, heights)
	if err != nil {
		n.t.Fatal("original block/successor evidence plan refused:", err)
	}
	for _, height := range plan {
		// Keep all four replicas, real validator sets, complete AND signatures,
		// strict >2/3 and the two-signature rejection in the original helper.
		n.verifyCommit(height, true, 4, false)
	}
}

func pqFreshActivate(n *pqNetworkE2E, origin time.Time, domain, arm string) []*pqFreshTrace {
	t := n.t
	n.phase = pqNetworkPhaseLegacy
	finish := pqFreshStage(t, origin, arm, "legacy-start", -1, -1)
	n.startLegacy()
	finish()
	n.phase = pqNetworkPhaseValidatorRegistration
	for i, member := range n.bootstrap.record.Members {
		finish = pqFreshStage(t, origin, arm, "validator-registration", i, -1)
		h := n.quiet(4)
		item := n.nodeForAddress(member.Address)
		intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(n.bootstrap.genesisID), ChainID: n.doc.ChainID, ValidatorAddress: bytes.Clone(member.Address), Sequence: 1, Epoch: 1, ApprovedAt: h + 1, EffectiveAt: h + 3, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.Ed25519), MLDSA87PublicKey: bytes.Clone(item.material.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(item.material.PublicB)}
		approval, err := intent.AuthoritySigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		a, b, err := item.pqKey.RegistrationPossession(intent)
		if err != nil {
			t.Fatal(err)
		}
		wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(item.legacy, approval), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		payload, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		if got := n.submit(payload, 4); got != h+1 {
			t.Fatalf("fresh validator %d approval executed at %d, signed for %d", i, got, h+1)
		}
		finish()
	}
	finish = pqFreshStage(t, origin, arm, "original-height-halt", -1, -1)
	h := n.quiet(4)
	var registry *ValidatorRegistryState
	n.query(0, "/validator-registry", &registry)
	if registry == nil || len(registry.Events) != 4 {
		t.Fatal("fresh four-validator original Ed approvals/dual possession did not commit")
	}
	h, registry = n.haltOriginalAtCommonHeight(h, registry)
	finish()
	finish = pqFreshStage(t, origin, arm, "activation-schedule", -1, -1)
	preserved := n.business()
	schedule, err := NewPQEngineSchedule(n.bootstrap, registry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	pin, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	n.authorization, err = NewPQEngineAuthorization(raw, pin)
	if err != nil {
		t.Fatal(err)
	}
	n.schedule, n.phase = schedule, pqNetworkPhaseActivation
	finish()
	// Attach the observer to the first normal PQ construction. Constructing four
	// unstarted nodes merely to close and construct them again repeats the same
	// cold application, vault recovery and handshake without adding a restart.
	// The original legacy nodes have already stopped and passed their independent
	// cold checkpoint/history checks above; all custody and node checks below are
	// the unchanged normal operations on those same original files and identities.
	traces := make([]*pqFreshTrace, 4)
	for i, item := range n.nodes {
		finish = pqFreshStage(t, origin, arm, "observed-pq-construction", i, -1)
		if item.node != nil {
			t.Fatal("observed PQ construction would replace a live original node")
		}
		n.acquireWriterLeases(item, true)
		app, err := NewPersistentApplicationWithEngineAuthorization(n.migration, item.appPath, n.bootstrap, n.authorization)
		if err != nil {
			t.Fatal(err)
		}
		item.app = app
		committed, err := NewPQCommittedSignerRegistry(app, n.bootstrap)
		if err != nil {
			t.Fatal(err)
		}
		finishCustody := pqFreshStage(t, origin, arm, "initial-validator-custody", i, -1)
		item.binding = ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(n.bootstrap.genesisID), ChainID: n.doc.ChainID, ActivationHeight: n.schedule.ActivationHeight}, ValidatorAddress: bytes.Clone(item.address), Epoch: 1, MLDSA87PublicKey: bytes.Clone(item.material.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(item.material.PublicB), SignerStatePath: filepath.Join(item.config.RootDir, "data", "pq-sign-state.json")}
		created, err := ynxconsensusauth.CreateSigner(item.binding.SignerStatePath, item.pqKey, item.binding.Policy, committed, item.address, 1)
		if err != nil {
			t.Fatal("new epoch durable signer:", err)
		}
		if err := created.Close(); err != nil {
			t.Fatal(err)
		}
		item.credential, err = ynxconsensusauth.GenerateHostRecoveryCredential()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { clear(item.credential) })
		vault, err := ynxconsensusauth.SealHostKeyEnvelope(item.material, item.binding, item.credential)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(item.vaultPath, vault, 0600); err != nil {
			t.Fatal(err)
		}
		item.material.Clear()
		item.pqKey.Destroy()
		if err := n.verifyStoppedSigningHistory(item); err != nil {
			t.Fatal("original stopped signing history:", err)
		}
		finishCustody()
		beforePQ := pqNetworkE2ERead(t, item.binding.SignerStatePath)
		beforeEd := pqNetworkE2ERead(t, item.config.PrivValidatorStateFile())
		finishRecovery := pqFreshStage(t, origin, arm, "original-custody-recovery", i, -1)
		item.host, err = ynxconsensusauth.ResumeHostSigner(item.vaultPath, item.credential, item.binding, committed)
		if err != nil {
			t.Fatal(err)
		}
		finishRecovery()
		signer, err := item.host.Signer()
		if err != nil {
			t.Fatal(err)
		}
		pv := privval.LoadFilePV(item.config.PrivValidatorKeyFile(), item.config.PrivValidatorStateFile())
		nodeKey, err := p2p.LoadNodeKey(item.config.NodeKeyFile())
		if err != nil {
			t.Fatal(err)
		}
		app.SetCommitTimingEnabled(true)
		traces[i] = &pqFreshTrace{Application: app, index: i, initial: n.doc.InitialHeight, origin: origin, domain: domain}
		item.node, err = pqFreshObservedNode(item.config, app, pv, signer, nodeKey, log.NewNopLogger(), traces[i])
		if err != nil {
			t.Fatal(err)
		}
		app.mu.RLock()
		height := app.committed.Height
		app.mu.RUnlock()
		if item.node.BlockStore().Height() != height || !bytes.Equal(item.keyBytes, pqNetworkE2ERead(t, item.config.PrivValidatorKeyFile())) || !bytes.Equal(item.nodeBytes, pqNetworkE2ERead(t, item.config.NodeKeyFile())) || !bytes.Equal(beforePQ, pqNetworkE2ERead(t, item.binding.SignerStatePath)) || !bytes.Equal(beforeEd, pqNetworkE2ERead(t, item.config.PrivValidatorStateFile())) {
			t.Fatal("observed normal constructor changed original store/identity/HRS")
		}
		n.configureStore(item)
		finish()
	}
	if !bytes.Equal(preserved, n.business()) {
		t.Fatal("trace attachment changed actual committed state")
	}
	finish = pqFreshStage(t, origin, arm, "pq-start-and-activation", -1, -1)
	n.startConstructed(4)
	n.driveThrough(schedule.ActivationHeight+1, 4)
	n.verifyTransition()
	n.verifyCommit(schedule.ActivationHeight, true, 4, false)
	finish()
	return traces
}

// Reads real BlockStores and stored FinalizeBlock results; it never repeats an
// offer, derives a target from RPC, or treats mempool acceptance as execution.
func pqFreshIncluded(n *pqNetworkE2E, payload []byte) (int64, int) {
	var height int64
	var index int
	n.wait("fresh exact original bytes committed on all four nodes", func() bool {
		for h := n.doc.InitialHeight; h <= n.nodes[0].node.BlockStore().Height(); h++ {
			block := n.nodes[0].node.BlockStore().LoadBlock(h)
			if block == nil {
				continue
			}
			for ix, tx := range block.Data.Txs {
				if !bytes.Equal(tx, payload) {
					continue
				}
				for _, item := range n.nodes {
					other := item.node.BlockStore().LoadBlock(h)
					result, err := item.store.LoadFinalizeBlockResponse(h)
					if other == nil || !bytes.Equal(other.Hash(), block.Hash()) || err != nil || result == nil || ix >= len(result.TxResults) {
						return false
					}
					if result.TxResults[ix] == nil || result.TxResults[ix].Code != 0 {
						n.t.Fatal("fresh original transaction was included but execution rejected")
					}
				}
				height, index = h, ix
				return true
			}
		}
		return false
	})
	return height, index
}

func pqFreshBirths(n *pqNetworkE2E, b *pqNetworkBusiness, accounts []pqFreshAccount, origin time.Time, arm string) []pqFreshBirth {
	finish := pqFreshStage(n.t, origin, arm, "initial-intent-preparation", -1, -1)
	checkpoint := n.quiet(4)
	activate := checkpoint + 6
	wires, payloads := make([][]byte, len(accounts)), make([][]byte, len(accounts))
	for i, account := range accounts {
		intent := ynxauth.RegistrationIntent{ChainID: n.nativeGenesis, Owner: account.owner, PKA: account.pair.PKA, PKB: account.pair.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: uint64(activate)}
		message, err := intent.SigningBytes()
		if err != nil {
			n.t.Fatal(err)
		}
		_, wires[i] = consensusPQProof(n.t, account.key, n.nativeGenesis, account.owner, ynxauth.TransactionPurpose, message)
		payloads[i], err = EncodePQTransaction(PQInitialRegistrationType, wires[i])
		if err != nil {
			n.t.Fatal(err)
		}
		pqBusinessWrite(n.t, filepath.Join(b.root, fmt.Sprintf("birth-%02d.wire", i)), wires[i])
	}
	finish()
	finish = pqFreshStage(n.t, origin, arm, "initial-admission", -1, -1)
	// All births use the normal signed mempool ingress. They are setup, not
	// paced transfer offers, and are never added to the business denominator.
	for _, payload := range payloads {
		tip := n.nodes[0].node.BlockStore().Height()
		if tip+1 >= activate || pqNetworkE2EBlockBudget(n.doc.InitialHeight, tip, pqNetworkE2ESubmissionBlocks) != nil {
			n.t.Fatal("birth original activation/block budget exhausted; preserve original intents, do not resign")
		}
		if result := n.check(payload); result.Code != 0 {
			n.t.Fatal("normal initial registration rejected; no legacy-signature fallback")
		}
	}
	finish()
	finish = pqFreshStage(n.t, origin, arm, "initial-execution-and-activation", -1, -1)
	rows := make([]pqFreshBirth, len(accounts))
	for i, payload := range payloads {
		h, ix := pqFreshIncluded(n, payload)
		rows[i] = pqFreshBirth{Owner: accounts[i].owner, FundingHash: accounts[i].funding, ABCITransactionHash: SignedTransactionHash(payload), NativeTransactionHash: SignedTransactionHash(wires[i]), Height: h, Index: ix, ActivationHeight: activate}
	}
	n.driveThrough(activate, 4)
	n.quiet(4)
	heights := make([]int64, len(rows))
	for i, row := range rows {
		heights[i] = row.Height
	}
	pqFreshVerifyCommits(n, heights)
	for i, account := range accounts {
		for node := range n.nodes {
			state := n.account(node, account.owner)
			if state.Balance != 1000 || state.Nonce != 1 {
				n.t.Fatal("real initial registration lost prepared funding or did not consume nonce1")
			}
		}
		rows[i].RegistrationFinalized = true
	}
	finish()
	return rows
}

type pqFreshClientPhases struct {
	InputPreparationNs            int64 `json:"inputPreparationNs,string"`
	IntentDurabilityNs            int64 `json:"intentDurabilityNs,string"`
	SubmissionHTTPNs              int64 `json:"submissionHTTPNs,string"`
	SubmissionValidationNs        int64 `json:"submissionValidationNs,string"`
	OriginalReadbackHTTPNs        int64 `json:"originalReadbackHTTPNs,string"`
	OriginalReadbackValidationNs  int64 `json:"originalReadbackValidationNs,string"`
	ProofCollectionHTTPNs         int64 `json:"proofCollectionHTTPNs,string"`
	CollectorIdentityValidationNs int64 `json:"collectorIdentityValidationNs,string"`
	ProofDurabilityNs             int64 `json:"proofDurabilityNs,string"`
}

type pqFreshClientReport struct {
	ReadbackIndexMode                          string              `json:"readbackIndexMode"`
	ReadbackOnly                               bool                `json:"readbackOnly"`
	SubmissionToFirstCommittedRPCObservationNs *int64              `json:"submissionToFirstCommittedRPCObservationNs,string"`
	FirstCommittedRPCObservationSource         string              `json:"firstCommittedRPCObservationSource"`
	FirstCommittedRPCHeight                    uint64              `json:"firstCommittedRPCHeight,string"`
	FirstCommittedRPCIndex                     *uint32             `json:"firstCommittedRPCIndex"`
	ABCITransactionHash                        string              `json:"abciTransactionHash"`
	NativeTransactionHash                      string              `json:"nativeTransactionHash"`
	TransactionType                            string              `json:"transactionType"`
	ExecutionHeight                            uint64              `json:"executionHeight,string"`
	CometIndex                                 *uint32             `json:"cometIndex"`
	SubmissionAttempts                         int                 `json:"submissionAttempts"`
	OriginalReadbackAttempts                   int                 `json:"originalReadbackAttempts"`
	InitialSubmissionUnknown                   bool                `json:"initialSubmissionUnknown"`
	Members                                    int                 `json:"members"`
	EffectiveBusinessIncludedObserved          int                 `json:"effectiveBusinessIncludedObserved"`
	RejectedMembers                            int                 `json:"rejectedMembers"`
	EffectiveBusinessFinalized                 int                 `json:"effectiveBusinessFinalized"`
	IndependentFinalityVerified                bool                `json:"independentFinalityVerified"`
	RegistrationFinalized                      bool                `json:"registrationFinalized"`
	ConsensusExecutionOutcome                  string              `json:"consensusExecutionOutcome"`
	FinalizedBusinessHashes                    []string            `json:"finalizedBusinessHashes"`
	ActualOfferToFinalityMeasured              bool                `json:"actualOfferToFinalityMeasured"`
	SustainedTPSQualified                      bool                `json:"sustainedTPSQualified"`
	Status                                     string              `json:"status"`
	ProofVerificationStatus                    string              `json:"proofVerificationStatus"`
	ProofVerifierSHA256                        string              `json:"proofVerifierSha256"`
	TrustContextSHA256                         string              `json:"trustContextSha256"`
	VerifierPreparationNs                      int64               `json:"verifierPreparationNs,string"`
	VerifierProcessNs                          int64               `json:"verifierProcessNs,string"`
	VerifierEvidenceDurabilityNs               int64               `json:"verifierEvidenceDurabilityNs,string"`
	VerifierResultValidationNs                 int64               `json:"verifierResultValidationNs,string"`
	ProofVerificationNs                        int64               `json:"proofVerificationNs,string"`
	Phases                                     pqFreshClientPhases `json:"clientPhases"`
}

type pqFreshTransfer struct {
	Sender                   string              `json:"sender"`
	NativeHash               string              `json:"nativeHash"`
	ABCIHash                 string              `json:"abciHash"`
	Height                   int64               `json:"height"`
	Index                    int                 `json:"index"`
	OfferOffsetNs            int64               `json:"offerOffsetNs"`
	OfferLatenessNs          int64               `json:"offerLatenessNs"`
	ObservedCompletionNs     int64               `json:"observedCompletionNs"`
	IndependentCompletionNs  int64               `json:"independentCompletionNs"`
	OfferToIndependentNs     int64               `json:"offerToIndependentNs"`
	IndependentTimingMeaning string              `json:"independentTimingMeaning"`
	Submission               pqFreshClientReport `json:"submission"`
	Readback                 pqFreshClientReport `json:"readback"`
	wire, payload            []byte
	path                     string
	offered                  time.Time
}

func pqFreshMode(baseline bool) string {
	if baseline {
		return "decode-index-again"
	}
	return "reuse-validated-index"
}

func pqFreshArgs(args []string, baseline bool) []string {
	if baseline {
		return append(args, "-pq-readback-index-baseline")
	}
	return args
}

func pqFreshReport(path string) (pqFreshClientReport, error) {
	var report pqFreshClientReport
	raw, err := pqBusinessRead(path, 64<<10)
	if err != nil || pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &report) != nil {
		return report, errors.New("original bounded client result unavailable; preserve UNKNOWN")
	}
	return report, nil
}

func pqFreshSubmissionValid(r pqFreshClientReport, row pqFreshTransfer, baseline bool) error {
	if r.ReadbackOnly || r.ReadbackIndexMode != pqFreshMode(baseline) || r.SubmissionAttempts != 1 || r.ABCITransactionHash != row.ABCIHash || r.NativeTransactionHash != row.NativeHash || r.TransactionType != PQTransferType || r.Members != 1 || r.IndependentFinalityVerified || r.EffectiveBusinessFinalized != 0 || r.SustainedTPSQualified || r.ActualOfferToFinalityMeasured {
		return errors.New("original single offer/client mode or observation classification differs")
	}
	if r.SubmissionToFirstCommittedRPCObservationNs != nil {
		if *r.SubmissionToFirstCommittedRPCObservationNs < 0 || r.FirstCommittedRPCHeight == 0 || r.FirstCommittedRPCIndex == nil || r.FirstCommittedRPCObservationSource != "post_response" && r.FirstCommittedRPCObservationSource != "original_get" {
			return errors.New("first committed RPC observation has no original coordinate/clock source")
		}
	} else if r.FirstCommittedRPCObservationSource != "" || r.FirstCommittedRPCHeight != 0 || r.FirstCommittedRPCIndex != nil {
		return errors.New("missing first observation duration cannot be manufactured from later GET")
	}
	if r.Status == "committed_observed" {
		if r.EffectiveBusinessIncludedObserved != 1 || r.RejectedMembers != 0 || r.SubmissionToFirstCommittedRPCObservationNs == nil {
			return errors.New("committed RPC result lacks its original first observation")
		}
	} else if r.Status != "submission_unknown" || !r.InitialSubmissionUnknown && r.SubmissionToFirstCommittedRPCObservationNs == nil {
		return errors.New("offer did not observe original N1 inclusion")
	}
	return nil
}

func pqFreshReadbackValid(r pqFreshClientReport, row pqFreshTransfer, baseline bool, verifier, contextPin string) error {
	if !r.ReadbackOnly || r.ReadbackIndexMode != pqFreshMode(baseline) || r.SubmissionAttempts != 0 || r.OriginalReadbackAttempts != 1 || r.Status != "committed_observed" || r.Members != 1 || r.EffectiveBusinessIncludedObserved != 1 || r.RejectedMembers != 0 || r.ABCITransactionHash != row.ABCIHash || r.NativeTransactionHash != row.NativeHash || r.TransactionType != PQTransferType || r.ExecutionHeight != uint64(row.Height) || r.CometIndex == nil || int(*r.CometIndex) != row.Index || !r.IndependentFinalityVerified || r.EffectiveBusinessFinalized != 1 || r.RegistrationFinalized || r.ConsensusExecutionOutcome != "succeeded" || len(r.FinalizedBusinessHashes) != 1 || r.FinalizedBusinessHashes[0] != row.NativeHash || r.ProofVerificationStatus != "verified_original_transaction" || r.ProofVerifierSHA256 != verifier || r.TrustContextSHA256 != contextPin || r.ActualOfferToFinalityMeasured || r.SustainedTPSQualified || r.SubmissionToFirstCommittedRPCObservationNs != nil {
		return errors.New("independent normal verifier did not prove exact Host N1 target/effect")
	}
	return nil
}

type pqFreshCompletion struct {
	index int
	err   error
	ended time.Time
}

func pqFreshStart(n *pqNetworkE2E, b *pqNetworkBusiness, done chan<- pqFreshCompletion, index int, label string, args []string) time.Time {
	started, err := pqFreshStartContext(n, b, n.ctx, done, index, label, args)
	if err != nil {
		n.t.Fatal("pinned normal fresh client failed to start; retain original intent")
	}
	return started
}

func pqFreshStartContext(n *pqNetworkE2E, b *pqNetworkBusiness, ctx context.Context, done chan<- pqFreshCompletion, index int, label string, args []string) (time.Time, error) {
	cmd, finish := b.command(n.t, ctx, label, "ynx-consensus-perf-client", nil, args...)
	started := time.Now()
	if err := cmd.Start(); err != nil {
		finish()
		return time.Time{}, err
	}
	go func() {
		err := cmd.Wait()
		ended := time.Now()
		finish()
		done <- pqFreshCompletion{index: index, err: err, ended: ended}
	}()
	return started, nil
}

// Only read-only, per-transaction proof consumers enter this fixed four-slot
// queue. Launch/preparation and result validation stay on the coordinator:
// they call helpers which may Fatal, and must never run on a worker goroutine.
func pqFreshReadbackQueue(parent context.Context, count int, start func(context.Context, int, chan<- pqFreshCompletion) error, accept func(pqFreshCompletion) error) error {
	if parent == nil || count < 1 || count > pqFreshSenders || start == nil || accept == nil {
		return errors.New("bounded nonempty fresh readback queue required")
	}
	ctx, cancel := context.WithCancel(parent)
	done := make(chan pqFreshCompletion, pqFreshInFlight)
	next, active, completed := 0, 0, 0
	issued, seen := make([]bool, count), make([]bool, count)
	defer func() {
		cancel()
		// Each successfully started child sends exactly once, only after Wait
		// and finish (log close + post-binary pin check). The buffer holds all
		// four completions even if preparation/validation calls Fatal/Goexit.
		// Join them before any enclosing test/node cleanup can finish.
		for active > 0 {
			<-done
			active--
		}
	}()
	for completed < count {
		for next < count && active < pqFreshInFlight {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := start(ctx, next, done); err != nil {
				return fmt.Errorf("fresh original readback %d failed to start: %w", next, err)
			}
			issued[next] = true
			next++
			active++
		}
		select {
		case result := <-done:
			active--
			if result.index < 0 || result.index >= count || !issued[result.index] || seen[result.index] {
				return errors.New("fresh readback completion does not identify one original started target")
			}
			seen[result.index] = true
			if err := accept(result); err != nil {
				return err
			}
			completed++
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func pqFreshTransfers(n *pqNetworkE2E, b *pqNetworkBusiness, accounts []pqFreshAccount, baseline bool, origin time.Time, arm string) ([]pqFreshTransfer, int, int64, int64) {
	finish := pqFreshStage(n.t, origin, arm, "business-intent-preparation", -1, -1)
	rows := make([]pqFreshTransfer, pqFreshSenders)
	for i, account := range accounts[1:] {
		message, err := (ynxauth.Transfer{ChainID: n.nativeGenesis, NativeChainID: 6423, From: account.owner, To: accounts[0].owner, Amount: 1, Fee: 1, Nonce: 2}).SigningBytes()
		if err != nil {
			n.t.Fatal(err)
		}
		_, wire := consensusPQProof(n.t, account.key, n.nativeGenesis, account.owner, ynxauth.TransactionPurpose, message)
		payload, err := EncodePQTransaction(PQTransferType, wire)
		if err != nil {
			n.t.Fatal(err)
		}
		path := filepath.Join(b.root, fmt.Sprintf("member-%02d.wire", i))
		pqBusinessWrite(n.t, path, wire)
		rows[i] = pqFreshTransfer{Sender: account.owner, NativeHash: SignedTransactionHash(wire), ABCIHash: SignedTransactionHash(payload), wire: wire, payload: payload, path: path}
	}
	finish()
	done := make(chan pqFreshCompletion, pqFreshInFlight)
	finishOffers := make([]func(), len(rows))
	started := time.Now()
	var lastOffer time.Time
	next, active, maximum := 0, 0, 0
	completed := 0
	for completed < len(rows) {
		if next < len(rows) && active < pqFreshInFlight {
			due := started.Add(time.Duration(next) * pqFreshInterval)
			if !lastOffer.IsZero() && due.Before(lastOffer.Add(pqFreshInterval)) {
				due = lastOffer.Add(pqFreshInterval)
			}
			if !time.Now().Before(due) {
				tip := n.nodes[0].node.BlockStore().Height()
				if pqNetworkE2EBlockBudget(n.doc.InitialHeight, tip, pqNetworkE2ESubmissionBlocks) != nil {
					n.t.Fatal("original block cap refuses another signed business offer")
				}
				label := fmt.Sprintf("member-%02d-submit", next)
				out := filepath.Join(b.root, label+".json")
				args := pqFreshArgs([]string{"-pq-member", rows[next].path, "-pq-gateway", b.url, "-output", out, "-timeout", "10s"}, baseline)
				finishOffers[next] = pqFreshStage(n.t, origin, arm, "business-offer", -1, next)
				rows[next].offered = pqFreshStart(n, b, done, next, label, args)
				rows[next].OfferOffsetNs = rows[next].offered.Sub(origin).Nanoseconds()
				rows[next].OfferLatenessNs = rows[next].offered.Sub(started.Add(time.Duration(next) * pqFreshInterval)).Nanoseconds()
				lastOffer = rows[next].offered
				next++
				active++
				if active > maximum {
					maximum = active
				}
				continue
			}
		}
		select {
		case result := <-done:
			active--
			completed++
			row := &rows[result.index]
			row.ObservedCompletionNs = result.ended.Sub(origin).Nanoseconds()
			var err error
			row.Submission, err = pqFreshReport(filepath.Join(b.root, fmt.Sprintf("member-%02d-submit.json", result.index)))
			var exit *exec.ExitError
			if err != nil || result.err != nil && (!errors.As(result.err, &exit) || exit.ExitCode() != 1 || row.Submission.Status != "submission_unknown") || pqFreshSubmissionValid(row.Submission, *row, baseline) != nil {
				n.t.Fatal("original offer result rejected; do not repeat an UNKNOWN transaction")
			}
			finishOffers[result.index]()
		case <-time.After(5 * time.Millisecond):
		case <-n.ctx.Done():
			n.t.Fatal("original fresh offer deadline; preserve all signed wires and UNKNOWN")
		}
	}
	finish = pqFreshStage(n.t, origin, arm, "business-original-inclusion", -1, -1)
	for i := range rows {
		rows[i].Height, rows[i].Index = pqFreshIncluded(n, rows[i].payload)
		observed := rows[i].Submission
		if observed.SubmissionToFirstCommittedRPCObservationNs != nil && (observed.FirstCommittedRPCHeight != uint64(rows[i].Height) || observed.FirstCommittedRPCIndex == nil || int(*observed.FirstCommittedRPCIndex) != rows[i].Index) {
			n.t.Fatal("first original RPC coordinates differ from independent Host stores")
		}
	}
	n.quiet(4)
	finish()
	finish = pqFreshStage(n.t, origin, arm, "business-commit-evidence", -1, -1)
	heights := make([]int64, len(rows))
	for i, row := range rows {
		heights[i] = row.Height
	}
	pqFreshVerifyCommits(n, heights)
	finish()
	// These independent proof observations use at most four clients/verifiers.
	// Their elapsed time includes the bounded verification queue, separately from
	// first committed RPC latency; it is not consensus formation time or a TPS SLA.
	contextPins, readbackFiles := make([]string, len(rows)), make([]string, len(rows))
	finishReadbacks := make([]func(), len(rows))
	verifier := b.manifest.Binaries["ynx-consensus-proof-verify"]
	err := pqFreshReadbackQueue(n.ctx, len(rows), func(ctx context.Context, i int, done chan<- pqFreshCompletion) error {
		row := &rows[i]
		finish = pqFreshStage(n.t, origin, arm, "business-host-context", -1, i)
		label := fmt.Sprintf("member-%02d", i)
		contextPath, contextPin, _ := b.hostContext(n, label, PQTransferType, row.wire, row.payload, row.Height, row.Index)
		finish()
		out := filepath.Join(b.root, label+"-readback.json")
		contextPins[i], readbackFiles[i] = contextPin, out
		args := pqFreshArgs([]string{"-pq-member", row.path, "-pq-gateway", b.url, "-pq-readback-only", "-pq-collect-proof", "-pq-proof-verifier", verifier.Path, "-pq-proof-verifier-sha256", verifier.SHA256, "-pq-trust-context", contextPath, "-pq-trust-context-sha256", contextPin, "-output", out, "-timeout", "10s"}, baseline)
		finishReadbacks[i] = pqFreshStage(n.t, origin, arm, "business-independent-readback", -1, i)
		_, err := pqFreshStartContext(n, b, ctx, done, i, label+"-readback", args)
		return err
	}, func(result pqFreshCompletion) error {
		if result.err != nil {
			return fmt.Errorf("normal independent readback/verifier %d failed; no rebroadcast or finalized credit: %w", result.index, result.err)
		}
		row := &rows[result.index]
		report, err := pqFreshReport(readbackFiles[result.index])
		if err != nil {
			return err
		}
		if err := pqFreshReadbackValid(report, *row, baseline, verifier.SHA256, contextPins[result.index]); err != nil {
			return fmt.Errorf("actual independent proof %d disagrees with the Host's original target: %w", result.index, err)
		}
		row.Readback = report
		ended := result.ended // Actual cmd.Wait completion, not coordinator queue drain.
		row.IndependentCompletionNs = ended.Sub(origin).Nanoseconds()
		row.OfferToIndependentNs = ended.Sub(row.offered).Nanoseconds()
		row.IndependentTimingMeaning = "upper-bound observation including queued proof verification; not consensus formation time"
		finishReadbacks[result.index]()
		return nil
	})
	if err != nil {
		n.t.Fatal("original independent readback queue failed after joining owned work; preserve UNKNOWN:", err)
	}
	for node := range n.nodes {
		for _, sender := range accounts[1:] {
			account := n.account(node, sender.owner)
			if account.Balance != 998 || account.Nonce != 2 {
				n.t.Fatal("fresh amount1 fee1 nonce2 execution differs across original nodes")
			}
		}
		account := n.account(node, accounts[0].owner)
		if account.Balance != 1000+pqFreshSenders || account.Nonce != 1 {
			n.t.Fatal("fresh receiver balance/initial nonce differs from sixteen real transfers")
		}
	}
	return rows, maximum, time.Since(started).Nanoseconds(), started.Sub(origin).Nanoseconds()
}

type pqFreshArm struct {
	Name                  string              `json:"name"`
	ReadbackIndexMode     string              `json:"readbackIndexMode"`
	GenesisSHA256         string              `json:"genesisSHA256"`
	ActivationHeight      int64               `json:"activationHeight"`
	InitialHeight         int64               `json:"initialHeight"`
	FinalHeight           int64               `json:"finalHeight"`
	Births                []pqFreshBirth      `json:"births"`
	Rows                  []pqFreshTransfer   `json:"rows"`
	NodePhases            [][]pqFreshTraceRow `json:"nodePhases,omitempty"`
	OfferedBusiness       int                 `json:"offeredBusiness"`
	FinalizedBusiness     int                 `json:"finalizedBusiness"`
	MaximumInFlight       int                 `json:"maximumInFlight"`
	OfferedRatePerSecond  int                 `json:"offeredRatePerSecond"`
	BusinessWindowNs      int64               `json:"businessWindowNs"`
	BusinessStartNs       int64               `json:"businessStartNs"`
	ClockOrigin           string              `json:"clockOrigin"`
	Clock                 string              `json:"clock"`
	SustainedTPSQualified bool                `json:"sustainedTPSQualified"`
}

func pqFreshArmRun(t *testing.T, ctx context.Context, build pqFreshBuild, root, name string, baseline bool, origin time.Time, domain string) pqFreshArm {
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal("new exclusive fresh arm directory required")
	}
	finish := pqFreshStage(t, origin, name, "original-fixture", -1, -1)
	b := &pqNetworkBusiness{manifest: pqNetworkBusinessManifest{ProtocolCommit: build.ProtocolCommit, PerformanceClientCommit: build.PerformanceClientCommit, SourceRoot: build.SourceRoot, SourceLeaves: build.SourceLeaves, Binaries: build.Binaries}, root: root}
	n := pqNetworkE2ENewWithBusiness(t, ctx, nil, b)
	defer func() {
		finishCleanup := pqFreshStage(t, origin, name, "normal-cleanup", -1, -1)
		b.close(t)
		n.stopAll()
		finishCleanup()
	}()
	accounts := pqFreshNew(n, b)
	finish()
	traces := pqFreshActivate(n, origin, domain, name)
	births := pqFreshBirths(n, b, accounts, origin, name)
	finish = pqFreshStage(t, origin, name, "gateway-start", -1, -1)
	b.startGateway(n)
	finish()
	rows, maxInFlight, elapsed, businessStart := pqFreshTransfers(n, b, accounts, baseline, origin, name)
	finish = pqFreshStage(t, origin, name, "actual-result-validation", -1, -1)
	tip := n.quiet(4)
	arm := pqFreshArm{Name: name, ReadbackIndexMode: pqFreshMode(baseline), GenesisSHA256: pqBusinessHash(n.rawGenesis), ActivationHeight: n.schedule.ActivationHeight, InitialHeight: n.doc.InitialHeight, FinalHeight: tip, Births: births, Rows: rows, OfferedBusiness: len(rows), MaximumInFlight: maxInFlight, OfferedRatePerSecond: 2, BusinessWindowNs: elapsed, BusinessStartNs: businessStart, ClockOrigin: "paired selector origin shared by both arms and all Host/ABCI offsets; child client durations use their own clock", Clock: pqFreshClock}
	for i, trace := range traces {
		observations, failure := trace.snapshot()
		if failure != "" || len(observations) == 0 {
			t.Fatal("real synchronous Finalize/Commit trace failed:", failure)
		}
		byHeight := make(map[int64]pqFreshTraceRow, len(observations))
		for _, observation := range observations {
			if observation.Node != i || observation.Clock != pqFreshClock || observation.ClockDomain != domain || observation.Height != observation.Persistence.Height || !observation.Persistence.Durable || !observation.CommitOK || !observation.FinalizeOK || byHeight[observation.Height].Height != 0 {
				t.Fatal("original node phase trace has missing/doubled/non-durable height")
			}
			byHeight[observation.Height] = observation
		}
		for h := observations[0].Height; h <= tip; h++ {
			observation, ok := byHeight[h]
			block := n.nodes[i].node.BlockStore().LoadBlock(h)
			if !ok || block == nil || observation.Transactions != len(block.Data.Txs) {
				t.Fatal("phase trace skipped an actual height, including an empty successor")
			}
		}
		arm.NodePhases = append(arm.NodePhases, observations)
	}
	for _, row := range rows {
		arm.FinalizedBusiness += row.Readback.EffectiveBusinessFinalized
	}
	if len(births) != pqFreshAccounts || len(rows) != pqFreshSenders || arm.FinalizedBusiness != pqFreshSenders || maxInFlight > pqFreshInFlight || pqNetworkE2EBlockBudget(arm.InitialHeight, tip, 0) != nil {
		t.Fatal("fresh arm does not satisfy the exact bounded business contract")
	}
	rawPhases, err := json.Marshal(map[string]any{"clockDomain": domain, "clockOrigin": arm.ClockOrigin, "nodePhases": arm.NodePhases})
	if err != nil || len(rawPhases) > 128<<10 {
		t.Fatal("bounded original raw phase receipt serialization failed")
	}
	pqBusinessWrite(t, filepath.Join(root, "node-phases.public.json"), rawPhases)
	publicArm := arm
	publicArm.NodePhases = nil
	public, err := json.Marshal(publicArm)
	if err != nil || len(public) > 128<<10 {
		t.Fatal("bounded original arm receipt serialization failed")
	}
	// Persist the completed first arm even if the second later fails. Its real
	// evidence is retained; it cannot be promoted into a completed paired run.
	pqBusinessWrite(t, filepath.Join(root, "arm.public.json"), public)
	finish()
	return arm
}

// The perf consumer's exact projection. Ns are nonnegative JSON integer
// numbers <=120e9, well below JavaScript's 2^53-1 precision boundary. Height is
// a decimal string. commitTiming is the original numeric API shape; Durable
// describes this node's persistence, and never establishes BFT finality.
type pqFreshPhaseRow struct {
	Arm          string              `json:"arm"`
	NodeIndex    int                 `json:"nodeIndex"`
	Height       string              `json:"height"`
	ClockDomain  string              `json:"clockDomain"`
	StartNs      int64               `json:"startNs"`
	EndNs        int64               `json:"endNs"`
	Phase        string              `json:"phase"`
	CommitTiming *CommitTimingSample `json:"commitTiming,omitempty"`
}

func pqFreshPhaseRowsValidate(rows []pqFreshPhaseRow, domain string) error {
	if domain == "" || len(rows) == 0 || len(rows) > 2*4*int(pqNetworkE2EMaxBlocks)*2 {
		return errors.New("bounded paired phase rows and common coordinator domain required")
	}
	type pair struct{ finalize, commit *pqFreshPhaseRow }
	pairs := map[string]pair{}
	nodesAtHeight := map[string]uint8{}
	arms := map[string]bool{}
	for i := range rows {
		row := &rows[i]
		height, err := strconv.ParseInt(row.Height, 10, 64)
		if err != nil || height < 1 || strconv.FormatInt(height, 10) != row.Height || row.Arm != "before" && row.Arm != "after" || row.NodeIndex < 0 || row.NodeIndex >= 4 || row.ClockDomain != domain || row.StartNs < 0 || row.EndNs < row.StartNs || row.EndNs > pqFreshPhaseMaxNs {
			return errors.New("phase coordinate, shared clock or bounded integer time differs")
		}
		key := fmt.Sprintf("%s/%d/%s", row.Arm, row.NodeIndex, row.Height)
		observed := pairs[key]
		switch row.Phase {
		case "finalize":
			if row.CommitTiming != nil || observed.finalize != nil {
				return errors.New("FinalizeBlock is one per node/height and carries no commit timing")
			}
			observed.finalize = row
		case "commit":
			p := row.CommitTiming
			if observed.commit != nil || p == nil || p.Height != height || !p.Durable || p.Storage == "" || p.PayloadBytes < 0 || p.ElapsedNs < 0 || p.ElapsedNs > row.EndNs-row.StartNs {
				return errors.New("actual per-height durable Commit timing required; not BFT finality")
			}
			for _, ns := range p.StagesNs {
				if ns < 0 || ns > pqFreshPhaseMaxNs {
					return errors.New("original numeric persistence stage outside bounded window")
				}
			}
			observed.commit = row
		default:
			return errors.New("phase must be exactly finalize or commit")
		}
		pairs[key] = observed
		arms[row.Arm] = true
		nodesAtHeight[row.Arm+"/"+row.Height] |= 1 << uint(row.NodeIndex)
	}
	if !arms["before"] || !arms["after"] {
		return errors.New("phase projection requires both measured arms")
	}
	for _, observed := range pairs {
		if observed.finalize == nil || observed.commit == nil || observed.finalize.EndNs > observed.commit.StartNs {
			return errors.New("each actual node/height requires ordered FinalizeBlock and Commit intervals")
		}
	}
	for _, mask := range nodesAtHeight {
		if mask != 15 {
			return errors.New("every observed height requires all four actual nodes")
		}
	}
	return nil
}

func pqFreshProjectPhases(arms []pqFreshArm, domain string) ([]pqFreshPhaseRow, error) {
	var projected []pqFreshPhaseRow
	for _, arm := range arms {
		if len(arm.NodePhases) != 4 {
			return nil, errors.New("four original node phase traces required")
		}
		for i, observations := range arm.NodePhases {
			for _, row := range observations {
				if row.Node != i || row.ClockDomain != domain || !row.FinalizeOK || !row.CommitOK || !row.TimingAvailable || row.FinalizeNs != row.FinalizeEndNs-row.FinalizeStartNs || row.CommitCallNs != row.CommitEndNs-row.CommitStartNs {
					return nil, errors.New("projection requires actual captured starts and ends, not inferred timestamps")
				}
				finalize := pqFreshPhaseRow{Arm: arm.Name, NodeIndex: i, Height: strconv.FormatInt(row.Height, 10), ClockDomain: domain, Phase: "finalize", StartNs: row.FinalizeStartNs, EndNs: row.FinalizeEndNs}
				commit := pqFreshPhaseRow{Arm: arm.Name, NodeIndex: i, Height: strconv.FormatInt(row.Height, 10), ClockDomain: domain, Phase: "commit", StartNs: row.CommitStartNs, EndNs: row.CommitEndNs}
				sample := row.Persistence
				sample.StagesNs = make(map[string]int64, len(row.Persistence.StagesNs))
				for k, ns := range row.Persistence.StagesNs {
					sample.StagesNs[k] = ns
				}
				commit.CommitTiming = &sample
				projected = append(projected, finalize, commit)
			}
		}
	}
	if err := pqFreshPhaseRowsValidate(projected, domain); err != nil {
		return nil, err
	}
	return projected, nil
}

func TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming(t *testing.T) {
	mode := os.Getenv("YNX_PQ_NETWORK_FRESH_BUSINESS_E2E")
	if mode == "" {
		t.Skip("requires separately authorized fresh paired four-node business window")
	}
	if mode != pqFreshOptIn || runtime.GOOS != "linux" || runtime.GOARCH != "amd64" || os.Getenv("YNX_PQ_NETWORK_E2E") != "" || os.Getenv("YNX_PQ_NETWORK_BUSINESS_E2E") != "" || os.Getenv("YNX_PQ_NETWORK_REMOTE_E2E") != "" || os.Getenv("YNX_PQ_REMOTE_PROCESS") != "" {
		t.Fatal("exclusive normal Linux fresh business window required")
	}
	raw, err := pqBusinessRead(os.Getenv("YNX_PQ_NETWORK_FRESH_BUSINESS_MANIFEST"), 64<<10)
	if err != nil {
		t.Fatal("fresh build DATA unavailable before any identity/node creation")
	}
	source, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	build, err := pqFreshBuildManifest(raw, os.Getenv("YNX_PQ_NETWORK_FRESH_BUSINESS_MANIFEST_SHA256"), os.Getenv("YNX_PQ_NETWORK_FRESH_BUSINESS_SOURCE_COMMIT"), source, executable)
	if err != nil {
		t.Fatal("fresh pre-node source/ELF pin refused:", err)
	}
	root, err := os.MkdirTemp("", "ynx-pq-fresh-paired-")
	if err != nil || os.Chmod(root, 0700) != nil {
		t.Fatal("new retained private fresh case directory required")
	}
	previous := runtime.GOMAXPROCS(2)
	defer runtime.GOMAXPROCS(previous)
	// Unchanged shared 105-second active budget, with the original enclosing
	// 120-second process timeout reserving fifteen seconds for normal cleanup.
	ctx, cancel := context.WithTimeout(context.Background(), 105*time.Second)
	defer cancel()
	// One coordinator origin for both arms. Never subtract a child process's
	// timebase from this origin or publish Unix nanoseconds as JSON numbers.
	origin := time.Now()
	domain := fmt.Sprintf("pq-fresh:%d", os.Getpid())
	arms := []pqFreshArm{pqFreshArmRun(t, ctx, build, filepath.Join(root, "before"), "before", true, origin, domain)}
	arms = append(arms, pqFreshArmRun(t, ctx, build, filepath.Join(root, "after"), "after", false, origin, domain))
	seen := map[string]bool{}
	for _, arm := range arms {
		for _, birth := range arm.Births {
			if seen[birth.Owner] || !birth.RegistrationFinalized || birth.FinalizedBusinessMembers != 0 {
				t.Fatal("arms reused an identity or promoted initial registration to business")
			}
			seen[birth.Owner] = true
		}
	}
	for _, binary := range build.Binaries {
		if err := pqBusinessCheckBinary(binary); err != nil {
			t.Fatal("same actual binary changed between paired arms")
		}
	}
	phaseRows, err := pqFreshProjectPhases(arms, domain)
	if err != nil {
		t.Fatal("exact original phase projection failed:", err)
	}
	// Raw per-H observations are retained in each node-phases.public.json.
	// The combined receipt uses one phaseRows projection instead of duplicating
	// those raw maps in the bounded public log.
	publicArms := append([]pqFreshArm(nil), arms...)
	for i := range publicArms {
		publicArms[i].NodePhases = nil
	}
	public, err := json.Marshal(map[string]any{"version": "YNX-PQ-NETWORK-FRESH-PAIRED-BUSINESS/v1", "syntheticOnly": true, "protocolCommit": build.ProtocolCommit, "clientCommit": pqFreshClientCommit, "clientTree": pqFreshClientTree, "binaries": build.Binaries, "sourceLeaves": build.SourceLeaves, "arms": publicArms, "phaseRows": phaseRows, "clockDomain": domain, "sameVM": true, "sameProcessPID": os.Getpid(), "businessFinalized": 2 * pqFreshSenders, "birthsExcluded": 2 * pqFreshAccounts, "sustainedTPSQualified": false, "publicDeployment": false, "nativeGrant": false})
	if err != nil || len(public) > 256<<10 {
		t.Fatal("bounded public fresh summary serialization failed")
	}
	pqBusinessWrite(t, filepath.Join(root, "fresh-business.public.json"), public)
	t.Logf("PQ_NETWORK_FRESH_BUSINESS_SUMMARY %s", public)
}

func TestPQNetworkFreshInitialGenesisCanonicalOwnerOrder(t *testing.T) {
	// Shape-valid public DATA only: this tests the existing Genesis grammar,
	// not key generation, signature validity, funding or account authority.
	migration := chain.ConsensusMigrationState{
		OriginalGenesisHash: strings.Repeat("a", 64),
		AccountPolicy: &ynxauth.State{Version: ynxauth.PolicyVersion,
			NetworkID: bytes.Repeat([]byte{0xaa}, 32), EnableAt: 2},
	}
	configuration := PQInitialAccountConfiguration{Version: PQInitialAccountsVersion,
		NetworkID: migration.OriginalGenesisHash, EnableAt: "2", BirthFee: "0"}
	assignments := make(map[string]PQInitialAccountBinding, pqFreshAccounts)
	for i := pqFreshAccounts; i > 0; i-- {
		binding := PQInitialAccountBinding{Owner: fmt.Sprintf("0x%040x", i),
			PKA: strings.Repeat(fmt.Sprintf("%02x", i), ynxbatch.PublicKeyASize),
			PKB: strings.Repeat(fmt.Sprintf("%02x", i), ynxbatch.PublicKeyBSize)}
		configuration.Accounts = append(configuration.Accounts, binding)
		assignments[binding.Owner] = binding
	}
	const orderError = "initial account bindings must have unique sorted canonical owners"
	plain := []byte(`{}`)
	if _, err := EncodePQInitialAccountGenesis(plain, migration, configuration); err == nil || !strings.Contains(err.Error(), orderError) {
		t.Fatal("original unsorted seventeen-account input did not reproduce the strict production rejection", err)
	}
	original, err := json.Marshal(configuration)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := pqFreshEncodeInitialGenesis(plain, migration, configuration)
	if err != nil {
		t.Fatal("actual fresh fixture encoder rejected canonicalized bindings:", err)
	}
	decoded, err := decodePQInitialAccountConfiguration(raw, migration)
	if err != nil || decoded == nil || len(decoded.Accounts) != pqFreshAccounts {
		t.Fatal("strict production reader lost canonicalized public bindings", err)
	}
	for i, binding := range decoded.Accounts {
		if binding.Owner != fmt.Sprintf("0x%040x", i+1) || binding != assignments[binding.Owner] {
			t.Fatal("canonicalization changed an owner-to-pair/funding assignment", i)
		}
	}
	after, err := json.Marshal(configuration)
	if err != nil || !bytes.Equal(after, original) || !bytes.Equal(plain, []byte(`{}`)) {
		t.Fatal("fixture encoder reordered the caller's account input or changed original Genesis", err)
	}
	duplicate := configuration
	duplicate.Accounts = append(append([]PQInitialAccountBinding(nil), configuration.Accounts...), configuration.Accounts[0])
	if _, err := pqFreshEncodeInitialGenesis(plain, migration, duplicate); err == nil || !strings.Contains(err.Error(), orderError) {
		t.Fatal("sorting silently removed or admitted a duplicate owner", err)
	}
	invalidPair := configuration
	invalidPair.Accounts = append([]PQInitialAccountBinding(nil), configuration.Accounts...)
	invalidPair.Accounts[0].PKB = "01"
	if _, err := pqFreshEncodeInitialGenesis(plain, migration, invalidPair); err == nil {
		t.Fatal("sorting bypassed full key-pair validation")
	}
}

func TestPQNetworkFreshCommitHeightPlanPreservesTargetsAndSuccessors(t *testing.T) {
	// Distinct public account/transaction coordinates share three actual blocks.
	// De-duplicating their commit evidence must not re-order or alias those rows.
	rows := make([]pqFreshBirth, pqFreshAccounts)
	heights := make([]int64, len(rows))
	for i := range rows {
		rows[i] = pqFreshBirth{Owner: fmt.Sprintf("0x%040x", i+1), Height: 22 - int64(i%3), Index: i}
		heights[i] = rows[i].Height
	}
	original := append([]pqFreshBirth(nil), rows...)
	originalHeights := append([]int64(nil), heights...)
	plan, err := pqFreshCommitHeightPlan(7, heights)
	if err != nil || len(plan) != 4 {
		t.Fatal("shared block evidence did not retain the exact four block/successor heights", plan, err)
	}
	for i, height := range []int64{20, 21, 22, 23} {
		if plan[i] != height {
			t.Fatal("actual block/successor evidence was lost or duplicated", plan)
		}
	}
	for i := range rows {
		if rows[i] != original[i] || heights[i] != originalHeights[i] {
			t.Fatal("commit planning changed a sender, transaction order or original coordinate")
		}
	}
	plan[0] = 50
	again, err := pqFreshCommitHeightPlan(7, heights)
	if err != nil || again[0] != 20 || heights[0] != originalHeights[0] {
		t.Fatal("local evidence plan retained caller/result aliases")
	}
	// Sixteen different blocks still require every independent block/successor;
	// no cap on proof count or transaction evidence is introduced by the plan.
	for i := 0; i < pqFreshSenders; i++ {
		heights[i] = 7 + 2*int64(i)
	}
	plan, err = pqFreshCommitHeightPlan(7, heights[:pqFreshSenders])
	if err != nil || len(plan) != 2*pqFreshSenders {
		t.Fatal("distinct transfer block/successor evidence was collapsed", plan, err)
	}
}

func TestPQNetworkFreshCommitHeightPlanRejectsMissingAndOutOfBudgetEvidence(t *testing.T) {
	const maximum = int64(1<<63 - 1)
	for _, test := range []struct {
		name    string
		initial int64
		heights []int64
	}{
		{"missing", 7, nil},
		{"too-many", 7, make([]int64, pqFreshAccounts+1)},
		{"unknown-initial", 0, []int64{7}},
		{"before-initial", 7, []int64{6}},
		{"successor-outside-original-48-block-cap", 7, []int64{54}},
		{"successor-overflow", maximum, []int64{maximum}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if plan, err := pqFreshCommitHeightPlan(test.initial, test.heights); err == nil || plan != nil {
				t.Fatal("invalid evidence produced a partial authentication plan", plan, err)
			}
		})
	}
	for _, test := range []struct {
		initial int64
		height  int64
	}{{7, 53}, {maximum - 1, maximum - 1}} {
		plan, err := pqFreshCommitHeightPlan(test.initial, []int64{test.height})
		if err != nil || len(plan) != 2 || plan[0] != test.height || plan[1] != test.height+1 {
			t.Fatal("valid last block/successor pair was rejected", plan, err)
		}
	}
}

func TestPQNetworkFreshReadbackQueueBoundedOutOfOrderTargets(t *testing.T) {
	live, maximum, launched := 0, 0, 0
	var order []int
	origin := time.Date(2026, time.October, 26, 0, 0, 0, 0, time.UTC)
	err := pqFreshReadbackQueue(context.Background(), pqFreshSenders, func(_ context.Context, index int, done chan<- pqFreshCompletion) error {
		launched++
		live++
		if live > maximum {
			maximum = live
		}
		if live > pqFreshInFlight || cap(done) < pqFreshInFlight {
			return errors.New("readback queue exceeded its fixed completion/resource slots")
		}
		// All four independently indexed completions arrive in reverse order.
		// The real coordinator must retain each original target and Wait clock.
		if index%pqFreshInFlight == pqFreshInFlight-1 {
			for i := index; i > index-pqFreshInFlight; i-- {
				done <- pqFreshCompletion{index: i, ended: origin.Add(time.Duration(i) * time.Millisecond)}
			}
		}
		return nil
	}, func(result pqFreshCompletion) error {
		live--
		position := len(order)
		want := position/pqFreshInFlight*pqFreshInFlight + pqFreshInFlight - 1 - position%pqFreshInFlight
		if result.index != want || result.ended != origin.Add(time.Duration(want)*time.Millisecond) {
			return errors.New("completion changed its transaction index or original Wait clock")
		}
		order = append(order, result.index)
		return nil
	})
	if err != nil || launched != pqFreshSenders || len(order) != pqFreshSenders || maximum != pqFreshInFlight || live != 0 {
		t.Fatal("bounded read-only queue lost a target or failed to use its four original slots", launched, order, maximum, live, err)
	}
	for _, count := range []int{0, pqFreshSenders + 1} {
		calls := 0
		err := pqFreshReadbackQueue(context.Background(), count, func(context.Context, int, chan<- pqFreshCompletion) error {
			calls++
			return nil
		}, func(pqFreshCompletion) error { calls++; return nil })
		if err == nil || calls != 0 {
			t.Fatal("unbounded readback plan invoked a launch/result callback", count, calls, err)
		}
	}
}

func TestPQNetworkFreshReadbackQueueFailureCancelsAndJoinsStartedWork(t *testing.T) {
	for _, mode := range []string{"start-failure", "report-failure", "parent-cancel"} {
		t.Run(mode, func(t *testing.T) {
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			failure := errors.New("original read-only operation failed")
			finished := make(chan int, pqFreshInFlight)
			var workers sync.WaitGroup
			started, accepted := 0, 0
			err := pqFreshReadbackQueue(parent, pqFreshSenders, func(ctx context.Context, index int, done chan<- pqFreshCompletion) error {
				if mode == "start-failure" && index == 2 {
					return failure // No child/completion exists for failed Start.
				}
				started++
				workers.Add(1)
				go func() {
					defer workers.Done()
					var err error
					if mode != "report-failure" || index != 0 {
						<-ctx.Done()
						err = ctx.Err()
					}
					// Model the actual Wait -> finish -> completion ordering.
					finished <- index
					done <- pqFreshCompletion{index: index, err: err, ended: time.Now()}
				}()
				if mode == "parent-cancel" && index == pqFreshInFlight-1 {
					cancel()
				}
				return nil
			}, func(result pqFreshCompletion) error {
				accepted++
				if mode == "report-failure" {
					return failure
				}
				return result.err
			})
			wanted := pqFreshInFlight
			if mode == "start-failure" {
				wanted = 2
			}
			if err == nil || mode != "parent-cancel" && !errors.Is(err, failure) || mode == "parent-cancel" && !errors.Is(err, context.Canceled) || started != wanted || mode == "start-failure" && accepted != 0 || mode == "report-failure" && accepted != 1 {
				t.Fatal("readback failure lost its first cause or launched extra work", mode, started, accepted, err)
			}
			seen := map[int]bool{}
			for i := 0; i < started; i++ {
				select {
				case index := <-finished:
					if index < 0 || index >= started || seen[index] {
						t.Fatal("joined completion does not belong to one original started child", index)
					}
					seen[index] = true
				default:
					t.Fatal("queue returned before an owned child's finish completed")
				}
			}
			workers.Wait()
		})
	}
}

// These DATA regressions run in normal CI without starting a node, generating a
// key, executing an ELF, using SSH, or granting any production signing authority.
func TestPQNetworkFreshBusinessDoesNotInventFirstObservationOrFinality(t *testing.T) {
	row := pqFreshTransfer{NativeHash: "0x" + strings.Repeat("11", 32), ABCIHash: "0x" + strings.Repeat("22", 32), Height: 7, Index: 2}
	r := pqFreshClientReport{ReadbackIndexMode: pqFreshMode(false), SubmissionAttempts: 1, ABCITransactionHash: row.ABCIHash, NativeTransactionHash: row.NativeHash, TransactionType: PQTransferType, Members: 1, Status: "submission_unknown", InitialSubmissionUnknown: true}
	if err := pqFreshSubmissionValid(r, row, false); err != nil {
		t.Fatal("UNKNOWN without an observation must remain representable", err)
	}
	r.FirstCommittedRPCObservationSource = "original_get"
	if pqFreshSubmissionValid(r, row, false) == nil {
		t.Fatal("later GET invented a missing first committed observation")
	}
	r.FirstCommittedRPCObservationSource = ""
	r.EffectiveBusinessFinalized, r.IndependentFinalityVerified = 1, true
	if pqFreshSubmissionValid(r, row, false) == nil {
		t.Fatal("RPC observation became independent finality")
	}
	ix := uint32(2)
	r = pqFreshClientReport{ReadbackOnly: true, ReadbackIndexMode: pqFreshMode(false), OriginalReadbackAttempts: 1, Status: "committed_observed", Members: 1, EffectiveBusinessIncludedObserved: 1, ABCITransactionHash: row.ABCIHash, NativeTransactionHash: row.NativeHash, TransactionType: PQTransferType, ExecutionHeight: 7, CometIndex: &ix, IndependentFinalityVerified: true, EffectiveBusinessFinalized: 1, ConsensusExecutionOutcome: "succeeded", FinalizedBusinessHashes: []string{row.NativeHash}, ProofVerificationStatus: "verified_original_transaction", ProofVerifierSHA256: "v", TrustContextSHA256: "c"}
	if err := pqFreshReadbackValid(r, row, false, "v", "c"); err != nil {
		t.Fatal(err)
	}
	for _, outcome := range []string{"partial", "rejected", ""} {
		bad := r
		bad.ConsensusExecutionOutcome = outcome
		if pqFreshReadbackValid(bad, row, false, "v", "c") == nil {
			t.Fatal("partial/rejected/unknown execution counted as a finalized N1")
		}
	}
	r.RegistrationFinalized = true
	if pqFreshReadbackValid(r, row, false, "v", "c") == nil {
		t.Fatal("initial registration counted as a business transfer")
	}
}

func TestPQNetworkFreshPhaseCopiesAndBoundedProfile(t *testing.T) {
	p := &pqFreshTrace{rows: []pqFreshTraceRow{{Height: 5, ExecutionCodes: []uint32{0}, Persistence: CommitTimingSample{Height: 5, StagesNs: map[string]int64{"sync": 7}}}, {Height: 6, Persistence: CommitTimingSample{Height: 6}}}}
	rows, failure := p.snapshot()
	if failure != "" || len(rows) != 2 || rows[0].Height != 5 || rows[1].Height != 6 {
		t.Fatal("empty successor overwrote the original-height trace")
	}
	rows[0].Persistence.StagesNs["sync"], rows[0].ExecutionCodes[0] = 90, 3
	again, _ := p.snapshot()
	if again[0].Persistence.StagesNs["sync"] != 7 || again[0].ExecutionCodes[0] != 0 {
		t.Fatal("public trace snapshot aliased a live original observation")
	}
	if pqFreshSenders != 16 || pqFreshAccounts != 17 || pqFreshInFlight != 4 || pqFreshInterval != time.Second/2 || pqFreshClientCommit == pqNetworkBusinessClientCommit || len(pqFreshArgs(nil, true)) != 1 || len(pqFreshArgs(nil, false)) != 0 {
		t.Fatal("fresh paired contract or unchanged historical client profile drifted")
	}
	for _, raw := range [][]byte{[]byte(`{}`), []byte(`{"version":"a","version":"b"}`), []byte(`{"performanceClientCommit":"3f5b"}`)} {
		if _, err := pqFreshBuildManifest(raw, pqBusinessHash(raw), strings.Repeat("11", 20), "/unused", "/unused/test"); err == nil {
			t.Fatal("incomplete/aliased/old-client source became permission to create nodes")
		}
	}
}

func TestPQNetworkFreshPhaseProjectionExactNumericShapeAndCommonClock(t *testing.T) {
	const domain = "DATA-only-common-coordinator-origin"
	arms := []pqFreshArm{{Name: "before", NodePhases: make([][]pqFreshTraceRow, 4)}, {Name: "after", NodePhases: make([][]pqFreshTraceRow, 4)}}
	for ai := range arms {
		for ni := range arms[ai].NodePhases {
			base := int64(ai*100 + ni*10)
			// Three transactions still produce exactly one block-level pair.
			arms[ai].NodePhases[ni] = []pqFreshTraceRow{{Node: ni, ClockDomain: domain, Height: 5, Transactions: 3, FinalizeStartNs: base + 1, FinalizeEndNs: base + 4, FinalizeNs: 3, CommitStartNs: base + 6, CommitEndNs: base + 10, CommitCallNs: 4, FinalizeOK: true, CommitOK: true, TimingAvailable: true, Persistence: CommitTimingSample{Height: 5, Storage: "atomic-json", Durable: true, ElapsedNs: 3, PayloadBytes: 12, StagesNs: map[string]int64{"sync": 2}}}}
		}
	}
	rows, err := pqFreshProjectPhases(arms, domain)
	if err != nil || len(rows) != 2*4*2 {
		t.Fatal("multi-transaction block multiplied phase rows or lost an arm/node", err)
	}
	rows[1].CommitTiming.StagesNs["sync"] = 99
	if arms[0].NodePhases[0][0].Persistence.StagesNs["sync"] != 2 {
		t.Fatal("consumer projection aliased the original captured CommitTimingSample")
	}
	rows, err = pqFreshProjectPhases(arms, domain)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	var shapes []map[string]json.RawMessage
	if json.Unmarshal(raw, &shapes) != nil || len(shapes) != len(rows) {
		t.Fatal("phase projection did not emit an array of closed row objects")
	}
	for i, shape := range shapes {
		wantFields := 7
		if rows[i].Phase == "commit" {
			wantFields++
		}
		if len(shape) != wantFields || len(shape["arm"]) == 0 || len(shape["nodeIndex"]) == 0 || !bytes.Equal(shape["height"], []byte(`"5"`)) || len(shape["clockDomain"]) == 0 || len(shape["phase"]) == 0 || len(shape["startNs"]) == 0 || shape["startNs"][0] == '"' || len(shape["endNs"]) == 0 || shape["endNs"][0] == '"' {
			t.Fatal("phase row names or decimal-height/integer-nanosecond shape differs")
		}
		if rows[i].Phase == "commit" {
			var timing map[string]json.RawMessage
			if json.Unmarshal(shape["commitTiming"], &timing) != nil || len(timing) != 6 || !bytes.Equal(timing["elapsedNs"], []byte("3")) || !bytes.Equal(timing["height"], []byte("5")) || !bytes.Equal(timing["durable"], []byte("true")) {
				t.Fatal("commitTiming lost the original numeric API shape or invented BFT finality")
			}
		}
	}
	// Exercise the emitted wire contract too: fractions and numeric strings do
	// not decode into this integer shape; valid integers over 120s are refused.
	first, err := json.Marshal(rows[:1])
	if err != nil {
		t.Fatal(err)
	}
	for _, replacement := range []string{`"startNs":1.5`, `"startNs":"1"`, `"startNs":9223372036854775808`} {
		bad := bytes.Replace(first, []byte(`"startNs":1`), []byte(replacement), 1)
		var decoded []pqFreshPhaseRow
		if json.Unmarshal(bad, &decoded) == nil {
			t.Fatal("non-integer/string/overflow timestamp entered the numeric phase contract")
		}
	}
	for _, scenario := range []string{"past-cap", "negative", "foreign-clock", "derived-end", "duplicate", "missing-node", "timing-on-finalize"} {
		t.Run(scenario, func(t *testing.T) {
			bad, err := pqFreshProjectPhases(arms, domain)
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "past-cap":
				bad[1].EndNs = pqFreshPhaseMaxNs + 1
			case "negative":
				bad[0].StartNs = -1
			case "foreign-clock":
				bad[0].ClockDomain = "child-client-own-clock"
			case "derived-end":
				arms[0].NodePhases[0][0].FinalizeEndNs++
				defer func() { arms[0].NodePhases[0][0].FinalizeEndNs-- }()
				if _, err := pqFreshProjectPhases(arms, domain); err == nil {
					t.Fatal("projection accepted inferred end inconsistent with actual captured elapsed")
				}
				return
			case "duplicate":
				bad = append(bad, bad[0])
			case "missing-node":
				bad = bad[2:]
			case "timing-on-finalize":
				bad[0].CommitTiming = bad[1].CommitTiming
			}
			if pqFreshPhaseRowsValidate(bad, domain) == nil {
				t.Fatal("invalid phase window, clock, per-block count or API shape accepted")
			}
		})
	}
}

func TestPQNetworkFreshPreflightPinsNewClientTreeWithoutExecutingELFData(t *testing.T) {
	for _, scenario := range []string{"valid-data", "old-client", "wrong-tree", "client-package-tree", "missing-fresh-source", "changed-fresh-source", "duplicate-binary", "wrong-running-test", "client-pin-drift", "field-alias", "nested-field-alias", "extra-field"} {
		t.Run(scenario, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(root, "source")
			if err := os.MkdirAll(filepath.Join(source, "internal", "consensus"), 0700); err != nil {
				t.Fatal(err)
			}
			commit := strings.Repeat("a", 40)
			m := pqFreshBuild{Version: "YNX-PQ-NETWORK-FRESH-BUSINESS-BUILD/v1", ProtocolCommit: commit, PerformanceClientCommit: pqFreshClientCommit, PerformanceClientTree: pqFreshClientTree, SourceRoot: source, SourceLeaves: map[string]string{}, Binaries: map[string]pqNetworkBusinessBinary{}}
			for _, leaf := range []string{"internal/consensus/pq_network_e2e_test.go", "internal/consensus/pq_network_business_test.go", "internal/consensus/pq_network_fresh_business_test.go"} {
				data := []byte("inert pinned source DATA " + leaf)
				if err := os.WriteFile(filepath.Join(source, leaf), data, 0600); err != nil {
					t.Fatal(err)
				}
				m.SourceLeaves[leaf] = pqBusinessHash(data)
			}
			originals := map[string][]byte{}
			for i, name := range []string{"consensus.test", "ynx-bft-gatewayd", "ynx-consensus-perf-client", "ynx-consensus-proof-verify"} {
				// Header-only non-runnable DATA, exactly as in the old preflight
				// regression. No exec.Cmd, node or signing authority is supplied.
				data := make([]byte, 64)
				copy(data, []byte{0x7f, 'E', 'L', 'F', 2, 1})
				data[16], data[18], data[63] = 2, 0x3e, byte(i+1)
				path := filepath.Join(root, name)
				if err := os.WriteFile(path, data, 0500); err != nil {
					t.Fatal(err)
				}
				originals[path] = bytes.Clone(data)
				binaryCommit := commit
				if name == "ynx-consensus-perf-client" {
					binaryCommit = pqFreshClientCommit
				}
				m.Binaries[name] = pqNetworkBusinessBinary{Path: path, SHA256: pqBusinessHash(data), Commit: binaryCommit, Bytes: int64(len(data))}
			}
			executable := m.Binaries["consensus.test"].Path
			switch scenario {
			case "old-client":
				m.PerformanceClientCommit = pqNetworkBusinessClientCommit
			case "wrong-tree":
				m.PerformanceClientTree = strings.Repeat("b", 40)
			case "client-package-tree":
				m.PerformanceClientTree = "19b9fafcfbb3f434b9ff745fb785afb1d0741247"
			case "missing-fresh-source":
				delete(m.SourceLeaves, "internal/consensus/pq_network_fresh_business_test.go")
			case "changed-fresh-source":
				if err := os.WriteFile(filepath.Join(source, "internal/consensus/pq_network_fresh_business_test.go"), []byte("changed original input"), 0600); err != nil {
					t.Fatal(err)
				}
			case "duplicate-binary":
				m.Binaries["ynx-bft-gatewayd"] = m.Binaries["consensus.test"]
			case "wrong-running-test":
				executable += ".different"
			case "client-pin-drift":
				p := m.Binaries["ynx-consensus-perf-client"]
				p.SHA256 = strings.Repeat("c", 64)
				m.Binaries["ynx-consensus-perf-client"] = p
			}
			raw, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "field-alias" {
				raw = bytes.Replace(raw, []byte(`"performanceClientTree"`), []byte(`"PerformanceClientTree"`), 1)
			} else if scenario == "nested-field-alias" {
				raw = bytes.Replace(raw, []byte(`"sha256"`), []byte(`"SHA256"`), 1)
			} else if scenario == "extra-field" {
				raw = append([]byte(`{"approved":true,`), raw[1:]...)
			}
			_, err = pqFreshBuildManifest(raw, pqBusinessHash(raw), commit, source, executable)
			if (err == nil) != (scenario == "valid-data") {
				t.Fatal("incorrect fresh pre-node admission", scenario, err)
			}
			for path, want := range originals {
				got, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(got, want) {
					t.Fatal("pin-only parser changed original executable DATA")
				}
			}
		})
	}
}
