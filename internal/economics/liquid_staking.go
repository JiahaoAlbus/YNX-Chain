package economics

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strings"
	"time"
)

const (
	LiquidStakingVersion = 1
	RateScale            = int64(1_000_000_000)
)

type LiquidStakingPolicy struct {
	Version                       int   `json:"version"`
	UnbondingEpochs               int64 `json:"unbondingEpochs"`
	MaxValidatorAllocationBPS     int64 `json:"maxValidatorAllocationBps"`
	MaxDepositYNXTPerAction       int64 `json:"maxDepositYnxtPerAction"`
	MaxWithdrawalSharesPerAction  int64 `json:"maxWithdrawalSharesPerAction"`
	MaxSecondaryMarketDiscountBPS int64 `json:"maxSecondaryMarketDiscountBps"`
}

type LiquidStakingAction struct {
	Epoch                 int64  `json:"epoch"`
	Type                  string `json:"type"`
	Amount                int64  `json:"amount,omitempty"`
	Validator             string `json:"validator,omitempty"`
	QueueID               string `json:"queueId,omitempty"`
	MarketPriceBPSOfNAV   int64  `json:"marketPriceBpsOfNav,omitempty"`
	MarketAvailableShares int64  `json:"marketAvailableShares,omitempty"`
}

type LiquidStakingInputs struct {
	AsOf                   time.Time             `json:"asOf"`
	InitialValidatorYNXT   map[string]int64      `json:"initialValidatorYnxt"`
	InitialLiquidYNXT      int64                 `json:"initialLiquidYnxt"`
	InitialShareSupply     int64                 `json:"initialShareSupply"`
	InitiallyPaused        bool                  `json:"initiallyPaused"`
	ContractAuditCompleted bool                  `json:"contractAuditCompleted"`
	GovernanceActivated    bool                  `json:"governanceActivated"`
	SecondaryLiquidityLive bool                  `json:"secondaryLiquidityLive"`
	Actions                []LiquidStakingAction `json:"actions"`
}

type LiquidStakingWithdrawal struct {
	ID             string `json:"id"`
	RequestedEpoch int64  `json:"requestedEpoch"`
	MaturesEpoch   int64  `json:"maturesEpoch"`
	SharesBurned   int64  `json:"sharesBurned"`
	ClaimYNXT      int64  `json:"claimYnxt"`
	Status         string `json:"status"`
}

type ValidatorAllocation struct {
	Validator     string `json:"validator"`
	BondedYNXT    int64  `json:"bondedYnxt"`
	AllocationBPS int64  `json:"allocationBps"`
}

type LiquidStakingStep struct {
	Index                            int                       `json:"index"`
	Action                           LiquidStakingAction       `json:"action"`
	Accepted                         bool                      `json:"accepted"`
	Failure                          string                    `json:"failure,omitempty"`
	Paused                           bool                      `json:"paused"`
	BondedYNXT                       int64                     `json:"bondedYnxt"`
	LiquidYNXT                       int64                     `json:"liquidYnxt"`
	BackingYNXT                      int64                     `json:"backingYnxt"`
	ShareSupply                      int64                     `json:"shareSupply"`
	PendingWithdrawalYNXT            int64                     `json:"pendingWithdrawalYnxt"`
	ActiveBackingYNXT                int64                     `json:"activeBackingYnxt"`
	UnderlyingPerShareNano           int64                     `json:"underlyingPerShareNano"`
	Solvent                          bool                      `json:"solvent"`
	ValidatorAllocations             []ValidatorAllocation     `json:"validatorAllocations"`
	ValidatorAllocationLimitBreached bool                      `json:"validatorAllocationLimitBreached"`
	WithdrawalQueue                  []LiquidStakingWithdrawal `json:"withdrawalQueue"`
	SecondaryMarketObserved          bool                      `json:"secondaryMarketObserved"`
	SecondaryMarketDiscountBPS       int64                     `json:"secondaryMarketDiscountBps,omitempty"`
	SecondaryMarketLimitBreached     bool                      `json:"secondaryMarketLimitBreached"`
}

