package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const CommittedStateVersion = 2

// CommittedState is the durable ABCI application state. Height is persisted
// for restart recovery but excluded from AppHash because empty blocks do not
// change application state.
type CommittedState struct {
	Version            int                      `json:"version"`
	ChainID            int64                    `json:"chainId"`
	MigrationStateHash string                   `json:"migrationStateHash"`
	Initialized        bool                     `json:"initialized"`
	Height             int64                    `json:"height"`
	Accounts           []chain.ConsensusAccount `json:"accounts"`
	AIPermissions      []BFTAIPermission        `json:"aiPermissions"`
	AIActions          []BFTAIAction            `json:"aiActions"`
	AIAuditEvents      []BFTAIAuditEvent        `json:"aiAuditEvents"`
	AppHash            string                   `json:"appHash"`
}

type committedStateHashDocument struct {
	Domain             string                   `json:"domain"`
	Version            int                      `json:"version"`
	ChainID            int64                    `json:"chainId"`
	MigrationStateHash string                   `json:"migrationStateHash"`
	Accounts           []chain.ConsensusAccount `json:"accounts"`
	AIPermissions      []BFTAIPermission        `json:"aiPermissions"`
	AIActions          []BFTAIAction            `json:"aiActions"`
	AIAuditEvents      []BFTAIAuditEvent        `json:"aiAuditEvents"`
}

func initialCommittedState(migration chain.ConsensusMigrationState) CommittedState {
	return CommittedState{
		Version:            CommittedStateVersion,
		ChainID:            migration.Network.ChainID,
		MigrationStateHash: migration.StateHash,
		Initialized:        false,
		Height:             int64(migration.Height),
		Accounts:           cloneAccounts(migration.Accounts),
		AIPermissions:      []BFTAIPermission{},
		AIActions:          []BFTAIAction{},
		AIAuditEvents:      []BFTAIAuditEvent{},
		AppHash:            migration.StateHash,
	}
}

func sealCommittedState(migration chain.ConsensusMigrationState, height int64, accounts []chain.ConsensusAccount, permissions []BFTAIPermission, actions []BFTAIAction, auditEvents []BFTAIAuditEvent) (CommittedState, error) {
	state := CommittedState{
		Version:            CommittedStateVersion,
		ChainID:            migration.Network.ChainID,
		MigrationStateHash: migration.StateHash,
		Initialized:        true,
		Height:             height,
		Accounts:           cloneAccounts(accounts),
		AIPermissions:      cloneAIPermissions(permissions),
		AIActions:          cloneAIActions(actions),
		AIAuditEvents:      append([]BFTAIAuditEvent(nil), auditEvents...),
	}
	if accountsEqual(state.Accounts, migration.Accounts) && len(state.AIPermissions) == 0 && len(state.AIActions) == 0 && len(state.AIAuditEvents) == 0 {
		state.AppHash = migration.StateHash
	} else {
		hash, err := state.calculateHash()
		if err != nil {
			return CommittedState{}, err
		}
		state.AppHash = hash
	}
	if err := state.Validate(migration); err != nil {
		return CommittedState{}, err
	}
	return state, nil
}

