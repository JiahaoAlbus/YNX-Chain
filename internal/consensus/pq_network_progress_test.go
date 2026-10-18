package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	cstypes "github.com/cometbft/cometbft/consensus/types"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	pqNetworkProgressPrefix      = "PQ_NETWORK_PROGRESS "
	pqNetworkProgressInterval    = time.Second
	pqNetworkProgressHeartbeat   = 3 * time.Second
	pqNetworkProgressMaxRows     = 128
	pqNetworkProgressMaxBytes    = 256 * 1024
	pqNetworkProgressMaxRowBytes = 4096
	pqNetworkProgressLogOverhead = 128 // testing.T filename/line, indentation and newline
	pqNetworkProgressNodeCount   = 4
)

// Only the explicitly opted-in real-network test collects these observations.
// No application, signer, authority or assertion consumes progress as evidence
// of authorization/finality. There is no sampler goroutine or extra wait.
type pqNetworkRoundStateReader interface {
	GetRoundState() *cstypes.RoundState
}

type pqNetworkProgressPhase uint8

const (
	pqNetworkPhaseLegacy pqNetworkProgressPhase = iota + 1
	pqNetworkPhaseAccountMigration
	pqNetworkPhaseValidatorRegistration
	pqNetworkPhaseActivation
	pqNetworkPhaseThreeOfFour
	pqNetworkPhaseCatchUp
	pqNetworkPhaseColdRestart
)

func (p pqNetworkProgressPhase) label() string {
	switch p {
	case pqNetworkPhaseLegacy:
		return "legacy"
	case pqNetworkPhaseAccountMigration:
		return "account-migration"
	case pqNetworkPhaseValidatorRegistration:
		return "validator-registration"
	case pqNetworkPhaseActivation:
		return "activation"
	case pqNetworkPhaseThreeOfFour:
		return "pq-three-of-four"
	case pqNetworkPhaseCatchUp:
		return "catch-up"
	case pqNetworkPhaseColdRestart:
		return "cold-restart"
	default:
		return "unknown"
	}
}

type pqNetworkProgressStage uint8

func pqNetworkProgressStageFor(stage string) pqNetworkProgressStage {
	switch stage {
	case "real peer mesh":
		return 1
	case "same committed checkpoint and idle mempools":
		return 2
	case "original bytes included and committed":
		return 3
	default:
		return 0
	}
}

func (s pqNetworkProgressStage) label() string {
	switch s {
	case 1:
		return "peer-mesh"
	case 2:
		return "quiet-checkpoint"
	case 3:
		return "transaction-inclusion"
	default:
		return "unknown"
	}
}

type pqNetworkProgressVotes struct {
	Available         bool `json:"available"`
	Validators        int  `json:"validators"`
	Participants      int  `json:"participants"`
	TwoThirdsAny      bool `json:"twoThirdsAny"`
	TwoThirdsMajority bool `json:"twoThirdsMajority"`
}

type pqNetworkProgressNode struct {
	Index              int                    `json:"index"`
	Running            bool                   `json:"running"`
	AppHeight          int64                  `json:"appHeight"`
	BlockStoreHeight   int64                  `json:"blockStoreHeight"`
	Peers              int                    `json:"peers"`
	ConsensusAvailable bool                   `json:"consensusAvailable"`
	Height             int64                  `json:"height"`
	Round              int32                  `json:"round"`
	Step               cstypes.RoundStepType  `json:"step"`
	Proposal           bool                   `json:"proposal"`
	ProposalBlock      bool                   `json:"proposalBlock"`
	Prevotes           pqNetworkProgressVotes `json:"prevotes"`
	Precommits         pqNetworkProgressVotes `json:"precommits"`
}