type LiquidStakingSimulation struct {
	SchemaVersion     int                 `json:"schemaVersion"`
	Source            string              `json:"source"`
	AsOf              time.Time           `json:"asOf"`
	Version           int                 `json:"version"`
	Coverage          string              `json:"coverage"`
	Policy            LiquidStakingPolicy `json:"policy"`
	Inputs            LiquidStakingInputs `json:"inputs"`
	Steps             []LiquidStakingStep `json:"steps"`
	MainnetReady      bool                `json:"mainnetReady"`
	ContractExecution bool                `json:"contractExecution"`
	GuaranteedAPY     bool                `json:"guaranteedApy"`
	GuaranteedPeg     bool                `json:"guaranteedPeg"`
	Warnings          []string            `json:"warnings"`
}

type liquidStakingState struct {
	validators map[string]int64
	liquid     int64
	shares     int64
	paused     bool
	queue      []LiquidStakingWithdrawal
}

func DefaultLiquidStakingPolicy() LiquidStakingPolicy {
	return LiquidStakingPolicy{Version: LiquidStakingVersion, UnbondingEpochs: 21, MaxValidatorAllocationBPS: 2_500, MaxDepositYNXTPerAction: 1_000_000, MaxWithdrawalSharesPerAction: 1_000_000, MaxSecondaryMarketDiscountBPS: 1_500}
}

func (p LiquidStakingPolicy) Validate() error {
	if p.Version != LiquidStakingVersion || p.UnbondingEpochs < 1 || p.UnbondingEpochs > 100_000 || p.MaxValidatorAllocationBPS < 1 || p.MaxValidatorAllocationBPS > BasisPoints || p.MaxDepositYNXTPerAction < 1 || p.MaxWithdrawalSharesPerAction < 1 || p.MaxSecondaryMarketDiscountBPS < 0 || p.MaxSecondaryMarketDiscountBPS > BasisPoints {
		return errors.New("liquid staking policy is incomplete or outside safety bounds")
	}
	return nil
}

func SimulateLiquidStaking(policy LiquidStakingPolicy, in LiquidStakingInputs) (LiquidStakingSimulation, error) {
	if err := policy.Validate(); err != nil {
		return LiquidStakingSimulation{}, err
	}
	if err := validateLiquidStakingInputs(in); err != nil {
		return LiquidStakingSimulation{}, err
	}
	state := liquidStakingState{validators: copyIntMap(in.InitialValidatorYNXT), liquid: in.InitialLiquidYNXT, shares: in.InitialShareSupply, paused: in.InitiallyPaused, queue: []LiquidStakingWithdrawal{}}
	result := LiquidStakingSimulation{SchemaVersion: 1, Source: "user-supplied-liquid-staking-stress-input", AsOf: in.AsOf.UTC(), Version: LiquidStakingVersion, Coverage: "deterministic-candidate-model-not-chain-state", Policy: policy, Inputs: in, Steps: make([]LiquidStakingStep, 0, len(in.Actions)), MainnetReady: false, ContractExecution: false, GuaranteedAPY: false, GuaranteedPeg: false, Warnings: []string{"Candidate simulation only; no contract deployment, audit conclusion, governance activation, guaranteed APY, peg, redemption price, or secondary liquidity.", "Rewards and slashing change the exchange rate; queued withdrawals remain liabilities and may become undercollateralized after losses.", "Secondary-market observations are user-supplied stress inputs and do not change protocol accounting."}}
	for i, action := range in.Actions {
		before := cloneLiquidStakingState(state)
		failure := applyLiquidStakingAction(&state, policy, action)
		if failure != "" {
			state = before
		}
		step, err := liquidStakingSnapshot(state, policy, i+1, action, failure)
		if err != nil {
			return LiquidStakingSimulation{}, err
		}
		result.Steps = append(result.Steps, step)
	}
	return result, nil
}

func validateLiquidStakingInputs(in LiquidStakingInputs) error {
	if in.AsOf.IsZero() || len(in.InitialValidatorYNXT) < 1 || in.InitialLiquidYNXT < 0 || in.InitialShareSupply < 1 || len(in.Actions) < 1 || len(in.Actions) > 10_000 {
		return errors.New("liquid staking inputs are incomplete or outside safety bounds")
	}
	total, err := sumIntMap(in.InitialValidatorYNXT)
	if err != nil || total > math.MaxInt64-in.InitialLiquidYNXT || total+in.InitialLiquidYNXT < in.InitialShareSupply {
		return errors.New("initial liquid staking backing is invalid")
	}
	previousEpoch := int64(-1)
	for id, amount := range in.InitialValidatorYNXT {
		if strings.TrimSpace(id) == "" || amount < 0 {
			return errors.New("initial validator allocation is invalid")
		}
	}
	for _, action := range in.Actions {
		if action.Epoch < 0 || action.Epoch < previousEpoch {
			return errors.New("liquid staking actions must be ordered by non-negative epoch")
		}
		previousEpoch = action.Epoch
	}
	return nil
}

