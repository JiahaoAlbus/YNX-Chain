package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const SolvencyPolicyVersion = 1

type SolvencyLiabilityLeaf struct {
	Address              string `json:"address"`
	LiquidYNXT           int64  `json:"liquidYnxt"`
	StakedYNXT           int64  `json:"stakedYnxt"`
	PendingUnbondingYNXT int64  `json:"pendingUnbondingYnxt"`
	StrategyVaultYNXT    int64  `json:"strategyVaultYnxt"`
	PaymasterBudgetYNXT  int64  `json:"paymasterBudgetYnxt"`
	TotalYNXT            int64  `json:"totalYnxt"`
}

type SolvencyLiabilityTotals struct {
	LiquidYNXT           int64 `json:"liquidYnxt"`
	StakedYNXT           int64 `json:"stakedYnxt"`
	PendingUnbondingYNXT int64 `json:"pendingUnbondingYnxt"`
	StrategyVaultYNXT    int64 `json:"strategyVaultYnxt"`
	PaymasterBudgetYNXT  int64 `json:"paymasterBudgetYnxt"`
	TotalYNXT            int64 `json:"totalYnxt"`
}

type SolvencyExternalReserveRatio struct {
	Available bool    `json:"available"`
	ValueBPS  *uint64 `json:"valueBps"`
	Coverage  string  `json:"coverage"`
}

type SolvencyWithdrawalCapacity struct {
	OnChainTransferableYNXT     int64  `json:"onChainTransferableYnxt"`
	ExternalRedemptionAvailable bool   `json:"externalRedemptionAvailable"`
	MaximumExpectedDelay        string `json:"maximumExpectedDelay"`
}

type BFTSolvencySnapshot struct {
	SchemaVersion             int                          `json:"schemaVersion"`
	PolicyVersion             int                          `json:"policyVersion"`
	Source                    string                       `json:"source"`
	AsOfBlockHeight           uint64                       `json:"asOfBlockHeight"`
	StateHash                 string                       `json:"stateHash"`
	NativeAsset               string                       `json:"nativeAsset"`
	ConsensusIssuedAssetsYNXT int64                        `json:"consensusIssuedAssetsYnxt"`
	Liabilities               SolvencyLiabilityTotals      `json:"liabilities"`
	EncumberedYNXT            int64                        `json:"encumberedYnxt"`
	OnChainReconciliationBPS  uint64                       `json:"onChainReconciliationBps"`
	ExternalReserveRatio      SolvencyExternalReserveRatio `json:"externalReserveRatio"`
	WithdrawalCapacity        SolvencyWithdrawalCapacity   `json:"withdrawalCapacity"`
	LiabilityMerkleRoot       string                       `json:"liabilityMerkleRoot"`
	LiabilityLeafCount        int                          `json:"liabilityLeafCount"`
	CustodyCoverage           string                       `json:"custodyCoverage"`
	Reconciled                bool                         `json:"reconciled"`
	Failure                   bool                         `json:"failure"`
}

type SolvencyMerkleSibling struct {
	Hash     string `json:"hash"`
	Position string `json:"position"`
}

type BFTSolvencyLiabilityProof struct {
	SchemaVersion       int                     `json:"schemaVersion"`
	Source              string                  `json:"source"`
	AsOfBlockHeight     uint64                  `json:"asOfBlockHeight"`
	StateHash           string                  `json:"stateHash"`
	LiabilityMerkleRoot string                  `json:"liabilityMerkleRoot"`
	LeafIndex           int                     `json:"leafIndex"`
	Leaf                SolvencyLiabilityLeaf   `json:"leaf"`
	LeafHash            string                  `json:"leafHash"`
	Siblings            []SolvencyMerkleSibling `json:"siblings"`
	Verified            bool                    `json:"verified"`
}

type solvencyLiabilityTree struct {
	leaves []SolvencyLiabilityLeaf
	levels [][][sha256.Size]byte
	totals SolvencyLiabilityTotals
}

