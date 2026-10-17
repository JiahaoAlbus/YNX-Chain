package api

import (
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func readPQBody(w http.ResponseWriter, r *http.Request, max int64) ([]byte, bool) {
	if strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])) != "application/octet-stream" {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type application/octet-stream is required")
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, max)
	b, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "PQ authorization exceeds maximum size")
		return nil, false
	}
	if len(b) == 0 {
		writeError(w, http.StatusBadRequest, "PQ authorization is empty")
		return nil, false
	}
	return b, true
}

func (s *Server) handlePQBatch(w http.ResponseWriter, r *http.Request) {
	wire, ok := readPQBody(w, r, chain.MaxPQBatchBytes)
	if !ok {
		return
	}
	result, err := s.devnet.SubmitPQBatch(wire)
	if err != nil {
		if result.Status == "uncertain" || result.Status == "not_committed" {
			// Preserve original batch identity/results without exposing filesystem
			// errors or claiming business admissions are durably accepted.
			w.Header().Set("Cache-Control", "no-store")
			if errors.Is(err, chain.ErrSnapshotDurabilityUncertain) {
				result.Status = "uncertain"
			}
			writeJSON(w, http.StatusServiceUnavailable, pqBatchResponse(wire, result))
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pqBatchResponse(wire, result))
}

func pqBatchResponse(wire []byte, result chain.PQBatchResult) map[string]any {
	// Result counts were bounded by chain admission. Decimal values come directly
	// from canonical signed bytes; no JS-unsafe legacy JSON number is round-tripped.
	whole, err := ynxbatch.DecodeWhole(wire)
	rows := make([]map[string]any, len(result.Results))
	for i, row := range result.Results {
		fields := map[string]string{"executionHeight": strconv.FormatUint(result.ExecutionHeight, 10)}
		if err == nil && int(row.Index) < len(whole.Messages) {
			if transfer, e := ynxauth.DecodeTransfer(whole.Messages[row.Index]); e == nil {
				fields["amount"], fields["fee"], fields["nonce"] = strconv.FormatUint(transfer.Amount, 10), strconv.FormatUint(transfer.Fee, 10), strconv.FormatUint(transfer.Nonce, 10)
			}
		}
		rows[i] = map[string]any{"index": row.Index, "outcome": row.Outcome, "transactionHash": row.TransactionHash, "error": row.Error, "wireHash": result.BatchHash, "batchHash": result.BatchHash, "decimalFields": fields}
	}
	return map[string]any{"batchHash": result.BatchHash, "wireHash": result.BatchHash, "status": result.Status, "replayed": result.Replayed, "executionHeight": strconv.FormatUint(result.ExecutionHeight, 10), "results": rows}
}

func (s *Server) pqDecimalFields(tx chain.Transaction) map[string]string {
	fields := map[string]string{"amount": strconv.FormatInt(tx.Amount, 10), "fee": strconv.FormatInt(tx.Fee, 10), "nonce": strconv.FormatUint(tx.Nonce, 10)}
	if height, ok := s.devnet.PQTransactionExecutionHeight(tx.Hash); ok {
		fields["executionHeight"] = strconv.FormatUint(height, 10)
	}
	return fields
}

func writePQUncertainMutation(w http.ResponseWriter, tx chain.Transaction, err error, fields map[string]string) bool {
	if !errors.Is(err, chain.ErrSnapshotDurabilityUncertain) {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "transaction durability needs confirmation; retry the identical signed request", "status": "transaction_durability_uncertain", "transactionHash": tx.Hash, "wireHash": tx.Hash, "decimalFields": fields, "durabilityVersion": chain.TransactionDurabilityVersion, "ynxDurability": transactionDurabilityRPC(tx.Hash, tx, chain.TransactionDurability{Status: "uncertain"})})
	return true
}

