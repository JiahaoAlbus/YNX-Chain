package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const quantAPIVersion = "abci-state-v11"

func (g *Gateway) handleQuantMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, quantFailure("Content-Type application/json is required"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, quantFailure("signed application action exceeds maximum size"))
		return
	}
	tx, err := consensus.DecodeSignedApplicationAction(payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, quantFailure(err.Error()))
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, quantFailure(err.Error()))
		return
	}
	expectedAction, recordID, status, err := quantRouteBinding(r, tx)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, quantFailure(err.Error()))
		return
	}
	if tx.Action != expectedAction {
		writeJSON(w, http.StatusBadRequest, quantFailure("signed application action does not match the requested Quant route"))
		return
	}
	if _, err := g.broadcastApplicationAction(r.Context(), payload, tx); err != nil {
		var txErr *gatewayTransactionError
		if errors.As(err, &txErr) {
			writeJSON(w, txErr.status, quantFailure(txErr.Error()))
		} else {
			writeJSON(w, http.StatusBadGateway, quantFailure(err.Error()))
		}
		return
	}
	txHash := consensus.ApplicationActionHash(payload)
	var events []consensus.BFTAssetAuditEvent
	if err := g.queryABCIJSON(r.Context(), "/quant/audit", &events); err != nil {
		writeJSON(w, http.StatusBadGateway, quantFailure("committed Quant audit evidence unavailable"))
		return
	}
	var evidence *consensus.BFTAssetAuditEvent
	for index := range events {
		event := &events[index]
		if event.TxHash == txHash && event.Type == tx.Action && event.RecordID == recordID && event.Signer == tx.Signer && validQuantAuditEvidence(*event) {
			evidence = event
			break
		}
	}
	if evidence == nil {
		writeJSON(w, http.StatusBadGateway, quantFailure("committed Quant audit evidence mismatch"))
		return
	}
	response := quantBase(evidence.OccurredAt, "exact")
	response["auditEvent"] = evidence
	if strings.HasPrefix(tx.Action, "strategy_mandate_") {
		var record assetauth.StrategyMandate
		if err := g.queryABCIJSON(r.Context(), "/quant/mandates/"+recordID, &record); err != nil || record.ID != recordID || !validCommittedMandateRecord(tx, record, evidence.OccurredAt) {
			writeJSON(w, http.StatusBadGateway, quantFailure("committed strategy mandate evidence mismatch"))
			return
		}
		response["mandate"] = record
	} else {
		var record assetauth.StrategyVault
		if err := g.queryABCIJSON(r.Context(), "/quant/vaults/"+recordID, &record); err != nil || record.ID != recordID || !validCommittedVaultRecord(tx, record, evidence.OccurredAt) {
			writeJSON(w, http.StatusBadGateway, quantFailure("committed strategy vault evidence mismatch"))
			return
		}
		response["vault"] = record
	}
	writeJSON(w, status, response)
}

