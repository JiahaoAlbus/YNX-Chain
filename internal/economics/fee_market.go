package economics

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

const FeeMarketCandidateVersion = 1

var CanonicalFeeLaneIDs = []string{"ai", "contract", "pay", "resource", "transfer", "trust"}

type FeeLanePolicy struct {
	InitialBaseFeePerUnit     int64 `json:"initialBaseFeePerUnit"`
	MinimumBaseFeePerUnit     int64 `json:"minimumBaseFeePerUnit"`
	MaximumBaseFeePerUnit     int64 `json:"maximumBaseFeePerUnit"`
	MaximumPriorityFeePerUnit int64 `json:"maximumPriorityFeePerUnit"`
	TargetUnitsPerBlock       int64 `json:"targetUnitsPerBlock"`
	MaximumUnitsPerBlock      int64 `json:"maximumUnitsPerBlock"`
	AdjustmentDenominator     int64 `json:"adjustmentDenominator"`
	ServiceFeePerUnit         int64 `json:"serviceFeePerUnit"`
	ServiceBurnBPS            int64 `json:"serviceBurnBps"`
	ValidatorShareBPS         int64 `json:"validatorShareBps"`
	ProviderShareBPS          int64 `json:"providerShareBps"`
	ProtocolShareBPS          int64 `json:"protocolShareBps"`
	TreasuryShareBPS          int64 `json:"treasuryShareBps"`
}

type FeeMarketPolicy struct {
	Version                   int                      `json:"version"`
	BaseFeeBurnBPS            int64                    `json:"baseFeeBurnBps"`
	GovernanceTimelockEpochs  int64                    `json:"governanceTimelockEpochs"`
	MaximumParameterChangeBPS int64                    `json:"maximumParameterChangeBps"`
	Lanes                     map[string]FeeLanePolicy `json:"lanes"`
}

type FeeMarketTransaction struct {
	ID                 string `json:"id"`
	User               string `json:"user"`
	Sponsor            string `json:"sponsor,omitempty"`
	Units              int64  `json:"units"`
	MaxFeePerUnit      int64  `json:"maxFeePerUnit"`
	PriorityFeePerUnit int64  `json:"priorityFeePerUnit"`
}

type FeeMarketLaneBlock struct {
	Lane         string                 `json:"lane"`
	Transactions []FeeMarketTransaction `json:"transactions"`
}

type FeeMarketBlockInput struct {
	Height int64                `json:"height"`
	Lanes  []FeeMarketLaneBlock `json:"lanes"`
}

type FeeMarketInputs struct {
	AsOf                     time.Time             `json:"asOf"`
	GovernanceApproved       bool                  `json:"governanceApproved"`
	CandidateActivationEpoch int64                 `json:"candidateActivationEpoch"`
	Blocks                   []FeeMarketBlockInput `json:"blocks"`
}

type CandidateFeeEvent struct {
	ID                 string `json:"id"`
	PolicyVersion      int    `json:"policyVersion"`
	BlockHeight        int64  `json:"blockHeight"`
	Lane               string `json:"lane"`
	TransactionID      string `json:"transactionId"`
	User               string `json:"user"`
	Payer              string `json:"payer"`
	Sponsor            string `json:"sponsor,omitempty"`
	Sponsored          bool   `json:"sponsored"`
	Units              int64  `json:"units"`
	BaseFeePerUnit     int64  `json:"baseFeePerUnit"`
	PriorityFeePerUnit int64  `json:"priorityFeePerUnit"`
	ServiceFeePerUnit  int64  `json:"serviceFeePerUnit"`
	GrossFeeYNXT       int64  `json:"grossFeeYnxt"`
	BaseFeeBurnYNXT    int64  `json:"baseFeeBurnYnxt"`
	ServiceBurnYNXT    int64  `json:"serviceBurnYnxt"`
	ValidatorYNXT      int64  `json:"validatorYnxt"`
	ProviderYNXT       int64  `json:"providerYnxt"`
	ProtocolYNXT       int64  `json:"protocolYnxt"`
	TreasuryYNXT       int64  `json:"treasuryYnxt"`
	Accepted           bool   `json:"accepted"`
	Failure            string `json:"failure,omitempty"`
	Source             string `json:"source"`
	AuditHash          string `json:"auditHash"`
}