func applyLiquidStakingAction(state *liquidStakingState, policy LiquidStakingPolicy, action LiquidStakingAction) string {
	action.Type = strings.ToLower(strings.TrimSpace(action.Type))
	action.Validator = strings.TrimSpace(action.Validator)
	action.QueueID = strings.TrimSpace(action.QueueID)
	switch action.Type {
	case "deposit":
		if state.paused {
			return "deposits_paused"
		}
		if action.Amount < 1 || action.Amount > policy.MaxDepositYNXTPerAction || action.Validator == "" {
			return "deposit_outside_policy"
		}
		backing, pending, err := liquidTotals(*state)
		if err != nil || backing < pending || backing-pending < 1 {
			return "accounting_unavailable"
		}
		minted, err := mulDiv(action.Amount, state.shares, backing-pending)
		if err != nil || minted < 1 || state.validators[action.Validator] > math.MaxInt64-action.Amount || state.shares > math.MaxInt64-minted {
			return "deposit_overflow_or_dust"
		}
		candidateTotal := backing + action.Amount - state.liquid
		candidateAllocation := state.validators[action.Validator] + action.Amount
		allocationBPS, err := mulDiv(candidateAllocation, BasisPoints, candidateTotal)
		if err != nil || allocationBPS > policy.MaxValidatorAllocationBPS {
			return "validator_allocation_cap_exceeded"
		}
		state.validators[action.Validator] = candidateAllocation
		state.shares += minted
	case "reward":
		if action.Amount < 1 || action.Validator == "" || state.validators[action.Validator] > math.MaxInt64-action.Amount {
			return "reward_invalid"
		}
		state.validators[action.Validator] += action.Amount
	case "slash":
		if action.Amount < 1 || action.Validator == "" || state.validators[action.Validator] < action.Amount {
			return "slash_invalid"
		}
		state.validators[action.Validator] -= action.Amount
	case "request_withdrawal":
		if action.Amount < 1 || action.Amount > policy.MaxWithdrawalSharesPerAction || action.Amount > state.shares {
			return "withdrawal_outside_policy"
		}
		backing, pending, err := liquidTotals(*state)
		if err != nil || backing < pending {
			return "accounting_unavailable"
		}
		claim, err := mulDiv(action.Amount, backing-pending, state.shares)
		if err != nil || claim < 1 {
			return "withdrawal_dust_or_overflow"
		}
		state.shares -= action.Amount
		id := fmt.Sprintf("lstq-%06d", len(state.queue)+1)
		state.queue = append(state.queue, LiquidStakingWithdrawal{ID: id, RequestedEpoch: action.Epoch, MaturesEpoch: action.Epoch + policy.UnbondingEpochs, SharesBurned: action.Amount, ClaimYNXT: claim, Status: "queued"})
	case "fulfill_withdrawal":
		index := -1
		for i := range state.queue {
			if state.queue[i].ID == action.QueueID {
				index = i
				break
			}
		}
		if index < 0 || state.queue[index].Status != "queued" {
			return "withdrawal_not_queued"
		}
		entry := state.queue[index]
		if action.Epoch < entry.MaturesEpoch {
			return "withdrawal_not_mature"
		}
		if err := removeBacking(state, entry.ClaimYNXT); err != nil {
			return "insufficient_backing_for_redemption"
		}
		state.queue[index].Status = "fulfilled"
	case "pause":
		state.paused = true
	case "unpause":
		state.paused = false
	case "secondary_quote":
		if action.MarketPriceBPSOfNAV < 1 || action.MarketPriceBPSOfNAV > 20_000 || action.MarketAvailableShares < 0 {
			return "secondary_quote_invalid"
		}
	default:
		return "unsupported_action"
	}
	return ""
}

