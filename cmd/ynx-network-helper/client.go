package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
)

type readonlyReport struct {
	Status string          `json:"status"`
	Data   json.RawMessage `json:"data,omitempty"`
	Code   string          `json:"code,omitempty"`
	Source string          `json:"source"`
}

// Only fixed read-only routes can reach this transport. An upstream response
// supplies data, never local authority, peer identity, or a checkpoint.
func (h *helper) readReport(ctx context.Context, path string, limit int64) readonlyReport {
	r := readonlyReport{Status: "unavailable", Source: h.rpc + path}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.Source, nil)
	if err != nil {
		r.Code = "RPC_UNAVAILABLE"
		return r
	}
	resp, err := h.client.Do(req)
	if err != nil {
		r.Code = "RPC_UNAVAILABLE"
		return r
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		r.Code = "RPC_HTTP_ERROR"
		return r
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(raw)) > limit {
		r.Code = "RPC_RESPONSE_LIMIT"
		return r
	}
	if !utf8.Valid(raw) || !json.Valid(raw) {
		r.Code = "RPC_INVALID_JSON"
		return r
	}
	r.Status = "reported"
	r.Data = raw
	return r
}
func (h *helper) nodeReport(w http.ResponseWriter, r *http.Request) {
	var empty struct{}
	if !decode(w, r, &empty) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
	defer cancel()
	paths := []string{"/status", "/validators"}
	results := make([]readonlyReport, len(paths))
	var wg sync.WaitGroup
	for i, path := range paths {
		wg.Add(1)
		go func(i int, path string) { defer wg.Done(); results[i] = h.readReport(ctx, path, 1<<20) }(i, path)
	}
	wg.Wait()
	latest := readonlyReport{Status: "unavailable", Code: "STATUS_HEIGHT_NOT_SUPPLIED", Source: h.rpc}
	var status struct {
		Height uint64 `json:"height"`
	}
	if results[0].Status == "reported" && json.Unmarshal(results[0].Data, &status) == nil && status.Height > 0 {
		latest = h.readReport(ctx, "/blocks/"+strconv.FormatUint(status.Height, 10), 2<<20)
	}
	h.sendAuthorizedJSON(w, r, map[string]any{"classification": receipt.RPCOnly, "source": h.rpc, "reports": map[string]readonlyReport{"status": results[0], "latestBlock": latest, "validators": results[1]}})
}
func (h *helper) clientReceipt(w http.ResponseWriter, r *http.Request) {
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
	if h.receipts == nil {
		denied(w, 503, "RECEIPTS_NOT_CONFIGURED")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
	defer cancel()
	var report readonlyReport
	var pending sync.WaitGroup
	pending.Add(1)
	go func() { defer pending.Done(); report = h.readReport(ctx, "/txs/"+url.PathEscape(in.TxID), 2<<20) }()
	collection := readonlyReport{Status: "unavailable", Code: "PROOF_NOT_SUPPLIED"}
	lookup, err := h.pqCommand.CollectorLookupID(in.TxID)
	if err != nil {
		collection.Code = "TARGET_NOT_CONFIGURED"
	} else {
		collection = h.readReport(ctx, "/txs/"+url.PathEscape(lookup)+"/pq-finality-proof", 4<<20)
	}
	pending.Wait()
	view := receipt.PQProofView{ProofView: receipt.ProofView{Level: receipt.RPCOnly, TxID: in.TxID, Source: report.Source, Reason: "NOT_SUPPLIED", Detail: "原生证明与独立固定的原 CORE 信任材料尚未共同提供。"}, StateScope: "transaction-result-only"}
	if collection.Status == "reported" {
		view = h.pqCommand.Verify(ctx, in.TxID, collection.Data)
	}
	// Keep source collection status separate from the original verifier result.
	// Raw source proof is not a fresh trust source on historical readback.
	collection.Data = nil
	v, _ := json.Marshal(view)
	proof, _ := json.Marshal(collection)
	rawReport := report.Data
	report.Data = nil
	reportMetadata, _ := json.Marshal(report)
	h.sendAuthorizedJSON(w, r, receipt.ClientReceipt{TxID: in.TxID, ContextPin: h.historyContextPin, View: v, Report: rawReport, ReportText: string(rawReport), ReportCollection: reportMetadata, ReportedBy: report.Source, ProofCollection: proof})
}
func (h *helper) listReceipts(w http.ResponseWriter, r *http.Request) {
	var empty struct{}
	if !decode(w, r, &empty) {
		return
	}
	if h.receipts == nil {
		denied(w, 503, "RECEIPTS_NOT_CONFIGURED")
		return
	}
	h.sendAuthorizedJSON(w, r, map[string]any{"classification": "historical-local-projection", "authority": false, "receipts": h.receipts.List()})
}
func (h *helper) getReceipt(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.ID) != 64 || !txPattern.MatchString(in.ID) {
		denied(w, 400, "INVALID_RECEIPT_ID")
		return
	}
	if h.receipts == nil {
		denied(w, 503, "RECEIPTS_NOT_CONFIGURED")
		return
	}
	record, ok := h.receipts.Get(in.ID)
	if !ok {
		denied(w, 404, "RECEIPT_NOT_FOUND")
		return
	}
	h.sendAuthorizedJSON(w, r, map[string]any{"historical": true, "authority": false, "receipt": record})
}
func (h *helper) nativeStatus(w http.ResponseWriter, r *http.Request) {
	var empty struct{}
	if !decode(w, r, &empty) {
		return
	}
	result := map[string]any{"native": nil, "browserIdentityVerified": false, "note": "Kernel credentials authenticate the helper's native self-connection; browser identity and management approval are not established."}
	if h.ipcDirectory == "" {
		result["code"] = "NATIVE_UNAVAILABLE"
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		response, err := localipc.Call(ctx, h.ipcDirectory, localipc.Request{Version: localipc.Version, ID: randomToken(), Operation: "status"})
		if err != nil {
			result["code"] = "NATIVE_UNAVAILABLE"
		} else {
			result["native"] = response
		}
	}
	h.sendAuthorizedJSON(w, r, result)
}
