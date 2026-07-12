package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handlePayMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/json is required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "signed Pay action exceeds maximum size"})
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
	expected := ""
	switch r.URL.Path {
	case "/pay/intents":
		expected = consensus.ActionPayIntentCreate
	case "/pay/invoices":
		expected = consensus.ActionPayInvoiceCreate
	case "/pay/refunds":
		expected = consensus.ActionPayRefundCreate
	case "/pay/webhook-signatures":
		expected = consensus.ActionPayWebhookRecord
	}
	if tx.Action != expected {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "signed Pay action does not match requested route"})
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
	switch tx.Action {
	case consensus.ActionPayIntentCreate:
		id := consensus.ApplicationActionRecordID("pay-intent", txHash)
		var record consensus.BFTPayIntent
		if err := g.queryABCIJSON(r.Context(), "/pay/intents/"+id, &record); err != nil || record.ID != id || record.Signer != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Pay intent evidence mismatch"})
			return
		}
		writeJSON(w, http.StatusCreated, record)
	case consensus.ActionPayInvoiceCreate:
		id := consensus.ApplicationActionRecordID("pay-invoice", txHash)
		var record consensus.BFTPayInvoice
		if err := g.queryABCIJSON(r.Context(), "/pay/invoices/"+id, &record); err != nil || record.ID != id || record.Signer != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Pay invoice evidence mismatch"})
			return
		}
		writeJSON(w, http.StatusCreated, record)
	case consensus.ActionPayRefundCreate:
		id := consensus.ApplicationActionRecordID("pay-refund", txHash)
		var record consensus.BFTPayRefund
		if err := g.queryABCIJSON(r.Context(), "/pay/refunds/"+id, &record); err != nil || record.ID != id || record.Signer != tx.Signer || record.TxHash != txHash {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Pay refund evidence mismatch"})
			return
		}
		writeJSON(w, http.StatusCreated, record)
	case consensus.ActionPayWebhookRecord:
		var input consensus.PayWebhookPayload
		_ = json.Unmarshal(tx.Payload, &input)
		var record consensus.BFTPayWebhook
		if err := g.queryABCIJSON(r.Context(), "/pay/webhooks/"+input.EventID, &record); err != nil || record.EventID != input.EventID || record.Signer != tx.Signer || record.TxHash != txHash || record.PayloadHash != input.PayloadHash || record.Signature != input.Signature {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "committed Pay webhook evidence mismatch"})
			return
		}
		writeJSON(w, http.StatusCreated, record)
	}
}

func (g *Gateway) handlePayIntent(w http.ResponseWriter, r *http.Request) {
	var v consensus.BFTPayIntent
	g.handlePayLookup(w, r, r.PathValue("id"), "/pay/intents/", &v, func() bool { return v.ID == r.PathValue("id") })
}
func (g *Gateway) handlePayInvoice(w http.ResponseWriter, r *http.Request) {
	var v consensus.BFTPayInvoice
	g.handlePayLookup(w, r, r.PathValue("id"), "/pay/invoices/", &v, func() bool { return v.ID == r.PathValue("id") })
}
func (g *Gateway) handlePayRefund(w http.ResponseWriter, r *http.Request) {
	var v consensus.BFTPayRefund
	g.handlePayLookup(w, r, r.PathValue("id"), "/pay/refunds/", &v, func() bool { return v.ID == r.PathValue("id") })
}
func (g *Gateway) handlePayWebhook(w http.ResponseWriter, r *http.Request) {
	var v consensus.BFTPayWebhook
	id := r.PathValue("eventId")
	g.handlePayLookup(w, r, id, "/pay/webhooks/", &v, func() bool { return v.EventID == id })
}
func (g *Gateway) handlePayEvent(w http.ResponseWriter, r *http.Request) {
	var v consensus.BFTPayEvent
	g.handlePayLookup(w, r, r.PathValue("id"), "/pay/events/", &v, func() bool { return v.ID == r.PathValue("id") })
}

func (g *Gateway) handlePayLookup(w http.ResponseWriter, r *http.Request, id, prefix string, out any, matches func() bool) {
	id = strings.TrimSpace(id)
	if !aiRecordIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical Pay record ID is required"})
		return
	}
	if err := g.queryABCIJSON(r.Context(), prefix+id, out); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Pay record not found"})
		return
	}
	if !matches() {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI Pay record ID mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (g *Gateway) handlePayEvents(w http.ResponseWriter, r *http.Request) {
	var events []consensus.BFTPayEvent
	if err := g.queryABCIJSON(r.Context(), "/pay/events", &events); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	intentID := strings.TrimSpace(r.URL.Query().Get("intentId"))
	if intentID != "" && !aiRecordIDPattern.MatchString(intentID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical Pay intent ID is required"})
		return
	}
	filtered := make([]consensus.BFTPayEvent, 0, len(events))
	for _, event := range events {
		if intentID == "" || event.IntentID == intentID {
			filtered = append(filtered, event)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": filtered})
}

func (g *Gateway) handlePayIdempotency(w http.ResponseWriter, r *http.Request) {
	merchant, key := strings.TrimSpace(r.URL.Query().Get("merchant")), strings.TrimSpace(r.URL.Query().Get("key"))
	if merchant == "" || key == "" || len(merchant) > 128 || len(key) > 128 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bounded merchant and key are required"})
		return
	}
	id := consensus.PayIdempotencyID(merchant, key)
	var record consensus.BFTPayIdempotency
	if err := g.queryABCIJSON(r.Context(), "/pay/idempotency/"+id, &record); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Pay idempotency record not found"})
		return
	}
	if record.ID != id || record.Merchant != merchant || record.IdempotencyKey != key {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "ABCI Pay idempotency evidence mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, record)
}
