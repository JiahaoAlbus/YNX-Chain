package api

import (
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
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

func (s *Server) handleAccountAuthorization(w http.ResponseWriter, r *http.Request) {
	owner, err := normalizeAccountInput(r.PathValue("address"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	state, height, nonce := s.devnet.AccountAuthorizationSnapshot(owner)
	result := map[string]any{"owner": owner, "executionHeight": strconv.FormatUint(height, 10), "ledgerNonce": strconv.FormatUint(nonce, 10), "algorithmVersion": "legacy", "enabled": state != nil, "records": []any{}}
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
	if err != nil {
		if writeUncertainMutation(w, tx, err) {
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
	writeJSON(w, http.StatusOK, map[string]any{"transaction": tx, "replayed": replayed, "activationHeight": strconv.FormatUint(m.Intent.ActivateAt, 10), "revision": strconv.FormatUint(m.Intent.NewRevision, 10), "executionHeight": strconv.FormatUint(height, 10), "status": status})
}

func (s *Server) handlePQTransfer(w http.ResponseWriter, r *http.Request) {
	// Fixed transfer messages are below 1 KiB; their complete certificate and
	// two maximal paths fit this finite ingress limit without generic 1 MiB data.
	wire, ok := readPQBody(w, r, 128<<10)
	if !ok {
		return
	}
	tx, replayed, err := s.devnet.SubmitPQTransfer(wire)
	if err != nil {
		if writeUncertainMutation(w, tx, err) {
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transaction": tx, "replayed": replayed, "status": "accepted"})
}