// GetRoundState is a shallow, locked copy. Read only the copied scalars and
// pointer presence; use HeightVoteSet/VoteSet's own locks for vote observations.
// The copied BitArray contains participation only, never Vote/signature bytes.
func pqNetworkProgressProject(index int, rs *cstypes.RoundState) pqNetworkProgressNode {
	out := pqNetworkProgressNode{Index: index}
	if rs == nil {
		return out
	}
	out.ConsensusAvailable = true
	out.Height, out.Round, out.Step = rs.Height, rs.Round, rs.Step
	out.Proposal, out.ProposalBlock = rs.Proposal != nil, rs.ProposalBlock != nil
	if rs.Votes != nil && rs.Round >= 0 {
		out.Prevotes = pqNetworkProgressVoteSummary(rs.Votes.Prevotes(rs.Round))
		out.Precommits = pqNetworkProgressVoteSummary(rs.Votes.Precommits(rs.Round))
	}
	return out
}

func pqNetworkProgressVoteSummary(votes *cmttypes.VoteSet) pqNetworkProgressVotes {
	if votes == nil {
		return pqNetworkProgressVotes{}
	}
	out := pqNetworkProgressVotes{
		Available: true, Validators: votes.Size(), Participants: -1,
		// These are the engine's voting-power checks, not a participant-count
		// approximation. A majority may agree on nil; it is not proof of commit.
		TwoThirdsAny: votes.HasTwoThirdsAny(), TwoThirdsMajority: votes.HasTwoThirdsMajority(),
	}
	// The fixture has exactly four validators. Even unexpected state cannot
	// cause an unbounded copy/scan; -1 explicitly means unobserved, not zero.
	if out.Validators <= pqNetworkProgressNodeCount {
		participation := votes.BitArray()
		if participation.Size() == out.Validators {
			out.Participants = 0
			for i := 0; i < participation.Size(); i++ {
				if participation.GetIndex(i) {
					out.Participants++
				}
			}
		}
	}
	return out
}

type pqNetworkProgressCoordinates struct {
	phase pqNetworkProgressPhase
	stage pqNetworkProgressStage
	nodes [pqNetworkProgressNodeCount]pqNetworkProgressNode
}

type pqNetworkProgressRow struct {
	Version  string `json:"version"`
	Sequence int    `json:"sequence"`
	// Relative to the first eligible observation, not the guard's Go start.
	ElapsedMillis   int64                                             `json:"elapsedMillis"`
	Phase           string                                            `json:"phase"`
	Stage           string                                            `json:"stage"`
	Heartbeat       bool                                              `json:"heartbeat"`
	ObservationOnly bool                                              `json:"observationOnly"`
	AtomicSnapshot  bool                                              `json:"atomicSnapshot"`
	Nodes           [pqNetworkProgressNodeCount]pqNetworkProgressNode `json:"nodes"`
}

// All four nodes share one rate and one line/byte budget for the entire test,
// including restart. Nothing grows with samples except these fixed counters.
// No clocks/locks are read for a node unless due returns true (at most 1Hz).
type pqNetworkProgressLimiter struct {
	started, sampled, emitted time.Time
	last                      pqNetworkProgressCoordinates
	hasLast, pending, stopped bool
	rows, bytes               int
}

func (p *pqNetworkProgressLimiter) due(now time.Time) bool {
	if p.stopped || p.rows >= pqNetworkProgressMaxRows || p.bytes >= pqNetworkProgressMaxBytes || p.pending {
		return false
	}
	if !p.sampled.IsZero() && now.Sub(p.sampled) < pqNetworkProgressInterval {
		return false
	}
	if p.started.IsZero() {
		p.started = now
	}
	p.sampled, p.pending = now, true
	return true
}

