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
	pqFreshClientTree             = "4866cc3924c060eb6a29939915d39b1c5c625607"
	pqFreshSenders                = 16
	pqFreshAccounts               = pqFreshSenders + 1
	pqFreshInFlight               = 4
	pqFreshInterval               = 500 * time.Millisecond
	pqFreshClock                  = "test-process time.Now monotonic elapsed; not a cross-process or wall-clock subtraction"
	pqFreshPhaseMaxNs             = int64(120 * time.Second)
	pqFreshCommitLogPrefix        = "PQ_NETWORK_FRESH_COMMIT_OBSERVATION "
	pqFreshCommitLogLineMax       = 1024
	pqFreshCommitLogRowsMax       = 2 * 4 * int(pqNetworkE2EMaxBlocks)
	pqFreshValidationLogPrefix    = "PQ_VALIDATE "
	pqFreshTransferLogPrefix      = "PQ_FRESH_TX "
	pqFreshInclusionLogPrefix     = "PQ_FRESH_INCLUSION "
	pqFreshDetailLogLineMax       = 512
	pqFreshTransferLogRowsMax     = 2 * pqFreshSenders
	pqFreshObservationLogBytesMax = pqFreshCommitLogRowsMax*(pqFreshCommitLogLineMax+pqFreshDetailLogLineMax) + 2*pqFreshTransferLogRowsMax*pqFreshDetailLogLineMax
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
	blockHash       string
	proposal        *pqFreshProposalTrace
}

// This is a node's accepted proposal call, not a wall-clock header time or a
// claim about earliest network arrival. Only the same block/payload subsequently
// finalized and committed can be joined to a verified business callback.
type pqFreshProposalTrace struct {
	blockHash string
	startNs   int64
	endNs     int64
	txHashes  []string
}

func pqFreshCopyProposal(p *pqFreshProposalTrace) *pqFreshProposalTrace {
	if p == nil {
		return nil
	}
	copy := *p
	copy.txHashes = append([]string(nil), p.txHashes...)
	return &copy
}

type pqFreshProposalKey struct {
	height int64
	hash   string
}

// Failure-retained DATA, not the successful paired-business summary. No
// transaction bytes, owners, paths, execution credit or finality are projected.
type pqFreshCommitObservation struct {
	Classification  string              `json:"classification"`
	Arm             string              `json:"arm"`
	NodeIndex       int                 `json:"nodeIndex"`
	PID             int                 `json:"pid"`
	Clock           string              `json:"clock"`
	ClockDomain     string              `json:"clockDomain"`
	Height          string              `json:"height"`
	Transactions    int                 `json:"transactions"`
	FinalizeStartNs int64               `json:"finalizeStartNs"`
	FinalizeEndNs   int64               `json:"finalizeEndNs"`
	FinalizeOK      bool                `json:"finalizeOK"`
	CommitStartNs   int64               `json:"commitStartNs"`
	CommitEndNs     int64               `json:"commitEndNs"`
	CommitCallNs    int64               `json:"commitCallNs"`
	CommitOK        bool                `json:"commitOK"`
	TimingAvailable bool                `json:"timingAvailable"`
	CommitTiming    *CommitTimingSample `json:"commitTiming"`
}

func pqFreshCommitObservationLine(arm string, row pqFreshTraceRow) ([]byte, error) {
	if arm != "before" && arm != "after" || row.Node < 0 || row.Node >= 4 || row.PID < 1 || int64(row.PID) > 1<<31-1 || row.Clock != pqFreshClock || row.ClockDomain != fmt.Sprintf("pq-fresh:%d", row.PID) || row.Height < 1 || row.Transactions < 0 {
		return nil, errors.New("original bounded Commit observation coordinates required")
	}
	if row.FinalizeStartNs < 0 || row.FinalizeEndNs < row.FinalizeStartNs || row.FinalizeEndNs > row.CommitStartNs || row.CommitEndNs < row.CommitStartNs || row.CommitEndNs > pqFreshPhaseMaxNs || row.CommitCallNs != row.CommitEndNs-row.CommitStartNs {
		return nil, errors.New("actual coordinator Commit intervals outside original window")
	}
	observation := pqFreshCommitObservation{Classification: "local-persistence-observation", Arm: arm, NodeIndex: row.Node, PID: row.PID, Clock: row.Clock, ClockDomain: row.ClockDomain, Height: strconv.FormatInt(row.Height, 10), Transactions: row.Transactions, FinalizeStartNs: row.FinalizeStartNs, FinalizeEndNs: row.FinalizeEndNs, FinalizeOK: row.FinalizeOK, CommitStartNs: row.CommitStartNs, CommitEndNs: row.CommitEndNs, CommitCallNs: row.CommitCallNs, CommitOK: row.CommitOK, TimingAvailable: row.TimingAvailable}
	if row.TimingAvailable {
		sample := row.Persistence
		if sample.Height < 1 || sample.ElapsedNs < 0 || sample.ElapsedNs > row.CommitCallNs || sample.PayloadBytes < 0 || uint64(sample.PayloadBytes) > 1<<53-1 || sample.Storage != "atomic-json" && sample.Storage != "snapshot-journal-v1" && sample.Storage != "block-journal-v2" {
			return nil, errors.New("original numeric persistence observation outside bounds")
		}
		var sum int64
		for stage, ns := range sample.StagesNs {
			switch stage {
			case "validate", "json_encode", "delta_encode", "journal_maintenance", "prepare_file", "write", "file_sync", "close_file", "rename", "directory_sync", "version_checkpoint":
			default:
				return nil, errors.New("unknown persistence stage cannot enter public Commit log")
			}
			if ns < 0 || ns > sample.ElapsedNs || sum > sample.ElapsedNs-ns {
				return nil, errors.New("numeric persistence stages exceed actual elapsed time")
			}
			sum += ns
		}
		observation.CommitTiming = &sample
	}
	raw, err := json.Marshal(observation)
	if err != nil || len(pqFreshCommitLogPrefix)+len(raw)+1 > pqFreshCommitLogLineMax {
		return nil, errors.New("bounded public Commit observation serialization failed")
	}
	return append(append([]byte(pqFreshCommitLogPrefix), raw...), '\n'), nil
}

// Fixed source order for the compact log projection, not a new state or timing
// API. Missing phases after a failed phase remain zero, never successful work.
var pqFreshValidationPhases = [...]string{
	"anchor", "validator_registry", "engine_schedule", "engine_snapshot", "pq_state",
	"migration_trace_lots", "legacy_sponsor", "legacy_resource_market", "legacy_contracts",
	"legacy_pay", "legacy_ai", "legacy_trust", "ledger_records", "pay", "resource",
	"resource_sponsor", "trust", "ide", "pq_resources", "pq_dex", "pq_contracts",
	"pq_native_actions", "pq_ethereum", "pq_ordered_resources", "fee_events", "governance",
	"dex", "asset_auth", "account_abstraction", "account_abstraction_policy",
	"ownership_and_vault_supply", "staking", "supply", "app_hash",
}

type pqFreshValidationObservation struct {
	Arm                string    `json:"a"`
	Node               int       `json:"n"`
	Height             string    `json:"h"`
	FailedPhase        int       `json:"f"`
	Phases             [34]int64 `json:"p"`
	HashDocumentNs     int64     `json:"d"`
	HashEncodeDigestNs int64     `json:"x"`
}

func pqFreshValidationObservationLine(arm string, row pqFreshTraceRow, sample CommitValidationTimingSample) ([]byte, error) {
	if arm != "before" && arm != "after" || row.Node < 0 || row.Node >= 4 || row.Height < 1 || !row.TimingAvailable || row.Persistence.Height != row.Height || sample.Height != row.Height || sample.ElapsedNs < 0 || sample.ElapsedNs > pqFreshPhaseMaxNs || sample.ElapsedNs > row.Persistence.ElapsedNs || row.Persistence.ElapsedNs > row.CommitCallNs {
		return nil, errors.New("same original Commit validation attempt required")
	}
	observation := pqFreshValidationObservation{Arm: arm, Node: row.Node, Height: strconv.FormatInt(row.Height, 10), FailedPhase: -1, HashDocumentNs: sample.HashDocumentNs, HashEncodeDigestNs: sample.HashEncodeDigestNs}
	if sample.Valid {
		if sample.FailedPhase != "" {
			return nil, errors.New("valid validation has a failed phase")
		}
	} else {
		for i, phase := range pqFreshValidationPhases {
			if phase == sample.FailedPhase {
				observation.FailedPhase = i
				break
			}
		}
		if observation.FailedPhase < 0 || row.CommitOK || row.Persistence.Durable {
			return nil, errors.New("failed validation has no original failed phase")
		}
	}
	count := len(pqFreshValidationPhases)
	if !sample.Valid {
		count = observation.FailedPhase + 1
	}
	if len(sample.PhaseNs) != count {
		return nil, errors.New("validation phases are not the original executed prefix")
	}
	var sum int64
	for i, phase := range pqFreshValidationPhases {
		ns, exists := sample.PhaseNs[phase]
		if exists != (i < count) || ns < 0 || ns > sample.ElapsedNs || sum > sample.ElapsedNs-ns {
			return nil, errors.New("unknown, missing or overlapping validation phase")
		}
		observation.Phases[i] = ns
		sum += ns
	}
	if sum != sample.ElapsedNs {
		return nil, errors.New("validation phase sum differs from actual elapsed")
	}
	outerValidate, marked := row.Persistence.StagesNs["validate"]
	if !marked && (row.CommitOK || row.Persistence.Durable) || marked && (outerValidate < sample.ElapsedNs || outerValidate > row.Persistence.ElapsedNs) {
		return nil, errors.New("validation detail exceeds its original outer stage")
	}
	hashNs := observation.Phases[len(observation.Phases)-1]
	if sample.HashDocumentNs < 0 || sample.HashEncodeDigestNs < 0 || sample.HashDocumentNs > hashNs || sample.HashEncodeDigestNs > hashNs-sample.HashDocumentNs {
		return nil, errors.New("hash child intervals exceed original app_hash phase")
	}
	raw, err := json.Marshal(observation)
	if err != nil || len(pqFreshValidationLogPrefix)+len(raw)+1 > pqFreshDetailLogLineMax {
		return nil, errors.New("bounded validation observation serialization failed")
	}
	return append(append([]byte(pqFreshValidationLogPrefix), raw...), '\n'), nil
}

type pqFreshTransferObservation struct {
	Kind                    string  `json:"kind"`
	Arm                     string  `json:"arm"`
	NativeHash              string  `json:"nativeHash"`
	ABCIHash                string  `json:"abciHash"`
	Height                  string  `json:"height"`
	Index                   int     `json:"index"`
	OfferOffsetNs           int64   `json:"offerOffsetNs"`
	IndependentCompletionNs int64   `json:"independentCompletionNs"`
	OfferToIndependentNs    int64   `json:"offerToIndependentNs"`
	FirstRPCNs              *string `json:"firstRPCNs"`
	FirstRPCClock           string  `json:"firstRPCClock"`
	ClockDomain             string  `json:"clockDomain"`
}

func pqFreshTransferObservationLine(arm, domain string, row pqFreshTransfer) ([]byte, error) {
	pid, err := strconv.ParseUint(strings.TrimPrefix(domain, "pq-fresh:"), 10, 31)
	if arm != "before" && arm != "after" || err != nil || pid == 0 || domain != fmt.Sprintf("pq-fresh:%d", pid) || !strings.HasPrefix(row.NativeHash, "0x") || !pqBusinessPin(strings.TrimPrefix(row.NativeHash, "0x"), 32) || !strings.HasPrefix(row.ABCIHash, "0x") || !pqBusinessPin(strings.TrimPrefix(row.ABCIHash, "0x"), 32) || row.Height < 1 || row.Index < 0 || int64(row.Index) > 1<<31-1 || row.OfferOffsetNs < 0 || row.IndependentCompletionNs < row.OfferOffsetNs || row.IndependentCompletionNs > pqFreshPhaseMaxNs || row.OfferToIndependentNs != row.IndependentCompletionNs-row.OfferOffsetNs {
		return nil, errors.New("original verified transfer coordinates and coordinator intervals required")
	}
	// Only offer/completion/delta are coordinator offsets. FirstRPCNs retains
	// the child's own duration; independent completion is an observation upper
	// bound including queued proof work, never a consensus formation timestamp.
	observation := pqFreshTransferObservation{Kind: "validated-readback", Arm: arm, NativeHash: strings.TrimPrefix(row.NativeHash, "0x"), ABCIHash: strings.TrimPrefix(row.ABCIHash, "0x"), Height: strconv.FormatInt(row.Height, 10), Index: row.Index, OfferOffsetNs: row.OfferOffsetNs, IndependentCompletionNs: row.IndependentCompletionNs, OfferToIndependentNs: row.OfferToIndependentNs, FirstRPCClock: "client-duration", ClockDomain: domain}
	if first := row.Submission.SubmissionToFirstCommittedRPCObservationNs; first != nil {
		if *first < 0 || *first > pqFreshPhaseMaxNs {
			return nil, errors.New("original child first-RPC duration outside window")
		}
		value := strconv.FormatInt(*first, 10)
		observation.FirstRPCNs = &value
	}
	raw, err := json.Marshal(observation)
	if err != nil || len(pqFreshTransferLogPrefix)+len(raw)+1 > pqFreshDetailLogLineMax {
		return nil, errors.New("bounded verified transfer observation serialization failed")
	}
	return append(append([]byte(pqFreshTransferLogPrefix), raw...), '\n'), nil
}

