package commerce

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxBody = 1 << 20

type ServerConfig struct {
	Auth                      AuthConfig
	Pay                       HTTPPayVerifier
	AI                        HTTPAIGateway
	BuyerAssets, SellerAssets http.FileSystem
}
type Server struct {
	store *Store
	cfg   ServerConfig
	mux   *http.ServeMux
}

func NewServer(store *Store, cfg ServerConfig) *Server {
	s := &Server{store: store, cfg: cfg, mux: http.NewServeMux()}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return s.security(s.mux) }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /api/capabilities", s.capabilities)
	s.mux.HandleFunc("POST /api/auth/challenges", s.challenge)
	s.mux.HandleFunc("POST /api/auth/sessions", s.session)
	s.mux.HandleFunc("GET /api/products", s.products)
	s.mux.HandleFunc("GET /api/products/{id}", s.product)
	s.mux.HandleFunc("GET /api/stores/{id}", s.publicStore)
	s.mux.HandleFunc("GET /api/profile", s.profile)
	s.mux.HandleFunc("PUT /api/profile", s.saveProfile)
	s.mux.HandleFunc("GET /api/cart", s.cart)
	s.mux.HandleFunc("PUT /api/cart", s.saveCart)
	s.mux.HandleFunc("GET /api/orders", s.orders)
	s.mux.HandleFunc("POST /api/orders", s.createOrder)
	s.mux.HandleFunc("GET /api/orders/{id}", s.order)
	s.mux.HandleFunc("POST /api/orders/{id}/pay-handoff", s.payHandoff)
	s.mux.HandleFunc("POST /api/orders/{id}/confirm-payment", s.confirmPayment)
	s.mux.HandleFunc("POST /api/orders/{id}/transition", s.orderTransition)
	s.mux.HandleFunc("POST /api/seller/stores", s.createStore)
	s.mux.HandleFunc("GET /api/seller/stores", s.sellerStores)
	s.mux.HandleFunc("PUT /api/seller/stores/{id}", s.updateStore)
	s.mux.HandleFunc("POST /api/seller/stores/{id}/activate", s.activateStore)
	s.mux.HandleFunc("GET /api/seller/stores/{id}/roles", s.roles)
	s.mux.HandleFunc("PUT /api/seller/stores/{id}/roles", s.setRole)
	s.mux.HandleFunc("POST /api/seller/products", s.createProduct)
	s.mux.HandleFunc("GET /api/seller/products", s.sellerProducts)
	s.mux.HandleFunc("POST /api/seller/products/{id}/publish", s.publishProduct)
	s.mux.HandleFunc("POST /api/seller/inventory", s.inventory)
	s.mux.HandleFunc("GET /api/seller/audit", s.audit)
	s.mux.HandleFunc("GET /api/seller/settlements", s.settlements)
	s.mux.HandleFunc("POST /api/ai/jobs", s.createAI)
	s.mux.HandleFunc("POST /api/ai/jobs/{id}/run", s.runAI)
	s.mux.HandleFunc("POST /api/ai/jobs/{id}/decision", s.decideAI)
	s.mux.HandleFunc("POST /api/ai/jobs/{id}/cancel", s.cancelAI)
	s.mux.HandleFunc("GET /api/ai/jobs/{id}/stream", s.streamAI)
	s.mux.HandleFunc("DELETE /api/ai/jobs/{id}", s.deleteAI)
	if s.cfg.BuyerAssets != nil {
		s.mux.Handle("/shop/", http.StripPrefix("/shop/", http.FileServer(s.cfg.BuyerAssets)))
	}
	if s.cfg.SellerAssets != nil {
		s.mux.Handle("/seller/", http.StripPrefix("/seller/", http.FileServer(s.cfg.SellerAssets)))
	}
}
func (s *Server) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && !s.store.Allow(r.RemoteAddr, "http.mutation", 240, time.Minute) {
			fail(w, http.StatusTooManyRequests, errors.New("mutation rate limit exceeded"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	write(w, 200, map[string]any{"ok": true, "service": "ynx-shopd", "chainId": ChainID, "chain": ChainName, "nativeSymbol": NativeSymbol, "persistence": s.store.path != ""})
}
func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	write(w, 200, map[string]any{"walletAuth": "signature_required", "paySettlement": availability(s.cfg.Pay.BaseURL != "" && s.cfg.Pay.APIKey != ""), "logistics": "unavailable", "tax": "unavailable", "aiProvider": availability(s.cfg.AI.BaseURL != "" && s.cfg.AI.APIKey != ""), "trustEvidence": "link_only", "protectedAIActions": []string{"publish_product", "change_price", "purchase", "refund", "change_seller_policy"}})
}
func availability(ok bool) string {
	if ok {
		return "available"
	}
	return "unavailable"
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		fail(w, 400, err)
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		fail(w, 400, errors.New("single JSON object required"))
		return false
	}
	return true
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, err error) {
	write(w, status, map[string]string{"error": err.Error()})
}
func status(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return 404
	case errors.Is(err, ErrUnauthorized):
		return 403
	case errors.Is(err, ErrConflict), errors.Is(err, ErrInvalidState), errors.Is(err, ErrInventory):
		return 409
	case errors.Is(err, ErrUnavailable):
		return 503
	default:
		return 400
	}
}
func (s *Server) auth(w http.ResponseWriter, r *http.Request, roles ...string) (Session, bool) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	sess, err := s.store.Authenticate(token)
	if err != nil {
		fail(w, 401, err)
		return Session{}, false
	}
	for _, role := range roles {
		if sess.Role == role {
			return sess, true
		}
	}
	fail(w, 403, ErrUnauthorized)
	return Session{}, false
}
func (s *Server) rate(w http.ResponseWriter, r *http.Request, actor, action string) bool {
	subject := actor
	if subject == "" {
		subject = r.RemoteAddr
	}
	if !s.store.Allow(subject, action, 60, time.Minute) {
		fail(w, 429, errors.New("rate limit exceeded"))
		return false
	}
	return true
}

