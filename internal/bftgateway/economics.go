package bftgateway

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

var feeEventIDPattern = regexp.MustCompile(`^fee_[0-9a-f]{24}$`)

func (g *Gateway) handleEconomicsFees(w http.ResponseWriter, r *http.Request) {
	var records []consensus.BFTFeeEvent
	if err := g.queryABCIJSON(r.Context(), "/economics/fees", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "source": "ynx-consensus-abci", "failure": true})
		return
	}
	payer := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("payer")))
	if payer != "" && !consensus.IsNativeAddress(payer) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "payer must be a canonical lowercase account address", "failure": true})
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 1000 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "limit must be between 1 and 1000", "failure": true})
			return
		}
		limit = parsed
	}
	filtered := make([]consensus.BFTFeeEvent, 0, len(records))
	for _, record := range records {
		if payer == "" || record.Payer == payer {
			filtered = append(filtered, record)
		}
	}
	matched := len(filtered)
	if len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	var asOf *time.Time
	if len(records) > 0 {
		value := records[len(records)-1].RecordedAt
		asOf = &value
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "asOf": asOf, "version": consensus.FeePolicyVersion, "coverage": map[string]any{"total": len(records), "matched": matched, "returned": len(filtered), "complete": matched <= limit}, "failure": false, "events": filtered})
}

func (g *Gateway) handleEconomicsFee(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !feeEventIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "canonical fee event ID is required", "failure": true})
		return
	}
	var record consensus.BFTFeeEvent
	if err := g.queryABCIJSON(r.Context(), "/economics/fees/"+id, &record); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "fee event not found", "source": "ynx-consensus-abci", "failure": true})
		return
	}
	if record.ID != id {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "ABCI fee event ID mismatch", "source": "ynx-consensus-abci", "failure": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "asOf": record.RecordedAt, "version": record.PolicyVersion, "coverage": "exact", "failure": false, "event": record})
}