func removeBacking(state *liquidStakingState, amount int64) error {
	if amount < 0 {
		return errors.New("negative redemption")
	}
	fromLiquid := amount
	if fromLiquid > state.liquid {
		fromLiquid = state.liquid
	}
	state.liquid -= fromLiquid
	remaining := amount - fromLiquid
	keys := sortedKeys(state.validators)
	for _, id := range keys {
		value := state.validators[id]
		take := value
		if take > remaining {
			take = remaining
		}
		state.validators[id] -= take
		remaining -= take
		if remaining == 0 {
			return nil
		}
	}
	return errors.New("insufficient backing")
}

func liquidStakingSnapshot(state liquidStakingState, policy LiquidStakingPolicy, index int, action LiquidStakingAction, failure string) (LiquidStakingStep, error) {
	backing, pending, err := liquidTotals(state)
	if err != nil {
		return LiquidStakingStep{}, err
	}
	active := int64(0)
	if backing >= pending {
		active = backing - pending
	}
	rate := int64(0)
	if state.shares > 0 && active > 0 {
		rate, err = mulDiv(active, RateScale, state.shares)
		if err != nil {
			return LiquidStakingStep{}, err
		}
	}
	bonded, _ := sumIntMap(state.validators)
	allocations := make([]ValidatorAllocation, 0, len(state.validators))
	allocationLimitBreached := false
	for _, id := range sortedKeys(state.validators) {
		bps := int64(0)
		if bonded > 0 {
			bps, _ = mulDiv(state.validators[id], BasisPoints, bonded)
		}
		allocations = append(allocations, ValidatorAllocation{Validator: id, BondedYNXT: state.validators[id], AllocationBPS: bps})
		if bps > policy.MaxValidatorAllocationBPS {
			allocationLimitBreached = true
		}
	}
	queue := append([]LiquidStakingWithdrawal(nil), state.queue...)
	step := LiquidStakingStep{Index: index, Action: action, Accepted: failure == "", Failure: failure, Paused: state.paused, BondedYNXT: bonded, LiquidYNXT: state.liquid, BackingYNXT: backing, ShareSupply: state.shares, PendingWithdrawalYNXT: pending, ActiveBackingYNXT: active, UnderlyingPerShareNano: rate, Solvent: backing >= pending, ValidatorAllocations: allocations, ValidatorAllocationLimitBreached: allocationLimitBreached, WithdrawalQueue: queue}
	if strings.EqualFold(strings.TrimSpace(action.Type), "secondary_quote") && failure == "" {
		step.SecondaryMarketObserved = true
		if action.MarketPriceBPSOfNAV < BasisPoints {
			step.SecondaryMarketDiscountBPS = BasisPoints - action.MarketPriceBPSOfNAV
		}
		step.SecondaryMarketLimitBreached = step.SecondaryMarketDiscountBPS > policy.MaxSecondaryMarketDiscountBPS
	}
	return step, nil
}

func cloneLiquidStakingState(value liquidStakingState) liquidStakingState {
	return liquidStakingState{validators: copyIntMap(value.validators), liquid: value.liquid, shares: value.shares, paused: value.paused, queue: append([]LiquidStakingWithdrawal(nil), value.queue...)}
}

func liquidTotals(state liquidStakingState) (int64, int64, error) {
	bonded, err := sumIntMap(state.validators)
	if err != nil || bonded > math.MaxInt64-state.liquid {
		return 0, 0, errors.New("liquid staking backing overflow")
	}
	backing := bonded + state.liquid
	pending := int64(0)
	for _, entry := range state.queue {
		if entry.Status == "queued" {
			if entry.ClaimYNXT < 0 || pending > math.MaxInt64-entry.ClaimYNXT {
				return 0, 0, errors.New("liquid staking liability overflow")
			}
			pending += entry.ClaimYNXT
		}
	}
	return backing, pending, nil
}

func mulDiv(a, b, denominator int64) (int64, error) {
	if a < 0 || b < 0 || denominator <= 0 {
		return 0, errors.New("invalid multiplication division input")
	}
	value := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	value.Quo(value, big.NewInt(denominator))
	if !value.IsInt64() {
		return 0, errors.New("multiplication division overflow")
	}
	return value.Int64(), nil
}

func sortedKeys(values map[string]int64) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
