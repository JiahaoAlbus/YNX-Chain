package finance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type BrokerActivationReadiness struct {
	StateBackend              string `json:"stateBackend"`
	MappingActive             bool   `json:"mappingActive"`
	WalletKeyLinked           bool   `json:"walletKeyLinked"`
	ApprovedAwaitingExecution int    `json:"approvedAwaitingExecution"`
	ExecutionRequested        int    `json:"executionRequested"`
	Ambiguous                 int    `json:"ambiguous"`
	ReconcileOnly             int    `json:"reconcileOnly"`
	Terminal                  int    `json:"terminal"`
	TotalOrders               int    `json:"totalOrders"`
	ReadyForExecutionRequest  bool   `json:"readyForExecutionRequest"`
	ReadyForWorkerDispatch    bool   `json:"readyForWorkerDispatch"`
	InspectedAt               string `json:"inspectedAt"`
}

// InspectBrokerActivationReadiness reads the existing authoritative state
// without creating a file, running a database migration, importing bootstrap
// state, or writing an audit event. It intentionally returns counts rather
// than order or account identifiers so the operator report is safe to retain.
func InspectBrokerActivationReadiness(ctx context.Context, statePath, databaseURL, account string, now time.Time) (BrokerActivationReadiness, error) {
	if _, err := DeriveFinanceSubjectID(account); err != nil {
		return BrokerActivationReadiness{}, errors.New("Finance activation owner is invalid")
	}
	state, backend, err := loadFinanceStateReadOnly(ctx, statePath, databaseURL)
	if err != nil {
		return BrokerActivationReadiness{}, err
	}
	accountState, ok := state.Accounts[account]
	if !ok {
		return BrokerActivationReadiness{StateBackend: backend, InspectedAt: now.UTC().Format(time.RFC3339Nano)}, nil
	}
	normalizeBrokerageState(&accountState.Brokerage)
	mapping := accountState.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
	mappingActive := mapping.Status == "active" && mapping.Account == account && mapping.Provider == FinanceOrderProvider && mapping.TradingEnvironment == FinanceOrderTradingEnv && financeProviderUUIDPattern.MatchString(mapping.BrokerAccountID)
	walletKeyLinked := mappingActive && financePublicKeyPattern.MatchString(mapping.WalletPublicKey)
	result := BrokerActivationReadiness{StateBackend: backend, MappingActive: mappingActive, WalletKeyLinked: walletKeyLinked, TotalOrders: len(accountState.Brokerage.Orders), InspectedAt: now.UTC().Format(time.RFC3339Nano)}
	for orderID, order := range accountState.Brokerage.Orders {
		outbox, hasOutbox := accountState.Brokerage.Outbox[orderID]
		switch {
		case !hasOutbox:
			result.Terminal++
		case outbox.Status == "pending_unwired" && outbox.ExecutionRequestKey == "" && outbox.ProviderOrderID == "" && order.ProviderOrderID == "" && order.ApprovalState == "consumed" && order.State == "submitting":
			result.ApprovedAwaitingExecution++
		case outbox.Status == "execution_requested" && outbox.ExecutionRequestKey != "" && outbox.ProviderOrderID == "" && order.ProviderOrderID == "" && order.ApprovalState == "consumed" && order.State == "submitting":
			result.ExecutionRequested++
		case outbox.Status == "dispatching" || outbox.Status == "submitted_unknown" || order.State == "submitted_unknown":
			result.Ambiguous++
		case outbox.ProviderOrderID != "" || order.ProviderOrderID != "" || outbox.Status == "submitted" || order.State == "submitted" || order.State == "partially_filled" || order.State == "cancel_requested":
			result.ReconcileOnly++
		default:
			result.Terminal++
		}
	}
	result.ReadyForExecutionRequest = mappingActive && walletKeyLinked && result.ApprovedAwaitingExecution > 0
	result.ReadyForWorkerDispatch = mappingActive && walletKeyLinked && result.ExecutionRequested == 1 && result.Ambiguous == 0
	return result, nil
}

func loadFinanceStateReadOnly(ctx context.Context, statePath, databaseURL string) (persistedState, string, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		absolute, err := filepath.Abs(strings.TrimSpace(statePath))
		if err != nil || absolute != statePath {
			return persistedState{}, "", errors.New("Finance read-only state path must be absolute")
		}
		fd, err := syscall.Open(absolute, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return persistedState{}, "", errors.New("Finance read-only state must be an existing regular file")
		}
		file := os.NewFile(uintptr(fd), absolute)
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			return persistedState{}, "", errors.New("Finance read-only state must be an existing regular file")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Nlink != 1 {
			return persistedState{}, "", errors.New("Finance read-only state must have one filesystem link")
		}
		raw, err := io.ReadAll(file)
		if err != nil {
			return persistedState{}, "", fmt.Errorf("read Finance activation state: %w", err)
		}
		currentInfo, err := os.Lstat(absolute)
		if err != nil {
			return persistedState{}, "", errors.New("Finance read-only state path changed during inspection")
		}
		currentStat, currentOK := currentInfo.Sys().(*syscall.Stat_t)
		if currentInfo.Mode()&os.ModeSymlink != 0 || !currentInfo.Mode().IsRegular() || !currentOK || currentStat.Dev != stat.Dev || currentStat.Ino != stat.Ino || currentStat.Nlink != 1 {
			return persistedState{}, "", errors.New("Finance read-only state path changed during inspection")
		}
		state, _, err := decodeFinanceState(raw)
		return state, "file-cas-single-host", err
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return persistedState{}, "", fmt.Errorf("open Finance read-only database: %w", err)
	}
	defer db.Close()
	var raw []byte
	var storedHash string
	if err := db.QueryRowContext(ctx, `SELECT state_json, state_hash FROM ynx_finance_state WHERE singleton = TRUE`).Scan(&raw, &storedHash); err != nil {
		return persistedState{}, "", fmt.Errorf("read existing Finance database state without migration: %w", err)
	}
	state, hash, err := decodeFinanceState(raw)
	if err != nil || hash != storedHash {
		return persistedState{}, "", errors.New("Finance read-only database state integrity verification failed")
	}
	return state, "postgres-cas-multi-instance", nil
}