type FeeLaneBlockResult struct {
	Lane                  string              `json:"lane"`
	OpeningBaseFeePerUnit int64               `json:"openingBaseFeePerUnit"`
	UsedUnits             int64               `json:"usedUnits"`
	TargetUnits           int64               `json:"targetUnits"`
	MaximumUnits          int64               `json:"maximumUnits"`
	ClosingBaseFeePerUnit int64               `json:"closingBaseFeePerUnit"`
	GrossFeeYNXT          int64               `json:"grossFeeYnxt"`
	BaseFeeBurnYNXT       int64               `json:"baseFeeBurnYnxt"`
	ServiceBurnYNXT       int64               `json:"serviceBurnYnxt"`
	ValidatorYNXT         int64               `json:"validatorYnxt"`
	ProviderYNXT          int64               `json:"providerYnxt"`
	ProtocolYNXT          int64               `json:"protocolYnxt"`
	TreasuryYNXT          int64               `json:"treasuryYnxt"`
	Events                []CandidateFeeEvent `json:"events"`
	Reconciled            bool                `json:"reconciled"`
}

type FeeMarketBlockResult struct {
	Height int64                `json:"height"`
	Lanes  []FeeLaneBlockResult `json:"lanes"`
}

type FeeMarketSimulation struct {
	SchemaVersion       int                    `json:"schemaVersion"`
	Source              string                 `json:"source"`
	AsOf                time.Time              `json:"asOf"`
	Version             int                    `json:"version"`
	Coverage            string                 `json:"coverage"`
	Policy              FeeMarketPolicy        `json:"policy"`
	Inputs              FeeMarketInputs        `json:"inputs"`
	Blocks              []FeeMarketBlockResult `json:"blocks"`
	ConsensusActive     bool                   `json:"consensusActive"`
	GovernanceActivated bool                   `json:"governanceActivated"`
	ExplorerIntegrated  bool                   `json:"explorerIntegrated"`
	Reconciled          bool                   `json:"reconciled"`
	Warnings            []string               `json:"warnings"`
}

func DefaultFeeMarketPolicy() FeeMarketPolicy {
	lanes := map[string]FeeLanePolicy{}
	for _, id := range CanonicalFeeLaneIDs {
		lanes[id] = FeeLanePolicy{InitialBaseFeePerUnit: 10, MinimumBaseFeePerUnit: 1, MaximumBaseFeePerUnit: 1_000_000, MaximumPriorityFeePerUnit: 100_000, TargetUnitsPerBlock: 1_000, MaximumUnitsPerBlock: 2_000, AdjustmentDenominator: 8, ValidatorShareBPS: 7_000, ProviderShareBPS: 1_000, ProtocolShareBPS: 1_000, TreasuryShareBPS: 1_000}
	}
	service := lanes["ai"]
	service.ServiceFeePerUnit, service.ServiceBurnBPS = 2, 1_000
	service.ValidatorShareBPS, service.ProviderShareBPS, service.ProtocolShareBPS, service.TreasuryShareBPS = 1_000, 6_000, 2_000, 1_000
	lanes["ai"] = service
	for _, id := range []string{"pay", "resource", "trust"} {
		service = lanes[id]
		service.ServiceFeePerUnit, service.ServiceBurnBPS = 1, 1_000
		service.ValidatorShareBPS, service.ProviderShareBPS, service.ProtocolShareBPS, service.TreasuryShareBPS = 4_000, 3_000, 2_000, 1_000
		lanes[id] = service
	}
	return FeeMarketPolicy{Version: FeeMarketCandidateVersion, BaseFeeBurnBPS: BasisPoints, GovernanceTimelockEpochs: 7, MaximumParameterChangeBPS: 1_000, Lanes: lanes}
}