type pqFreshCommitLog struct {
	mu             sync.Mutex
	writer         io.Writer
	rows           int
	validationRows int
	transferRows   int
	inclusionRows  int
	bytes          int
	last           [2][4]int64
	validationLast [2][4]int64
	transferSeen   [2][pqFreshSenders]bool
	inclusionSeen  [2][pqFreshSenders]bool
	failure        error
}

// Caller holds only this stdout mutex, never an application or trace lock.
// One bounded write, no retry/fsync/worker; the first writer error is sticky.
func (p *pqFreshCommitLog) writeLocked(line []byte) error {
	if p.failure != nil {
		return p.failure
	}
	if p.writer == nil || p.bytes > pqFreshObservationLogBytesMax-len(line) {
		p.failure = errors.New("bounded public observation byte budget exhausted")
		return p.failure
	}
	written, err := p.writer.Write(line)
	if err == nil && written != len(line) {
		err = io.ErrShortWrite
	}
	if err != nil {
		p.failure = err
		return err
	}
	p.bytes += len(line)
	return nil
}

func (p *pqFreshCommitLog) emit(arm string, row pqFreshTraceRow) error {
	line, err := pqFreshCommitObservationLine(arm, row)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.failure != nil {
		return p.failure
	}
	armIndex := 0
	if arm == "after" {
		armIndex = 1
	}
	if p.rows >= pqFreshCommitLogRowsMax || row.Height <= p.last[armIndex][row.Node] {
		p.failure = errors.New("bounded original Commit log count or height exhausted")
		return p.failure
	}
	if err := p.writeLocked(line); err != nil {
		return err
	}
	p.rows++
	p.last[armIndex][row.Node] = row.Height
	return nil
}

func (p *pqFreshCommitLog) emitValidation(arm string, row pqFreshTraceRow, sample CommitValidationTimingSample) error {
	line, err := pqFreshValidationObservationLine(arm, row, sample)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.failure != nil {
		return p.failure
	}
	ai := 0
	if arm == "after" {
		ai = 1
	}
	if p.validationRows >= pqFreshCommitLogRowsMax || row.Height <= p.validationLast[ai][row.Node] || row.Height != p.last[ai][row.Node] {
		p.failure = errors.New("bounded same-Commit validation count or height differs")
		return p.failure
	}
	if err := p.writeLocked(line); err != nil {
		return err
	}
	p.validationRows++
	p.validationLast[ai][row.Node] = row.Height
	return nil
}

func (p *pqFreshCommitLog) emitTransfer(arm, domain string, index int, row pqFreshTransfer) error {
	line, err := pqFreshTransferObservationLine(arm, domain, row)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.failure != nil {
		return p.failure
	}
	ai := 0
	if arm == "after" {
		ai = 1
	}
	if index < 0 || index >= pqFreshSenders || p.transferRows >= pqFreshTransferLogRowsMax || p.transferSeen[ai][index] {
		p.failure = errors.New("bounded original verified callback count differs")
		return p.failure
	}
	if err := p.writeLocked(line); err != nil {
		return err
	}
	p.transferRows++
	p.transferSeen[ai][index] = true
	return nil
}

type pqFreshInclusionObservation struct {
	Arm       string       `json:"a"`
	Clock     string       `json:"c"`
	ABCIHash  string       `json:"t"`
	Height    string       `json:"h"`
	Index     int          `json:"i"`
	BlockHash string       `json:"b"`
	Proposals [4]*[2]int64 `json:"p"`
	// Probe count/ns, full Commit-check count/ns, actual Host-helper call ns.
	// Host-helper wall time now runs on one worker and may overlap other
	// transactions/coordinator calls; only this row's call intervals are disjoint.
	// Zero Commit-check count means the same immutable H was already verified.
	Work [5]int64 `json:"w"`
}

func (p *pqFreshTrace) inclusionTime(row pqFreshTransfer, blockHash string) *[2]int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, committed := range p.rows {
		proposal := committed.proposal
		if committed.Height == row.Height && committed.blockHash == blockHash && committed.FinalizeOK && committed.CommitOK && committed.TimingAvailable && committed.Persistence.Durable && proposal != nil && proposal.blockHash == blockHash && row.Index >= 0 && row.Index < len(proposal.txHashes) && row.Index < len(committed.ExecutionCodes) && committed.ExecutionCodes[row.Index] == 0 && proposal.txHashes[row.Index] == row.ABCIHash && proposal.startNs >= row.OfferOffsetNs && proposal.endNs >= proposal.startNs && proposal.endNs <= committed.FinalizeStartNs && proposal.endNs <= row.IndependentCompletionNs {
			return &[2]int64{proposal.startNs, proposal.endNs}
		}
	}
	return nil
}

func pqFreshInclusionObservationLine(arm, domain string, row pqFreshTransfer, blockHash string, traces []*pqFreshTrace) ([]byte, error) {
	if _, err := pqFreshTransferObservationLine(arm, domain, row); err != nil {
		return nil, err
	}
	if !pqBusinessPin(blockHash, 32) || blockHash != strings.ToLower(blockHash) || blockHash == strings.Repeat("0", 64) || len(traces) != 4 {
		return nil, errors.New("original finalized block hash and four traces required")
	}
	observation := pqFreshInclusionObservation{Arm: arm, Clock: domain, ABCIHash: strings.TrimPrefix(row.ABCIHash, "0x"), Height: strconv.FormatInt(row.Height, 10), Index: row.Index, BlockHash: blockHash, Work: row.coordinatorWork}
	for _, value := range observation.Work {
		if value < 0 || value > pqFreshPhaseMaxNs {
			return nil, errors.New("original callback call work exceeds bounded window")
		}
	}
	if observation.Work[0] == 0 && observation.Work[1] != 0 || observation.Work[2] == 0 && observation.Work[3] != 0 || observation.Work[1]+observation.Work[3]+observation.Work[4] > row.OfferToIndependentNs {
		return nil, errors.New("callback call intervals overlap or uninvoked work was invented")
	}
	for i, trace := range traces {
		if trace == nil || trace.index != i || trace.arm != arm || trace.domain != domain {
			return nil, errors.New("proposal observation trace identity differs")
		}
		observation.Proposals[i] = trace.inclusionTime(row, blockHash)
	}
	raw, err := json.Marshal(observation)
	if err != nil || len(pqFreshInclusionLogPrefix)+len(raw)+1 > pqFreshDetailLogLineMax {
		return nil, errors.New("bounded proposal observation serialization failed")
	}
	return append(append([]byte(pqFreshInclusionLogPrefix), raw...), '\n'), nil
}

func (p *pqFreshCommitLog) emitInclusion(arm, domain string, index int, row pqFreshTransfer, blockHash string, traces []*pqFreshTrace) error {
	line, err := pqFreshInclusionObservationLine(arm, domain, row, blockHash, traces)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.failure != nil {
		return p.failure
	}
	ai := 0
	if arm == "after" {
		ai = 1
	}
	if index < 0 || index >= pqFreshSenders || !p.transferSeen[ai][index] || p.inclusionSeen[ai][index] || p.inclusionRows >= pqFreshTransferLogRowsMax {
		p.failure = errors.New("bounded proposal observation requires its unique verified callback")
		return p.failure
	}
	if err := p.writeLocked(line); err != nil {
		return err
	}
	p.inclusionRows++
	p.inclusionSeen[ai][index] = true
	return nil
}

type pqFreshTrace struct {
	*Application
	mu        sync.Mutex
	index     int
	initial   int64
	origin    time.Time
	domain    string
	arm       string
	public    *pqFreshCommitLog
	pending   *pqFreshTraceRow
	rows      []pqFreshTraceRow
	proposals map[pqFreshProposalKey]*pqFreshProposalTrace
	failure   string
}

