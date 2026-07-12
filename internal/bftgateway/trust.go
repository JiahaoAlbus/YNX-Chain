package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handleTrustMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/json is required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "signed Trust action exceeds maximum size"})
		return
	}
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	expected := expectedTrustAction(r)
	if expected == "" || tx.Action != expected {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "signed Trust action does not match requested route"})
		return
	}
	if !trustPathMatchesPayload(r, tx) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "signed Trust record ID does not match requested route"})
		return
	}
	if _, err := g.broadcastApplicationAction(r.Context(), raw, tx); err != nil {
		var txErr *gatewayTransactionError
		if errors.As(err, &txErr) {
			writeJSON(w, txErr.status, map[string]string{"error": txErr.Error()})
		} else {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		}
		return
	}
	txHash := consensus.ApplicationActionHash(raw)
	status := http.StatusOK
	switch tx.Action {
	case consensus.ActionGovernanceCreate:
		status = http.StatusCreated
		id := consensus.ApplicationActionRecordID("governance-request", txHash)
		var record consensus.BFTGovernanceRequest
		if err := g.queryABCIJSON(r.Context(), "/governance/requests/"+id, &record); err != nil || record.ID != id || record.Signer != tx.Signer || record.Requester != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed governance request evidence mismatch"})
			return
		}
		writeJSON(w, status, record)
	case consensus.ActionGovernanceReview, consensus.ActionGovernanceReject:
		var input consensus.GovernanceDecisionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		var record consensus.BFTGovernanceRequest
		if err := g.queryABCIJSON(r.Context(), "/governance/requests/"+input.RequestID, &record); err != nil || record.ID != input.RequestID || record.Reviewer != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed governance decision evidence mismatch"})
			return
		}
		writeJSON(w, status, record)
	case consensus.ActionTrustAppealCreate:
		status = http.StatusCreated
		id := consensus.ApplicationActionRecordID("trust-appeal", txHash)
		var record consensus.BFTTrustAppeal
		if err := g.queryABCIJSON(r.Context(), "/trust/appeals/"+id, &record); err != nil || record.ID != id || record.Signer != tx.Signer || record.Appellant != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Trust appeal evidence mismatch"})
			return
		}
		writeJSON(w, status, record)
	case consensus.ActionTrustAppealResolve:
		var input consensus.TrustAppealDecisionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		var record consensus.BFTTrustAppeal
		if err := g.queryABCIJSON(r.Context(), "/trust/appeals/"+input.AppealID, &record); err != nil || record.ID != input.AppealID || record.ReviewerSigner != tx.Signer || record.TxHash != txHash || record.Decision != input.Decision {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Trust appeal resolution evidence mismatch"})
			return
		}
		writeJSON(w, status, record)
	}
}

func trustPathMatchesPayload(r *http.Request, tx consensus.SignedApplicationAction) bool {
	switch tx.Action {
	case consensus.ActionGovernanceReview, consensus.ActionGovernanceReject:
		var input consensus.GovernanceDecisionPayload
		return json.Unmarshal(tx.Payload, &input) == nil && input.RequestID == r.PathValue("id")
	case consensus.ActionTrustAppealResolve:
		var input consensus.TrustAppealDecisionPayload
		return json.Unmarshal(tx.Payload, &input) == nil && input.AppealID == r.PathValue("id")
	default:
		return true
	}
}

func expectedTrustAction(r *http.Request) string {
	switch {
	case r.URL.Path == "/governance/requests":
		return consensus.ActionGovernanceCreate
	case strings.HasSuffix(r.URL.Path, "/review"):
		return consensus.ActionGovernanceReview
	case strings.HasSuffix(r.URL.Path, "/reject"):
		return consensus.ActionGovernanceReject
	case r.URL.Path == "/trust/appeals":
		return consensus.ActionTrustAppealCreate
	case strings.HasSuffix(r.URL.Path, "/resolve"):
		return consensus.ActionTrustAppealResolve
	default:
		return ""
	}
}

func (g *Gateway) handleGovernanceRequest(w http.ResponseWriter, r *http.Request) {
	var record consensus.BFTGovernanceRequest
	g.handleTrustLookup(w, r, r.PathValue("id"), "/governance/requests/", &record, func() bool { return record.ID == r.PathValue("id") })
}
func (g *Gateway) handleTrustAppeal(w http.ResponseWriter, r *http.Request) {
	var record consensus.BFTTrustAppeal
	g.handleTrustLookup(w, r, r.PathValue("id"), "/trust/appeals/", &record, func() bool { return record.ID == r.PathValue("id") })
}
func (g *Gateway) handleTrustLookup(w http.ResponseWriter, r *http.Request, id, prefix string, out any, matches func() bool) {
	id = strings.TrimSpace(id)
	if !aiRecordIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical Trust record ID is required"})
		return
	}
	if err := g.queryABCIJSON(r.Context(), prefix+id, out); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Trust record not found"})
		return
	}
	if !matches() {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI Trust record ID mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (g *Gateway) handleRequestValidityRules(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"rules": chain.RequestValidityRules(), "truthfulStatus": "static-chain-law-registry"})
}

func (g *Gateway) handleTransparencyReport(w http.ResponseWriter, r *http.Request) {
	var entries []consensus.BFTTransparencyEntry
	if err := g.queryABCIJSON(r.Context(), "/governance/transparency", &entries); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	report := struct {
		Network        chain.NetworkConfig              `json:"network"`
		GeneratedAt    time.Time                        `json:"generatedAt"`
		EntryCount     int                              `json:"entryCount"`
		RejectedCount  int                              `json:"rejectedCount"`
		AppealCount    int                              `json:"appealCount"`
		ReviewCount    int                              `json:"reviewCount"`
		TruthfulStatus string                           `json:"truthfulStatus"`
		Entries        []consensus.BFTTransparencyEntry `json:"entries"`
	}{Network: chain.DefaultNetworkConfig("testnet"), Entries: entries, EntryCount: len(entries), TruthfulStatus: "cometbft-abci-backed-transparency"}
	for _, entry := range entries {
		if entry.CreatedAt.After(report.GeneratedAt) {
			report.GeneratedAt = entry.CreatedAt
		}
		if entry.Status == "rejected" {
			report.RejectedCount++
		}
		if entry.Type == "trust_appeal" {
			report.AppealCount++
		}
		if entry.Classification == chain.RequestRequiresReview || entry.Status == "reviewed" {
			report.ReviewCount++
		}
	}
	if report.GeneratedAt.IsZero() {
		report.GeneratedAt = time.Unix(0, 0).UTC()
	}
	writeJSON(w, http.StatusOK, report)
}
