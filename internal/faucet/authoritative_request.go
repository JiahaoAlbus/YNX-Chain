package faucet

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func newDurableRequestID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "faucet_" + hex.EncodeToString(value[:]), nil
}

func (s *Service) requestAuthoritative(ctx context.Context, req Request, remote string) (Response, int, error) {
	s.mu.Lock()
	s.requests++
	s.mu.Unlock()
	address, err := s.normalizeRecipient(req.Address)
	if err != nil || address == chain.FaucetAddress {
		s.recordDenied("invalid address")
		return Response{}, 400, errors.New("invalid faucet recipient")
	}
	id := req.RequestID
	if id == "" {
		id, err = newDurableRequestID()
		if err != nil {
			return Response{}, 503, errors.New("could not allocate faucet request ID")
		}
	}
	hash, err := chain.FaucetRequestHash(s.cfg.ChainID, id)
	if err != nil {
		s.recordDenied("invalid request ID")
		return Response{}, 400, err
	}
	result := Response{RequestID: id, Address: address, NativeSymbol: "YNXT", TransactionHash: hash, TruthfulStatus: s.truthfulStatus()}
	known, found, err := s.admissions.lookup(id)
	if err != nil {
		result.Status = "admission_unavailable"
		result.RetrySameRequest = true
		return result, 503, errors.New("durable faucet admission is unavailable")
	}
	amount := req.Amount
	if found {
		// Omitted amount keeps the original admitted amount across a default
		// or limit change. A retry never creates a new intent.
		if amount == 0 {
			amount = known.Amount
		}
		if known.Address != address || amount != known.Amount {
			result.Status = "request_id_conflict"
			return result, 409, chain.ErrFaucetRequestConflict
		}
		result.Amount = amount
		if known.Transaction != nil {
			if !validAuthoritativeReceipt(*known.Transaction, known, hash) {
				result.Status = "stored_receipt_invalid"
				return result, 503, errors.New("stored faucet receipt is invalid")
			}
			result.Transaction = *known.Transaction
			result.Replayed = true
			result.Status = "accepted"
			return result, 200, nil
		}
	} else {
		if amount == 0 {
			amount = s.cfg.DefaultAmount
		}
		if amount <= 0 || amount > s.cfg.MaxAmount {
			s.recordDenied("invalid amount")
			return Response{}, 400, errors.New("amount exceeds faucet limits")
		}
	}
	result.Amount = amount
	// Probe the explicit read-only capability before charging the local quota.
	// Writes use a NEW route: an old server that ignores unknown JSON fields
	// must never mint again after a deployment rollback.
	if err := s.requireFaucetCapability(ctx); err != nil {
		result.Status = "upstream_capability_unavailable"
		result.RetrySameRequest = true
		return result, 503, err
	}
	now := time.Now().UTC()
	record, replayed, err := s.admissions.admit(id, address, clientIP(remote), amount, now)
	entry := LogEntry{RequestID: id, At: now, IP: clientIP(remote), Address: address, Amount: amount}
	if err != nil {
		status := 503
		result.Status = "admission_unavailable"
		result.RetrySameRequest = true
		if errors.Is(err, chain.ErrFaucetRequestConflict) {
			status = 409
			result.Status = "request_id_conflict"
			result.RetrySameRequest = false
		}
		if errors.Is(err, errAdmissionRate) {
			status = 429
			result.Status = "rate_limited"
			entry.Status = "rate_limited"
			entry.Error = err.Error()
			_ = s.appendLog(entry)
			s.recordDenied(entry.Error)
		}
		return result, status, err
	}
	if record.Transaction != nil {
		if !validAuthoritativeReceipt(*record.Transaction, record, hash) {
			result.Status = "stored_receipt_invalid"
			return result, 503, errors.New("stored faucet receipt is invalid")
		}
		result.Transaction = *record.Transaction
		result.Replayed = true
		result.Status = "accepted"
		return result, 200, nil
	}
	transaction, status, err := s.sendDurableFaucetRequest(ctx, record, hash)
	if err != nil {
		result.Status = "transaction_result_uncertain"
		result.RetrySameRequest = true
		if status == 409 {
			result.Status = "request_id_conflict"
			result.RetrySameRequest = false
		}
		entry.Status = "error"
		entry.Error = err.Error()
		entry.TxHash = hash
		_ = s.appendLog(entry)
		s.mu.Lock()
		s.lastError = err.Error()
		s.mu.Unlock()
		return result, status, err
	}
	if err := s.admissions.complete(record, transaction); err != nil {
		result.Status = "receipt_persistence_uncertain"
		result.RetrySameRequest = true
		return result, 503, errors.New("faucet receipt needs confirmation; retain the same request ID")
	}
	entry.Status = "sent"
	entry.TxHash = hash
	_ = s.appendLog(entry)
	s.mu.Lock()
	s.successes++
	s.lastHash = hash
	s.lastError = ""
	s.mu.Unlock()
	result.Transaction = transaction
	result.Status = "accepted"
	result.Replayed = replayed
	if replayed {
		return result, 200, nil
	}
	return result, http.StatusCreated, nil
}