func quantRouteBinding(r *http.Request, tx consensus.SignedApplicationAction) (string, string, int, error) {
	switch {
	case r.URL.Path == "/quant/mandates":
		var input consensus.StrategyMandateCreatePayload
		if err := json.Unmarshal(tx.Payload, &input); err != nil || strings.TrimSpace(input.ID) == "" {
			return "", "", 0, errors.New("invalid strategy mandate creation payload")
		}
		return consensus.ActionStrategyMandateCreate, strings.TrimSpace(input.ID), http.StatusCreated, nil
	case strings.HasSuffix(r.URL.Path, "/revoke"), strings.HasSuffix(r.URL.Path, "/kill"):
		var input consensus.StrategyMandateControlPayload
		if err := json.Unmarshal(tx.Payload, &input); err != nil || input.MandateID != r.PathValue("id") {
			return "", "", 0, errors.New("signed mandate ID does not match its route")
		}
		if strings.HasSuffix(r.URL.Path, "/revoke") {
			return consensus.ActionStrategyMandateRevoke, input.MandateID, http.StatusOK, nil
		}
		return consensus.ActionStrategyMandateKill, input.MandateID, http.StatusOK, nil
	case r.URL.Path == "/quant/vaults":
		var input consensus.StrategyVaultCreatePayload
		if err := json.Unmarshal(tx.Payload, &input); err != nil || strings.TrimSpace(input.VaultID) == "" {
			return "", "", 0, errors.New("invalid strategy vault creation payload")
		}
		return consensus.ActionStrategyVaultCreate, strings.TrimSpace(input.VaultID), http.StatusCreated, nil
	default:
		var input consensus.StrategyVaultAmountPayload
		if err := json.Unmarshal(tx.Payload, &input); err != nil || input.VaultID != r.PathValue("id") {
			return "", "", 0, errors.New("signed vault ID does not match its route")
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/deposit"):
			return consensus.ActionStrategyVaultDeposit, input.VaultID, http.StatusOK, nil
		case strings.HasSuffix(r.URL.Path, "/withdraw"):
			return consensus.ActionStrategyVaultWithdraw, input.VaultID, http.StatusOK, nil
		case strings.HasSuffix(r.URL.Path, "/emergency-exit"):
			return consensus.ActionStrategyVaultExit, input.VaultID, http.StatusOK, nil
		default:
			return "", "", 0, errors.New("unsupported Quant mutation route")
		}
	}
}

func validQuantAuditEvidence(event consensus.BFTAssetAuditEvent) bool {
	return event.ID == consensus.ApplicationActionRecordID("asset-audit", event.TxHash) && transactionHashPattern.MatchString(event.TxHash) && blockHashPattern.MatchString(event.AuditHash) && strings.ToLower(event.AuditHash) == event.AuditHash && consensus.IsNativeAddress(event.Signer) && event.BlockHeight > 0 && !event.OccurredAt.IsZero()
}

func validCommittedMandateRecord(tx consensus.SignedApplicationAction, record assetauth.StrategyMandate, occurredAt time.Time) bool {
	if record.Validate() != nil || record.Owner != tx.Signer || record.CreatedAt.After(occurredAt) {
		return false
	}
	switch tx.Action {
	case consensus.ActionStrategyMandateCreate:
		var input consensus.StrategyMandateCreatePayload
		return json.Unmarshal(tx.Payload, &input) == nil && record.ID == input.ID && record.EngineIdentity == input.EngineIdentity && record.StrategyHash == input.StrategyHash && record.StrategyVersion == input.StrategyVersion && record.NonceDomain == input.NonceDomain && record.RevokedAt == nil && record.KillSwitchAt == nil
	case consensus.ActionStrategyMandateRevoke:
		return record.RevokedAt != nil && !record.RevokedAt.After(occurredAt)
	case consensus.ActionStrategyMandateKill:
		return record.KillSwitchAt != nil && !record.KillSwitchAt.After(occurredAt)
	default:
		return false
	}
}

func validCommittedVaultRecord(tx consensus.SignedApplicationAction, record assetauth.StrategyVault, occurredAt time.Time) bool {
	if record.Validate() != nil || record.CreatedAt.After(occurredAt) {
		return false
	}
	switch tx.Action {
	case consensus.ActionStrategyVaultCreate:
		var input consensus.StrategyVaultCreatePayload
		return json.Unmarshal(tx.Payload, &input) == nil && record.ID == input.VaultID && record.MandateID == input.MandateID && record.Owner == tx.Signer && record.BalanceYNXT == 0 && record.ClosedAt == nil
	case consensus.ActionStrategyVaultDeposit:
		var input consensus.StrategyVaultAmountPayload
		return json.Unmarshal(tx.Payload, &input) == nil && input.AmountYNXT > 0 && record.ID == input.VaultID && record.ClosedAt == nil
	case consensus.ActionStrategyVaultWithdraw:
		var input consensus.StrategyVaultAmountPayload
		return json.Unmarshal(tx.Payload, &input) == nil && input.AmountYNXT > 0 && record.ID == input.VaultID && record.Owner == tx.Signer && record.ClosedAt == nil
	case consensus.ActionStrategyVaultExit:
		var input consensus.StrategyVaultAmountPayload
		return json.Unmarshal(tx.Payload, &input) == nil && record.ID == input.VaultID && record.Owner == tx.Signer && record.BalanceYNXT == 0 && record.ClosedAt != nil && !record.ClosedAt.After(occurredAt)
	default:
		return false
	}
}

