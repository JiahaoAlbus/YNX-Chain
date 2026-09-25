package faucet

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// RequestStatus only reads an existing admitted intent and its deterministic
// chain transaction. It cannot create an admission, charge quota, or mint.
func (s *Service) RequestStatus(ctx context.Context, id string) (Response, int, error) {
	if s.admissions == nil {
		return Response{}, 503, errors.New("durable status unavailable")
	}
	hash, err := chain.FaucetRequestHash(s.cfg.ChainID, id)
	if err != nil {
		return Response{}, 400, err
	}
	record, found, err := s.admissions.lookup(id)
	if err != nil {
		s.recordAdmissionStoreError("lookup")
		return Response{}, 503, errors.New("admission unavailable")
	}
	if !found {
		return Response{RequestID: id, Status: "not_admitted"}, 404, nil
	}
	result := Response{RequestID: id, Address: record.Address, Amount: record.Amount, NativeSymbol: "YNXT", TransactionHash: hash, Status: "pending", RetrySameRequest: true, TruthfulStatus: s.truthfulStatus()}
	if record.Transaction == nil {
		recovered := s.recoverReceipt(ctx, record, hash)
		if recovered.err != nil {
			return result, 503, recovered.err
		}
		if recovered.pending {
			s.flightMu.Lock()
			active := s.fundingFlights[id] != nil
			s.flightMu.Unlock()
			if record.Async && (record.AsyncStopped || record.AsyncAttempts >= maxAsyncFundingAttempts) && !active {
				result.Status = "retry_exhausted"
				return result, 503, errors.New("faucet retry budget exhausted; retain the same request ID")
			}
			return result, 202, nil
		}
		record.Transaction = &recovered.tx
	}
	if !validAuthoritativeReceipt(*record.Transaction, record, hash) {
		return result, 503, errors.New("stored receipt does not match admitted intent")
	}
	result.Transaction = *record.Transaction
	result.Replayed = true
	result.Status = "accepted"
	result.RetrySameRequest = false
	return result, 200, nil
}

func (s *Service) recoverReceipt(ctx context.Context, record admissionRecord, hash string) statusResult {
	s.flightMu.Lock()
	if active := s.fundingFlights[record.RequestID]; active != nil {
		s.flightMu.Unlock()
		return statusResult{pending: true}
	}
	f := s.statusFlights[record.RequestID]
	if f == nil {
		f = &statusFlight{done: make(chan struct{})}
		s.statusFlights[record.RequestID] = f
		s.flightStats.statusStarted++
		s.flightStats.statusActive++
		go func() {
			opCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			f.result = s.fetchAndPersistReceipt(opCtx, record, hash)
			s.flightMu.Lock()
			delete(s.statusFlights, record.RequestID)
			s.flightStats.statusActive--
			close(f.done)
			s.flightMu.Unlock()
		}()
	} else {
		s.flightStats.statusJoined++
	}
	s.flightMu.Unlock()
	select {
	case <-ctx.Done():
		return statusResult{err: errors.New("receipt lookup continues; check status with the same request ID")}
	case <-f.done:
		return f.result
	}
}

func (s *Service) fetchAndPersistReceipt(ctx context.Context, record admissionRecord, hash string) statusResult {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.cfg.RPCURL, "/")+"/v1/native-transactions/"+hash, nil)
	if err != nil {
		return statusResult{err: err}
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return statusResult{err: errors.New("receipt lookup unavailable; retain original request")}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return statusResult{pending: true}
	}
	if resp.StatusCode != 200 {
		return statusResult{err: errors.New("receipt lookup unavailable")}
	}
	var envelope struct {
		Source            string                     `json:"source"`
		ConsensusFinality bool                       `json:"consensusFinality"`
		SchemaVersion     string                     `json:"schemaVersion"`
		Status            string                     `json:"status"`
		IntegerEncoding   string                     `json:"integerEncoding"`
		Transaction       map[string]json.RawMessage `json:"transaction"`
		Durability        struct {
			Version           string `json:"version"`
			Scope             string `json:"scope"`
			CheckpointHeight  string `json:"checkpointHeight"`
			CheckpointHash    string `json:"checkpointHash"`
			SnapshotIntegrity string `json:"snapshotIntegrity"`
		} `json:"durability"`
	}
	if decodeBoundedJSON(resp.Body, &envelope) != nil || envelope.SchemaVersion != "ynx-native-finance-transaction-v1" || envelope.IntegerEncoding != "decimal-string" || envelope.Durability.Version != "ynx-local-durability-v1" || envelope.Durability.Scope != "local-snapshot" {
		return statusResult{err: errors.New("invalid durable receipt model")}
	}
	if envelope.Status != "durable" && envelope.Status != "pending_durable" {
		return statusResult{pending: true}
	}
	if len(envelope.Durability.SnapshotIntegrity) != 64 {
		return statusResult{err: errors.New("durable checkpoint missing")}
	}
	var tx chain.Transaction
	fields := envelope.Transaction
	for _, key := range []string{"amount", "fee", "nonce", "blockNumber"} {
		if raw, ok := fields[key]; ok {
			var text string
			if json.Unmarshal(raw, &text) != nil {
				return statusResult{err: errors.New("invalid receipt integer")}
			}
			if _, err := strconv.ParseUint(text, 10, 64); err != nil {
				return statusResult{err: errors.New("invalid receipt integer")}
			}
			fields[key] = json.RawMessage(text)
		}
	}
	delete(fields, "logs")
	delete(fields, "lotFlows")
	raw, _ := json.Marshal(fields)
	if json.Unmarshal(raw, &tx) != nil || !validAuthoritativeReceipt(tx, record, hash) {
		return statusResult{err: errors.New("receipt does not match admitted intent")}
	}
	if err := s.admissions.complete(record, tx); err != nil {
		s.recordAdmissionStoreError("complete")
		return statusResult{err: errors.New("receipt persistence unavailable")}
	}
	return statusResult{tx: tx}
}
func (s *Server) handleRequestStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	result, status, err := s.service.RequestStatus(r.Context(), r.URL.Query().Get("requestId"))
	if err != nil {
		writeJSON(w, status, map[string]any{"error": err.Error(), "requestId": result.RequestID, "transactionHash": result.TransactionHash, "status": result.Status, "retrySameRequest": result.RetrySameRequest})
		return
	}
	writeJSON(w, status, result)
}