func (s CommittedState) Validate(migration chain.ConsensusMigrationState) error {
	if err := migration.Validate(); err != nil {
		return fmt.Errorf("invalid migration anchor: %w", err)
	}
	if s.Version != CommittedStateVersion {
		return fmt.Errorf("unsupported committed state version %d", s.Version)
	}
	if s.ChainID != migration.Network.ChainID || s.MigrationStateHash != migration.StateHash {
		return errors.New("committed state does not match its YNX migration anchor")
	}
	if s.Height < int64(migration.Height) {
		return fmt.Errorf("committed height %d precedes migrated height %d", s.Height, migration.Height)
	}
	if !s.Initialized && (s.Height != int64(migration.Height) || !accountsEqual(s.Accounts, migration.Accounts) || len(s.AIPermissions) != 0 || len(s.AIActions) != 0 || len(s.AIAuditEvents) != 0 || !strings.EqualFold(s.AppHash, migration.StateHash)) {
		return errors.New("uninitialized committed state must exactly match the migration anchor")
	}
	if len(s.Accounts) == 0 {
		return errors.New("committed state requires accounts")
	}
	var liquid, staked int64
	previous := ""
	for _, account := range s.Accounts {
		if strings.TrimSpace(account.Address) == "" || (previous != "" && account.Address <= previous) {
			return errors.New("committed accounts must have unique sorted addresses")
		}
		if account.Balance < 0 || account.Staked < 0 {
			return fmt.Errorf("committed account %s has negative YNXT", account.Address)
		}
		if account.ResourceUsage.BandwidthUsed < 0 || account.ResourceUsage.ComputeUsed < 0 || account.ResourceUsage.AICreditsUsed < 0 || account.ResourceUsage.TrustUsed < 0 {
			return fmt.Errorf("committed account %s has negative resource usage", account.Address)
		}
		if account.Balance > math.MaxInt64-liquid || account.Staked > math.MaxInt64-staked {
			return errors.New("committed YNXT totals overflow int64")
		}
		for lotID, amount := range account.Lots {
			if strings.TrimSpace(lotID) == "" || amount < 0 {
				return fmt.Errorf("committed account %s has invalid lot state", account.Address)
			}
		}
		liquid += account.Balance
		staked += account.Staked
		previous = account.Address
	}
	previous = ""
	for _, permission := range s.AIPermissions {
		if permission.ID == "" || (previous != "" && permission.ID <= previous) || !IsNativeAddress(permission.Signer) || permission.SessionID == "" || permission.Requester == "" || permission.Scope == "" || permission.Purpose == "" || permission.Status != "active" || permission.CreatedAt.IsZero() || !permission.ExpiresAt.After(permission.CreatedAt) || permission.BlockHeight <= 0 || permission.TxHash == "" || permission.AuditHash == "" {
			return errors.New("committed AI permissions must be complete and sorted by unique ID")
		}
		previous = permission.ID
	}
	previous = ""
	for _, action := range s.AIActions {
		if action.ID == "" || (previous != "" && action.ID <= previous) || !IsNativeAddress(action.Signer) || action.SessionID == "" || action.Requester == "" || action.Scope == "" || action.ActionType == "" || action.Description == "" || action.Status == "" || action.CreatedAt.IsZero() || !action.ExpiresAt.After(action.CreatedAt) || action.BlockHeight <= 0 || action.TxHash == "" || action.AuditHash == "" {
			return errors.New("committed AI actions must be complete and sorted by unique ID")
		}
		previous = action.ID
	}
	seenAudit := make(map[string]struct{}, len(s.AIAuditEvents))
	for _, event := range s.AIAuditEvents {
		if event.ID == "" || event.RecordID == "" || event.Type == "" || !IsNativeAddress(event.Signer) || event.BlockHeight <= 0 || event.CreatedAt.IsZero() || event.TxHash == "" || event.AuditHash == "" {
			return errors.New("committed AI audit event is incomplete")
		}
		if _, exists := seenAudit[event.ID]; exists {
			return errors.New("committed AI audit event IDs must be unique")
		}
		seenAudit[event.ID] = struct{}{}
	}
	if liquid != migration.LiquidSupplyYNXT || staked != migration.StakedSupplyYNXT {
		return errors.New("committed state changed total liquid or staked YNXT supply")
	}
	expected := migration.StateHash
	if !accountsEqual(s.Accounts, migration.Accounts) || len(s.AIPermissions) != 0 || len(s.AIActions) != 0 || len(s.AIAuditEvents) != 0 {
		var err error
		expected, err = s.calculateHash()
		if err != nil {
			return err
		}
	}
	if !strings.EqualFold(s.AppHash, expected) {
		return fmt.Errorf("committed app hash mismatch: expected %s", expected)
	}
	return nil
}