func (p *pqFreshTrace) ProcessProposal(ctx context.Context, request *abci.RequestProcessProposal) (*abci.ResponseProcessProposal, error) {
	started := time.Now()
	response, err := p.Application.ProcessProposal(ctx, request)
	ended := time.Now()
	// Preserve the exact original response/error, including every reject. Only
	// bounded successful accepts are observed; overflow is missing DATA, never
	// an altered consensus response or a fabricated zero-duration observation.
	if err == nil && response != nil && response.Status == abci.ResponseProcessProposal_ACCEPT && request != nil && len(request.Hash) == 32 && len(request.Txs) <= pqFreshAccounts+pqFreshSenders && pqNetworkE2EBlockBudget(p.initial, request.Height, 0) == nil {
		row := &pqFreshProposalTrace{blockHash: hex.EncodeToString(request.Hash), startNs: started.Sub(p.origin).Nanoseconds(), endNs: ended.Sub(p.origin).Nanoseconds()}
		if row.startNs >= 0 && row.endNs >= row.startNs && row.endNs <= pqFreshPhaseMaxNs && row.blockHash != strings.Repeat("0", 64) {
			for _, tx := range request.Txs {
				row.txHashes = append(row.txHashes, SignedTransactionHash(tx))
			}
			key := pqFreshProposalKey{height: request.Height, hash: row.blockHash}
			p.mu.Lock()
			if p.proposals == nil {
				p.proposals = make(map[pqFreshProposalKey]*pqFreshProposalTrace)
			}
			if p.proposals[key] == nil && len(p.proposals) < 4*int(pqNetworkE2EMaxBlocks) {
				p.proposals[key] = row
			}
			p.mu.Unlock()
		}
	}
	return response, err
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
	row.blockHash = hex.EncodeToString(request.Hash)
	proposal := p.proposals[pqFreshProposalKey{height: request.Height, hash: row.blockHash}]
	if proposal != nil && proposal.endNs <= row.FinalizeStartNs && len(proposal.txHashes) == len(request.Txs) {
		matches := true
		for i, tx := range request.Txs {
			matches = matches && proposal.txHashes[i] == SignedTransactionHash(tx)
		}
		if matches {
			row.proposal = pqFreshCopyProposal(proposal)
		}
	}
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
	validation, validationAvailable := p.Application.LastCommitValidationTiming()
	p.mu.Lock()
	if p.pending == nil || len(p.rows) >= int(pqNetworkE2EMaxBlocks) {
		p.failure = "Commit without its bounded original FinalizeBlock trace"
		p.mu.Unlock()
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
	p.mu.Unlock()
	if p.public != nil {
		logErr := p.public.emit(p.arm, row)
		if logErr == nil && validationAvailable {
			logErr = p.public.emitValidation(p.arm, row, validation)
		}
		if logErr != nil {
			p.mu.Lock()
			if p.failure == "" {
				p.failure = "bounded original Commit observation log failed"
			}
			p.mu.Unlock()
		}
	}
	return response, err
}

func (p *pqFreshTrace) snapshot() ([]pqFreshTraceRow, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	rows := append([]pqFreshTraceRow(nil), p.rows...)
	for i := range rows {
		rows[i].proposal = pqFreshCopyProposal(rows[i].proposal)
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

func pqFreshActivate(n *pqNetworkE2E, origin time.Time, domain, arm string, commitLog *pqFreshCommitLog) []*pqFreshTrace {
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
		if err := app.SetCommitValidationTimingEnabled(true); err != nil {
			n.t.Fatal("explicit fresh validation timing opt-in failed:", err)
		}
		traces[i] = &pqFreshTrace{Application: app, index: i, initial: n.doc.InitialHeight, origin: origin, domain: domain, arm: arm, public: commitLog}
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

// The hint belongs to one exact payload and one original, immutable BlockStore.
// It records search progress only, never validated execution or consensus facts.
// A nil historical block remains unsearched and cannot be skipped. A matched H
// stays at the hint, so every readiness call reloads the original block and all
// four stored execution results before the unchanged independent proof path.
func pqFreshScanPayload(payload []byte, minimum, tip int64, load func(int64) *cmttypes.Block) (int64, int, int64, error) {
	if len(payload) == 0 || minimum < 1 || tip < 0 || tip == int64(1<<63-1) || load == nil {
		return 0, 0, minimum, errors.New("bounded original payload search inputs required")
	}
	next := minimum
	for h := minimum; h <= tip; h++ {
		block := load(h)
		if block == nil {
			return 0, 0, h, nil
		}
		for ix, tx := range block.Data.Txs {
			if bytes.Equal(tx, payload) {
				return h, ix, h, nil
			}
		}
		next = h + 1
	}
	return 0, 0, next, nil
}

// Reads real BlockStores and stored FinalizeBlock results; it never repeats an
// offer, derives a target from RPC, or treats mempool acceptance as execution.
func pqFreshInclusionReady(n *pqNetworkE2E, payload []byte, minimum *int64) (int64, int, bool) {
	store := n.nodes[0].node.BlockStore()
	h, ix, next, err := pqFreshScanPayload(payload, *minimum, store.Height(), store.LoadBlock)
	if err != nil {
		n.t.Fatal(err)
	}
	*minimum = next
	if h == 0 {
		return 0, 0, false
	}
	// Reload the matched original block. Search progress is not an authority
	// cache, and no cached successful validation bypasses any replica check.
	block := store.LoadBlock(h)
	if block == nil || ix >= len(block.Data.Txs) || !bytes.Equal(block.Data.Txs[ix], payload) {
		return h, ix, false
	}
	for _, item := range n.nodes {
		other := item.node.BlockStore().LoadBlock(h)
		result, err := item.store.LoadFinalizeBlockResponse(h)
		if other == nil || !bytes.Equal(other.Hash(), block.Hash()) || err != nil || result == nil || ix >= len(result.TxResults) {
			return h, ix, false
		}
		if result.TxResults[ix] == nil || result.TxResults[ix].Code != 0 {
			n.t.Fatal("fresh original transaction was included but execution rejected")
		}
	}
	return h, ix, true
}

func pqFreshIncluded(n *pqNetworkE2E, payload []byte) (int64, int) {
	height, index := int64(0), 0
	minimum := n.doc.InitialHeight
	n.wait("fresh exact original bytes committed on all four nodes", func() bool {
		var ready bool
		height, index, ready = pqFreshInclusionReady(n, payload, &minimum)
		return ready
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
	coordinatorWork          [5]int64
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

// Both queues own only their successfully started CLI Wait/finish work. Their
// child context is canceled before joining; the global network context and
// outer process-tree cleanup/UNKNOWN evidence remain independently owned.
func pqFreshCancelJoin(cancel context.CancelFunc, done <-chan pqFreshCompletion, active *int) {
	cancel()
	// Each child sends exactly once after Wait and finish. Both callers retain
	// a four-entry buffer, so Fatal/Goexit cannot strand a completion sender.
	for *active > 0 {
		<-done
		*active = *active - 1
	}
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
	defer pqFreshCancelJoin(cancel, done, &active)
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

// Existing Host progress events carry the complete measured array without
// adding a log record or changing the original512-byte progress-line budget.
// Total includes its children; Capture includes App-lock wait and encoding.
func pqFreshHostProgressLine(arm string, index int, start, end int64, timing *pqBusinessHostPreparationTimings) (string, error) {
	if arm != "before" && arm != "after" || index < 0 || index >= pqFreshSenders || start < 0 || end < start || end > pqFreshPhaseMaxNs {
		return "", errors.New("bounded original Host progress coordinates required")
	}
	line := fmt.Sprintf("PQ_NETWORK_FRESH_PROGRESS arm=%s phase=business-host-context node=-1 index=%d event=complete offsetNs=%d durationNs=%d", arm, index, end, end-start)
	if timing != nil {
		a := [10]int64{timing.TotalWallNs, timing.LightBlocksWallNs, timing.InputEncodingWallNs, timing.CheckpointLoadWallNs, timing.CheckpointCaptureWallNs, timing.CheckpointDecodeWallNs, timing.CheckpointValidateWallNs, timing.CheckpointRetryWaitNs, timing.RetainInputsWallNs, timing.ContextWriteWallNs}
		if a[0] < 0 || a[0] > end-start {
			return "", errors.New("Host timing exceeds its original queued progress span")
		}
		var sum int64
		for _, value := range a[1:] {
			if value < 0 || value > a[0]-sum {
				return "", errors.New("Host timing children overlap or exceed total wall time")
			}
			sum += value
		}
		raw, err := json.Marshal(a)
		if err != nil {
			return "", err
		}
		line += " hostNs=" + string(raw)
	}
	// Reserve96 bytes for the normal Go test filename/line prefix and newline.
	if len(line)+96 > pqFreshDetailLogLineMax {
		return "", errors.New("Host progress exceeds original line allowance")
	}
	return line, nil
}

func pqFreshHostStage(t *testing.T, origin time.Time, arm string, index int) func(*pqBusinessHostPreparationTimings) {
	t.Helper()
	start := time.Since(origin).Nanoseconds()
	t.Logf("PQ_NETWORK_FRESH_PROGRESS arm=%s phase=business-host-context node=-1 index=%d event=begin offsetNs=%d durationNs=0", arm, index, start)
	return func(timing *pqBusinessHostPreparationTimings) {
		t.Helper()
		line, err := pqFreshHostProgressLine(arm, index, start, time.Since(origin).Nanoseconds(), timing)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s", line)
	}
}

// Only the error-return Host preparation runs on this single worker. The
// coordinator still owns all Fatal helpers, original CLI Starts and proof result
// validation. A reservation covers queued + preparing + running proof work, so
// those stages together never exceed the original four proof slots.
type pqFreshHostRequest struct {
	ordinal, index int
	height         int64
	wire, payload  []byte
}

type pqFreshHostPrepared struct {
	ordinal    int
	path, pin  string
	durationNs int64
	err        error
	timing     pqBusinessHostPreparationTimings
}

type pqFreshHostQueue struct {
	ctx     context.Context
	cancel  context.CancelFunc
	jobs    chan pqFreshHostRequest
	results chan pqFreshHostPrepared
	stopped chan struct{}
	// Only the original coordinator accesses the following lifecycle state.
	issued, delivered, reserved []bool
	ready                       map[int]pqFreshHostPrepared
	outstanding                 int
}

func pqFreshNewHostQueue(parent context.Context, count int, prepare func(context.Context, pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error)) (*pqFreshHostQueue, error) {
	if parent == nil || count < 1 || count > pqFreshSenders || prepare == nil {
		return nil, errors.New("bounded error-return Host preparation required")
	}
	ctx, cancel := context.WithCancel(parent)
	q := &pqFreshHostQueue{ctx: ctx, cancel: cancel, jobs: make(chan pqFreshHostRequest, pqFreshInFlight), results: make(chan pqFreshHostPrepared, pqFreshInFlight), stopped: make(chan struct{}), issued: make([]bool, count), delivered: make([]bool, count), reserved: make([]bool, count), ready: make(map[int]pqFreshHostPrepared)}
	go func() {
		defer close(q.stopped)
		for {
			select {
			case <-ctx.Done():
				return
			case job := <-q.jobs:
				if ctx.Err() != nil {
					return // Never prepare another queued target after cancellation.
				}
				started := time.Now()
				path, pin, timing, err := prepare(ctx, job)
				// At most four reservations exist, and each publishes once.
				// The original coordinator can therefore cancel/join without
				// draining results or stranding this worker on an abandoned send.
				q.results <- pqFreshHostPrepared{ordinal: job.ordinal, path: path, pin: pin, durationNs: time.Since(started).Nanoseconds(), err: err, timing: timing}
				if err != nil {
					return // Retain the original error; do not start later targets.
				}
			}
		}
	}()
	return q, nil
}

func (q *pqFreshHostQueue) close() {
	q.cancel()
	<-q.stopped
}

func (q *pqFreshHostQueue) enqueue(request pqFreshHostRequest) (bool, error) {
	i := request.ordinal
	if i < 0 || i >= len(q.issued) || request.height < 1 || request.index < 0 || len(request.wire) == 0 || len(request.payload) == 0 || q.issued[i] {
		return false, errors.New("one exact original Host target per reservation required")
	}
	if err := q.ctx.Err(); err != nil {
		return false, err
	}
	if q.outstanding >= pqFreshInFlight {
		return false, nil
	}
	// Detached inputs keep a worker from observing later row/result mutation.
	request.wire, request.payload = bytes.Clone(request.wire), bytes.Clone(request.payload)
	q.issued[i], q.reserved[i] = true, true
	q.outstanding++
	q.jobs <- request
	return true, nil
}

func (q *pqFreshHostQueue) take(i int) (pqFreshHostPrepared, bool, error) {
	if i < 0 || i >= len(q.issued) || !q.reserved[i] || q.delivered[i] {
		return pqFreshHostPrepared{}, false, errors.New("Host completion has no undelivered original reservation")
	}
	for {
		select {
		case result := <-q.results:
			_, duplicate := q.ready[result.ordinal]
			if result.ordinal < 0 || result.ordinal >= len(q.issued) || !q.reserved[result.ordinal] || q.delivered[result.ordinal] || duplicate {
				return pqFreshHostPrepared{}, false, errors.New("duplicate or foreign Host preparation completion")
			}
			q.ready[result.ordinal] = result
		default:
			result, ok := q.ready[i]
			if ok {
				delete(q.ready, i)
				q.delivered[i] = true
			}
			return result, ok, nil
		}
	}
}

func (q *pqFreshHostQueue) release(i int) error {
	if i < 0 || i >= len(q.issued) || !q.reserved[i] || !q.delivered[i] || q.outstanding < 1 {
		return errors.New("proof completion has no prepared original Host reservation")
	}
	q.reserved[i] = false
	q.outstanding--
	return nil
}

// The coordinator owns all Fatal validation and both bounded child Wait sets.
// Proof work can start for a completed original offer while later offers remain
// paced. It never reoffers UNKNOWN, moves work outside the guard, or increases
// either original four-slot queue. At most4 offer clients +4 readback clients
// +4 verifier children + test/gateway/controller =15 owned processes, below16.
func pqFreshPipeline(parent context.Context, count int, started time.Time, offer func(context.Context, int, chan<- pqFreshCompletion) (time.Time, error), offered func(pqFreshCompletion) error, readback func(context.Context, int, chan<- pqFreshCompletion) (bool, error), verified func(pqFreshCompletion) error) (int, error) {
	if parent == nil || count < 1 || count > pqFreshSenders || started.IsZero() || offer == nil || offered == nil || readback == nil || verified == nil {
		return 0, errors.New("bounded original offer/readback pipeline required")
	}
	ctx, cancel := context.WithCancel(parent)
	offerDone, proofDone := make(chan pqFreshCompletion, pqFreshInFlight), make(chan pqFreshCompletion, pqFreshInFlight)
	next, offerActive, proofActive, completed, maximum := 0, 0, 0, 0, 0
	offerSeen, proofStarted, proofSeen := make([]bool, count), make([]bool, count), make([]bool, count)
	defer pqFreshCancelJoin(cancel, offerDone, &offerActive)
	defer pqFreshCancelJoin(cancel, proofDone, &proofActive)
	var last time.Time
	nextOfferAt := func() time.Time {
		due := started.Add(time.Duration(next) * pqFreshInterval)
		if !last.IsZero() && due.Before(last.Add(pqFreshInterval)) {
			due = last.Add(pqFreshInterval)
		}
		return due
	}
	for completed < count {
		if err := ctx.Err(); err != nil {
			return maximum, err
		}
		if next < count && offerActive < pqFreshInFlight {
			if !time.Now().Before(nextOfferAt()) {
				at, err := offer(ctx, next, offerDone)
				if err != nil {
					return maximum, fmt.Errorf("original offer %d failed to start: %w", next, err)
				}
				last = at
				next++
				offerActive++
				if offerActive > maximum {
					maximum = offerActive
				}
				continue
			}
		}
		recheckOffer := false
		for i := 0; i < count && proofActive < pqFreshInFlight; i++ {
			if !offerSeen[i] || proofStarted[i] {
				continue
			}
			// A false readiness result can still include slow historical reads
			// or complete validation. Do not scan another target past a paced
			// offer's due time; preserve every target for the next iteration.
			if next < count && offerActive < pqFreshInFlight && !time.Now().Before(nextOfferAt()) {
				recheckOffer = true
				break
			}
			ok, err := readback(ctx, i, proofDone)
			if err != nil {
				return maximum, fmt.Errorf("original readback %d failed before readiness/start: %w", i, err)
			}
			if ok {
				proofStarted[i] = true
				proofActive++
				recheckOffer = true
				break // Check paced offers again before another Host preparation.
			}
		}
		if recheckOffer {
			continue
		}
		select {
		case result := <-offerDone:
			offerActive-- // A successfully started child's actual Wait completed.
			if result.index < 0 || result.index >= next || offerSeen[result.index] {
				return maximum, errors.New("offer completion has no unique original Start")
			}
			if err := offered(result); err != nil {
				return maximum, err
			}
			offerSeen[result.index] = true
		case result := <-proofDone:
			proofActive--
			if result.index < 0 || result.index >= count || !proofStarted[result.index] || proofSeen[result.index] {
				return maximum, errors.New("proof completion has no unique original readback Start")
			}
			if err := verified(result); err != nil {
				return maximum, err
			}
			proofSeen[result.index] = true
			completed++
		case <-ctx.Done():
			return maximum, ctx.Err()
		case <-time.After(5 * time.Millisecond):
		}
	}
	return maximum, nil
}

func pqFreshTransfers(n *pqNetworkE2E, b *pqNetworkBusiness, accounts []pqFreshAccount, baseline bool, origin time.Time, arm, domain string, public *pqFreshCommitLog, traces []*pqFreshTrace) ([]pqFreshTransfer, int, int64, int64) {
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
	finishOffers, finishReadbacks := make([]func(), len(rows)), make([]func(), len(rows))
	finishContexts := make([]func(*pqBusinessHostPreparationTimings), len(rows))
	var hostQueue *pqFreshHostQueue
	// This join runs before the enclosing arm closes the Gateway or nodes,
	// including when any original coordinator Fatal helper calls Goexit.
	defer func() {
		if hostQueue != nil {
			hostQueue.close()
		}
	}()
	contextPins, readbackFiles := make([]string, len(rows)), make([]string, len(rows))
	included, evidenced := make([]bool, len(rows)), make([]bool, len(rows))
	searchHeights := make([]int64, len(rows))
	for i := range searchHeights {
		searchHeights[i] = n.doc.InitialHeight
	}
	includedCount, evidenceCount := 0, 0
	verifiedHeights := make(map[int64]bool)
	var finishInclusion, finishEvidence func()
	verifier := b.manifest.Binaries["ynx-consensus-proof-verify"]
	started := time.Now()
	maximum, err := pqFreshPipeline(n.ctx, len(rows), started, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		tip := n.nodes[0].node.BlockStore().Height()
		if pqNetworkE2EBlockBudget(n.doc.InitialHeight, tip, pqNetworkE2ESubmissionBlocks) != nil {
			return time.Time{}, errors.New("original block cap refuses another signed business offer")
		}
		label := fmt.Sprintf("member-%02d-submit", i)
		out := filepath.Join(b.root, label+".json")
		args := pqFreshArgs([]string{"-pq-member", rows[i].path, "-pq-gateway", b.url, "-output", out, "-timeout", "10s"}, baseline)
		finishOffers[i] = pqFreshStage(n.t, origin, arm, "business-offer", -1, i)
		offered, err := pqFreshStartContext(n, b, ctx, done, i, label, args)
		if err == nil {
			rows[i].offered, rows[i].OfferOffsetNs = offered, offered.Sub(origin).Nanoseconds()
			rows[i].OfferLatenessNs = offered.Sub(started.Add(time.Duration(i) * pqFreshInterval)).Nanoseconds()
		}
		return offered, err
	}, func(result pqFreshCompletion) error {
		row := &rows[result.index]
		row.ObservedCompletionNs = result.ended.Sub(origin).Nanoseconds()
		var err error
		row.Submission, err = pqFreshReport(filepath.Join(b.root, fmt.Sprintf("member-%02d-submit.json", result.index)))
		var exit *exec.ExitError
		if err != nil || result.err != nil && (!errors.As(result.err, &exit) || exit.ExitCode() != 1 || row.Submission.Status != "submission_unknown") || pqFreshSubmissionValid(row.Submission, *row, baseline) != nil {
			return errors.New("original offer result rejected; do not repeat an UNKNOWN transaction")
		}
		finishOffers[result.index]()
		return nil
	}, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		row := &rows[i]
		if hostQueue == nil {
			// Use the original pipeline child context: cancellation reaches
			// Host preparation before the pipeline joins its two CLI Wait sets.
			var err error
			hostQueue, err = pqFreshNewHostQueue(ctx, len(rows), func(ctx context.Context, request pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error) {
				path, pin, _, timing, err := b.prepareHostContextMeasured(ctx, n, fmt.Sprintf("member-%02d", request.ordinal), PQTransferType, request.wire, request.payload, request.height, request.index)
				return path, pin, timing, err
			})
			if err != nil {
				return false, err
			}
		}
		if hostQueue.issued[i] {
			prepared, available, err := hostQueue.take(i)
			if err != nil || !available {
				return false, err
			}
			row.coordinatorWork[4] = prepared.durationNs
			if prepared.err != nil {
				finishContexts[i](nil) // Partial phases are not invented as zero timings.
				return false, prepared.err
			}
			finishContexts[i](&prepared.timing)
			out := filepath.Join(b.root, fmt.Sprintf("member-%02d-readback.json", i))
			contextPins[i], readbackFiles[i] = prepared.pin, out
			args := pqFreshArgs([]string{"-pq-member", row.path, "-pq-gateway", b.url, "-pq-readback-only", "-pq-collect-proof", "-pq-proof-verifier", verifier.Path, "-pq-proof-verifier-sha256", verifier.SHA256, "-pq-trust-context", prepared.path, "-pq-trust-context-sha256", prepared.pin, "-output", out, "-timeout", "10s"}, baseline)
			finishReadbacks[i] = pqFreshStage(n.t, origin, arm, "business-independent-readback", -1, i)
			_, err = pqFreshStartContext(n, b, ctx, done, i, fmt.Sprintf("member-%02d-readback", i), args)
			return err == nil, err
		}
		if hostQueue.outstanding == pqFreshInFlight {
			return false, nil // Preparing and queued targets retain their proof slots.
		}
		if finishInclusion == nil {
			finishInclusion = pqFreshStage(n.t, origin, arm, "business-original-inclusion", -1, -1)
		}
		probeStarted := time.Now()
		finishProbe := func() {
			row.coordinatorWork[0]++
			row.coordinatorWork[1] += time.Since(probeStarted).Nanoseconds()
		}
		h, ix, ready := pqFreshInclusionReady(n, row.payload, &searchHeights[i])
		if h != 0 {
			row.Height, row.Index = h, ix
		}
		if !ready {
			finishProbe()
			return false, nil // Only original Host stores are queried, never reoffer.
		}
		observed := row.Submission
		if observed.SubmissionToFirstCommittedRPCObservationNs != nil && (observed.FirstCommittedRPCHeight != uint64(row.Height) || observed.FirstCommittedRPCIndex == nil || int(*observed.FirstCommittedRPCIndex) != row.Index) {
			finishProbe()
			return false, errors.New("first original RPC coordinates differ from independent Host stores")
		}
		if !included[i] {
			included[i], includedCount = true, includedCount+1
			if includedCount == len(rows) {
				finishInclusion()
			}
		}
		plan, err := pqFreshCommitHeightPlan(n.doc.InitialHeight, []int64{row.Height})
		if err != nil {
			finishProbe()
			return false, err
		}
		// Wait for immutable block/successor evidence without globally draining
		// other offers. The original full four-node AND/quorum checks below
		// still run once per actual historical height before any Host target.
		for _, height := range plan {
			for _, item := range n.nodes {
				set, err := item.store.LoadValidators(height)
				if item.node.BlockStore().LoadBlock(height) == nil || item.node.BlockStore().LoadSeenCommit(height) == nil || err != nil || set == nil {
					finishProbe()
					return false, nil
				}
			}
		}
		finishProbe()
		if finishEvidence == nil {
			finishEvidence = pqFreshStage(n.t, origin, arm, "business-commit-evidence", -1, -1)
		}
		for _, height := range plan {
			if !verifiedHeights[height] {
				verifyStarted := time.Now()
				n.verifyCommit(height, true, 4, false)
				row.coordinatorWork[2]++
				row.coordinatorWork[3] += time.Since(verifyStarted).Nanoseconds()
				verifiedHeights[height] = true
			}
		}
		if !evidenced[i] {
			evidenced[i], evidenceCount = true, evidenceCount+1
			if evidenceCount == len(rows) {
				finishEvidence()
			}
		}
		finishContexts[i] = pqFreshHostStage(n.t, origin, arm, i)
		queued, err := hostQueue.enqueue(pqFreshHostRequest{ordinal: i, index: row.Index, height: row.Height, wire: row.wire, payload: row.payload})
		if err != nil {
			return false, fmt.Errorf("original Host preparation reservation failed after readiness: %w", err)
		}
		if !queued {
			return false, errors.New("original Host preparation reservation lost its bounded slot")
		}
		return false, nil
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
		row.IndependentCompletionNs = result.ended.Sub(origin).Nanoseconds()
		row.OfferToIndependentNs = result.ended.Sub(row.offered).Nanoseconds()
		row.IndependentTimingMeaning = "upper-bound observation including queued proof verification; not consensus formation time"
		finishReadbacks[result.index]()
		if public != nil {
			if err := public.emitTransfer(arm, domain, result.index, *row); err != nil {
				return fmt.Errorf("bounded original verified callback log failed: %w", err)
			}
			block := n.nodes[0].node.BlockStore().LoadBlock(row.Height)
			if block == nil {
				return errors.New("original verified callback block unavailable; do not invent proposal timing")
			}
			if err := public.emitInclusion(arm, domain, result.index, *row, hex.EncodeToString(block.Hash()), traces); err != nil {
				return fmt.Errorf("bounded original proposal observation failed: %w", err)
			}
		}
		return hostQueue.release(result.index)
	})
	if err != nil {
		n.t.Fatal("original offer/readback pipeline failed after joining owned work; preserve UNKNOWN:", err)
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

func pqFreshArmRun(t *testing.T, ctx context.Context, build pqFreshBuild, root, name string, baseline bool, origin time.Time, domain string, commitLog *pqFreshCommitLog) pqFreshArm {
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
	traces := pqFreshActivate(n, origin, domain, name, commitLog)
	births := pqFreshBirths(n, b, accounts, origin, name)
	finish = pqFreshStage(t, origin, name, "gateway-start", -1, -1)
	b.startGateway(n)
	finish()
	rows, maxInFlight, elapsed, businessStart := pqFreshTransfers(n, b, accounts, baseline, origin, name, domain, commitLog, traces)
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
	publicLog := &pqFreshCommitLog{writer: os.Stdout}
	arms := []pqFreshArm{pqFreshArmRun(t, ctx, build, filepath.Join(root, "before"), "before", true, origin, domain, publicLog)}
	arms = append(arms, pqFreshArmRun(t, ctx, build, filepath.Join(root, "after"), "after", false, origin, domain, publicLog))
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

func TestPQNetworkFreshOfferCleanupJoinsBeforeFatalUnwindCompletes(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	done := make(chan pqFreshCompletion, pqFreshInFlight)
	canceled, finished := make(chan int, pqFreshInFlight), make(chan int, pqFreshInFlight)
	releaseFinish := make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(releaseFinish) })
	var workers sync.WaitGroup
	// Two offers have successfully started before a later Start/report Fatal.
	// This tests the real shared unwind helper, without a node, ELF or replay.
	active := 2
	for index := 0; index < active; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			<-ctx.Done()
			canceled <- index
			<-releaseFinish
			finished <- index
			done <- pqFreshCompletion{index: index, err: ctx.Err(), ended: time.Now()}
		}(index)
	}
	joined := make(chan struct{})
	go func() {
		defer close(joined)
		defer pqFreshCancelJoin(cancel, done, &active)
		runtime.Goexit() // The same defer-unwind semantics as testing.Fatal.
	}()
	deadline := time.After(time.Second)
	for i := 0; i < 2; i++ {
		select {
		case <-canceled:
		case <-deadline:
			t.Fatal("owned offer context was not canceled during Fatal unwind")
		}
	}
	select {
	case <-joined:
		t.Fatal("offer cleanup returned before outstanding Wait/finish work joined")
	default:
	}
	if parent.Err() != nil {
		t.Fatal("offer cleanup canceled the independently owned network context")
	}
	release.Do(func() { close(releaseFinish) })
	select {
	case <-joined:
	case <-deadline:
		t.Fatal("offer cleanup did not join its released original completions")
	}
	if active != 0 || len(finished) != 2 || len(done) != 0 {
		t.Fatal("offer unwind lost a finished original child", active, len(finished), len(done))
	}
	workers.Wait()
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

type pqFreshCommitWriterFunc func([]byte) (int, error)

func (f pqFreshCommitWriterFunc) Write(raw []byte) (int, error) { return f(raw) }

func TestPQNetworkFreshCommitObservationFailureRetainsActualTiming(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	app.SetCommitTimingEnabled(true)
	if err := app.SetCommitValidationTimingEnabled(true); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	trace := &pqFreshTrace{Application: app, initial: int64(migration.Height) + 1, origin: time.Now(), domain: fmt.Sprintf("pq-fresh:%d", os.Getpid()), arm: "before"}
	checks := 0
	trace.public = &pqFreshCommitLog{writer: pqFreshCommitWriterFunc(func(raw []byte) (int, error) {
		if !app.mu.TryLock() {
			return 0, errors.New("stdout writer entered under application lock")
		}
		app.mu.Unlock()
		if !trace.mu.TryLock() {
			return 0, errors.New("stdout writer entered under trace lock")
		}
		trace.mu.Unlock()
		checks++
		return output.Write(raw)
	})}
	ctx := context.Background()
	for nonce := uint64(1); nonce <= 2; nonce++ {
		height := int64(migration.Height) + int64(nonce)
		response, err := trace.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{journalTransfer(t, nonce)}})
		if err != nil || response == nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
			t.Fatal("actual FinalizeBlock fixture failed", err)
		}
		var original []byte
		if nonce == 2 {
			original, err = os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			app.pending.AppHash = "invalid-hash" // Actual persistence validation failure, not a manufactured timing sample.
		}
		committed, err := trace.Commit(ctx, &abci.RequestCommit{})
		if nonce == 1 && (err != nil || committed == nil) {
			t.Fatal("actual first Commit failed", err)
		}
		if nonce == 2 {
			if err == nil || committed != nil || !strings.Contains(err.Error(), "persist finalized YNX state") {
				t.Fatal("observation changed the original failed Commit return", err)
			}
			after, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(original, after) || app.committed.Height != height-1 {
				t.Fatal("failed Commit changed original durable state", readErr)
			}
		}
	}
	if checks != 4 || trace.public.rows != 2 || trace.public.validationRows != 2 {
		t.Fatal("completed callbacks were not immediately retained outside original locks")
	}
	allLines := bytes.Split(bytes.TrimSuffix(output.Bytes(), []byte{'\n'}), []byte{'\n'})
	if len(allLines) != 4 {
		t.Fatal("later failure erased or duplicated prior Commit lines")
	}
	var lines [][]byte
	for i, line := range allLines {
		if i%2 == 0 {
			lines = append(lines, line)
			continue
		}
		var detail pqFreshValidationObservation
		raw := bytes.TrimPrefix(line, []byte(pqFreshValidationLogPrefix))
		failedPhase := -1
		if i == 3 {
			failedPhase = len(pqFreshValidationPhases) - 1
		}
		if !bytes.HasPrefix(line, []byte(pqFreshValidationLogPrefix)) || len(line)+1 > pqFreshDetailLogLineMax || pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &detail) != nil || detail.Arm != "before" || detail.Node != 0 || detail.Height != strconv.FormatInt(int64(migration.Height)+int64(i/2)+1, 10) || detail.FailedPhase != failedPhase {
			t.Fatal("same-attempt validation success/failure was lost or promoted")
		}
		var shape map[string]json.RawMessage
		if json.Unmarshal(raw, &shape) != nil || len(shape) != 7 {
			t.Fatal("validation projection changed the original sample or added qualification")
		}
	}
	for i, line := range lines {
		if len(line)+1 > pqFreshCommitLogLineMax || !bytes.HasPrefix(line, []byte(pqFreshCommitLogPrefix)) {
			t.Fatal("failure-retained line escaped its bounded public format")
		}
		raw := bytes.TrimPrefix(line, []byte(pqFreshCommitLogPrefix))
		var observation pqFreshCommitObservation
		if pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &observation) != nil || observation.Classification != "local-persistence-observation" || observation.Arm != "before" || observation.NodeIndex != 0 || observation.PID != os.Getpid() || observation.Clock != pqFreshClock || observation.ClockDomain != trace.domain || observation.Height != strconv.FormatInt(int64(migration.Height)+int64(i)+1, 10) || !observation.TimingAvailable || observation.CommitTiming == nil {
			t.Fatal("original callback coordinates or numeric timing were lost")
		}
		var shape map[string]json.RawMessage
		if json.Unmarshal(raw, &shape) != nil || len(shape) != 17 {
			t.Fatal("Commit observation acquired extra fields")
		}
		for _, key := range []string{"qualified", "finalized", "independentFinalityVerified", "businessFinalized", "transaction", "owner", "path"} {
			if _, ok := shape[key]; ok {
				t.Fatal("local Commit logging exposed private data or invented finality")
			}
		}
		if observation.CommitOK != (i == 0) || observation.CommitTiming.Durable != (i == 0) || observation.CommitTiming.Height != int64(migration.Height)+int64(i)+1 {
			t.Fatal("failed persistence was promoted or a prior durable sample was reused")
		}
		for _, key := range []string{"finalizeStartNs", "finalizeEndNs", "commitStartNs", "commitEndNs", "commitCallNs"} {
			var value int64
			if json.Unmarshal(shape[key], &value) != nil || value < 0 || value > pqFreshPhaseMaxNs {
				t.Fatal("original coordinator times are not bounded JSON integers")
			}
		}
	}
	rows, failure := trace.snapshot()
	if failure == "" || len(rows) != 2 || rows[1].CommitOK || rows[1].Persistence.Durable {
		t.Fatal("original failed callback no longer fails the success-summary path")
	}
	failed := rows[1]
	phase := []pqFreshPhaseRow{{Arm: "before", NodeIndex: 0, Height: strconv.FormatInt(failed.Height, 10), ClockDomain: trace.domain, StartNs: failed.CommitStartNs, EndNs: failed.CommitEndNs, Phase: "commit", CommitTiming: &failed.Persistence}}
	if err := pqFreshPhaseRowsValidate(phase, trace.domain); err == nil || !strings.Contains(err.Error(), "durable Commit") {
		t.Fatal("failure-retained numeric observation became qualified phase evidence", err)
	}
	if bytes.Contains(output.Bytes(), []byte("PQ_NETWORK_FRESH_BUSINESS_SUMMARY")) {
		t.Fatal("failure log emitted the complete paired-business summary")
	}
}

func TestPQNetworkFreshCommitObservationBoundsAndWriteFailure(t *testing.T) {
	stages := map[string]int64{}
	for _, stage := range []string{"validate", "json_encode", "delta_encode", "journal_maintenance", "prepare_file", "write", "file_sync", "close_file", "rename", "directory_sync", "version_checkpoint"} {
		stages[stage] = int64(time.Second)
	}
	row := pqFreshTraceRow{PID: 1<<31 - 1, Clock: pqFreshClock, ClockDomain: "pq-fresh:2147483647", Height: 1<<63 - 1, Transactions: int(^uint(0) >> 1), FinalizeStartNs: 100000000000, FinalizeEndNs: 100000000000, CommitStartNs: 100000000000, CommitEndNs: pqFreshPhaseMaxNs, CommitCallNs: 20000000000, TimingAvailable: true, Persistence: CommitTimingSample{Height: 1<<63 - 1, Storage: "snapshot-journal-v1", ElapsedNs: 20000000000, PayloadBytes: 1<<53 - 1, StagesNs: stages}}
	line, err := pqFreshCommitObservationLine("before", row)
	if err != nil || len(line) > pqFreshCommitLogLineMax || pqFreshCommitLogRowsMax != 384 || pqFreshCommitLogRowsMax*pqFreshCommitLogLineMax != 384<<10 || pqFreshObservationLogBytesMax+(256<<10)+312*512 != 1044480 || pqFreshObservationLogBytesMax+(256<<10)+312*512+4096 != 1<<20 {
		t.Fatal("maximum public Commit lines no longer fit the original stdout budget", len(line), err)
	}
	missing := row
	missing.TimingAvailable = false
	missing.Persistence.Durable = true // An unavailable sample cannot leak an older successful attempt.
	missingLine, err := pqFreshCommitObservationLine("before", missing)
	if err != nil || !bytes.Contains(missingLine, []byte(`"timingAvailable":false,"commitTiming":null`)) {
		t.Fatal("missing original timing acquired a prior durable sample", err)
	}
	for _, scenario := range []string{"unknown-arm", "clock", "domain", "node", "time", "duration", "stage", "stage-time", "storage", "payload"} {
		bad := row
		bad.Persistence.StagesNs = make(map[string]int64, len(stages))
		for key, value := range stages {
			bad.Persistence.StagesNs[key] = value
		}
		arm := "before"
		switch scenario {
		case "unknown-arm":
			arm = "private-canary"
		case "clock":
			bad.Clock = "private-canary"
		case "domain":
			bad.ClockDomain = "private-canary"
		case "node":
			bad.Node = 4
		case "time":
			bad.CommitEndNs = pqFreshPhaseMaxNs + 1
		case "duration":
			bad.CommitCallNs++
		case "stage":
			bad.Persistence.StagesNs["private-canary"] = 1
		case "stage-time":
			bad.Persistence.StagesNs["write"] = -1
		case "storage":
			bad.Persistence.Storage = "private-canary"
		case "payload":
			bad.Persistence.PayloadBytes = -1
		}
		var output bytes.Buffer
		log := &pqFreshCommitLog{writer: &output}
		if err := log.emit(arm, bad); err == nil || output.Len() != 0 || log.rows != 0 {
			t.Fatal("invalid coordinate/stage reached stdout", scenario, err)
		}
	}
	var output bytes.Buffer
	log := &pqFreshCommitLog{writer: &output}
	detail := CommitValidationTimingSample{Valid: true, PhaseNs: make(map[string]int64)}
	for _, phase := range pqFreshValidationPhases {
		detail.PhaseNs[phase] = 0
	}
	for _, arm := range []string{"before", "after"} {
		for node := 0; node < 4; node++ {
			for height := int64(1); height <= pqNetworkE2EMaxBlocks; height++ {
				row.Node, row.Height, row.Persistence.Height = node, height, height
				if err := log.emit(arm, row); err != nil {
					t.Fatal(err)
				}
				detail.Height = height
				if err := log.emitValidation(arm, row, detail); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	before := output.Len()
	row.Height, row.Persistence.Height = pqNetworkE2EMaxBlocks+1, pqNetworkE2EMaxBlocks+1
	if log.rows != pqFreshCommitLogRowsMax || log.validationRows != pqFreshCommitLogRowsMax || log.bytes != output.Len() || output.Len() > pqFreshCommitLogRowsMax*(pqFreshCommitLogLineMax+pqFreshDetailLogLineMax) || log.emit("after", row) == nil || output.Len() != before {
		t.Fatal("Commit stdout count/byte budget grew after its original cap")
	}
	firstCause := errors.New("owned stdout unavailable")
	writes := 0
	broken := &pqFreshCommitLog{writer: pqFreshCommitWriterFunc(func([]byte) (int, error) { writes++; return 0, firstCause })}
	if !errors.Is(broken.emit("before", row), firstCause) || !errors.Is(broken.emit("before", row), firstCause) || writes != 1 || broken.rows != 0 {
		t.Fatal("failed stdout was retried or its first cause replaced")
	}
	short := &pqFreshCommitLog{writer: pqFreshCommitWriterFunc(func(raw []byte) (int, error) { return len(raw) - 1, nil })}
	if !errors.Is(short.emit("before", row), io.ErrShortWrite) || short.rows != 0 {
		t.Fatal("partial stdout write was called a complete observation")
	}
}

func TestPQNetworkFreshValidationObservationExactPrefixAndBounds(t *testing.T) {
	// A legal joint maximum digit-width vector, not 34 independent 120s
	// maxima: 9*10s+25*1s=115s within the unchanged 120s observation bound.
	row := pqFreshTraceRow{Node: 3, Height: 1<<63 - 1, CommitCallNs: pqFreshPhaseMaxNs, CommitOK: true, TimingAvailable: true, Persistence: CommitTimingSample{Height: 1<<63 - 1, ElapsedNs: pqFreshPhaseMaxNs, StagesNs: map[string]int64{"validate": pqFreshPhaseMaxNs}}}
	detail := CommitValidationTimingSample{Height: row.Height, Valid: true, PhaseNs: make(map[string]int64), HashDocumentNs: 500000000, HashEncodeDigestNs: 500000000}
	for i, phase := range pqFreshValidationPhases {
		ns := int64(time.Second)
		if i < 9 {
			ns *= 10
		}
		detail.PhaseNs[phase], detail.ElapsedNs = ns, detail.ElapsedNs+ns
	}
	line, err := pqFreshValidationObservationLine("before", row, detail)
	if err != nil || len(line) > pqFreshDetailLogLineMax || len(pqFreshValidationPhases) != 34 {
		t.Fatal("jointly bounded original validation phases exceeded the existing stdout cap", len(line), err)
	}
	var decoded pqFreshValidationObservation
	raw := bytes.TrimSuffix(bytes.TrimPrefix(line, []byte(pqFreshValidationLogPrefix)), []byte{'\n'})
	if pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &decoded) != nil || decoded.Height != strconv.FormatInt(row.Height, 10) || decoded.FailedPhase != -1 || decoded.Phases[0] != 10000000000 || decoded.Phases[33] != 1000000000 || decoded.HashDocumentNs != detail.HashDocumentNs || decoded.HashEncodeDigestNs != detail.HashEncodeDigestNs {
		t.Fatal("validation projection changed original numeric values or fixed order")
	}
	for _, scenario := range []string{"stale-height", "unavailable", "missing-phase", "unknown-phase", "negative", "overlap", "sum", "failed-valid", "unknown-failure", "hash-child", "outer-validate", "outer-call"} {
		t.Run(scenario, func(t *testing.T) {
			badRow, bad := row, detail
			bad.PhaseNs = make(map[string]int64, len(detail.PhaseNs))
			for phase, ns := range detail.PhaseNs {
				bad.PhaseNs[phase] = ns
			}
			switch scenario {
			case "stale-height":
				bad.Height--
			case "unavailable":
				badRow.TimingAvailable = false
			case "missing-phase":
				delete(bad.PhaseNs, "anchor")
			case "unknown-phase":
				bad.PhaseNs["private-canary"] = 0
			case "negative":
				bad.PhaseNs["anchor"] = -1
			case "overlap":
				bad.PhaseNs["anchor"] = pqFreshPhaseMaxNs
			case "sum":
				bad.ElapsedNs++
			case "failed-valid":
				bad.FailedPhase = "anchor"
			case "unknown-failure":
				bad.Valid, bad.FailedPhase, badRow.CommitOK = false, "private-canary", false
			case "hash-child":
				bad.HashEncodeDigestNs++
			case "outer-validate":
				badRow.Persistence.StagesNs = map[string]int64{"validate": detail.ElapsedNs - 1}
			case "outer-call":
				badRow.CommitCallNs = badRow.Persistence.ElapsedNs - 1
			}
			if projected, err := pqFreshValidationObservationLine("before", badRow, bad); err == nil || projected != nil {
				t.Fatal("foreign/overlapping/non-prefix detail reached stdout", scenario)
			}
		})
	}
	failed := CommitValidationTimingSample{Height: row.Height, FailedPhase: "pq_state", ElapsedNs: 5, PhaseNs: map[string]int64{}}
	for _, phase := range pqFreshValidationPhases[:5] {
		failed.PhaseNs[phase] = 1
	}
	row.CommitOK, row.Persistence.StagesNs = false, nil
	line, err = pqFreshValidationObservationLine("after", row, failed)
	if err != nil || json.Unmarshal(bytes.TrimPrefix(line, []byte(pqFreshValidationLogPrefix)), &decoded) != nil || decoded.FailedPhase != 4 || decoded.Phases[4] != 1 || decoded.Phases[5] != 0 {
		t.Fatal("actual failed prefix was discarded or missing later phases claimed success", err)
	}
	failed.PhaseNs["migration_trace_lots"] = 0
	if _, err := pqFreshValidationObservationLine("after", row, failed); err == nil {
		t.Fatal("unexecuted phase was accepted as an observed zero-duration stage")
	}
	failed.PhaseNs = map[string]int64{"anchor": 1, "validator_registry": 1, "engine_schedule": 1, "engine_snapshot": 1, "pq_state": 1}
	failed.HashDocumentNs = 1
	if _, err := pqFreshValidationObservationLine("after", row, failed); err == nil {
		t.Fatal("hash child appeared before app_hash was executed")
	}
}

func TestPQNetworkFreshVerifiedCallbackFailureRetainsOriginalFields(t *testing.T) {
	const domain = "pq-fresh:2147483647"
	origin := time.Unix(1, 0)
	var output bytes.Buffer
	log := &pqFreshCommitLog{writer: &output}
	firstRPC := int64(17)
	rows := make([]pqFreshTransfer, 4)
	for i := range rows {
		ix := uint32(i)
		rows[i] = pqFreshTransfer{NativeHash: SignedTransactionHash([]byte{byte(i)}), ABCIHash: SignedTransactionHash([]byte{byte(i + 16)}), Height: int64(i + 7), Index: i, OfferOffsetNs: int64(i * 10), offered: origin.Add(time.Duration(i * 10))}
		row := &rows[i]
		row.Readback = pqFreshClientReport{ReadbackOnly: true, ReadbackIndexMode: pqFreshMode(false), OriginalReadbackAttempts: 1, Status: "committed_observed", Members: 1, EffectiveBusinessIncludedObserved: 1, ABCITransactionHash: row.ABCIHash, NativeTransactionHash: row.NativeHash, TransactionType: PQTransferType, ExecutionHeight: uint64(row.Height), CometIndex: &ix, IndependentFinalityVerified: true, EffectiveBusinessFinalized: 1, ConsensusExecutionOutcome: "succeeded", FinalizedBusinessHashes: []string{row.NativeHash}, ProofVerificationStatus: "verified_original_transaction", ProofVerifierSHA256: "v", TrustContextSHA256: "c"}
		if i != 1 {
			row.Submission.SubmissionToFirstCommittedRPCObservationNs = &firstRPC
		}
	}
	firstCause := errors.New("later independent verifier unavailable; preserve UNKNOWN")
	// Exercise the same real coordinator queue. Synthetic public reports here
	// test retention only, not mathematical proof qualification or node behavior.
	err := pqFreshReadbackQueue(context.Background(), len(rows), func(_ context.Context, i int, done chan<- pqFreshCompletion) error {
		done <- pqFreshCompletion{index: i, ended: origin.Add(time.Duration(100 + i))}
		return nil
	}, func(result pqFreshCompletion) error {
		if result.index == 3 {
			return firstCause
		}
		row := &rows[result.index]
		if err := pqFreshReadbackValid(row.Readback, *row, false, "v", "c"); err != nil {
			return err
		}
		row.IndependentCompletionNs = result.ended.Sub(origin).Nanoseconds()
		row.OfferToIndependentNs = result.ended.Sub(row.offered).Nanoseconds()
		return log.emitTransfer("before", domain, result.index, *row)
	})
	if !errors.Is(err, firstCause) || log.transferRows != 3 {
		t.Fatal("later failure erased earlier verified callbacks or changed the original error", err)
	}
	lines := bytes.Split(bytes.TrimSuffix(output.Bytes(), []byte{'\n'}), []byte{'\n'})
	if len(lines) != 3 {
		t.Fatal("callbacks were deferred to the absent complete-pair summary")
	}
	for i, line := range lines {
		var got pqFreshTransferObservation
		raw := bytes.TrimPrefix(line, []byte(pqFreshTransferLogPrefix))
		var shape map[string]json.RawMessage
		if !bytes.HasPrefix(line, []byte(pqFreshTransferLogPrefix)) || len(line)+1 > pqFreshDetailLogLineMax || pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &got) != nil || json.Unmarshal(raw, &shape) != nil || len(shape) != 12 || got.Kind != "validated-readback" || got.NativeHash != strings.TrimPrefix(rows[i].NativeHash, "0x") || got.ABCIHash != strings.TrimPrefix(rows[i].ABCIHash, "0x") || got.Height != strconv.FormatInt(rows[i].Height, 10) || got.Index != i || got.OfferOffsetNs != rows[i].OfferOffsetNs || got.IndependentCompletionNs != rows[i].IndependentCompletionNs || got.OfferToIndependentNs != rows[i].OfferToIndependentNs || got.FirstRPCClock != "client-duration" || got.ClockDomain != domain {
			t.Fatal("callback original coordinates/times were replaced or qualification fields added")
		}
		if i == 1 && got.FirstRPCNs != nil || i != 1 && (got.FirstRPCNs == nil || *got.FirstRPCNs != "17") {
			t.Fatal("missing first-RPC observation was invented or child duration became a coordinator offset")
		}
	}
	if bytes.Contains(output.Bytes(), []byte("PQ_NETWORK_FRESH_BUSINESS_SUMMARY")) || bytes.Contains(output.Bytes(), []byte("qualified")) {
		t.Fatal("three retained callbacks became a successful complete pair")
	}
}

func TestPQNetworkFreshVerifiedCallbackBoundsAndNoRetry(t *testing.T) {
	first := pqFreshPhaseMaxNs
	row := pqFreshTransfer{NativeHash: "0x" + strings.Repeat("f", 64), ABCIHash: "0x" + strings.Repeat("a", 64), Height: 1<<63 - 1, Index: 1<<31 - 1, OfferOffsetNs: 10000000000, IndependentCompletionNs: pqFreshPhaseMaxNs, OfferToIndependentNs: pqFreshPhaseMaxNs - 10000000000, Submission: pqFreshClientReport{SubmissionToFirstCommittedRPCObservationNs: &first}}
	const domain = "pq-fresh:2147483647"
	line, err := pqFreshTransferObservationLine("before", domain, row)
	if err != nil || len(line) > pqFreshDetailLogLineMax || pqFreshTransferLogRowsMax != 32 {
		t.Fatal("maximum legal verified-callback line exceeds original budget", len(line), err)
	}
	for _, scenario := range []string{"hash", "hash-prefix", "index", "height", "clock", "offset", "completion", "delta", "first-RPC"} {
		bad, clock := row, domain
		switch scenario {
		case "hash":
			bad.NativeHash = "private-canary"
		case "hash-prefix":
			bad.ABCIHash = strings.TrimPrefix(bad.ABCIHash, "0x")
		case "index":
			bad.Index = -1
		case "height":
			bad.Height = 0
		case "clock":
			clock = "child-duration"
		case "offset":
			bad.OfferOffsetNs = -1
		case "completion":
			bad.IndependentCompletionNs++
		case "delta":
			bad.OfferToIndependentNs++
		case "first-RPC":
			value := pqFreshPhaseMaxNs + 1
			bad.Submission.SubmissionToFirstCommittedRPCObservationNs = &value
		}
		var out bytes.Buffer
		log := &pqFreshCommitLog{writer: &out}
		if err := log.emitTransfer("before", clock, 0, bad); err == nil || out.Len() != 0 || log.transferRows != 0 {
			t.Fatal("invalid original field reached public callback log", scenario)
		}
	}
	var out bytes.Buffer
	log := &pqFreshCommitLog{writer: &out}
	for _, arm := range []string{"before", "after"} {
		for i := 0; i < pqFreshSenders; i++ {
			if err := log.emitTransfer(arm, domain, i, row); err != nil {
				t.Fatal(err)
			}
		}
	}
	before := out.Len()
	if log.transferRows != 32 || out.Len() > 32*512 || log.emitTransfer("after", domain, 0, row) == nil || out.Len() != before {
		t.Fatal("duplicate callback exceeded original 32-line budget")
	}
	writes := 0
	firstCause := errors.New("original stdout failure")
	broken := &pqFreshCommitLog{writer: pqFreshCommitWriterFunc(func([]byte) (int, error) { writes++; return 0, firstCause })}
	if !errors.Is(broken.emitTransfer("before", domain, 0, row), firstCause) || !errors.Is(broken.emitTransfer("after", domain, 0, row), firstCause) || writes != 1 || broken.transferRows != 0 {
		t.Fatal("failed public callback write was retried or its first cause lost")
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

func TestPQNetworkFreshProposalActualDelegateFinalBlockAndOwnedTiming(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := NewPersistentApplication(migration, "")
	if err != nil {
		t.Fatal(err)
	}
	app.SetCommitTimingEnabled(true)
	height := int64(migration.Height) + 1
	domain := fmt.Sprintf("pq-fresh:%d", os.Getpid())
	trace := &pqFreshTrace{Application: app, initial: height, origin: time.Now().Add(-time.Millisecond), domain: domain, arm: "before"}
	payload := journalTransfer(t, 1)
	blockHash := sha256.Sum256([]byte("unit-only-original-final-block"))
	otherHash := sha256.Sum256([]byte("unit-only-other-round"))
	request := &abci.RequestProcessProposal{Height: height, Hash: bytes.Clone(blockHash[:]), Time: time.Unix(1802736000+height, 0), Txs: [][]byte{bytes.Clone(payload)}}
	before, _ := json.Marshal(app.committed)
	want, wantErr := plain.ProcessProposal(context.Background(), request)
	got, gotErr := trace.ProcessProposal(context.Background(), request)
	if wantErr != gotErr || want.Status != got.Status || got.Status != abci.ResponseProcessProposal_ACCEPT {
		t.Fatal("observer changed original real ProcessProposal acceptance", wantErr, gotErr)
	}
	after, _ := json.Marshal(app.committed)
	if !bytes.Equal(before, after) || len(trace.proposals) != 1 {
		t.Fatal("proposal observation changed committed state or lost accepted record")
	}
	first := pqFreshCopyProposal(trace.proposals[pqFreshProposalKey{height: height, hash: hex.EncodeToString(blockHash[:])}])
	if first == nil || first.startNs < 0 || first.endNs < first.startNs {
		t.Fatal("actual delegated call has no ordered parent-clock timing")
	}
	// The same block's first accepted observation survives another round/call.
	trace.ProcessProposal(context.Background(), request)
	request.Hash = bytes.Clone(otherHash[:])
	trace.ProcessProposal(context.Background(), request)
	request.Height += 2
	want, wantErr = plain.ProcessProposal(context.Background(), request)
	got, gotErr = trace.ProcessProposal(context.Background(), request)
	if wantErr != gotErr || want.Status != got.Status || got.Status != abci.ResponseProcessProposal_REJECT || len(trace.proposals) != 2 {
		t.Fatal("rejected proposal acquired timing or changed original response")
	}
	// Caller mutation cannot change either the original hash or retained tx IDs.
	request.Hash[0] ^= 1
	request.Txs[0][0] ^= 1
	response, err := trace.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Hash: bytes.Clone(blockHash[:]), Time: time.Unix(1802736000+height, 0), Txs: [][]byte{payload}})
	if err != nil || response == nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
		t.Fatal("actual original FinalizeBlock failed", err)
	}
	if _, err := trace.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	rows, failure := trace.snapshot()
	if failure != "" || len(rows) != 1 || rows[0].proposal == nil || rows[0].proposal.blockHash != hex.EncodeToString(blockHash[:]) || rows[0].proposal.startNs != first.startNs || rows[0].proposal.endNs != first.endNs || rows[0].proposal.txHashes[0] != SignedTransactionHash(payload) {
		t.Fatal("final block was joined to another round/tx or lost its first accepted call", failure)
	}
	rows[0].proposal.txHashes[0] = "changed public copy"
	again, _ := trace.snapshot()
	if again[0].proposal.txHashes[0] != SignedTransactionHash(payload) {
		t.Fatal("snapshot aliases owned proposal transaction IDs")
	}
	// Observation overflow must not turn a real accepted proposal into rejection.
	for i := 0; i < 4*int(pqNetworkE2EMaxBlocks)+2; i++ {
		hash := sha256.Sum256([]byte(fmt.Sprintf("unit-only-bounded-proposal-%d", i)))
		r, err := trace.ProcessProposal(context.Background(), &abci.RequestProcessProposal{Height: height + 1, Hash: hash[:]})
		if err != nil || r.Status != abci.ResponseProcessProposal_ACCEPT {
			t.Fatal("diagnostic capacity altered actual consensus response", err)
		}
	}
	if len(trace.proposals) != 4*int(pqNetworkE2EMaxBlocks) {
		t.Fatal("proposal observations exceeded their fixed bound")
	}
}

func TestPQNetworkFreshProposalLogBindsVerifiedCallbackAndMissingReplicas(t *testing.T) {
	domain := fmt.Sprintf("pq-fresh:%d", os.Getpid())
	block := strings.Repeat("12", 32)
	row := pqFreshTransfer{NativeHash: "0x" + strings.Repeat("34", 32), ABCIHash: "0x" + strings.Repeat("56", 32), Height: 20, Index: 0, OfferOffsetNs: 10, IndependentCompletionNs: 100, OfferToIndependentNs: 90}
	row.coordinatorWork = [5]int64{2, 4, 1, 6, 8}
	traces := make([]*pqFreshTrace, 4)
	for i := range traces {
		traces[i] = &pqFreshTrace{index: i, arm: "before", domain: domain, rows: []pqFreshTraceRow{{Height: row.Height, FinalizeOK: true, CommitOK: true, TimingAvailable: true, FinalizeStartNs: 50, ExecutionCodes: []uint32{0}, Persistence: CommitTimingSample{Durable: true}, blockHash: block, proposal: &pqFreshProposalTrace{blockHash: block, startNs: 20, endNs: 30, txHashes: []string{row.ABCIHash}}}}}
	}
	// A competing hash, failed execution and unobserved replica remain null.
	traces[1].rows[0].blockHash = strings.Repeat("78", 32)
	traces[2].rows[0].ExecutionCodes[0] = 1
	traces[3].rows = nil
	line, err := pqFreshInclusionObservationLine("before", domain, row, block, traces)
	var got pqFreshInclusionObservation
	var shape map[string]json.RawMessage
	if err != nil || len(line) > 512 || json.Unmarshal(bytes.TrimPrefix(line, []byte(pqFreshInclusionLogPrefix)), &got) != nil || json.Unmarshal(bytes.TrimPrefix(line, []byte(pqFreshInclusionLogPrefix)), &shape) != nil || len(shape) != 8 || got.ABCIHash != strings.TrimPrefix(row.ABCIHash, "0x") || got.Height != "20" || got.Index != 0 || got.BlockHash != block || got.Clock != domain || got.Proposals[0] == nil || *got.Proposals[0] != [2]int64{20, 30} || got.Proposals[1] != nil || got.Proposals[2] != nil || got.Proposals[3] != nil {
		t.Fatal("original inclusion coordinates or missing replica semantics changed", err)
	}
	if got.Work != row.coordinatorWork {
		t.Fatal("actual coordinator work was replaced by an inclusive stage span")
	}
	for _, work := range [][5]int64{{0, 4, 1, 6, 8}, {2, 4, 0, 6, 8}, {2, 50, 1, 50, 8}, {2, -1, 1, 6, 8}} {
		bad := row
		bad.coordinatorWork = work
		if _, err := pqFreshInclusionObservationLine("before", domain, bad, block, traces); err == nil {
			t.Fatal("uninvoked, overlapping or negative coordinator work was accepted")
		}
	}
	var output bytes.Buffer
	log := &pqFreshCommitLog{writer: &output}
	if err := log.emitInclusion("before", domain, 0, row, block, traces); err == nil {
		t.Fatal("proposal timing emitted without its validated callback")
	}
	log = &pqFreshCommitLog{writer: &output}
	if err := log.emitTransfer("before", domain, 0, row); err != nil {
		t.Fatal(err)
	}
	if err := log.emitInclusion("before", domain, 0, row, block, traces); err != nil {
		t.Fatal(err)
	}
	written := output.Len()
	if err := log.emitInclusion("before", domain, 0, row, block, traces); err == nil || output.Len() != written {
		t.Fatal("duplicate callback created another physical inclusion observation")
	}
	traces[0].rows[0].proposal.txHashes[0] = "0x" + strings.Repeat("90", 32)
	if traces[0].inclusionTime(row, block) != nil {
		t.Fatal("same height/index substituted a foreign transaction")
	}
	traces[0].domain = "pq-fresh:1"
	if _, err := pqFreshInclusionObservationLine("before", domain, row, block, traces); err == nil {
		t.Fatal("another process clock was accepted")
	}
	if pqFreshTransferLogRowsMax*pqFreshDetailLogLineMax != 16<<10 || pqFreshObservationLogBytesMax+(256<<10)+312*512 != 1044480 {
		t.Fatal("proposal observations consumed more than the original16KiB reserve")
	}
}

func TestPQNetworkFreshPipelineStartsOriginalReadbackBeforeLastOffer(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	var starts []time.Time
	offers, proofs, overlapped := 0, 0, false
	maximum, err := pqFreshPipeline(ctx, 2, time.Now(), func(ctx context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		at := time.Now()
		starts = append(starts, at)
		done <- pqFreshCompletion{index: i, ended: at}
		return at, nil
	}, func(result pqFreshCompletion) error {
		offers++
		return nil
	}, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		if offers == 0 {
			t.Fatal("readback started before its original offer completion")
		}
		if i == 0 && len(starts) == 1 {
			overlapped = true
		}
		done <- pqFreshCompletion{index: i, ended: time.Now()}
		return true, nil
	}, func(result pqFreshCompletion) error {
		proofs++
		return nil
	})
	if err != nil || !overlapped || offers != 2 || proofs != 2 || maximum > pqFreshInFlight || len(starts) != 2 || starts[1].Sub(starts[0]) < pqFreshInterval {
		t.Fatal("original readback remained globally serialized, repeated an offer or changed pacing", err)
	}
}

