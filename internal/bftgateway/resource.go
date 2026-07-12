package bftgateway

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handleResourceMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/json is required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "signed Resource action exceeds maximum size"})
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
	expected := consensus.ActionResourceDelegate
	if r.URL.Path == "/resource-market/rent" {
		expected = consensus.ActionResourceRent
	}
	if tx.Action != expected {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "signed Resource action does not match requested route"})
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
	if tx.Action == consensus.ActionResourceDelegate {
		id := consensus.ApplicationActionRecordID("resource-delegation", txHash)
		var record consensus.BFTResourceDelegation
		if err := g.queryABCIJSON(r.Context(), "/resource/delegations/"+id, &record); err != nil || record.ID != id || record.Signer != tx.Signer || record.Provider != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource delegation evidence mismatch"})
			return
		}
		writeJSON(w, http.StatusCreated, record)
		return
	}
	id := consensus.ApplicationActionRecordID("resource-rental", txHash)
	var record consensus.BFTResourceRental
	if err := g.queryABCIJSON(r.Context(), "/resource/rentals/"+id, &record); err != nil || record.ID != id || record.Signer != tx.Signer || record.Address != tx.Signer || record.TxHash != txHash {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource rental evidence mismatch"})
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (g *Gateway) handleResourcePolicy(w http.ResponseWriter, r *http.Request) {
	var policy chain.ResourceMarketPolicy
	if err := g.queryABCIJSON(r.Context(), "/resource/policy", &policy); err != nil || policy.Validate() != nil || policy.Currency != "YNXT" || policy.PolicyHash == "" {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource policy is unavailable or invalid"})
		return
	}
	writeJSON(w, http.StatusOK, policy)
}

func (g *Gateway) handleResourceQuote(w http.ResponseWriter, r *http.Request) {
	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if !consensus.IsNativeAddress(address) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical Resource address is required"})
		return
	}
	bandwidth, ok := parseNonnegativeResourceValue(r, "bandwidth")
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "non-negative Resource amounts are required"})
		return
	}
	compute, ok := parseNonnegativeResourceValue(r, "compute")
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "non-negative Resource amounts are required"})
		return
	}
	aiCredits, ok := parseNonnegativeResourceValue(r, "aiCredits")
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "non-negative Resource amounts are required"})
		return
	}
	trustCredits, ok := parseNonnegativeResourceValue(r, "trustCredits")
	if !ok || bandwidth == 0 && compute == 0 && aiCredits == 0 && trustCredits == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "at least one non-negative Resource amount is required"})
		return
	}
	var policy chain.ResourceMarketPolicy
	if err := g.queryABCIJSON(r.Context(), "/resource/policy", &policy); err != nil || policy.Validate() != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource policy is unavailable"})
		return
	}
	status, err := g.status(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	expiresAt := status.LatestBlockTime.Add(time.Duration(policy.QuoteTTLSeconds) * time.Second)
	quote, err := chain.ResourceQuoteForPolicy(policy, address, bandwidth, compute, aiCredits, trustCredits, expiresAt)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, quote)
}

func parseNonnegativeResourceValue(r *http.Request, key string) (int64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return 0, true
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	return value, err == nil && value >= 0
}

func (g *Gateway) handleResourceDelegations(w http.ResponseWriter, r *http.Request) {
	address := strings.TrimSpace(r.PathValue("address"))
	if address == "" || len(address) > 128 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bounded Resource address is required"})
		return
	}
	var records []consensus.BFTResourceDelegation
	if err := g.queryABCIJSON(r.Context(), "/resource/delegations", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	filtered := make([]consensus.BFTResourceDelegation, 0)
	for _, record := range records {
		if record.Provider == address || record.Beneficiary == address {
			filtered = append(filtered, record)
		}
	}
	writeJSON(w, http.StatusOK, filtered)
}

func (g *Gateway) handleResourceRental(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !aiRecordIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical Resource rental ID is required"})
		return
	}
	var record consensus.BFTResourceRental
	if err := g.queryABCIJSON(r.Context(), "/resource/rentals/"+id, &record); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Resource rental not found"})
		return
	}
	if record.ID != id {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI Resource rental ID mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (g *Gateway) handleResourceIncome(w http.ResponseWriter, r *http.Request) {
	address := strings.TrimSpace(r.PathValue("address"))
	if address == "" || len(address) > 128 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bounded Resource address is required"})
		return
	}
	var records []consensus.BFTResourceIncome
	if err := g.queryABCIJSON(r.Context(), "/resource/income", &records); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	filtered := make([]consensus.BFTResourceIncome, 0)
	for _, record := range records {
		if record.Provider == address {
			filtered = append(filtered, record)
		}
	}
	writeJSON(w, http.StatusOK, filtered)
}

func (g *Gateway) handleResourceAnalytics(w http.ResponseWriter, r *http.Request) {
	var analytics chain.ResourceAnalytics
	if err := g.queryABCIJSON(r.Context(), "/resource/analytics", &analytics); err != nil || analytics.PolicyHash == "" || analytics.TruthfulStatus != "committed_bft_state" {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Resource analytics are unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, analytics)
}

func (g *Gateway) handleResourceIdempotency(w http.ResponseWriter, r *http.Request) {
	signer, key := strings.TrimSpace(r.URL.Query().Get("signer")), strings.TrimSpace(r.URL.Query().Get("key"))
	if !consensus.IsNativeAddress(signer) || len(key) < 3 || len(key) > 128 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical signer and bounded key are required"})
		return
	}
	id := consensus.ResourceIdempotencyID(signer, key)
	var record consensus.BFTResourceIdempotency
	if err := g.queryABCIJSON(r.Context(), "/resource/idempotency/"+id, &record); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Resource idempotency record not found"})
		return
	}
	if record.ID != id || record.Signer != signer || record.IdempotencyKey != key {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI Resource idempotency evidence mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (g *Gateway) handleResourceBalance(w http.ResponseWriter, r *http.Request) {
	address := strings.TrimSpace(r.PathValue("address"))
	if address == "" || len(address) > 128 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bounded Resource address is required"})
		return
	}
	var balance chain.ResourceBalance
	if err := g.queryABCIJSON(r.Context(), "/resources/"+address, &balance); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Resource account not found"})
		return
	}
	if balance.Address != address {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI Resource account mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, balance)
}