func validAuthoritativeReceipt(tx chain.Transaction, record admissionRecord, hash string) bool {
	return tx.Hash == hash && tx.Type == "faucet" && tx.From == chain.FaucetAddress && tx.To == record.Address && tx.Amount == record.Amount && tx.Fee == 0
}

func (s *Service) requireFaucetCapability(ctx context.Context) error {
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"ynx_getFaucetModel","params":[]}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.cfg.RPCURL, "/")+"/evm", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return errors.New("faucet capability check is unavailable")
	}
	defer resp.Body.Close()
	var result struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Result  struct {
			Authority struct {
				Version    string `json:"version"`
				Header     string `json:"header"`
				Required   bool   `json:"required"`
				Configured bool   `json:"configured"`
			} `json:"authority"`
			Version    string          `json:"version"`
			ChainID    string          `json:"chainId"`
			Pattern    string          `json:"requestIdPattern"`
			HashScheme string          `json:"transactionHashScheme"`
			Scope      string          `json:"idempotencyScope"`
			LegacySafe bool            `json:"legacyRequestSafeRetry"`
			Consensus  bool            `json:"consensusFinality"`
			Durability json.RawMessage `json:"durability"`
		} `json:"result"`
		Error json.RawMessage `json:"error,omitempty"`
	}
	if resp.StatusCode != 200 || decodeBoundedJSON(resp.Body, &result) != nil || result.JSONRPC != "2.0" || result.ID != 1 || len(result.Error) != 0 || result.Result.Version != chain.FaucetRequestVersion || result.Result.ChainID != "0x"+strconv.FormatInt(s.cfg.ChainID, 16) || result.Result.Pattern != "^[A-Za-z0-9_-]{32,128}$" || result.Result.HashScheme != "sha256-nul-domain-decimal-chain-id-request-id" || result.Result.Scope != "retained-chain-transaction-history" {
		return errors.New("upstream does not expose the required chain-bound durable faucet model")
	}
	if a := result.Result.Authority; a.Required || s.coreAuthToken != "" {
		if a.Version != "ynx-faucet-core-token-v1" || a.Header != "X-YNX-Faucet-Auth" || !a.Required || !a.Configured || s.coreAuthToken == "" {
			return errors.New("Core Faucet authority is not configured")
		}
	}
	return nil
}

func (s *Service) sendDurableFaucetRequest(ctx context.Context, record admissionRecord, hash string) (chain.Transaction, int, error) {
	body, _ := json.Marshal(Request{RequestID: record.RequestID, Address: record.Address, Amount: record.Amount})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.cfg.RPCURL, "/")+"/faucet/requests", bytes.NewReader(body))
	if err != nil {
		return chain.Transaction{}, 503, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.coreAuthToken != "" {
		req.Header.Set("X-YNX-Faucet-Auth", s.coreAuthToken)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return chain.Transaction{}, 503, errors.New("faucet result needs confirmation; retain the same request ID")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 409 {
		return chain.Transaction{}, 409, chain.ErrFaucetRequestConflict
	}
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return chain.Transaction{}, 503, fmt.Errorf("durable faucet returned %d; retain the same request ID", resp.StatusCode)
	}
	var tx chain.Transaction
	if resp.Header.Get("X-YNX-Faucet-Idempotency") != chain.FaucetRequestVersion || decodeBoundedJSON(resp.Body, &tx) != nil || !validAuthoritativeReceipt(tx, record, hash) {
		return chain.Transaction{}, 503, errors.New("upstream did not return the exact durable faucet receipt")
	}
	return tx, resp.StatusCode, nil
}