func buildSolvencySnapshot(migration chain.ConsensusMigrationState, state CommittedState) (BFTSolvencySnapshot, error) {
	tree, err := buildSolvencyLiabilityTree(state)
	if err != nil {
		return BFTSolvencySnapshot{}, err
	}
	issued, err := checkedSolvencyAdd(migration.LiquidSupplyYNXT, migration.StakedSupplyYNXT)
	if err != nil {
		return BFTSolvencySnapshot{}, errors.New("migration supply overflows solvency snapshot")
	}
	encumbered, err := checkedSolvencyAdd(tree.totals.StakedYNXT, tree.totals.PendingUnbondingYNXT, tree.totals.StrategyVaultYNXT, tree.totals.PaymasterBudgetYNXT)
	if err != nil {
		return BFTSolvencySnapshot{}, errors.New("encumbered supply overflows solvency snapshot")
	}
	reconciled := issued == tree.totals.TotalYNXT
	reconciliationBPS := uint64(0)
	if reconciled {
		reconciliationBPS = 10_000
	}
	return BFTSolvencySnapshot{
		SchemaVersion:             1,
		PolicyVersion:             SolvencyPolicyVersion,
		Source:                    "ynx-consensus-abci",
		AsOfBlockHeight:           uint64(state.Height),
		StateHash:                 state.AppHash,
		NativeAsset:               "YNXT",
		ConsensusIssuedAssetsYNXT: issued,
		Liabilities:               tree.totals,
		EncumberedYNXT:            encumbered,
		OnChainReconciliationBPS:  reconciliationBPS,
		ExternalReserveRatio:      SolvencyExternalReserveRatio{Available: false, ValueBPS: nil, Coverage: "unavailable-no-external-custody-or-fiat-reserve-attestation"},
		WithdrawalCapacity:        SolvencyWithdrawalCapacity{OnChainTransferableYNXT: tree.totals.LiquidYNXT, ExternalRedemptionAvailable: false, MaximumExpectedDelay: "unavailable-no-external-redemption-provider"},
		LiabilityMerkleRoot:       tree.rootHex(),
		LiabilityLeafCount:        len(tree.leaves),
		CustodyCoverage:           "exact-native-consensus-liabilities-only-no-external-assets",
		Reconciled:                reconciled,
		Failure:                   !reconciled,
	}, nil
}

func buildSolvencyLiabilityProof(state CommittedState, address string) (BFTSolvencyLiabilityProof, error) {
	tree, err := buildSolvencyLiabilityTree(state)
	if err != nil {
		return BFTSolvencyLiabilityProof{}, err
	}
	index := sort.Search(len(tree.leaves), func(i int) bool { return tree.leaves[i].Address >= address })
	if index == len(tree.leaves) || tree.leaves[index].Address != address {
		return BFTSolvencyLiabilityProof{}, errors.New("solvency liability leaf not found")
	}
	original := index
	siblings := make([]SolvencyMerkleSibling, 0, len(tree.levels)-1)
	for level := 0; level < len(tree.levels)-1; level++ {
		values := tree.levels[level]
		siblingIndex := index ^ 1
		position := "right"
		if index%2 == 1 {
			position = "left"
		}
		if siblingIndex >= len(values) {
			siblingIndex = index
		}
		siblings = append(siblings, SolvencyMerkleSibling{Hash: hex.EncodeToString(values[siblingIndex][:]), Position: position})
		index /= 2
	}
	leafHash := solvencyLeafHash(tree.leaves[original])
	proof := BFTSolvencyLiabilityProof{SchemaVersion: 1, Source: "ynx-consensus-abci", AsOfBlockHeight: uint64(state.Height), StateHash: state.AppHash, LiabilityMerkleRoot: tree.rootHex(), LeafIndex: original, Leaf: tree.leaves[original], LeafHash: hex.EncodeToString(leafHash[:]), Siblings: siblings}
	proof.Verified = VerifySolvencyLiabilityProof(proof)
	return proof, nil
}

func VerifySolvencyLiabilityProof(proof BFTSolvencyLiabilityProof) bool {
	current := solvencyLeafHash(proof.Leaf)
	if proof.LeafHash != hex.EncodeToString(current[:]) {
		return false
	}
	for _, sibling := range proof.Siblings {
		raw, err := hex.DecodeString(sibling.Hash)
		if err != nil || len(raw) != sha256.Size {
			return false
		}
		var value [sha256.Size]byte
		copy(value[:], raw)
		switch sibling.Position {
		case "left":
			current = solvencyNodeHash(value, current)
		case "right":
			current = solvencyNodeHash(current, value)
		default:
			return false
		}
	}
	return proof.LiabilityMerkleRoot == hex.EncodeToString(current[:])
}

