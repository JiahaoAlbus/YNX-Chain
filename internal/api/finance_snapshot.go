package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func (s *Server) handleNativeFinanceSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeError(w, 400, "invalid snapshot query")
		return
	}
	if len(query) > 1 || len(query["account"]) > 1 {
		writeError(w, 400, "only one account query is supported")
		return
	}
	for key := range query {
		if key != "account" {
			writeError(w, 400, "unknown snapshot query")
			return
		}
	}
	address := query.Get("account")
	if address != "" {
		address, err = accountaddress.Normalize(address)
		if err != nil {
			writeError(w, 400, "invalid snapshot account")
			return
		}
	}
	value, err := s.devnet.NativeFinanceSnapshot(address)
	if err != nil {
		writeJSON(w, 503, map[string]any{"error": err.Error(), "coverage": map[string]any{"complete": false}})
		return
	}
	writeJSON(w, 200, value)
}

// Convert with UseNumber before marshaling: float64 would lose exact int64
// amounts before a JavaScript client ever had a chance to construct a BigInt.
func decimalJSON(value any) any {
	switch v := value.(type) {
	case json.Number:
		return string(v)
	case map[string]any:
		for k, x := range v {
			v[k] = decimalJSON(x)
		}
		return v
	case []any:
		for i, x := range v {
			v[i] = decimalJSON(x)
		}
		return v
	default:
		return value
	}
}

func (s *Server) handleNativeFinanceTransaction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	hash := r.PathValue("hash")
	if !isCanonicalData(hash, 32) {
		writeError(w, 400, "canonical transaction hash required")
		return
	}
	tx, proof, found := s.devnet.RPCTransactionWithDurability(hash)
	if !found {
		writeJSON(w, 404, map[string]any{"status": "not_found", "transactionHash": hash})
		return
	}
	payload, err := json.Marshal(tx)
	if err != nil {
		writeError(w, 500, "transaction encoding failed")
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var transaction any
	if decoder.Decode(&transaction) != nil {
		writeError(w, 500, "transaction encoding failed")
		return
	}
	writeJSON(w, 200, map[string]any{"schemaVersion": "ynx-native-finance-transaction-v1", "source": "authoritative chain-native YNX Testnet state",
		"integerEncoding": "decimal-string", "transaction": decimalJSON(transaction), "status": proof.Status, "consensusFinality": false,
		"durability": map[string]any{"version": "ynx-local-durability-v1", "scope": "local-snapshot", "checkpointHeight": strconv.FormatUint(proof.CheckpointHeight, 10),
			"checkpointHash": proof.CheckpointHash, "snapshotIntegrity": proof.SnapshotIntegrity}})
}
