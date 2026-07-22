package payproduct

import (
	"crypto/subtle"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
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
func (s *Server) Handler() http.Handler { return securityHeaders(s.mux) }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("POST /v1/merchants/onboard", s.onboard)
	s.mux.HandleFunc("POST /v1/merchant/sessions", s.merchantSession)
	s.mux.HandleFunc("POST /v1/merchant/members", s.merchantMember)
	s.mux.HandleFunc("GET /v1/invoices/{id}", s.invoice)
	s.mux.HandleFunc("POST /v1/invoices/{id}/settlements", s.settlement)
	s.mux.HandleFunc("POST /v1/invoices/{id}/refund-requests", s.refund)
	s.mux.HandleFunc("POST /v1/invoices/{id}/disputes", s.dispute)
	s.mux.HandleFunc("GET /v1/merchant/state", s.merchantState)
	s.mux.HandleFunc("POST /v1/merchant/catalog", s.catalog)
	s.mux.HandleFunc("POST /v1/merchant/invoices", s.createInvoice)
	s.mux.HandleFunc("PUT /v1/merchant/webhook", s.webhook)
	s.mux.HandleFunc("POST /v1/merchant/webhook/rotate", s.rotate)
	s.mux.HandleFunc("POST /v1/merchant/webhooks/{id}/retry", s.retryWebhook)
	s.mux.HandleFunc("GET /v1/merchant/analytics", s.analytics)
	s.mux.HandleFunc("GET /v1/merchant/reconciliation.csv", s.exportCSV)
	s.mux.HandleFunc("POST /v1/merchant/ai/runs", s.aiRun)
	s.mux.HandleFunc("POST /v1/merchant/ai/runs/{id}/review", s.aiReview)
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
	p, _, ok := s.merchantAuth(w, r, "webhook")
	if !ok {
		return
	}
	state, err := s.service.SnapshotForMerchant(p.Merchant.ID)
	if err == nil {
		if _, ok := state.Deliveries[r.PathValue("id")]; !ok {
			err = errors.New("webhook delivery not found")
		}
	}
	if err != nil {
		respond(w, 0, nil, err)
		return
	}
	out, err := s.service.Deliver(r.Context(), r.PathValue("id"))
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
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=ynx-pay-reconciliation.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"invoice_id", "central_invoice_id", "merchant_id", "amount_ynxt", "fee_ynxt", "status", "transaction_hash", "block_number", "created_at", "expires_at"})
	for _, v := range items {
		tx := ""
		block := ""
		if v.Settlement != nil {
			tx = v.Settlement.TransactionHash
			block = strconv.FormatUint(v.Settlement.BlockNumber, 10)
		}
		_ = cw.Write([]string{v.ID, v.CentralID, v.MerchantID, strconv.FormatInt(v.Amount, 10), strconv.FormatInt(v.Fee, 10), v.Status, tx, block, v.CreatedAt.Format(time.RFC3339), v.ExpiresAt.Format(time.RFC3339)})
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
