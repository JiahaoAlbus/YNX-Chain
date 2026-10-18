package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handleStakingMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "Content-Type application/json is required", "failure": true})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "signed staking action exceeds maximum size", "failure": true})
		return
	}
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error(), "failure": true})
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error(), "failure": true})
		return
	}
	expected := map[string]string{"/staking/delegations": consensus.ActionStakeDelegate, "/staking/unbondings": consensus.ActionStakeUnbond, "/staking/withdrawals": consensus.ActionStakeWithdraw}[r.URL.Path]
	if tx.Action != expected {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "signed staking action does not match requested route", "failure": true})
		return
	}
	if _, err := g.broadcastApplicationAction(r.Context(), raw, tx); err != nil {
		var txErr *gatewayTransactionError
		if errors.As(err, &txErr) {
			writeJSON(w, txErr.status, map[string]any{"error": txErr.Error(), "failure": true})
		} else {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "failure": true})
		}
		return
	}
	txHash := consensus.ApplicationActionHash(raw)
	switch tx.Action {
	case consensus.ActionStakeDelegate:
		var input consensus.StakeDelegatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		id := consensus.StakingDelegationID(tx.Signer, input.Validator)
		var record consensus.BFTStakeDelegation
		if err := g.queryABCIJSON(r.Context(), "/staking/delegations/"+id, &record); err != nil || record.ID != id || record.Delegator != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": "committed delegation evidence mismatch", "failure": true})
			return
		}
		writeJSON(w, http.StatusCreated, stakingEnvelope(record.UpdatedAt, record, "delegation"))
	case consensus.ActionStakeUnbond:
		id := consensus.ApplicationActionRecordID("stake-unbonding", txHash)
		var record consensus.BFTUnbondingEntry
		if err := g.queryABCIJSON(r.Context(), "/staking/unbondings/"+id, &record); err != nil || record.ID != id || record.Delegator != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": "committed unbonding evidence mismatch", "failure": true})
			return
		}
		writeJSON(w, http.StatusCreated, stakingEnvelope(record.RequestedAt, record, "unbonding"))
	case consensus.ActionStakeWithdraw:
		var input consensus.StakeWithdrawPayload
		_ = json.Unmarshal(tx.Payload, &input)
		var record consensus.BFTUnbondingEntry
		if err := g.queryABCIJSON(r.Context(), "/staking/unbondings/"+input.UnbondingID, &record); err != nil || record.ID != input.UnbondingID || record.Delegator != tx.Signer || record.TxHash != txHash || record.Status != "withdrawn" {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": "committed withdrawal evidence mismatch", "failure": true})
			return
		}
		writeJSON(w, http.StatusOK, stakingEnvelope(*record.WithdrawnAt, record, "unbonding"))
	}
}

func stakingEnvelope(asOf any, record any, key string) map[string]any {
	return map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "asOf": asOf, "version": consensus.StakingPolicyVersion, "coverage": "exact", "failure": false, key: record}
}
func (g *Gateway) handleStakeDelegations(w http.ResponseWriter, r *http.Request) {
	var records []consensus.BFTStakeDelegation
	if err := g.queryABCIJSON(r.Context(), "/staking/delegations", &records); err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error(), "failure": true})
		return
	}
	writeJSON(w, 200, map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "version": consensus.StakingPolicyVersion, "coverage": map[string]any{"returned": len(records), "complete": true}, "failure": false, "delegations": records})
}
func (g *Gateway) handleStakeDelegation(w http.ResponseWriter, r *http.Request) {
	g.handleStakeLookup(w, r, "/staking/delegations/", "delegation")
}
func (g *Gateway) handleUnbondings(w http.ResponseWriter, r *http.Request) {
	var records []consensus.BFTUnbondingEntry
	if err := g.queryABCIJSON(r.Context(), "/staking/unbondings", &records); err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error(), "failure": true})
		return
	}
	writeJSON(w, 200, map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "version": consensus.StakingPolicyVersion, "coverage": map[string]any{"returned": len(records), "complete": true}, "failure": false, "unbondings": records})
}
func (g *Gateway) handleUnbonding(w http.ResponseWriter, r *http.Request) {
	g.handleStakeLookup(w, r, "/staking/unbondings/", "unbonding")
}
func (g *Gateway) handleStakeLookup(w http.ResponseWriter, r *http.Request, prefix, kind string) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !aiRecordIDPattern.MatchString(id) {
		writeJSON(w, 400, map[string]any{"error": "canonical staking record ID is required", "failure": true})
		return
	}
	if kind == "delegation" {
		var record consensus.BFTStakeDelegation
		if err := g.queryABCIJSON(r.Context(), prefix+id, &record); err != nil || record.ID != id {
			writeJSON(w, 404, map[string]any{"error": "delegation not found", "failure": true})
			return
		}
		writeJSON(w, 200, stakingEnvelope(record.UpdatedAt, record, kind))
		return
	}
	var record consensus.BFTUnbondingEntry
	if err := g.queryABCIJSON(r.Context(), prefix+id, &record); err != nil || record.ID != id {
		writeJSON(w, 404, map[string]any{"error": "unbonding entry not found", "failure": true})
		return
	}
	writeJSON(w, 200, stakingEnvelope(record.RequestedAt, record, kind))
}
func (g *Gateway) handleStakingSummary(w http.ResponseWriter, r *http.Request) {
	var summary map[string]any
	if err := g.queryABCIJSON(r.Context(), "/staking/summary", &summary); err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error(), "failure": true})
		return
	}
	summary["schemaVersion"], summary["failure"] = 1, false
	writeJSON(w, 200, summary)
}