func TestPQNetworkFreshHostPreparationYieldsBetweenReadinessProbes(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var starts []time.Time
	offeredCount, verifiedCount := 0, 0
	crossedDue, probedBeforeDueOffer := false, false
	maximum, err := pqFreshPipeline(ctx, 3, time.Now(), func(_ context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		at := time.Now()
		starts = append(starts, at)
		done <- pqFreshCompletion{index: i, ended: at}
		return at, nil
	}, func(pqFreshCompletion) error {
		offeredCount++
		return nil
	}, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		if offeredCount < 2 {
			return false, nil
		}
		if !crossedDue {
			// The first eligible readiness call finishes after the next original
			// offer is due. Another readiness call must not overtake that offer.
			wait := time.Until(starts[1].Add(pqFreshInterval)) + time.Millisecond
			if wait > 0 {
				timer := time.NewTimer(wait)
				defer timer.Stop()
				select {
				case <-timer.C:
				case <-ctx.Done():
					return false, ctx.Err()
				}
			}
			crossedDue = true
			return false, nil
		}
		if len(starts) < 3 {
			probedBeforeDueOffer = true
			return false, errors.New("another readiness probe overtook an already due original offer")
		}
		done <- pqFreshCompletion{index: i, ended: time.Now()}
		return true, nil
	}, func(pqFreshCompletion) error {
		verifiedCount++
		return nil
	})
	if err != nil || !crossedDue || probedBeforeDueOffer || len(starts) != 3 || offeredCount != 3 || verifiedCount != 3 || maximum > pqFreshInFlight {
		t.Fatal("readiness scan delayed an already due original offer or lost original proof work", err)
	}
	for i := 1; i < len(starts); i++ {
		if starts[i].Sub(starts[i-1]) < pqFreshInterval {
			t.Fatal("readiness yield introduced catch-up offers")
		}
	}
}