func (p *pqNetworkProgressLimiter) record(now time.Time, point pqNetworkProgressCoordinates) string {
	if !p.pending {
		return ""
	}
	p.pending = false
	if p.stopped || p.rows >= pqNetworkProgressMaxRows || now.Before(p.sampled) {
		return ""
	}
	unchanged := p.hasLast && p.last == point
	if unchanged && now.Sub(p.emitted) < pqNetworkProgressHeartbeat {
		return ""
	}
	row := pqNetworkProgressRow{
		Version: "ynx-pq-network-progress/v1", Sequence: p.rows + 1,
		ElapsedMillis: now.Sub(p.started).Milliseconds(), Phase: point.phase.label(), Stage: point.stage.label(),
		Heartbeat: unchanged, ObservationOnly: true, AtomicSnapshot: false, Nodes: point.nodes,
	}
	raw, err := json.Marshal(row)
	if err != nil {
		p.stopped = true
		return ""
	}
	line := pqNetworkProgressPrefix + string(raw)
	charged := len(line) + pqNetworkProgressLogOverhead
	if charged > pqNetworkProgressMaxRowBytes || charged > pqNetworkProgressMaxBytes-p.bytes {
		p.stopped = true
		return ""
	}
	p.rows++
	p.bytes += charged
	p.last, p.hasLast, p.emitted = point, true, now
	return line
}

func (n *pqNetworkE2E) observeProgress(stage string) {
	if os.Getenv("YNX_PQ_NETWORK_E2E") != "authorized-four-node-window" {
		return
	}
	now := time.Now()
	if !n.progress.due(now) {
		return
	}
	point := pqNetworkProgressCoordinates{phase: n.phase, stage: pqNetworkProgressStageFor(stage)}
	for i := range point.nodes {
		point.nodes[i].Index = i
		if i >= len(n.nodes) || n.nodes[i] == nil {
			continue
		}
		item := n.nodes[i]
		if item.node != nil {
			if item.consensus != nil {
				point.nodes[i] = pqNetworkProgressProject(i, item.consensus.GetRoundState())
			}
			point.nodes[i].Running = item.node.IsRunning()
			point.nodes[i].BlockStoreHeight = item.node.BlockStore().Height()
			point.nodes[i].Peers = item.node.Switch().Peers().Size()
		}
		if item.app != nil {
			// Do not nest application locks with consensus/vote/store locks.
			item.app.mu.RLock()
			point.nodes[i].AppHeight = item.app.committed.Height
			item.app.mu.RUnlock()
		}
	}
	// Separate node/vote/application reads are explicitly not an atomic state
	// snapshot. No hash or signature is emitted, and no original assertion is
	// weakened or replaced with this best-effort diagnostic observation.
	if line := n.progress.record(now, point); line != "" {
		n.t.Logf("%s", line)
	}
}

func TestPQNetworkProgressRateAndHeartbeat(t *testing.T) {
	start := time.Unix(100, 0)
	var p pqNetworkProgressLimiter
	point := pqNetworkProgressCoordinates{phase: pqNetworkPhaseLegacy, stage: 2}
	if !p.due(start) || p.due(start) {
		t.Fatal("first sample must be allowed exactly once")
	}
	first := p.record(start, point)
	if first == "" || p.record(start, point) != "" {
		t.Fatal("one sample must produce at most one four-node line")
	}
	for i := 1; i < 1000; i++ {
		if p.due(start.Add(time.Duration(i) * time.Millisecond)) {
			t.Fatal("25ms wait-loop polling must not acquire extra node locks")
		}
	}
	for i := 1; i <= 2; i++ {
		now := start.Add(time.Duration(i) * time.Second)
		if !p.due(now) || p.record(now, point) != "" {
			t.Fatal("unchanged coordinates must wait for the bounded heartbeat")
		}
	}
	now := start.Add(3 * time.Second)
	if !p.due(now) {
		t.Fatal("heartbeat sample missing")
	}
	var row pqNetworkProgressRow
	if err := json.Unmarshal([]byte(strings.TrimPrefix(p.record(now, point), pqNetworkProgressPrefix)), &row); err != nil || !row.Heartbeat || len(row.Nodes) != 4 {
		t.Fatalf("expected one four-node heartbeat: %+v error=%v", row, err)
	}
	point.nodes[2].Round++
	now = start.Add(4 * time.Second)
	if !p.due(now) || p.record(now, point) == "" {
		t.Fatal("a changed round must emit at the next bounded sample")
	}
	point.phase, point.stage = pqNetworkPhaseActivation, 3
	now = start.Add(5 * time.Second)
	if !p.due(now) || p.record(now, point) == "" || p.due(start) {
		t.Fatal("phase/stage change missing or clock regression bypassed rate limit")
	}
}