func (g *Gateway) handleQuantMandates(w http.ResponseWriter, r *http.Request) {
	var records []assetauth.StrategyMandate
	if err := g.queryABCIJSON(r.Context(), "/quant/mandates", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, quantFailure(err.Error()))
		return
	}
	response := quantBase(latestMandateTime(records), map[string]any{"returned": len(records), "complete": true})
	response["mandates"] = records
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleQuantMandate(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !validQuantID(id) {
		writeJSON(w, http.StatusBadRequest, quantFailure("canonical strategy mandate ID is required"))
		return
	}
	var record assetauth.StrategyMandate
	if err := g.queryABCIJSON(r.Context(), "/quant/mandates/"+id, &record); err != nil {
		writeJSON(w, http.StatusNotFound, quantFailure("strategy mandate not found"))
		return
	}
	if record.ID != id {
		writeJSON(w, http.StatusBadGateway, quantFailure("ABCI strategy mandate ID mismatch"))
		return
	}
	response := quantBase(record.CreatedAt, "exact")
	response["mandate"] = record
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleQuantVaults(w http.ResponseWriter, r *http.Request) {
	var records []assetauth.StrategyVault
	if err := g.queryABCIJSON(r.Context(), "/quant/vaults", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, quantFailure(err.Error()))
		return
	}
	response := quantBase(latestVaultTime(records), map[string]any{"returned": len(records), "complete": true})
	response["vaults"] = records
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleQuantVault(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !validQuantID(id) {
		writeJSON(w, http.StatusBadRequest, quantFailure("canonical strategy vault ID is required"))
		return
	}
	var record assetauth.StrategyVault
	if err := g.queryABCIJSON(r.Context(), "/quant/vaults/"+id, &record); err != nil {
		writeJSON(w, http.StatusNotFound, quantFailure("strategy vault not found"))
		return
	}
	if record.ID != id {
		writeJSON(w, http.StatusBadGateway, quantFailure("ABCI strategy vault ID mismatch"))
		return
	}
	response := quantBase(record.CreatedAt, "exact")
	response["vault"] = record
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleQuantAudit(w http.ResponseWriter, r *http.Request) {
	var records []consensus.BFTAssetAuditEvent
	if err := g.queryABCIJSON(r.Context(), "/quant/audit", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, quantFailure(err.Error()))
		return
	}
	var asOf any
	if len(records) > 0 {
		asOf = records[len(records)-1].OccurredAt
	}
	response := quantBase(asOf, map[string]any{"returned": len(records), "complete": true})
	response["events"] = records
	writeJSON(w, http.StatusOK, response)
}

func quantBase(asOf, coverage any) map[string]any {
	return map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "asOf": asOf, "version": quantAPIVersion, "coverage": coverage, "failure": false}
}

func quantFailure(message string) map[string]any {
	return map[string]any{"error": message, "source": "ynx-consensus-abci", "version": quantAPIVersion, "coverage": "none", "failure": true}
}

func validQuantID(id string) bool {
	return quantRecordIDPattern.MatchString(id)
}

func latestMandateTime(records []assetauth.StrategyMandate) any {
	var latest time.Time
	for _, record := range records {
		if record.CreatedAt.After(latest) {
			latest = record.CreatedAt
		}
	}
	if latest.IsZero() {
		return nil
	}
	return latest
}

func latestVaultTime(records []assetauth.StrategyVault) any {
	var latest time.Time
	for _, record := range records {
		if record.CreatedAt.After(latest) {
			latest = record.CreatedAt
		}
	}
	if latest.IsZero() {
		return nil
	}
	return latest
}