func (p FeeMarketPolicy) Validate() error {
	if p.Version != FeeMarketCandidateVersion || p.BaseFeeBurnBPS < 0 || p.BaseFeeBurnBPS > BasisPoints || p.GovernanceTimelockEpochs < 1 || p.MaximumParameterChangeBPS < 1 || p.MaximumParameterChangeBPS > BasisPoints || len(p.Lanes) != len(CanonicalFeeLaneIDs) {
		return errors.New("fee market policy is incomplete or outside bounds")
	}
	for _, id := range CanonicalFeeLaneIDs {
		lane, ok := p.Lanes[id]
		shares := lane.ValidatorShareBPS + lane.ProviderShareBPS + lane.ProtocolShareBPS + lane.TreasuryShareBPS
		if !ok || lane.MinimumBaseFeePerUnit < 1 || lane.InitialBaseFeePerUnit < lane.MinimumBaseFeePerUnit || lane.MaximumBaseFeePerUnit < lane.InitialBaseFeePerUnit || lane.MaximumPriorityFeePerUnit < 0 || lane.TargetUnitsPerBlock < 1 || lane.MaximumUnitsPerBlock < lane.TargetUnitsPerBlock || lane.AdjustmentDenominator < 1 || lane.ServiceFeePerUnit < 0 || lane.ServiceBurnBPS < 0 || lane.ServiceBurnBPS > BasisPoints || shares != BasisPoints {
			return fmt.Errorf("fee lane %s policy is invalid", id)
		}
		if lane.TargetUnitsPerBlock > math.MaxInt64/lane.AdjustmentDenominator || lane.MaximumBaseFeePerUnit > math.MaxInt64-lane.MaximumPriorityFeePerUnit || lane.MaximumBaseFeePerUnit+lane.MaximumPriorityFeePerUnit > math.MaxInt64-lane.ServiceFeePerUnit || lane.MaximumBaseFeePerUnit+lane.MaximumPriorityFeePerUnit+lane.ServiceFeePerUnit > math.MaxInt64/lane.MaximumUnitsPerBlock {
			return fmt.Errorf("fee lane %s arithmetic bounds are unsafe", id)
		}
		for _, share := range []int64{lane.ValidatorShareBPS, lane.ProviderShareBPS, lane.ProtocolShareBPS, lane.TreasuryShareBPS} {
			if share < 0 || share > BasisPoints {
				return fmt.Errorf("fee lane %s share is invalid", id)
			}
		}
	}
	for id := range p.Lanes {
		if !containsString(CanonicalFeeLaneIDs, id) {
			return errors.New("fee market policy contains an unknown lane")
		}
	}
	return nil
}

func SimulateFeeMarket(policy FeeMarketPolicy, in FeeMarketInputs) (FeeMarketSimulation, error) {
	if err := policy.Validate(); err != nil {
		return FeeMarketSimulation{}, err
	}
	if err := validateFeeMarketInputs(in); err != nil {
		return FeeMarketSimulation{}, err
	}
	baseFees := map[string]int64{}
	for _, id := range CanonicalFeeLaneIDs {
		baseFees[id] = policy.Lanes[id].InitialBaseFeePerUnit
	}
	result := FeeMarketSimulation{SchemaVersion: 1, Source: "user-supplied-fee-market-simulation-input", AsOf: in.AsOf.UTC(), Version: FeeMarketCandidateVersion, Coverage: "deterministic-candidate-not-consensus-state", Policy: policy, Inputs: in, Blocks: make([]FeeMarketBlockResult, 0, len(in.Blocks)), ConsensusActive: false, GovernanceActivated: false, ExplorerIntegrated: false, Reconciled: true, Warnings: []string{"Candidate only; current consensus fixed-fee policy remains authoritative and no base fee, burn, lane, sponsorship, or split is activated by this output.", "Burn destroys supply and is never counted as validator, provider, protocol, or Treasury revenue.", "Sponsor attribution changes the disclosed payer only; it does not change gross fee or create a hidden spread."}}
	seenTransactions := map[string]bool{}
	for _, block := range in.Blocks {
		blockResult := FeeMarketBlockResult{Height: block.Height, Lanes: make([]FeeLaneBlockResult, 0, len(CanonicalFeeLaneIDs))}
		byLane := map[string]FeeMarketLaneBlock{}
		for _, lane := range block.Lanes {
			byLane[lane.Lane] = lane
		}
		for _, laneID := range CanonicalFeeLaneIDs {
			laneResult, err := simulateFeeLaneBlock(policy, laneID, block.Height, baseFees[laneID], byLane[laneID].Transactions, seenTransactions)
			if err != nil {
				return FeeMarketSimulation{}, err
			}
			baseFees[laneID] = laneResult.ClosingBaseFeePerUnit
			result.Reconciled = result.Reconciled && laneResult.Reconciled
			blockResult.Lanes = append(blockResult.Lanes, laneResult)
		}
		result.Blocks = append(result.Blocks, blockResult)
	}
	return result, nil
}