func TestPQNetworkProgressBounds(t *testing.T) {
	start := time.Unix(100, 0)
	var p pqNetworkProgressLimiter
	point := pqNetworkProgressCoordinates{phase: pqNetworkPhaseValidatorRegistration, stage: 3}
	for i := range point.nodes {
		point.nodes[i] = pqNetworkProgressNode{
			Index: i, Running: true, AppHeight: 21, BlockStoreHeight: 21, Peers: 3,
			ConsensusAvailable: true, Height: 22, Step: cstypes.RoundStepPrecommitWait,
			Proposal: true, ProposalBlock: true,
			Prevotes:   pqNetworkProgressVotes{Available: true, Validators: 4, Participants: 3, TwoThirdsAny: true, TwoThirdsMajority: true},
			Precommits: pqNetworkProgressVotes{Available: true, Validators: 4, Participants: 2},
		}
	}
	rows, charged := 0, 0
	for i := 0; i < 10000; i++ {
		now := start.Add(time.Duration(i) * time.Second)
		point.nodes[0].Round = int32(i)
		if p.due(now) {
			line := p.record(now, point)
			if line != "" {
				rows++
				charged += len(line) + pqNetworkProgressLogOverhead
				if len(line)+pqNetworkProgressLogOverhead > pqNetworkProgressMaxRowBytes {
					t.Fatal("single public progress row exceeded its bound")
				}
			}
		}
	}
	if rows != pqNetworkProgressMaxRows || rows != p.rows || charged != p.bytes || charged > pqNetworkProgressMaxBytes {
		t.Fatalf("progress budget differs: rows=%d charged=%d counters=%d/%d", rows, charged, p.rows, p.bytes)
	}
	// Exhaustion stops reads as well as output, across all phases/restarts.
	if p.due(start.Add(24 * time.Hour)) {
		t.Fatal("row exhaustion reset the sampling budget")
	}
	p = pqNetworkProgressLimiter{bytes: pqNetworkProgressMaxBytes - 1}
	if !p.due(start) || p.record(start, point) != "" || !p.stopped || p.rows != 0 || p.bytes != pqNetworkProgressMaxBytes-1 || p.due(start.Add(time.Second)) {
		t.Fatal("byte budget must fail closed before emitting any partial row")
	}
}