func (s *Server) handleAccountAuthorization(w http.ResponseWriter, r *http.Request) {
	owner, err := normalizeAccountInput(r.PathValue("address"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	view := s.devnet.AccountAuthorizationDetails(owner)
	state, height, nonce := view.State, view.ExecutionHeight, view.LedgerNonce
	result := map[string]any{"owner": owner, "executionHeight": strconv.FormatUint(height, 10), "ledgerNonce": strconv.FormatUint(nonce, 10), "algorithmVersion": "legacy", "enabled": state != nil, "records": []any{}, "policyView": "next_execution", "source": "authoritative_producer", "recordsView": "includes_pending", "committedHeight": strconv.FormatUint(view.CommittedHeight, 10), "committedBlockHash": view.CommittedBlockHash, "committedAlgorithmVersion": "legacy"}
	result["checkpointStatus"], result["checkpointIntegrity"], result["recordsComplete"] = view.CheckpointStatus, view.CheckpointIntegrity, true
	w.Header().Set("Cache-Control", "no-store")
	if state != nil {
		records := make([]map[string]any, 0, len(state.Records))
		for _, r := range state.Records {
			records = append(records, map[string]any{"algorithmVersion": r.AlgorithmVersion, "owner": r.Owner, "pkA": hex.EncodeToString(r.PKA), "pkB": hex.EncodeToString(r.PKB), "revision": strconv.FormatUint(r.Revision, 10), "registeredAt": strconv.FormatUint(r.RegisteredAt, 10), "activeFrom": strconv.FormatUint(r.ActiveFrom, 10), "ledgerNonce": strconv.FormatUint(r.LedgerNonce, 10)})
		}
		result["policyVersion"], result["networkId"], result["enableAt"], result["records"] = state.Version, hex.EncodeToString(state.NetworkID), strconv.FormatUint(state.EnableAt, 10), records
		if record, active := state.PolicyAt(owner, height); active {
			result["algorithmVersion"] = record.AlgorithmVersion
			result["activeRevision"] = strconv.FormatUint(record.Revision, 10)
		}
		if record, active := state.PolicyAt(owner, view.CommittedHeight); active && record.RegisteredAt <= view.CommittedHeight {
			result["committedAlgorithmVersion"] = record.AlgorithmVersion
			result["committedActiveRevision"] = strconv.FormatUint(record.Revision, 10)
		}
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAccountMigration(w http.ResponseWriter, r *http.Request) {
	wire, ok := readPQBody(w, r, ynxauth.MaxMigrationBytes)
	if !ok {
		return
	}
	m, err := ynxauth.DecodeMigration(wire)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	owner, err := normalizeAccountInput(r.PathValue("address"))
	if err != nil || owner != m.Intent.Owner {
		writeError(w, http.StatusBadRequest, "migration owner does not match route")
		return
	}
	tx, replayed, err := s.devnet.SubmitAccountMigration(wire)
	decimal := s.pqDecimalFields(tx)
	decimal["revision"], decimal["activationHeight"] = strconv.FormatUint(m.Intent.NewRevision, 10), strconv.FormatUint(m.Intent.ActivateAt, 10)
	if err != nil {
		if writePQUncertainMutation(w, tx, err, decimal) {
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	status := "registered_pending_activation"
	state, height, _ := s.devnet.AccountAuthorizationSnapshot(owner)
	if state != nil {
		if current, active := state.PolicyAt(owner, height); active {
			if current.Revision == m.Intent.NewRevision {
				status = "active"
			} else if current.Revision > m.Intent.NewRevision {
				status = "superseded"
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"transaction": tx, "wireHash": tx.Hash, "decimalFields": decimal, "replayed": replayed, "activationHeight": strconv.FormatUint(m.Intent.ActivateAt, 10), "revision": strconv.FormatUint(m.Intent.NewRevision, 10), "executionHeight": strconv.FormatUint(height, 10), "status": status})
}

func (s *Server) handlePQTransfer(w http.ResponseWriter, r *http.Request) {
	// Fixed transfer messages are below 1 KiB; their complete certificate and
	// two maximal paths fit this finite ingress limit without generic 1 MiB data.
	wire, ok := readPQBody(w, r, 128<<10)
	if !ok {
		return
	}
	tx, replayed, err := s.devnet.SubmitPQTransfer(wire)
	decimal := s.pqDecimalFields(tx)
	if err != nil {
		if writePQUncertainMutation(w, tx, err, decimal) {
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transaction": tx, "wireHash": tx.Hash, "decimalFields": decimal, "replayed": replayed, "status": "accepted"})
}
