package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// This reads only the original collector route at the fixed local configuration
// source. A successful collection remains RPC_ONLY until original CORE verifies
// it using the independently pinned local invocation context.
func (h *helper) lookupProof(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TxID string `json:"txId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !txPattern.MatchString(in.TxID) {
		denied(w, 400, "INVALID_TX_ID")
		return
	}
	lookup, err := h.pqCommand.CollectorLookupID(in.TxID)
	if err != nil {
		denied(w, 400, "TARGET_NOT_CONFIGURED")
		return
	}
	endpoint := h.rpc + "/txs/" + url.PathEscape(lookup) + "/pq-finality-proof"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		denied(w, 502, "RPC_UNAVAILABLE")
		return
	}
	resp, err := h.client.Do(req)
	if err != nil {
		if r.Context().Err() != nil {
			denied(w, 401, "PAIRING_REQUIRED")
		} else {
			denied(w, 502, "PROOF_SOURCE_UNAVAILABLE")
		}
		return
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
	if r.Context().Err() != nil {
		denied(w, 401, "PAIRING_REQUIRED")
		return
	}
	if err != nil || len(raw) > 4<<20 || !json.Valid(raw) {
		denied(w, 502, "INVALID_PROOF_SOURCE_RESPONSE")
		return
	}
	if resp.StatusCode != 200 {
		sendJSON(w, 502, map[string]any{"error": "PROOF_NOT_SUPPLIED", "upstreamStatus": resp.StatusCode})
		return
	}
	view := h.pqCommand.Verify(r.Context(), in.TxID, raw)
	h.sendAuthorizedJSON(w, r, map[string]any{"view": view, "reportedBy": endpoint})
}