func TestPQNetworkFreshPipelineReadinessNeverReoffersAndCancelsBothWaitSets(t *testing.T) {
	attempts, starts := 0, 0
	_, err := pqFreshPipeline(context.Background(), 1, time.Now(), func(ctx context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		starts++
		done <- pqFreshCompletion{index: i, ended: time.Now()}
		return time.Now(), nil
	}, func(pqFreshCompletion) error { return nil }, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		attempts++
		if attempts < 3 {
			return false, nil
		}
		done <- pqFreshCompletion{index: i, ended: time.Now()}
		return true, nil
	}, func(pqFreshCompletion) error { return nil })
	if err != nil || starts != 1 || attempts != 3 {
		t.Fatal("read-only readiness retried a signed offer or fabricated completion", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	var waits sync.WaitGroup
	completed := make(chan string, 2)
	_, err = pqFreshPipeline(ctx, 2, time.Now(), func(ctx context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		if i == 0 {
			done <- pqFreshCompletion{index: i, ended: time.Now()}
		} else {
			waits.Add(1)
			go func() {
				defer waits.Done()
				<-ctx.Done()
				completed <- "offer"
				done <- pqFreshCompletion{index: i, err: ctx.Err(), ended: time.Now()}
			}()
			cancel()
		}
		return time.Now(), nil
	}, func(pqFreshCompletion) error { return nil }, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		waits.Add(1)
		go func() {
			defer waits.Done()
			<-ctx.Done()
			completed <- "proof"
			done <- pqFreshCompletion{index: i, err: ctx.Err(), ended: time.Now()}
		}()
		return true, nil
	}, func(pqFreshCompletion) error { return nil })
	waits.Wait()
	if !errors.Is(err, context.Canceled) || len(completed) != 2 {
		t.Fatal("pipeline cancellation did not join both actually started Wait sets", err)
	}
}