func (s CommittedState) calculateHash() (string, error) {
	doc := committedStateHashDocument{
		Domain:             "YNX_ABCI_STATE_V2",
		Version:            s.Version,
		ChainID:            s.ChainID,
		MigrationStateHash: s.MigrationStateHash,
		Accounts:           s.Accounts,
		AIPermissions:      s.AIPermissions,
		AIActions:          s.AIActions,
		AIAuditEvents:      s.AIAuditEvents,
	}
	payload, err := json.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("encode committed state hash document: %w", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func loadCommittedState(path string, migration chain.ConsensusMigrationState) (CommittedState, error) {
	if strings.TrimSpace(path) == "" {
		return initialCommittedState(migration), nil
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return initialCommittedState(migration), nil
	}
	if err != nil {
		return CommittedState{}, fmt.Errorf("stat committed state: %w", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return CommittedState{}, fmt.Errorf("committed state permissions must not allow group or other access: %o", info.Mode().Perm())
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return CommittedState{}, fmt.Errorf("read committed state: %w", err)
	}
	var state CommittedState
	if err := json.Unmarshal(payload, &state); err != nil {
		return CommittedState{}, fmt.Errorf("decode committed state: %w", err)
	}
	if err := state.Validate(migration); err != nil {
		return CommittedState{}, fmt.Errorf("validate committed state: %w", err)
	}
	return state, nil
}

func saveCommittedState(path string, state CommittedState, migration chain.ConsensusMigrationState) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := state.Validate(migration); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode committed state: %w", err)
	}
	payload = append(payload, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create committed state directory: %w", err)
	}
	temp, err := os.CreateTemp(dir, ".ynx-abci-state-*")
	if err != nil {
		return fmt.Errorf("create committed state temp file: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("secure committed state temp file: %w", err)
	}
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return fmt.Errorf("write committed state temp file: %w", err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("sync committed state temp file: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close committed state temp file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace committed state: %w", err)
	}
	directory, err := os.Open(dir)
	if err == nil {
		err = directory.Sync()
		_ = directory.Close()
	}
	if err != nil {
		return fmt.Errorf("sync committed state directory: %w", err)
	}
	return nil
}

func cloneAccounts(accounts []chain.ConsensusAccount) []chain.ConsensusAccount {
	out := make([]chain.ConsensusAccount, len(accounts))
	for i, account := range accounts {
		out[i] = account
		out[i].Lots = make(map[string]int64, len(account.Lots))
		for lotID, amount := range account.Lots {
			out[i].Lots[lotID] = amount
		}
	}
	return out
}

func cloneAIPermissions(permissions []BFTAIPermission) []BFTAIPermission {
	return append([]BFTAIPermission(nil), permissions...)
}

func cloneAIActions(actions []BFTAIAction) []BFTAIAction {
	out := make([]BFTAIAction, len(actions))
	for i, action := range actions {
		out[i] = action
		out[i].Reasons = append([]string(nil), action.Reasons...)
		if action.ApprovedAt != nil {
			approvedAt := *action.ApprovedAt
			out[i].ApprovedAt = &approvedAt
		}
		if action.RejectedAt != nil {
			rejectedAt := *action.RejectedAt
			out[i].RejectedAt = &rejectedAt
		}
	}
	return out
}

func accountsEqual(left, right []chain.ConsensusAccount) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}

func accountIndex(accounts []chain.ConsensusAccount, address string) (int, bool) {
	index := sort.Search(len(accounts), func(i int) bool { return accounts[i].Address >= address })
	return index, index < len(accounts) && accounts[index].Address == address
}

func ensureAccount(accounts []chain.ConsensusAccount, address string) ([]chain.ConsensusAccount, int) {
	index, ok := accountIndex(accounts, address)
	if ok {
		return accounts, index
	}
	accounts = append(accounts, chain.ConsensusAccount{})
	copy(accounts[index+1:], accounts[index:])
	accounts[index] = chain.ConsensusAccount{Address: address, Lots: map[string]int64{}}
	return accounts, index
}
