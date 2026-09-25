package faucet

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	bolt "go.etcd.io/bbolt"
)

// OperatorRecoveryResult is deliberately free of credentials and cannot grant
// funds by itself. "receipt_absent" is not evidence that a prior POST failed.
type OperatorRecoveryResult struct {
	RequestID       string `json:"requestId"`
	TransactionHash string `json:"transactionHash"`
	Address         string `json:"address,omitempty"`
	Amount          int64  `json:"amount,omitempty"`
	Status          string `json:"status"`
	AsyncAttempts   int    `json:"asyncAttempts,omitempty"`
	RecoveryOutcome string `json:"recoveryOutcome,omitempty"`
	Executed        bool   `json:"executed,omitempty"`
}

// InspectOrRecoverRequest is an offline, exact-ID operator operation. It never
// creates an admission or touches quota. The daemon must release the Bolt file
// lock first. Only execute=true can perform one Core POST on an exhausted async
// admission, and it durably reserves that single attempt before network I/O.
func InspectOrRecoverRequest(ctx context.Context, cfg Config, id, address string, amount int64, execute bool) (OperatorRecoveryResult, error) {
	return inspectOrRecoverRequest(ctx, cfg, id, address, amount, execute, func(store *admissionStore, record admissionRecord, tx chain.Transaction) error {
		return store.complete(record, tx)
	})
}

func inspectOrRecoverRequest(ctx context.Context, cfg Config, id, address string, amount int64, execute bool, persistReceipt func(*admissionStore, admissionRecord, chain.Transaction) error) (OperatorRecoveryResult, error) {
	result := OperatorRecoveryResult{RequestID: id}
	if cfg.ChainID != 6423 {
		return result, errors.New("operator recovery requires explicit testnet chain ID 6423")
	}
	if strings.TrimSpace(cfg.RPCURL) == "" || strings.TrimSpace(cfg.AdmissionPath) == "" {
		return result, errors.New("RPC URL and existing admission database path are required")
	}
	hash, err := chain.FaucetRequestHash(cfg.ChainID, id)
	if err != nil {
		return result, err
	}
	result.TransactionHash = hash
	info, err := os.Lstat(cfg.AdmissionPath)
	if err != nil {
		return result, err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 || info.Mode().Perm()&0077 != 0 {
		return result, errors.New("admission database must be a nonempty private regular file")
	}
	db, err := bolt.Open(cfg.AdmissionPath, 0600, &bolt.Options{Timeout: time.Second, ReadOnly: !execute})
	if err != nil {
		return result, fmt.Errorf("admission database must be offline and exclusively available: %w", err)
	}
	defer db.Close()
	store := &admissionStore{db: db, cfg: cfg}
	if err := store.health(); err != nil {
		return result, err
	}
	record, found, err := store.lookup(id)
	if err != nil {
		return result, err
	}
	if !found {
		result.Status = "not_admitted"
		return result, nil
	}
	result.Address, result.Amount, result.AsyncAttempts = record.Address, record.Amount, record.AsyncAttempts
	if record.OperatorRecovery != nil {
		result.RecoveryOutcome = record.OperatorRecovery.Outcome
	}
	if address != record.Address || amount != record.Amount {
		result.Status = "binding_mismatch"
		return result, errors.New("operator-provided address and amount must equal the durable admission")
	}
	s := &Service{cfg: cfg, admissions: store, httpClient: newUpstreamHTTPClient(10*time.Second, 10*time.Second)}
	if record.Transaction != nil {
		if !validAuthoritativeReceipt(*record.Transaction, record, hash) {
			result.Status = "invalid_stored_receipt"
			return result, errors.New("stored receipt does not match admitted intent")
		}
		result.Status = "completed"
		return result, nil
	}
	receipt := s.fetchReceipt(ctx, record, hash)
	if receipt.err != nil {
		result.Status = "receipt_unknown"
		return result, receipt.err
	}
	if !receipt.pending {
		if execute {
			if err := persistReceipt(store, record, receipt.tx); err != nil {
				result.Status = "receipt_persistence_failed"
				return result, err
			}
			if record.OperatorRecovery != nil {
				if err := store.noteOperatorRecovery(id, "confirmed_on_reconcile"); err != nil {
					return result, err
				}
				result.RecoveryOutcome = "confirmed_on_reconcile"
			}
		}
		result.Status = "durable_receipt_found"
		return result, nil
	}
	if !receipt.notFound {
		result.Status = "receipt_not_durable"
		return result, nil
	}
	if record.OperatorRecovery != nil {
		result.Status = "recovery_result_unknown"
		return result, nil
	}
	if !record.Async || (!record.AsyncStopped && record.AsyncAttempts < maxAsyncFundingAttempts) {
		result.Status = "not_exhausted"
		return result, nil
	}
	result.Status = "eligible_receipt_absent"
	if !execute {
		return result, nil
	}
	// A 404 alone cannot authorize funding. Core must currently advertise the
	// exact chain-bound, retained-history idempotency model and private token.
	token, err := loadCoreAuthToken(cfg.CoreAuthTokenPath)
	if err != nil || token == "" {
		result.Status = "authority_unavailable"
		return result, errors.New("Core authority token is required for operator recovery")
	}
	s.coreAuthToken = token
	if err := s.probeFaucetCapability(ctx, s.httpClient); err != nil {
		result.Status = "capability_unavailable"
		return result, err
	}
	reserved, err := store.reserveOperatorRecovery(record)
	if err != nil {
		return result, err
	}
	if !reserved {
		result.Status = "recovery_result_unknown"
		return result, nil
	}
	result.Executed = true
	result.RecoveryOutcome = "reserved_result_unknown"
	// This is the existing Core exact-ID path, not a new public/privileged API.
	tx, _, sendErr := s.sendDurableFaucetRequest(ctx, record, hash)
	if sendErr == nil {
		if err := persistReceipt(store, record, tx); err != nil {
			result.Status = "receipt_persistence_failed"
			return result, err
		}
		if err := store.noteOperatorRecovery(id, "confirmed"); err != nil {
			return result, err
		}
		result.Status, result.RecoveryOutcome = "completed", "confirmed"
		return result, nil
	}
	// Even an HTTP failure might hide a committed Core mutation. Reconcile
	// once, but never authorize a second send from this admission.
	reconcileCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	recovered := s.fetchReceipt(reconcileCtx, record, hash)
	if recovered.err == nil && !recovered.pending {
		if err := persistReceipt(store, record, recovered.tx); err != nil {
			result.Status = "receipt_persistence_failed"
			return result, err
		}
		if err := store.noteOperatorRecovery(id, "confirmed_after_uncertain_ack"); err != nil {
			return result, err
		}
		result.Status, result.RecoveryOutcome = "completed", "confirmed_after_uncertain_ack"
		return result, nil
	}
	_ = store.noteOperatorRecovery(id, "result_unknown_no_resend")
	result.Status, result.RecoveryOutcome = "recovery_result_unknown", "result_unknown_no_resend"
	return result, fmt.Errorf("Core result requires later exact receipt reconciliation; no resend permitted: %w", sendErr)
}