func TestPQNetworkFreshPipelineKeepsBothOriginalFourSlotBounds(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	offerGate, proofGate := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	var waits sync.WaitGroup
	runningOffers, runningProofs, peakOffers, peakProofs := 0, 0, 0, 0
	startedOffers, startedProofs := make([]bool, 5), make([]bool, 5)
	maximum, err := pqFreshPipeline(ctx, 5, time.Now(), func(ctx context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		if startedOffers[i] {
			t.Fatal("original offer Start repeated")
		}
		startedOffers[i] = true
		mu.Lock()
		runningOffers++
		if runningOffers > peakOffers {
			peakOffers = runningOffers
		}
		mu.Unlock()
		waits.Add(1)
		go func() {
			defer waits.Done()
			if i < 4 {
				select {
				case <-offerGate:
				case <-ctx.Done():
				}
			}
			mu.Lock()
			runningOffers--
			mu.Unlock()
			done <- pqFreshCompletion{index: i, ended: time.Now()}
		}()
		if i == 3 {
			close(offerGate)
		}
		if i == 4 {
			close(proofGate)
		}
		return time.Now(), nil
	}, func(pqFreshCompletion) error { return nil }, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		if startedProofs[i] {
			t.Fatal("original readback Start repeated")
		}
		startedProofs[i] = true
		mu.Lock()
		runningProofs++
		if runningProofs > peakProofs {
			peakProofs = runningProofs
		}
		mu.Unlock()
		waits.Add(1)
		go func() {
			defer waits.Done()
			select {
			case <-proofGate:
			case <-ctx.Done():
			}
			mu.Lock()
			runningProofs--
			mu.Unlock()
			done <- pqFreshCompletion{index: i, ended: time.Now()}
		}()
		return true, nil
	}, func(pqFreshCompletion) error { return nil })
	waits.Wait()
	if err != nil || maximum != pqFreshInFlight || peakOffers > pqFreshInFlight || peakProofs > pqFreshInFlight || peakProofs < 1 || runningOffers != 0 || runningProofs != 0 {
		t.Fatal("pipeline increased original queue capacity or failed to join children", maximum, peakOffers, peakProofs, err)
	}
	for i := range startedOffers {
		if !startedOffers[i] || !startedProofs[i] {
			t.Fatal("planned original identity was not consumed exactly once")
		}
	}
}