func buildSolvencyLiabilityTree(state CommittedState) (solvencyLiabilityTree, error) {
	byAddress := map[string]*SolvencyLiabilityLeaf{}
	leafFor := func(address string) *SolvencyLiabilityLeaf {
		if byAddress[address] == nil {
			byAddress[address] = &SolvencyLiabilityLeaf{Address: address}
		}
		return byAddress[address]
	}
	for _, account := range state.Accounts {
		leaf := leafFor(account.Address)
		leaf.LiquidYNXT = account.Balance
		leaf.StakedYNXT = account.Staked
	}
	for _, entry := range state.Unbondings {
		if entry.Status == "queued" {
			leaf := leafFor(entry.Delegator)
			value, err := checkedSolvencyAdd(leaf.PendingUnbondingYNXT, entry.AmountYNXT)
			if err != nil {
				return solvencyLiabilityTree{}, errors.New("pending unbonding liability overflows")
			}
			leaf.PendingUnbondingYNXT = value
		}
	}
	for _, vault := range state.StrategyVaults {
		if vault.BalanceYNXT > math.MaxInt64 {
			return solvencyLiabilityTree{}, errors.New("strategy vault liability exceeds execution range")
		}
		leaf := leafFor(vault.Owner)
		value, err := checkedSolvencyAdd(leaf.StrategyVaultYNXT, int64(vault.BalanceYNXT))
		if err != nil {
			return solvencyLiabilityTree{}, errors.New("strategy vault liability overflows")
		}
		leaf.StrategyVaultYNXT = value
	}
	for _, paymaster := range state.Paymasters {
		remaining := paymaster.Policy.GlobalBudget - paymaster.Policy.GlobalSpent
		if remaining > math.MaxInt64 {
			return solvencyLiabilityTree{}, errors.New("paymaster liability exceeds execution range")
		}
		leaf := leafFor(paymaster.Policy.Sponsor)
		value, err := checkedSolvencyAdd(leaf.PaymasterBudgetYNXT, int64(remaining))
		if err != nil {
			return solvencyLiabilityTree{}, errors.New("paymaster liability overflows")
		}
		leaf.PaymasterBudgetYNXT = value
	}
	addresses := make([]string, 0, len(byAddress))
	for address := range byAddress {
		addresses = append(addresses, address)
	}
	sort.Strings(addresses)
	tree := solvencyLiabilityTree{leaves: make([]SolvencyLiabilityLeaf, 0, len(addresses))}
	for _, address := range addresses {
		leaf := *byAddress[address]
		total, err := checkedSolvencyAdd(leaf.LiquidYNXT, leaf.StakedYNXT, leaf.PendingUnbondingYNXT, leaf.StrategyVaultYNXT, leaf.PaymasterBudgetYNXT)
		if err != nil || total < 0 {
			return solvencyLiabilityTree{}, errors.New("account liability is invalid or overflows")
		}
		leaf.TotalYNXT = total
		if total == 0 {
			continue
		}
		tree.leaves = append(tree.leaves, leaf)
		if err := addSolvencyTotals(&tree.totals, leaf); err != nil {
			return solvencyLiabilityTree{}, err
		}
	}
	tree.levels = buildSolvencyMerkleLevels(tree.leaves)
	return tree, nil
}

func addSolvencyTotals(total *SolvencyLiabilityTotals, leaf SolvencyLiabilityLeaf) error {
	values := []struct {
		target *int64
		value  int64
	}{{&total.LiquidYNXT, leaf.LiquidYNXT}, {&total.StakedYNXT, leaf.StakedYNXT}, {&total.PendingUnbondingYNXT, leaf.PendingUnbondingYNXT}, {&total.StrategyVaultYNXT, leaf.StrategyVaultYNXT}, {&total.PaymasterBudgetYNXT, leaf.PaymasterBudgetYNXT}, {&total.TotalYNXT, leaf.TotalYNXT}}
	for _, entry := range values {
		value, err := checkedSolvencyAdd(*entry.target, entry.value)
		if err != nil {
			return errors.New("solvency liability totals overflow")
		}
		*entry.target = value
	}
	return nil
}

func checkedSolvencyAdd(values ...int64) (int64, error) {
	var total int64
	for _, value := range values {
		if value < 0 || total > math.MaxInt64-value {
			return 0, errors.New("non-negative int64 sum overflows")
		}
		total += value
	}
	return total, nil
}

func buildSolvencyMerkleLevels(leaves []SolvencyLiabilityLeaf) [][][sha256.Size]byte {
	if len(leaves) == 0 {
		empty := sha256.Sum256([]byte("YNX_SOLVENCY_EMPTY_ROOT_V1"))
		return [][][sha256.Size]byte{{empty}}
	}
	first := make([][sha256.Size]byte, len(leaves))
	for index, leaf := range leaves {
		first[index] = solvencyLeafHash(leaf)
	}
	levels := [][][sha256.Size]byte{first}
	for len(levels[len(levels)-1]) > 1 {
		current := levels[len(levels)-1]
		next := make([][sha256.Size]byte, (len(current)+1)/2)
		for index := range next {
			left := current[index*2]
			right := left
			if index*2+1 < len(current) {
				right = current[index*2+1]
			}
			next[index] = solvencyNodeHash(left, right)
		}
		levels = append(levels, next)
	}
	return levels
}

func solvencyLeafHash(leaf SolvencyLiabilityLeaf) [sha256.Size]byte {
	payload, _ := json.Marshal(leaf)
	return sha256.Sum256(append([]byte("YNX_SOLVENCY_LIABILITY_LEAF_V1\x00"), payload...))
}

func solvencyNodeHash(left, right [sha256.Size]byte) [sha256.Size]byte {
	payload := make([]byte, 0, len("YNX_SOLVENCY_NODE_V1\x00")+sha256.Size*2)
	payload = append(payload, []byte("YNX_SOLVENCY_NODE_V1\x00")...)
	payload = append(payload, left[:]...)
	payload = append(payload, right[:]...)
	return sha256.Sum256(payload)
}

func (tree solvencyLiabilityTree) rootHex() string {
	root := tree.levels[len(tree.levels)-1][0]
	return hex.EncodeToString(root[:])
}