func (s *Server) challenge(w http.ResponseWriter, r *http.Request) {
	if !s.rate(w, r, "", "auth.challenge") {
		return
	}
	var in ChallengeInput
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.CreateChallenge(in, s.cfg.Auth)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 201, map[string]any{"challenge": v, "signBytes": string(challengeSignBytes(v))})
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	if !s.rate(w, r, "", "auth.session") {
		return
	}
	var in SessionInput
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.CompleteSession(in, s.cfg.Auth)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 201, v)
}
func (s *Server) products(w http.ResponseWriter, r *http.Request) {
	write(w, 200, map[string]any{"products": s.store.Products(r.URL.Query().Get("q"), r.URL.Query().Get("category"))})
}
func (s *Server) product(w http.ResponseWriter, r *http.Request) {
	v, err := s.store.Product(r.PathValue("id"))
	if err != nil || !v.Published {
		fail(w, 404, ErrNotFound)
		return
	}
	write(w, 200, v)
}
func (s *Server) publicStore(w http.ResponseWriter, r *http.Request) {
	v, err := s.store.PublicStore(r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	write(w, 200, map[string]any{"account": sess.Account, "role": sess.Role, "sessionExpiresAt": sess.ExpiresAt, "chain": ChainName, "profile": s.store.Profile(sess.Account)})
}
func (s *Server) saveProfile(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer")
	if !ok {
		return
	}
	var in struct {
		DisplayName string
		Addresses   []Address
	}
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.SaveProfile(sess.Account, in.DisplayName, in.Addresses)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) cart(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer")
	if !ok {
		return
	}
	write(w, 200, s.store.Cart(sess.Account))
}
func (s *Server) saveCart(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer")
	if !ok {
		return
	}
	var in struct{ Items []CartItem }
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.SaveCart(sess.Account, in.Items)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) orders(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	write(w, 200, map[string]any{"orders": s.store.Orders(sess.Account, sess.Role)})
}
func (s *Server) order(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	v, err := s.store.Order(sess.Account, sess.Role, r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) createOrder(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer")
	if !ok || !s.rate(w, r, sess.Account, "order.create") {
		return
	}
	var in OrderInput
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.CreateOrder(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 201, v)
}
func (s *Server) payHandoff(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer")
	if !ok {
		return
	}
	var in struct{ IdempotencyKey string }
	if !decode(w, r, &in) {
		return
	}
	o, err := s.store.Order(sess.Account, "buyer", r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	invoice, deepLink, err := s.cfg.Pay.CreateInvoice(r.Context(), o, in.IdempotencyKey)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	o, err = s.store.BindInvoice(sess.Account, o.ID, invoice)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 201, map[string]any{"order": o, "invoiceId": invoice, "deepLink": deepLink, "status": "payment_pending"})
}
func (s *Server) confirmPayment(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer")
	if !ok {
		return
	}
	o, err := s.store.Order(sess.Account, "buyer", r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	if o.InvoiceID == "" {
		fail(w, 409, ErrInvalidState)
		return
	}
	e, err := s.cfg.Pay.Settlement(r.Context(), o.InvoiceID)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	v, err := s.store.ConfirmSettlement(o.ID, e)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) orderTransition(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	var in struct {
		Action, Carrier, TrackingNumber, Reason, Explanation, Body, IdempotencyKey string
		Rating                                                                     int
	}
	if !decode(w, r, &in) {
		return
	}
	var ship *Shipment
	var res *Resolution
	var review *Review
	if in.Action == "shipped" {
		ship = &Shipment{Carrier: in.Carrier, TrackingNumber: in.TrackingNumber}
	}
	if strings.Contains(in.Action, "return") || strings.Contains(in.Action, "refund") || in.Action == "disputed" {
		res = &Resolution{Kind: strings.Split(in.Action, "_")[0], Reason: in.Reason, Explanation: in.Explanation}
	}
	if in.Action == "reviewed" {
		review = &Review{Rating: in.Rating, Body: in.Body}
	}
	v, err := s.store.transition(sess.Account, sess.Role, r.PathValue("id"), in.Action, ship, res, review, in.IdempotencyKey)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}

func (s *Server) createStore(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in CreateStoreInput
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.CreateStore(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 201, v)
}
func (s *Server) sellerStores(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	write(w, 200, map[string]any{"stores": s.store.SellerStores(sess.Account)})
}
func (s *Server) updateStore(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in StoreUpdate
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.UpdateStore(sess.Account, r.PathValue("id"), in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) roles(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	v, err := s.store.SellerRoles(sess.Account, r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, map[string]any{"roles": v})
}
func (s *Server) setRole(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in struct{ Account, Role string }
	if !decode(w, r, &in) {
		return
	}
	if err := s.store.SetSellerRole(sess.Account, r.PathValue("id"), in.Account, in.Role); err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, map[string]string{"status": "updated"})
}
func (s *Server) activateStore(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	v, err := s.store.ActivateStore(sess.Account, r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) createProduct(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in CreateProductInput
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.CreateProduct(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 201, v)
}
func (s *Server) sellerProducts(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	v, err := s.store.SellerProducts(sess.Account, r.URL.Query().Get("storeId"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, map[string]any{"products": v})
}
func (s *Server) publishProduct(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	v, err := s.store.PublishProduct(sess.Account, r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) inventory(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in InventoryInput
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.SetInventory(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	events, err := s.store.SellerAudit(sess.Account)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, map[string]any{"events": events})
}
func (s *Server) settlements(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	write(w, 200, map[string]any{"settlements": s.store.Settlements(sess.Account)})
}
func (s *Server) createAI(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	var in AIInput
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.CreateAIJob(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 201, v)
}
func (s *Server) runAI(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	v, err := s.store.RunAIJob(r.Context(), sess.Account, r.PathValue("id"), s.cfg.AI)
	if err != nil {
		fail(w, status(err), fmt.Errorf("AI generation failed: %w", err))
		return
	}
	write(w, 200, v)
}
func (s *Server) decideAI(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	var in struct{ Decision string }
	if !decode(w, r, &in) {
		return
	}
	v, err := s.store.DecideAIJob(sess.Account, r.PathValue("id"), in.Decision)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) cancelAI(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	v, err := s.store.CancelAIJob(sess.Account, r.PathValue("id"))
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, v)
}
func (s *Server) streamAI(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, errors.New("streaming unavailable"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	for i := 0; i < 120; i++ {
		j, err := s.store.AIJob(sess.Account, r.PathValue("id"))
		if err != nil {
			fmt.Fprintf(w, "event: error\ndata: %q\n\n", err.Error())
			flusher.Flush()
			return
		}
		data, _ := json.Marshal(j)
		fmt.Fprintf(w, "event: status\ndata: %s\n\n", data)
		flusher.Flush()
		if j.Status != "permission_granted" && j.Status != "running" {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}
func (s *Server) deleteAI(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "buyer", "seller")
	if !ok {
		return
	}
	if err := s.store.DeleteAIJob(sess.Account, r.PathValue("id")); err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, map[string]string{"status": "deleted"})
}