func validateFeeMarketInputs(in FeeMarketInputs) error {
	if in.AsOf.IsZero() || len(in.Blocks) < 1 || len(in.Blocks) > 10_000 {
		return errors.New("fee market inputs are incomplete or outside bounds")
	}
	previousHeight := int64(0)
	for _, block := range in.Blocks {
		if block.Height <= previousHeight || len(block.Lanes) != len(CanonicalFeeLaneIDs) {
			return errors.New("fee market blocks must be strictly ordered and contain every lane")
		}
		previousHeight = block.Height
		seen := map[string]bool{}
		for _, lane := range block.Lanes {
			if !containsString(CanonicalFeeLaneIDs, lane.Lane) || seen[lane.Lane] {
				return errors.New("fee market block contains an unknown or duplicate lane")
			}
			seen[lane.Lane] = true
		}
	}
	return nil
}

func simulateFeeLaneBlock(policy FeeMarketPolicy, laneID string, height, openingBaseFee int64, transactions []FeeMarketTransaction, seen map[string]bool) (FeeLaneBlockResult, error) {
	lane := policy.Lanes[laneID]
	result := FeeLaneBlockResult{Lane: laneID, OpeningBaseFeePerUnit: openingBaseFee, TargetUnits: lane.TargetUnitsPerBlock, MaximumUnits: lane.MaximumUnitsPerBlock, Events: make([]CandidateFeeEvent, 0, len(transactions)), Reconciled: true}
	for _, tx := range transactions {
		if strings.TrimSpace(tx.ID) == "" || seen[tx.ID] {
			return FeeLaneBlockResult{}, errors.New("fee market transaction IDs must be non-empty and globally unique")
		}
		seen[tx.ID] = true
		event := CandidateFeeEvent{PolicyVersion: FeeMarketCandidateVersion, BlockHeight: height, Lane: laneID, TransactionID: tx.ID, User: strings.TrimSpace(tx.User), Payer: strings.TrimSpace(tx.User), Sponsor: strings.TrimSpace(tx.Sponsor), Sponsored: strings.TrimSpace(tx.Sponsor) != "", Units: tx.Units, BaseFeePerUnit: openingBaseFee, ServiceFeePerUnit: lane.ServiceFeePerUnit, Source: "ynx-fee-market-candidate-v1"}
		if event.Sponsored {
			event.Payer = event.Sponsor
		}
		event.ID = candidateFeeEventID(height, laneID, tx.ID)
		failure := validateCandidateFeeTransaction(tx, event, result.UsedUnits, lane)
		if failure == "" {
			availablePriority := tx.MaxFeePerUnit - openingBaseFee - lane.ServiceFeePerUnit
			event.PriorityFeePerUnit = minInt64(tx.PriorityFeePerUnit, availablePriority)
			if err := calculateCandidateFeeEvent(policy, lane, &event); err != nil {
				return FeeLaneBlockResult{}, err
			}
			event.Accepted = true
			result.UsedUnits += tx.Units
			result.GrossFeeYNXT += event.GrossFeeYNXT
			result.BaseFeeBurnYNXT += event.BaseFeeBurnYNXT
			result.ServiceBurnYNXT += event.ServiceBurnYNXT
			result.ValidatorYNXT += event.ValidatorYNXT
			result.ProviderYNXT += event.ProviderYNXT
			result.ProtocolYNXT += event.ProtocolYNXT
			result.TreasuryYNXT += event.TreasuryYNXT
		} else {
			event.Failure = failure
		}
		event.AuditHash = candidateFeeAuditHash(event)
		result.Events = append(result.Events, event)
	}
	result.ClosingBaseFeePerUnit = adjustCandidateBaseFee(openingBaseFee, result.UsedUnits, lane)
	allocated := result.BaseFeeBurnYNXT + result.ServiceBurnYNXT + result.ValidatorYNXT + result.ProviderYNXT + result.ProtocolYNXT + result.TreasuryYNXT
	result.Reconciled = result.GrossFeeYNXT == allocated
	return result, nil
}