// Ordinary CI exercises only immutable DATA reads; no node, signing process or
// transaction offer is started by these search regressions.
func TestPQNetworkFreshInclusionScanSkipsOnlyPreviouslySearchedHistory(t *testing.T) {
	payload := []byte("exact original transaction")
	blocks := map[int64]*cmttypes.Block{}
	for h := int64(1); h <= 3; h++ {
		blocks[h] = &cmttypes.Block{Data: cmttypes.Data{Txs: cmttypes.Txs{cmttypes.Tx("other transaction")}}}
	}
	reads := map[int64]int{}
	load := func(h int64) *cmttypes.Block { reads[h]++; return blocks[h] }
	h, _, hint, err := pqFreshScanPayload(payload, 1, 2, load)
	if err != nil || h != 0 || hint != 3 {
		t.Fatal("original historical miss did not advance search progress", h, hint, err)
	}
	h, _, hint, err = pqFreshScanPayload(payload, hint, 3, load)
	if err != nil || h != 0 || hint != 4 || reads[1] != 1 || reads[2] != 1 || reads[3] != 1 {
		t.Fatal("already-searched immutable history was loaded again", h, hint, reads, err)
	}
	// A block arriving after the earlier tip must still be searched. Similar
	// bytes and another transaction at index0 cannot substitute for the target.
	blocks[4] = &cmttypes.Block{Data: cmttypes.Data{Txs: cmttypes.Txs{cmttypes.Tx("exact original transactioN"), cmttypes.Tx(payload)}}}
	h, ix, hint, err := pqFreshScanPayload(payload, hint, 4, load)
	if err != nil || h != 4 || ix != 1 || hint != 4 || reads[4] != 1 {
		t.Fatal("new original block/exact payload index was missed", h, ix, hint, reads, err)
	}
	// A match never advances the hint past H. All readiness attempts must
	// reload it; the normal caller then repeats all four execution checks.
	h, ix, hint, err = pqFreshScanPayload(payload, hint, 4, load)
	if err != nil || h != 4 || ix != 1 || hint != 4 || reads[4] != 2 {
		t.Fatal("matched block was replaced by cached validation", h, ix, hint, reads, err)
	}
}

func TestPQNetworkFreshInclusionScanRetainsMissingHeightAndIndependentPayloads(t *testing.T) {
	first, second := []byte("first original"), []byte("second original")
	blocks := map[int64]*cmttypes.Block{5: {Data: cmttypes.Data{Txs: cmttypes.Txs{cmttypes.Tx(second)}}}}
	var reads []int64
	load := func(h int64) *cmttypes.Block { reads = append(reads, h); return blocks[h] }
	h, _, firstHint, err := pqFreshScanPayload(first, 4, 5, load)
	if err != nil || h != 0 || firstHint != 4 || (len(reads) != 1 || reads[0] != 4) {
		t.Fatal("nil historical hole was silently skipped", h, firstHint, reads, err)
	}
	blocks[4] = &cmttypes.Block{Data: cmttypes.Data{Txs: cmttypes.Txs{cmttypes.Tx(first)}}}
	h, _, firstHint, err = pqFreshScanPayload(first, firstHint, 5, load)
	if err != nil || h != 4 || firstHint != 4 {
		t.Fatal("late available original height was not retried", h, firstHint, err)
	}
	h, _, secondHint, err := pqFreshScanPayload(second, 4, 5, load)
	if err != nil || h != 5 || secondHint != 5 || firstHint != 4 {
		t.Fatal("payload search hints were shared between transactions", h, firstHint, secondHint, err)
	}
}

func TestPQNetworkFreshInclusionScanRejectsInvalidInputsAndWaitsForNewTip(t *testing.T) {
	calls := 0
	load := func(int64) *cmttypes.Block { calls++; return nil }
	for _, test := range []struct {
		payload      []byte
		minimum, tip int64
		load         func(int64) *cmttypes.Block
	}{
		{nil, 1, 1, load}, {[]byte("target"), 0, 1, load}, {[]byte("target"), 1, -1, load}, {[]byte("target"), 1, 1<<63 - 1, load}, {[]byte("target"), 1, 1, nil},
	} {
		if _, _, _, err := pqFreshScanPayload(test.payload, test.minimum, test.tip, test.load); err == nil {
			t.Fatal("invalid search input entered the original store")
		}
	}
	if calls != 0 {
		t.Fatal("invalid search read a store")
	}
	h, _, hint, err := pqFreshScanPayload([]byte("target"), 2, 1, load)
	if err != nil || h != 0 || hint != 2 || calls != 0 {
		t.Fatal("search beyond the current original tip invented an observation", h, hint, calls, err)
	}
}

