package streambft

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

const (
	CandidateVersion = 1
	ChainID          = "ynx_6423-1"
)

type Lane string

const (
	LaneConsensusGovernance Lane = "consensus_governance"
	LaneOracleBridgeRisk    Lane = "oracle_bridge_risk"
	LaneLiquidation         Lane = "liquidation"
	LaneCancel              Lane = "cancel_mass_cancel"
	LaneTradingOrders       Lane = "trading_orders"
	LanePayStableSettlement Lane = "pay_stable_settlement"
	LaneGeneralEVM          Lane = "general_evm"
	LaneServiceSettlement   Lane = "service_settlement"
	LaneBulkDataCommitment  Lane = "bulk_data_commitment"
)

var orderedLanes = []Lane{
	LaneConsensusGovernance,
	LaneOracleBridgeRisk,
	LaneLiquidation,
	LaneCancel,
	LaneTradingOrders,
	LanePayStableSettlement,
	LaneGeneralEVM,
	LaneServiceSettlement,
	LaneBulkDataCommitment,
}

func OrderedLanes() []Lane { return append([]Lane(nil), orderedLanes...) }

func (l Lane) Validate() error {
	for _, candidate := range orderedLanes {
		if l == candidate {
			return nil
		}
	}
	return fmt.Errorf("unsupported StreamBFT lane %q", l)
}

func laneRank(l Lane) int {
	for index, candidate := range orderedLanes {
		if l == candidate {
			return index
		}
	}
	return len(orderedLanes)
}

type AccessSet struct {
	Reads  []string `json:"reads"`
	Writes []string `json:"writes"`
}

func (a AccessSet) Normalize() AccessSet {
	return AccessSet{Reads: uniqueSorted(a.Reads), Writes: uniqueSorted(a.Writes)}
}

func (a AccessSet) Validate() error {
	normalized := a.Normalize()
	if len(normalized.Reads) != len(a.Reads) || len(normalized.Writes) != len(a.Writes) {
		return errors.New("access set keys must be unique and sorted")
	}
	for _, key := range append(append([]string(nil), a.Reads...), a.Writes...) {
		if strings.TrimSpace(key) == "" || len(key) > 256 {
			return errors.New("access set contains an empty or oversized key")
		}
	}
	return nil
}

func (a AccessSet) Conflicts(other AccessSet) bool {
	writes := make(map[string]struct{}, len(a.Writes)+len(other.Writes))
	for _, key := range a.Writes {
		writes[key] = struct{}{}
	}
	for _, key := range other.Writes {
		if _, ok := writes[key]; ok {
			return true
		}
		for _, read := range a.Reads {
			if key == read {
				return true
			}
		}
	}
	for _, key := range a.Writes {
		for _, read := range other.Reads {
			if key == read {
				return true
			}
		}
	}
	return false
}

type Resources struct {
	Compute      uint64 `json:"compute"`
	StorageRead  uint64 `json:"storageRead"`
	StorageWrite uint64 `json:"storageWrite"`
	Bandwidth    uint64 `json:"bandwidth"`
	StateGrowth  uint64 `json:"stateGrowth"`
}

func (r Resources) Add(other Resources) Resources {
	return Resources{
		Compute: r.Compute + other.Compute, StorageRead: r.StorageRead + other.StorageRead,
		StorageWrite: r.StorageWrite + other.StorageWrite, Bandwidth: r.Bandwidth + other.Bandwidth,
		StateGrowth: r.StateGrowth + other.StateGrowth,
	}
}

func (r Resources) checkedAdd(other Resources) (Resources, bool) {
	result := r.Add(other)
	if result.Compute < r.Compute || result.StorageRead < r.StorageRead ||
		result.StorageWrite < r.StorageWrite || result.Bandwidth < r.Bandwidth ||
		result.StateGrowth < r.StateGrowth {
		return Resources{}, false
	}
	return result, true
}

func (r Resources) Fits(limit Resources) bool {
	return r.Compute <= limit.Compute && r.StorageRead <= limit.StorageRead &&
		r.StorageWrite <= limit.StorageWrite && r.Bandwidth <= limit.Bandwidth &&
		r.StateGrowth <= limit.StateGrowth
}

type Transaction struct {
	ID          string            `json:"id"`
	Sender      string            `json:"sender"`
	Nonce       uint64            `json:"nonce"`
	Lane        Lane              `json:"lane"`
	Access      AccessSet         `json:"access"`
	Resources   Resources         `json:"resources"`
	FeeCap      uint64            `json:"feeCap"`
	PayloadHash string            `json:"payloadHash"`
	Writes      map[string][]byte `json:"writes,omitempty"`
}

func (t Transaction) Validate() error {
	if strings.TrimSpace(t.ID) == "" || strings.TrimSpace(t.Sender) == "" {
		return errors.New("transaction ID and sender are required")
	}
	if err := t.Lane.Validate(); err != nil {
		return err
	}
	if err := t.Access.Validate(); err != nil {
		return err
	}
	if len(t.PayloadHash) != sha256.Size*2 {
		return errors.New("payload hash must be lowercase SHA-256 hex")
	}
	if _, err := hex.DecodeString(t.PayloadHash); err != nil || strings.ToLower(t.PayloadHash) != t.PayloadHash {
		return errors.New("payload hash must be lowercase SHA-256 hex")
	}
	for key := range t.Writes {
		if !contains(t.Access.Writes, key) {
			return fmt.Errorf("write %q is absent from declared access set", key)
		}
	}
	return nil
}

func (t Transaction) CanonicalHash() (string, error) {
	if err := t.Validate(); err != nil {
		return "", err
	}
	payload, err := json.Marshal(t)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func SortTransactions(transactions []Transaction) {
	sort.SliceStable(transactions, func(i, j int) bool {
		left, right := transactions[i], transactions[j]
		if laneRank(left.Lane) != laneRank(right.Lane) {
			return laneRank(left.Lane) < laneRank(right.Lane)
		}
		if left.Sender != right.Sender {
			return left.Sender < right.Sender
		}
		if left.Nonce != right.Nonce {
			return left.Nonce < right.Nonce
		}
		return left.ID < right.ID
	})
}

func uniqueSorted(values []string) []string {
	result := append([]string(nil), values...)
	sort.Strings(result)
	if len(result) < 2 {
		return result
	}
	write := 1
	for read := 1; read < len(result); read++ {
		if result[read] != result[write-1] {
			result[write] = result[read]
			write++
		}
	}
	return result[:write]
}

func contains(values []string, wanted string) bool {
	index := sort.SearchStrings(values, wanted)
	return index < len(values) && values[index] == wanted
}
