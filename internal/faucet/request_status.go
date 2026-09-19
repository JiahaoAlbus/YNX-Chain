package faucet

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

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
		return Response{}, 503, errors.New("admission unavailable")
	}
	if !found {
		return Response{RequestID: id, Status: "not_admitted"}, 404, nil
	}
	result := Response{RequestID: id, Address: record.Address, Amount: record.Amount, NativeSymbol: "YNXT", TransactionHash: hash, Status: "pending", RetrySameRequest: true, TruthfulStatus: s.truthfulStatus()}
	if record.Transaction == nil {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.cfg.RPCURL, "/")+"/v1/native-transactions/"+hash, nil)
		if err != nil {
			return result, 503, err
		}
		resp, err := s.httpClient.Do(req)
		if err != nil {
			return result, 503, errors.New("receipt lookup unavailable; retain original request")
		}
		defer resp.Body.Close()
		if resp.StatusCode == 404 {
			return result, 202, nil
		}
		if resp.StatusCode != 200 {
			return result, 503, errors.New("receipt lookup unavailable")
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
			return result, 503, errors.New("invalid durable receipt model")
		}
		if envelope.Status != "durable" && envelope.Status != "pending_durable" {
			return result, 202, nil
		}
		if len(envelope.Durability.SnapshotIntegrity) != 64 {
			return result, 503, errors.New("durable checkpoint missing")
		}
		// Only the Faucet receipt fields are needed here. Exact decimal strings are
		// parsed as integers, never converted through floating point.
		var tx chain.Transaction
		fields := envelope.Transaction
		for _, key := range []string{"amount", "fee", "nonce", "blockNumber"} {
			if raw, ok := fields[key]; ok {
				var text string
				if json.Unmarshal(raw, &text) != nil {
					return result, 503, errors.New("invalid receipt integer")
				}
				if _, err := strconv.ParseUint(text, 10, 64); err != nil {
					return result, 503, errors.New("invalid receipt integer")
				}
				fields[key] = json.RawMessage(text)
			}
		}
		delete(fields, "logs")
		delete(fields, "lotFlows")
		raw, _ := json.Marshal(fields)
		if json.Unmarshal(raw, &tx) != nil || !validAuthoritativeReceipt(tx, record, hash) {
			return result, 503, errors.New("receipt does not match admitted intent")
		}
		if err := s.admissions.complete(record, tx); err != nil {
			return result, 503, errors.New("receipt persistence unavailable")
		}
		record.Transaction = &tx
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
func (s *Server) handleRequestStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	result, status, err := s.service.RequestStatus(r.Context(), r.URL.Query().Get("requestId"))
	if err != nil {
		writeJSON(w, status, map[string]any{"error": err.Error(), "requestId": result.RequestID, "transactionHash": result.TransactionHash, "status": result.Status, "retrySameRequest": result.RetrySameRequest})
		return
	}
	writeJSON(w, status, result)
}
