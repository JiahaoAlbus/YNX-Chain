package payproduct

import (
	"bytes"
	"crypto/subtle"
	"encoding/csv"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxRequestBytes = 1 << 20

type Server struct {
	service *Service
	mux     *http.ServeMux
}

func NewServer(service *Service) *Server {
	s := &Server{service: service, mux: http.NewServeMux()}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return s.ObservedHandler() }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /v1/settlement-assets", s.settlementAssets)
	s.mux.HandleFunc("POST /v1/merchants/onboard", s.onboard)
	s.mux.HandleFunc("POST /v1/merchant/sessions", s.merchantSession)
	s.mux.HandleFunc("POST /v1/merchant/members", s.merchantMember)
	s.mux.HandleFunc("GET /v1/invoices/{id}", s.invoice)
	s.mux.HandleFunc("POST /v1/invoices/{id}/settlements", s.settlement)
	s.mux.HandleFunc("POST /v1/invoices/{id}/refund-requests", s.refund)
	s.mux.HandleFunc("POST /v1/invoices/{id}/disputes", s.dispute)
	s.mux.HandleFunc("POST /v1/invoices/{id}/sponsorship-quotes", s.sponsorshipQuote)
	s.mux.HandleFunc("POST /v1/sponsorships/{id}/receipts", s.sponsorshipReceipt)
	s.mux.HandleFunc("POST /v1/invoices/{id}/route-quotes", s.routeQuote)
	s.mux.HandleFunc("POST /v1/route-quotes/{id}/select", s.routeSelect)
	s.mux.HandleFunc("POST /v1/bridge-transfers/{id}/refresh", s.bridgeRefresh)
	s.mux.HandleFunc("GET /v1/split-payments/{id}", s.splitPayment)
	s.mux.HandleFunc("POST /v1/split-payments/{id}/shares/{shareId}/claim", s.claimSplitShare)
	s.mux.HandleFunc("GET /v1/quant-bills/{id}", s.quantBill)
	s.mux.HandleFunc("GET /v1/merchant/state", s.merchantState)
	s.mux.HandleFunc("POST /v1/merchant/catalog", s.catalog)
	s.mux.HandleFunc("POST /v1/merchant/invoices", s.createInvoice)
	s.mux.HandleFunc("POST /v1/merchant/split-payments", s.createSplitPayment)
	s.mux.HandleFunc("POST /v1/merchant/quant-bills", s.createQuantBill)
	s.mux.HandleFunc("POST /v1/merchant/recurring-drafts", s.createRecurringDraft)
	s.mux.HandleFunc("PUT /v1/merchant/webhook", s.webhook)
	s.mux.HandleFunc("POST /v1/merchant/webhook/rotate", s.rotate)
	s.mux.HandleFunc("POST /v1/merchant/webhooks/{id}/retry", s.retryWebhook)
	s.mux.HandleFunc("POST /v1/merchant/refunds/{id}/submit", s.submitRefund)
	s.mux.HandleFunc("POST /v1/merchant/refunds/{id}/refresh", s.refreshRefund)
	s.mux.HandleFunc("GET /v1/merchant/analytics", s.analytics)
	s.mux.HandleFunc("GET /v1/merchant/reconciliation.csv", s.exportCSV)
	s.mux.HandleFunc("POST /v1/merchant/ai/runs", s.aiRun)
	s.mux.HandleFunc("POST /v1/merchant/ai/runs/{id}/review", s.aiReview)
}
func (s *Server) settlementAssets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"assets": s.service.SettlementAssets(), "fiatIsOnChainAsset": false})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "service": "ynx-pay-product", "network": ChainID, "evmChainId": EVMChainID, "asset": NativeAsset, "feeYnxt": NativeFeeYNXT, "crossChainSettlement": "unavailable", "paidEvidence": "authoritative-central-pay-api"})
}
func (s *Server) onboard(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-YNX-Bootstrap-Key")), []byte(s.service.bootstrap)) != 1 {
		writeError(w, 401, "valid merchant bootstrap key required")
		return
	}
	var in OnboardInput
	if !decode(w, r, &in) {
		return
	}
	out, err := s.service.Onboard(in)
	respond(w, 201, out, err)
}
func (s *Server) merchantSession(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	var in struct {
		MerchantID string `json:"merchantId"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CompleteMerchantSession(r, body, in.MerchantID)
	respond(w, 201, out, err)
}
func (s *Server) merchantMember(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "members")
	if !ok {
		return
	}
	var in struct {
		Account string `json:"account"`
		Role    string `json:"role"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.UpsertMerchantMember(p, in.Account, in.Role)
	respond(w, 200, out, err)
}
func (s *Server) invoice(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.Invoice(r.Context(), r.PathValue("id"))
	out = publicInvoice(out)
	respond(w, 200, out, err)
}
func (s *Server) settlement(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in struct {
		Intent         SignedPaymentIntent `json:"intent"`
		Result         WalletPaymentResult `json:"result"`
		IdempotencyKey string              `json:"idempotencyKey"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.SubmitSignedSettlement(r.Context(), session, r.PathValue("id"), in.Intent, in.Result, in.IdempotencyKey)
	respond(w, 201, out, err)
}
func (s *Server) refund(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in struct {
		Amount         int64  `json:"amount"`
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateRefundRequest(session, r.PathValue("id"), in.Amount, in.Reason, in.IdempotencyKey)
	respond(w, 201, out, err)
}
func (s *Server) dispute(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in struct {
		Reason         string   `json:"reason"`
		TrustEvidence  []string `json:"trustEvidence"`
		IdempotencyKey string   `json:"idempotencyKey"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateDispute(session, r.PathValue("id"), in.Reason, in.IdempotencyKey, in.TrustEvidence)
	respond(w, 201, out, err)
}
func (s *Server) sponsorshipQuote(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in SponsorshipInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.RequestSponsorship(r.Context(), session, r.PathValue("id"), in)
	respond(w, 201, out, err)
}
func (s *Server) sponsorshipReceipt(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in struct {
		UserOperationHash string `json:"userOperationHash"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.ConfirmSponsorship(r.Context(), session, r.PathValue("id"), in.UserOperationHash)
	respond(w, 200, out, err)
}
func (s *Server) routeQuote(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in RouteQuoteInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateRouteQuote(r.Context(), session, r.PathValue("id"), in)
	respond(w, 201, out, err)
}
func (s *Server) routeSelect(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in struct {
		OptionID string `json:"optionId"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.SelectRoute(session, r.PathValue("id"), in.OptionID)
	respond(w, 200, out, err)
}
func (s *Server) bridgeRefresh(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	if len(bytes.TrimSpace(body)) != 0 && string(bytes.TrimSpace(body)) != "{}" {
		writeError(w, 400, "bridge refresh body must be empty")
		return
	}
	out, err := s.service.RefreshBridge(r.Context(), session, r.PathValue("id"))
	respond(w, 200, out, err)
}
func (s *Server) merchantState(w http.ResponseWriter, r *http.Request) {
	p, _, ok := s.merchantAuth(w, r, "read")
	if !ok {
		return
	}
	out, err := s.service.SnapshotForMerchant(p.Merchant.ID)
	respond(w, 200, out, err)
}
func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "invoice")
	if !ok {
		return
	}
	var in CatalogInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateCatalog(p.Merchant, in)
	respond(w, 201, out, err)
}
func (s *Server) createInvoice(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "invoice")
	if !ok {
		return
	}
	var in InvoiceInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateInvoice(r.Context(), p.Merchant, in)
	respond(w, 201, out, err)
}
func (s *Server) createSplitPayment(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "invoice")
	if !ok {
		return
	}
	var in SplitPaymentInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateSplitPayment(p.Merchant, in)
	respond(w, 201, out, err)
}
func (s *Server) splitPayment(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.SplitPayment(r.Context(), r.PathValue("id"))
	out = publicSplitPayment(out)
	respond(w, 200, out, err)
}
func (s *Server) claimSplitShare(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return
	}
	session, err := s.service.VerifyPayGateway(r, body)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	var in struct {
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.ClaimSplitShare(r.Context(), session, r.PathValue("id"), r.PathValue("shareId"), in.IdempotencyKey)
	out = publicSplitPayment(out)
	respond(w, 201, out, err)
}
func (s *Server) quantBill(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.QuantBill(r.Context(), r.PathValue("id"))
	out = publicQuantBill(out)
	respond(w, 200, out, err)
}
func (s *Server) createQuantBill(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "invoice")
	if !ok {
		return
	}
	if p.Role != "owner" && p.Role != "finance" {
		writeError(w, 403, "owner or finance role required for Quant billing")
		return
	}
	var in QuantBillInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateQuantBill(r.Context(), p.Merchant, in)
	out = publicQuantBill(out)
	respond(w, 201, out, err)
}
func (s *Server) createRecurringDraft(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "invoice")
	if !ok {
		return
	}
	if p.Role != "owner" && p.Role != "finance" {
		writeError(w, 403, "owner or finance role required for recurring draft")
		return
	}
	var in RecurringDraftInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.CreateRecurringDraft(p.Merchant, in)
	respond(w, 201, out, err)
}
func (s *Server) webhook(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "webhook")
	if !ok {
		return
	}
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	err := s.service.SetWebhook(p.Merchant, in.Endpoint)
	respond(w, 200, map[string]string{"status": "updated"}, err)
}
func (s *Server) rotate(w http.ResponseWriter, r *http.Request) {
	p, _, ok := s.merchantAuth(w, r, "webhook")
	if !ok {
		return
	}
	_, err := s.service.RotateWebhookSecret(p.Merchant)
	respond(w, 200, map[string]string{"status": "rotated", "secretDelivery": "server-side secret manager only"}, err)
}
func (s *Server) retryWebhook(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "webhook")
	if !ok {
		return
	}
	var in struct {
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	queued, err := s.service.ManualReplayWebhook(p, r.PathValue("id"), in.Reason, in.IdempotencyKey)
	if err != nil {
		respond(w, 0, nil, err)
		return
	}
	out, err := s.service.Deliver(r.Context(), queued.ID)
	respond(w, 201, out, err)
}
func (s *Server) submitRefund(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "refund")
	if !ok {
		return
	}
	var in struct {
		Authorization  RefundAuthorization `json:"authorization"`
		IdempotencyKey string              `json:"idempotencyKey"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.SubmitRefundAuthorization(r.Context(), p, r.PathValue("id"), in.Authorization, in.IdempotencyKey)
	respond(w, 201, out, err)
}
func (s *Server) refreshRefund(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "case")
	if !ok {
		return
	}
	if len(bytes.TrimSpace(body)) != 0 && string(bytes.TrimSpace(body)) != "{}" {
		writeError(w, 400, "refund refresh body must be empty")
		return
	}
	out, err := s.service.RefreshRefund(r.Context(), p, r.PathValue("id"))
	respond(w, 200, out, err)
}
func (s *Server) analytics(w http.ResponseWriter, r *http.Request) {
	p, _, ok := s.merchantAuth(w, r, "read")
	if !ok {
		return
	}
	out, err := s.service.Analytics(p.Merchant.ID)
	respond(w, 200, out, err)
}
func (s *Server) exportCSV(w http.ResponseWriter, r *http.Request) {
	p, _, ok := s.merchantAuth(w, r, "reconcile")
	if !ok {
		return
	}
	items, err := s.service.Export(p.Merchant.ID)
	if err != nil {
		respond(w, 0, nil, err)
		return
	}
	state, err := s.service.SnapshotForMerchant(p.Merchant.ID)
	if err != nil {
		respond(w, 0, nil, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=ynx-pay-reconciliation.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"invoice_id", "central_invoice_id", "merchant_id", "amount_ynxt", "fee_ynxt", "refunded_ynxt", "merchant_net_ynxt", "status", "transaction_hash", "block_number", "refund_receipts", "created_at", "expires_at"})
	for _, v := range items {
		tx := ""
		block := ""
		refunded := int64(0)
		refundReceipts := []string{}
		if v.Settlement != nil {
			tx = v.Settlement.TransactionHash
			block = strconv.FormatUint(v.Settlement.BlockNumber, 10)
		}
		for _, refund := range state.Refunds {
			if refund.InvoiceID == v.ID && refund.Status == "refunded" && refund.Evidence != nil {
				refunded += refund.Amount
				refundReceipts = append(refundReceipts, refund.Evidence.ReceiptID)
			}
		}
		sort.Strings(refundReceipts)
		_ = cw.Write([]string{v.ID, v.CentralID, v.MerchantID, strconv.FormatInt(v.Amount, 10), strconv.FormatInt(v.Fee, 10), strconv.FormatInt(refunded, 10), strconv.FormatInt(v.Amount-refunded, 10), v.Status, tx, block, strings.Join(refundReceipts, ";"), v.CreatedAt.Format(time.RFC3339), v.ExpiresAt.Format(time.RFC3339)})
	}
	cw.Flush()
}
func (s *Server) aiRun(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "ai-run")
	if !ok {
		return
	}
	var in AIRunInput
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.StartAI(r.Context(), p.Merchant, in)
	respond(w, 201, out, err)
}
func (s *Server) aiReview(w http.ResponseWriter, r *http.Request) {
	p, body, ok := s.merchantAuth(w, r, "ai-review")
	if !ok {
		return
	}
	var in struct {
		Decision string `json:"decision"`
	}
	if !decodeBytes(w, body, &in) {
		return
	}
	out, err := s.service.ReviewAI(p.Merchant, r.PathValue("id"), in.Decision)
	respond(w, 200, out, err)
}
func (s *Server) merchantAuth(w http.ResponseWriter, r *http.Request, permission string) (MerchantPrincipal, []byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return MerchantPrincipal{}, nil, false
	}
	p, err := s.service.AuthenticateMerchantSession(r.Header.Get("Authorization"))
	if err != nil {
		writeError(w, 401, err.Error())
		return MerchantPrincipal{}, nil, false
	}
	if !roleAllows(p.Role, permission) {
		writeError(w, 403, "merchant role does not allow this operation")
		return MerchantPrincipal{}, nil, false
	}
	w.Header().Set("X-YNX-Merchant-Role", p.Role)
	return p, body, true
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err != nil {
		writeError(w, 413, "request body exceeds limit")
		return false
	}
	return decodeBytes(w, raw, out)
}
func decodeBytes(w http.ResponseWriter, raw []byte, out any) bool {
	if err := strictJSON(raw, out); err != nil {
		writeError(w, 400, "invalid request: "+err.Error())
		return false
	}
	return true
}
func respond(w http.ResponseWriter, status int, value any, err error) {
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	writeJSON(w, status, value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