func TestPQNetworkProgressPublicProjection(t *testing.T) {
	// Populate fields that a whole RoundState serializer would expose. This
	// control does not create/start a Node or sign any consensus object.
	secret := "PRIVATE_SENTINEL_key_signature_transaction_credential_absolute_path"
	rs := &cstypes.RoundState{
		Height: 22, Round: 3, Step: cstypes.RoundStepPrecommitWait,
		Proposal:      &cmttypes.Proposal{Signature: []byte(secret)},
		ProposalBlock: &cmttypes.Block{Data: cmttypes.Data{Txs: cmttypes.Txs{cmttypes.Tx(secret)}}},
	}
	point := pqNetworkProgressCoordinates{phase: pqNetworkProgressPhase(255), stage: pqNetworkProgressStageFor(secret)}
	point.nodes[0] = pqNetworkProgressProject(0, rs)
	if point.nodes[0].Height != 22 || point.nodes[0].Round != 3 || point.nodes[0].Step != cstypes.RoundStepPrecommitWait || !point.nodes[0].Proposal || !point.nodes[0].ProposalBlock || point.nodes[0].Prevotes.Available {
		t.Fatal("projection lost public coordinates or invented votes")
	}
	var p pqNetworkProgressLimiter
	now := time.Unix(100, 0)
	p.due(now)
	line := p.record(now, point)
	if line == "" || strings.Contains(line, secret) || strings.Contains(line, "signature") || strings.Contains(line, "credential") || strings.Contains(line, "transaction") || strings.Contains(line, "path") {
		t.Fatal("private/raw fields or caller-controlled strings reached progress output")
	}
	var row pqNetworkProgressRow
	decoder := json.NewDecoder(strings.NewReader(strings.TrimPrefix(line, pqNetworkProgressPrefix)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&row); err != nil || row.Phase != "unknown" || row.Stage != "unknown" || !row.ObservationOnly || row.AtomicSnapshot {
		t.Fatalf("invalid public progress schema: error=%v row=%+v", err, row)
	}
	if !bytes.Equal(rs.Proposal.Signature, []byte(secret)) || string(rs.ProposalBlock.Data.Txs[0]) != secret {
		t.Fatal("projection mutated source objects")
	}
	if got := pqNetworkProgressProject(3, nil); got.Index != 3 || got.ConsensusAvailable || got.Proposal || got.Prevotes.Available {
		t.Fatal("missing consensus state was represented as an available observation")
	}
}

func TestPQNetworkProgressVotingPowerAndOptIn(t *testing.T) {
	// No node is constructed. Exercise the real VoteSet participation API with
	// tiny synthetic Ed votes, including a weighted majority of ONE voter, so
	// a count-based approximation cannot masquerade as the engine's >2/3 test.
	const chainID = "synthetic-progress-only"
	keys := make([]cmted.PrivKey, 4)
	validators := make([]*cmttypes.Validator, len(keys))
	for i := range keys {
		keys[i] = cmted.GenPrivKeyFromSecret([]byte{byte(i), 0x70, 0x72, 0x6f, 0x67})
		power := int64(1)
		if i == 0 {
			power = 7
		}
		validators[i] = cmttypes.NewValidator(keys[i].PubKey(), power)
	}
	set := cmttypes.NewValidatorSet(validators)
	votes := cstypes.NewHeightVoteSet(chainID, 22, set)
	rs := &cstypes.RoundState{Height: 22, Round: 0, Step: cstypes.RoundStepPrevote, Votes: votes}
	before := pqNetworkProgressProject(0, rs)
	if !before.Prevotes.Available || before.Prevotes.Validators != 4 || before.Prevotes.Participants != 0 || before.Prevotes.TwoThirdsAny || before.Precommits.Participants != 0 {
		t.Fatal("empty real vote set was misreported")
	}
	index, _ := set.GetByAddress(keys[0].PubKey().Address())
	vote := &cmttypes.Vote{Type: cmtproto.PrevoteType, Height: 22, Round: 0, Timestamp: time.Unix(100, 0).UTC(), ValidatorAddress: keys[0].PubKey().Address(), ValidatorIndex: index}
	var err error
	vote.Signature, err = keys[0].Sign(cmttypes.VoteSignBytes(chainID, vote.ToProto()))
	if err != nil {
		t.Fatal("synthetic progress vote signing failed")
	}
	if added, err := votes.AddVote(vote, "", false); err != nil || !added {
		t.Fatal("synthetic progress vote was not admitted by the real VoteSet")
	}
	after := pqNetworkProgressProject(0, rs)
	if after.Prevotes.Participants != 1 || !after.Prevotes.TwoThirdsAny || !after.Prevotes.TwoThirdsMajority || after.Precommits.Participants != 0 || after.Precommits.TwoThirdsAny {
		t.Fatal("weighted >2/3 prevotes were confused with a count or precommit")
	}
	// The nil-block majority above is intentionally not labelled a commit.
	rs.Round = 9
	if got := pqNetworkProgressProject(0, rs); got.Prevotes.Available || got.Precommits.Available {
		t.Fatal("untracked round reused another round's votes")
	}
	for _, optIn := range []string{"", "not-authorized"} {
		t.Setenv("YNX_PQ_NETWORK_E2E", optIn)
		n := &pqNetworkE2E{}
		n.observeProgress("untrusted-absolute-path")
		if !n.progress.sampled.IsZero() || n.progress.rows != 0 || n.progress.bytes != 0 {
			t.Fatal("non-opted-in call collected network progress")
		}
	}
}