func validateCandidateFeeTransaction(tx FeeMarketTransaction, event CandidateFeeEvent, used int64, lane FeeLanePolicy) string {
	if event.User == "" || event.Payer == "" || (event.Sponsored && event.Sponsor == event.User) {
		return "payer_attribution_invalid"
	}
	if tx.Units < 1 || tx.MaxFeePerUnit < 0 || tx.PriorityFeePerUnit < 0 || tx.PriorityFeePerUnit > lane.MaximumPriorityFeePerUnit || used > lane.MaximumUnitsPerBlock-tx.Units {
		return "units_or_lane_capacity_invalid"
	}
	minimum := event.BaseFeePerUnit + event.ServiceFeePerUnit
	if tx.MaxFeePerUnit < minimum {
		return "max_fee_below_base_and_service_fee"
	}
	return ""
}

func calculateCandidateFeeEvent(policy FeeMarketPolicy, lane FeeLanePolicy, event *CandidateFeeEvent) error {
	base, err := checkedMultiply(event.BaseFeePerUnit, event.Units)
	if err != nil {
		return err
	}
	priority, err := checkedMultiply(event.PriorityFeePerUnit, event.Units)
	if err != nil {
		return err
	}
	service, err := checkedMultiply(event.ServiceFeePerUnit, event.Units)
	if err != nil || base > math.MaxInt64-priority || base+priority > math.MaxInt64-service {
		return errors.New("fee market charge overflow")
	}
	event.GrossFeeYNXT = base + priority + service
	event.BaseFeeBurnYNXT, _ = mulDiv(base, policy.BaseFeeBurnBPS, BasisPoints)
	event.ServiceBurnYNXT, _ = mulDiv(service, lane.ServiceBurnBPS, BasisPoints)
	distributable := event.GrossFeeYNXT - event.BaseFeeBurnYNXT - event.ServiceBurnYNXT
	event.ValidatorYNXT, _ = mulDiv(distributable, lane.ValidatorShareBPS, BasisPoints)
	event.ProviderYNXT, _ = mulDiv(distributable, lane.ProviderShareBPS, BasisPoints)
	event.ProtocolYNXT, _ = mulDiv(distributable, lane.ProtocolShareBPS, BasisPoints)
	event.TreasuryYNXT = distributable - event.ValidatorYNXT - event.ProviderYNXT - event.ProtocolYNXT
	return nil
}

func adjustCandidateBaseFee(opening, used int64, lane FeeLanePolicy) int64 {
	if used == lane.TargetUnitsPerBlock {
		return opening
	}
	deltaUnits := used - lane.TargetUnitsPerBlock
	absDelta := deltaUnits
	if absDelta < 0 {
		absDelta = -absDelta
	}
	delta, err := mulDiv(opening, absDelta, lane.TargetUnitsPerBlock*lane.AdjustmentDenominator)
	if err != nil {
		return opening
	}
	if deltaUnits > 0 && delta < 1 {
		delta = 1
	}
	closing := opening
	if deltaUnits > 0 {
		if opening > math.MaxInt64-delta {
			closing = lane.MaximumBaseFeePerUnit
		} else {
			closing = opening + delta
		}
	} else {
		closing = opening - delta
	}
	if closing < lane.MinimumBaseFeePerUnit {
		return lane.MinimumBaseFeePerUnit
	}
	if closing > lane.MaximumBaseFeePerUnit {
		return lane.MaximumBaseFeePerUnit
	}
	return closing
}

func checkedMultiply(a, b int64) (int64, error) {
	if a < 0 || b < 0 || (a != 0 && b > math.MaxInt64/a) {
		return 0, errors.New("fee market multiplication overflow")
	}
	return a * b, nil
}

func candidateFeeEventID(height int64, lane, txID string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("YNX_FEE_CANDIDATE_V1\x00%d\x00%s\x00%s", height, lane, txID)))
	return "feec_" + hex.EncodeToString(sum[:12])
}

func candidateFeeAuditHash(event CandidateFeeEvent) string {
	event.AuditHash = ""
	raw, _ := json.Marshal(event)
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}