func TestPQNetworkFreshHostPreparationDoesNotBlockOriginalPacedOffers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	var queue *pqFreshHostQueue
	defer func() {
		if queue != nil {
			queue.close()
		}
	}()
	startedHost, secondOffer := make(chan struct{}), make(chan struct{})
	var starts []time.Time
	verified := 0
	_, err := pqFreshPipeline(ctx, 2, time.Now(), func(ctx context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		at := time.Now()
		starts = append(starts, at)
		if i == 1 {
			select {
			case <-startedHost:
			default:
				return time.Time{}, errors.New("Host preparation never entered the original pipeline")
			}
			close(secondOffer) // The first Host call cannot complete before this.
		}
		done <- pqFreshCompletion{index: i, ended: at}
		return at, nil
	}, func(pqFreshCompletion) error { return nil }, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		if queue == nil {
			var err error
			queue, err = pqFreshNewHostQueue(ctx, 2, func(ctx context.Context, request pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error) {
				if request.ordinal == 0 {
					close(startedHost)
					select {
					case <-secondOffer:
					case <-ctx.Done():
						return "", "", pqBusinessHostPreparationTimings{}, ctx.Err()
					}
				}
				return "original detached Host context", strings.Repeat("31", 32), pqBusinessHostPreparationTimings{}, nil
			})
			if err != nil {
				return false, err
			}
		}
		if !queue.issued[i] {
			_, err := queue.enqueue(pqFreshHostRequest{ordinal: i, height: 1, wire: []byte("wire"), payload: []byte("envelope")})
			return false, err
		}
		result, ready, err := queue.take(i)
		if err != nil || !ready {
			return false, err
		}
		if result.err != nil {
			return false, result.err
		}
		if result.path == "" || result.pin != strings.Repeat("31", 32) {
			return false, errors.New("original context identity changed")
		}
		done <- pqFreshCompletion{index: i, ended: time.Now()}
		return true, nil
	}, func(result pqFreshCompletion) error {
		verified++
		return queue.release(result.index)
	})
	if err != nil || verified != 2 || len(starts) != 2 || starts[1].Sub(starts[0]) < pqFreshInterval || queue.outstanding != 0 {
		t.Fatal("Host wait serialized original offers, changed cadence or fabricated completion", err)
	}
}

func TestPQNetworkFreshHostPreparationRetainsFourSlotsAndDetachedInputs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	gate, entered := make(chan struct{}), make(chan struct{})
	var seen []int // Only the single worker writes; read after close/join.
	active, peak := 0, 0
	queue, err := pqFreshNewHostQueue(ctx, 5, func(ctx context.Context, request pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error) {
		active++
		if active > peak {
			peak = active
		}
		defer func() { active-- }()
		if request.ordinal == 0 {
			close(entered)
			select {
			case <-gate:
			case <-ctx.Done():
				return "", "", pqBusinessHostPreparationTimings{}, ctx.Err()
			}
		}
		if string(request.wire) != "original-wire" || string(request.payload) != "original-envelope" {
			return "", "", pqBusinessHostPreparationTimings{}, errors.New("mutable row bytes reached Host worker")
		}
		seen = append(seen, request.ordinal)
		return "original-context", strings.Repeat("32", 32), pqBusinessHostPreparationTimings{}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer queue.close()
	wire, payload := []byte("original-wire"), []byte("original-envelope")
	request := func(i int) pqFreshHostRequest {
		return pqFreshHostRequest{ordinal: i, height: 1, wire: wire, payload: payload}
	}
	for i := 0; i < 4; i++ {
		if ok, err := queue.enqueue(request(i)); err != nil || !ok {
			t.Fatal("original four slots were not admitted", i, err)
		}
	}
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("Host worker did not start")
	}
	if ok, err := queue.enqueue(request(4)); err != nil || ok || queue.outstanding != 4 {
		t.Fatal("a fifth queued/preparing/proof target exceeded original slots", err)
	}
	wire[0], payload[0] = 'X', 'Y'
	close(gate)
	await := func(i int) pqFreshHostPrepared {
		for {
			r, ready, err := queue.take(i)
			if err != nil {
				t.Fatal(err)
			}
			if ready {
				if r.err != nil {
					t.Fatal(r.err)
				}
				return r
			}
			select {
			case <-ctx.Done():
				t.Fatal("original Host completion missing")
			case <-time.After(time.Millisecond):
			}
		}
	}
	for i := 0; i < 4; i++ {
		await(i)
	}
	if ok, err := queue.enqueue(request(4)); err != nil || ok || queue.outstanding != 4 {
		t.Fatal("preparation completion released a slot before its proof was accepted", err)
	}
	if err := queue.release(0); err != nil {
		t.Fatal(err)
	}
	if _, err := queue.enqueue(request(0)); err == nil {
		t.Fatal("released original target was prepared twice")
	}
	if err := queue.release(0); err == nil {
		t.Fatal("one proof released the original slot twice")
	}
	wire, payload = []byte("original-wire"), []byte("original-envelope")
	if ok, err := queue.enqueue(request(4)); err != nil || !ok {
		t.Fatal("verified original proof did not release exactly one slot", err)
	}
	for i := 1; i < 4; i++ {
		if err := queue.release(i); err != nil {
			t.Fatal(err)
		}
	}
	await(4)
	if err := queue.release(4); err != nil {
		t.Fatal(err)
	}
	queue.close()
	if len(seen) != 5 || active != 0 || peak != 1 || queue.outstanding != 0 || cap(queue.jobs) != 4 || cap(queue.results) != 4 {
		t.Fatal("Host preparation was not a joined single worker with the original four reservations", seen, active, peak)
	}
}

func TestPQNetworkFreshHostPreparationPreservesErrorsAndPipelineCancellation(t *testing.T) {
	firstCause := errors.New("original Host capture refused")
	calls := 0
	queue, err := pqFreshNewHostQueue(context.Background(), 2, func(context.Context, pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error) {
		calls++
		return "", "", pqBusinessHostPreparationTimings{}, firstCause
	})
	if err != nil {
		t.Fatal(err)
	}
	defer queue.close()
	for i := 0; i < 2; i++ {
		if ok, err := queue.enqueue(pqFreshHostRequest{ordinal: i, height: 1, wire: []byte("w"), payload: []byte("p")}); err != nil || !ok {
			t.Fatal(err)
		}
	}
	<-queue.stopped
	r, ready, err := queue.take(0)
	if err != nil || !ready || !errors.Is(r.err, firstCause) || calls != 1 {
		t.Fatal("Host failure lost the original cause or started later queued work", err, r.err, calls)
	}
	queue.close()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	var pending *pqFreshHostQueue
	defer func() {
		if pending != nil {
			pending.close()
		}
	}()
	entered, canceled := make(chan struct{}), make(chan struct{})
	startFailure := errors.New("original next offer could not start")
	_, err = pqFreshPipeline(ctx, 2, time.Now(), func(ctx context.Context, i int, done chan<- pqFreshCompletion) (time.Time, error) {
		if i == 1 {
			return time.Time{}, startFailure
		}
		at := time.Now()
		done <- pqFreshCompletion{index: i, ended: at}
		return at, nil
	}, func(pqFreshCompletion) error { return nil }, func(ctx context.Context, i int, done chan<- pqFreshCompletion) (bool, error) {
		if pending == nil {
			var err error
			pending, err = pqFreshNewHostQueue(ctx, 2, func(ctx context.Context, _ pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error) {
				close(entered)
				<-ctx.Done()
				close(canceled)
				return "", "", pqBusinessHostPreparationTimings{}, ctx.Err()
			})
			if err != nil {
				return false, err
			}
			_, err = pending.enqueue(pqFreshHostRequest{ordinal: i, height: 1, wire: []byte("w"), payload: []byte("p")})
			return false, err
		}
		return false, nil
	}, func(pqFreshCompletion) error { return errors.New("no unprepared proof may be credited") })
	if !errors.Is(err, startFailure) {
		t.Fatal("pipeline lost its actual first failure", err)
	}
	if pending == nil {
		t.Fatal("pipeline failed before the original Host preparation was exercised")
	}
	pending.close()
	select {
	case <-entered:
	default:
		t.Fatal("original Host preparation never began")
	}
	select {
	case <-canceled:
	default:
		t.Fatal("original pipeline child cancellation did not reach/join Host preparation")
	}
}

func TestPQNetworkFreshHostPreparationRejectsInvalidTargetsAndJoinsGoexit(t *testing.T) {
	if _, err := pqFreshNewHostQueue(nil, 1, func(context.Context, pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error) {
		return "", "", pqBusinessHostPreparationTimings{}, nil
	}); err == nil {
		t.Fatal("nil Host parent context accepted")
	}
	if _, err := pqFreshNewHostQueue(context.Background(), 17, nil); err == nil {
		t.Fatal("unbounded or missing Host preparer accepted")
	}
	entered, canceled, coordinatorEnded := make(chan struct{}), make(chan struct{}), make(chan struct{})
	queue, err := pqFreshNewHostQueue(context.Background(), 1, func(ctx context.Context, _ pqFreshHostRequest) (string, string, pqBusinessHostPreparationTimings, error) {
		close(entered)
		<-ctx.Done()
		close(canceled)
		return "", "", pqBusinessHostPreparationTimings{}, ctx.Err()
	})
	if err != nil {
		t.Fatal(err)
	}
	defer queue.close()
	for _, request := range []pqFreshHostRequest{{ordinal: -1, height: 1, wire: []byte("w"), payload: []byte("p")}, {ordinal: 1, height: 1, wire: []byte("w"), payload: []byte("p")}, {ordinal: 0, height: 0, wire: []byte("w"), payload: []byte("p")}, {ordinal: 0, height: 1, payload: []byte("p")}} {
		if _, err := queue.enqueue(request); err == nil {
			t.Fatal("invalid target entered the original Host queue")
		}
	}
	if queue.outstanding != 0 {
		t.Fatal("invalid target consumed a proof slot")
	}
	go func() {
		defer close(coordinatorEnded)
		defer queue.close()
		_, _ = queue.enqueue(pqFreshHostRequest{ordinal: 0, height: 1, wire: []byte("w"), payload: []byte("p")})
		<-entered
		runtime.Goexit() // Same defer semantics as a coordinator-only Fatal.
	}()
	select {
	case <-coordinatorEnded:
	case <-time.After(2 * time.Second):
		t.Fatal("coordinator Goexit stranded the Host worker")
	}
	select {
	case <-canceled:
	default:
		t.Fatal("Goexit returned before Host cancellation/join")
	}
}

func TestPQNetworkFreshHostPreparationProgressKeepsAllMeasuredStagesAndOriginalBudget(t *testing.T) {
	timing := pqBusinessHostPreparationTimings{TotalWallNs: 120000000000, LightBlocksWallNs: 10000000000, InputEncodingWallNs: 10000000000, CheckpointLoadWallNs: 10000000000, CheckpointCaptureWallNs: 10000000000, CheckpointDecodeWallNs: 10000000000, CheckpointValidateWallNs: 10000000000, CheckpointRetryWaitNs: 10000000000, RetainInputsWallNs: 10000000000, ContextWriteWallNs: 10000000000}
	line, err := pqFreshHostProgressLine("before", 15, 0, pqFreshPhaseMaxNs, &timing)
	if err != nil || len(line)+96 > 512 {
		t.Fatal("complete measured Host stages exceeded original progress allowance", len(line), err)
	}
	var values []int64
	pieces := strings.Split(line, " hostNs=")
	if len(pieces) != 2 || json.Unmarshal([]byte(pieces[1]), &values) != nil || len(values) != 10 || values[0] != timing.TotalWallNs || values[9] != timing.ContextWriteWallNs {
		t.Fatal("actual ten-stage timing projection changed")
	}
	mapped := pqBusinessHostPreparationTimings{TotalWallNs: 99, LightBlocksWallNs: 1, InputEncodingWallNs: 2, CheckpointLoadWallNs: 3, CheckpointCaptureWallNs: 4, CheckpointDecodeWallNs: 5, CheckpointValidateWallNs: 6, CheckpointRetryWaitNs: 7, RetainInputsWallNs: 8, ContextWriteWallNs: 9}
	ordered, err := pqFreshHostProgressLine("after", 0, 0, 100, &mapped)
	if err != nil || json.Unmarshal([]byte(strings.Split(ordered, " hostNs=")[1]), &values) != nil {
		t.Fatal("ordered original Host timings unavailable", err)
	}
	for i, want := range []int64{99, 1, 2, 3, 4, 5, 6, 7, 8, 9} {
		if values[i] != want {
			t.Fatal("Host phase order was changed or a child was counted twice", i, values)
		}
	}
	without, err := pqFreshHostProgressLine("after", 0, 1, 2, nil)
	if err != nil || strings.Contains(without, "hostNs=") {
		t.Fatal("failed/missing Host timing invented zero stage observations", err)
	}
	bad := timing
	bad.CheckpointValidateWallNs = timing.TotalWallNs
	if _, err := pqFreshHostProgressLine("before", 0, 0, pqFreshPhaseMaxNs, &bad); err == nil {
		t.Fatal("overlapping Host children accepted")
	}
	bad = timing
	bad.CheckpointCaptureWallNs = -1
	if _, err := pqFreshHostProgressLine("before", 0, 0, pqFreshPhaseMaxNs, &bad); err == nil {
		t.Fatal("negative Host stage accepted")
	}
	if _, err := pqFreshHostProgressLine("before", 0, 0, 1, &timing); err == nil {
		t.Fatal("Host total outside actual parent span accepted")
	}
	if pqFreshObservationLogBytesMax+(256<<10)+312*512 != 1044480 {
		t.Fatal("Host instrumentation raised original whole-log allowance")
	}
}
