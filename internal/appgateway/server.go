package appgateway

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

type Server struct {
	gateway *Gateway
	client  *http.Client
	build   buildinfo.Info
}

const appGatewayUpstreamTimeout = 30 * time.Second

type upstreamHealth struct {
	OK             bool           `json:"ok"`
	Service        string         `json:"service"`
	RemoteDeployed bool           `json:"remoteDeployed"`
	TruthfulStatus string         `json:"truthfulStatus"`
	Build          buildinfo.Info `json:"build"`
}

type Health struct {
	OK              bool                      `json:"ok"`
	Service         string                    `json:"service"`
	BrowserBoundary string                    `json:"browserBoundary"`
	NativeBoundary  string                    `json:"nativeBoundary"`
	NativeProducts  []string                  `json:"nativeProducts"`
	WalletBoundary  string                    `json:"walletBoundary"`
	OwnershipProof  string                    `json:"ownershipProof"`
	SessionStorage  string                    `json:"sessionStorage"`
	ActiveSessions  int                       `json:"activeSessions"`
	RemoteDeployed  bool                      `json:"remoteDeployed"`
	Upstreams       map[string]upstreamHealth `json:"upstreams"`
	TruthfulStatus  string                    `json:"truthfulStatus"`
	Build           buildinfo.Info            `json:"build"`
}

func NewServer(gateway *Gateway) *Server {
	return NewServerWithBuild(gateway, buildinfo.Info{})
}

func NewServerWithBuild(gateway *Gateway, build buildinfo.Info) *Server {
	return &Server{gateway: gateway, client: &http.Client{Timeout: appGatewayUpstreamTimeout}, build: buildinfo.Normalize(build)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/app/health", s.appHealth)
	mux.HandleFunc("/app/", s.app)
	mux.HandleFunc("/v1/wallet/", s.wallet)
	return securityHeaders(mux)
}

func (s *Server) appHealth(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && !s.gateway.OriginAllowed(origin) {
		writeError(w, http.StatusForbidden, "origin is not allowed")
		return
	}
	if origin != "" {
		setCORS(w, origin)
	}
	s.health(w, r)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	upstreams := map[string]upstreamHealth{}
	ok := true
	services := []string{"chat", "square", "pay", "social", "bridge", "wallet"}
	if s.gateway.payProductURL != nil {
		services = append(services, "pay-product")
	}
	for _, service := range services {
		base, _, _, _ := s.gateway.upstream(service)
		if base == nil {
			ok = false
			upstreams[service] = upstreamHealth{OK: false, Service: service, TruthfulStatus: "upstream-unavailable"}
			continue
		}
		request, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, base.String()+"/health", nil)
		response, err := s.client.Do(request)
		if err != nil {
			ok = false
			upstreams[service] = upstreamHealth{OK: false, Service: service, TruthfulStatus: "upstream-unreachable"}
			continue
		}
		var health upstreamHealth
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&health)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || decodeErr != nil || !health.OK {
			ok = false
			health.OK = false
			if health.Service == "" {
				health.Service = service
			}
			if health.TruthfulStatus == "" {
				health.TruthfulStatus = "upstream-unhealthy"
			}
		}
		upstreams[service] = health
	}
	status := "local-first-party-app-gateway-not-remote-deployed"
	if s.gateway.cfg.RemoteDeployed {
		status = "remote-first-party-app-gateway"
	}
	health := Health{OK: ok, Service: "ynx-app-gatewayd", BrowserBoundary: "exact-https-origin", NativeBoundary: "explicit-product-client-bindings", NativeProducts: []string{nativeMobileClient, nativeSocialClient, nativeWalletClient}, WalletBoundary: "p256-product-session-proof", OwnershipProof: "ynx1-secp256k1-plus-ed25519-device", SessionStorage: "integrity-checked-atomic-mode-0600-token-hashes-only", ActiveSessions: s.gateway.ActiveSessionCount(), RemoteDeployed: s.gateway.cfg.RemoteDeployed, Upstreams: upstreams, TruthfulStatus: status, Build: s.build}
	code := http.StatusOK
	if !ok {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, health)
}

func (s *Server) wallet(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && !s.gateway.OriginAllowed(origin) {
		writeError(w, http.StatusForbidden, "origin is not allowed")
		return
	}
	if origin != "" {
		setCORS(w, origin)
	}
	if r.Method == http.MethodOptions {
		s.walletPreflight(w, r)
		return
	}
	if !s.gateway.Allow(r.RemoteAddr) {
		writeError(w, http.StatusTooManyRequests, "app gateway rate limit exceeded")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, s.gateway.cfg.MaxBodyBytes+1))
	if err != nil || int64(len(body)) > s.gateway.cfg.MaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "canonical Wallet request exceeds gateway policy")
		return
	}
	upstreamURL := *s.gateway.walletURL
	upstreamURL.Path, upstreamURL.RawPath, upstreamURL.RawQuery = r.URL.Path, r.URL.RawPath, r.URL.RawQuery
	request, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL.String(), bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusBadGateway, "unable to construct canonical Wallet request")
		return
	}
	for _, header := range []string{"Accept", "Content-Type", "X-YNX-Product-Session-Proof"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			request.Header.Set(header, value)
		}
	}
	response, err := s.client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "canonical Wallet Gateway unavailable")
		return
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, s.gateway.cfg.MaxResponseBytes+1))
	if err != nil || int64(len(responseBody)) > s.gateway.cfg.MaxResponseBytes {
		writeError(w, http.StatusBadGateway, "canonical Wallet response exceeds gateway policy")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(responseBody)
}

func (s *Server) walletPreflight(w http.ResponseWriter, r *http.Request) {
	if strings.ToUpper(strings.TrimSpace(r.Header.Get("Access-Control-Request-Method"))) != http.MethodPost {
		writeError(w, http.StatusForbidden, "canonical Wallet preflight method is not allowed")
		return
	}
	for _, raw := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
		header := http.CanonicalHeaderKey(strings.TrimSpace(raw))
		if header != "" && header != "Accept" && header != "Content-Type" && header != "X-Ynx-Product-Session-Proof" {
			writeError(w, http.StatusForbidden, fmt.Sprintf("canonical Wallet preflight header %s is not allowed", header))
			return
		}
	}
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, X-YNX-Product-Session-Proof")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) app(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	binding, allowed := s.gateway.ClientBinding(origin, r.Header.Get("X-YNX-Client"))
	if !allowed {
		writeError(w, http.StatusForbidden, "browser origin or native client binding is not allowed")
		return
	}
	if origin != "" {
		setCORS(w, origin)
	}
	if r.Method == http.MethodOptions {
		s.preflight(w, r)
		return
	}
	if !s.gateway.Allow(r.RemoteAddr) {
		writeError(w, http.StatusTooManyRequests, "app gateway rate limit exceeded")
		return
	}
	if strings.HasPrefix(r.URL.EscapedPath(), "/app/session/") {
		s.session(w, r, binding)
		return
	}
	if strings.HasPrefix(r.URL.EscapedPath(), "/app/pay-product/") {
		s.payProduct(w, r)
		return
	}
	if strings.HasPrefix(r.URL.EscapedPath(), "/app/pay-merchant/") {
		s.payMerchant(w, r)
		return
	}
	service, upstreamPath, ok := resolveAppPath(r.URL.EscapedPath())
	if !ok {
		writeError(w, http.StatusNotFound, "app route not found")
		return
	}
	if !productRouteAllowed(binding, service) {
		writeError(w, http.StatusNotFound, "app route not available to this product")
		return
	}
	public := publicRouteAllowed(service, r.Method, upstreamPath)
	protected := protectedRouteAllowed(service, r.Method, upstreamPath)
	if !public && !protected {
		writeError(w, http.StatusNotFound, "app route not found")
		return
	}
	if protected && service == "bridge" && upstreamPath == "/bridge/wallet-reviews" && !s.gateway.WalletReviewBindingAllowed(binding) {
		writeError(w, http.StatusNotFound, "Wallet review route not available to this product")
		return
	}
	var body []byte
	var err error
	if r.Body != nil {
		body, err = io.ReadAll(io.LimitReader(r.Body, s.gateway.cfg.MaxBodyBytes+1))
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "unable to read request body")
		return
	}
	if int64(len(body)) > s.gateway.cfg.MaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "request body exceeds gateway policy")
		return
	}
	var authenticatedSession AppSession
	if protected {
		if binding == "" {
			writeError(w, http.StatusUnauthorized, "browser origin or native client binding is required")
			return
		}
		var session AppSession
		if service == "bridge" && binding != nativeWalletBinding {
			session, err = s.authenticateBridgeProductSession(r, bridgeScope(r.Method, upstreamPath))
		} else {
			session, err = s.gateway.AuthenticateSession(binding, r.Header.Get("X-YNX-App-Session"), r.Header.Get("X-YNX-Device-ID"))
		}
		if err != nil {
			writeError(w, http.StatusUnauthorized, "account-bound Product Session proof required")
			return
		}
		authenticatedSession = session
		if r.Method == http.MethodPost && upstreamPath == "/"+service+"/devices" && !s.gateway.RegistrationMatchesSession(service, session, body) {
			writeError(w, http.StatusUnauthorized, "device registration does not match account-bound session")
			return
		}
		if service == "pay" && r.Method == http.MethodPost && strings.HasSuffix(upstreamPath, "/settle") {
			body, err = bindPayPayer(body, authenticatedSession.Account)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
	}
	base, key, keyHeader, ok := s.gateway.upstream(service)
	if !ok || base == nil {
		writeError(w, http.StatusServiceUnavailable, "target service route is unavailable")
		return
	}
	upstreamURL := *base
	upstreamURL.Path = appUpstreamPath(service, upstreamPath)
	upstreamURL.RawPath = ""
	upstreamURL.RawQuery = r.URL.RawQuery
	request, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL.String(), bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusBadGateway, "unable to construct upstream request")
		return
	}
	for _, header := range []string{"Accept", "Content-Type", "X-YNX-Device-ID", "X-YNX-Timestamp", "X-YNX-Device-Signature"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			request.Header.Set(header, value)
		}
	}
	request.Header.Set(keyHeader, key)
	request.Header.Set("X-YNX-App-Gateway", "1")
	if protected && service == "bridge" {
		request.Header.Set("X-YNX-App-Session-ID", authenticatedSession.ID)
		request.Header.Set("X-YNX-App-Session-Account", authenticatedSession.Account)
		request.Header.Set("X-YNX-App-Session-Device", authenticatedSession.DeviceID)
		request.Header.Set("X-YNX-App-Session-Expires-At", authenticatedSession.ExpiresAt.UTC().Format(time.RFC3339Nano))
		request.Header.Set("X-YNX-App-Product", productForBinding(binding))
		request.Header.Set("X-YNX-App-Scope", bridgeScope(r.Method, upstreamPath))
	}
	response, err := s.client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "upstream service unavailable")
		return
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, s.gateway.cfg.MaxResponseBytes+1))
	if err != nil || int64(len(responseBody)) > s.gateway.cfg.MaxResponseBytes {
		writeError(w, http.StatusBadGateway, "upstream response exceeds gateway policy")
		return
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(responseBody)
}

type payProductSession struct {
	Account        string
	SessionID      string
	DeviceID       string
	SessionBinding string
	RequestDigest  string
	Scopes         []string
	IssuedAt       time.Time
	ExpiresAt      time.Time
}

var payProductScopes = []string{"account:read", "pay:case:create", "pay:route:select", "pay:settlement:submit", "pay:sponsorship:request"}

func (s *Server) payProduct(w http.ResponseWriter, r *http.Request) {
	if s.gateway.payProductURL == nil || len(s.gateway.payProductAssertionKey) < 32 {
		writeError(w, http.StatusServiceUnavailable, "YNX Pay product service is unavailable")
		return
	}
	upstreamPath, scope, public, ok := payProductRoute(r.Method, r.URL.EscapedPath())
	if !ok {
		writeError(w, http.StatusNotFound, "Pay product route not found")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, s.gateway.cfg.MaxBodyBytes+1))
	if err != nil || int64(len(body)) > s.gateway.cfg.MaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "Pay product request exceeds gateway policy")
		return
	}
	var session payProductSession
	if !public {
		session, err = s.authenticatePayProductSession(r, scope)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "active YNX Pay Product Session proof required")
			return
		}
	}
	upstreamURL := *s.gateway.payProductURL
	upstreamURL.Path, upstreamURL.RawPath, upstreamURL.RawQuery = upstreamPath, "", r.URL.RawQuery
	request, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL.String(), bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusBadGateway, "unable to construct Pay product request")
		return
	}
	for _, header := range []string{"Accept", "Content-Type"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			request.Header.Set(header, value)
		}
	}
	if !public {
		if err := s.signPayProductAssertion(request, body, session); err != nil {
			writeError(w, http.StatusServiceUnavailable, "unable to create bounded Pay Gateway assertion")
			return
		}
	}
	response, err := s.client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "YNX Pay product service unavailable")
		return
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, s.gateway.cfg.MaxResponseBytes+1))
	if err != nil || int64(len(responseBody)) > s.gateway.cfg.MaxResponseBytes {
		writeError(w, http.StatusBadGateway, "Pay product response exceeds gateway policy")
		return
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(responseBody)
}

func payProductRoute(method, escapedPath string) (string, string, bool, bool) {
	if !strings.HasPrefix(escapedPath, "/app/pay-product/") {
		return "", "", false, false
	}
	path := "/" + strings.TrimPrefix(escapedPath, "/app/pay-product/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if method == http.MethodGet {
		switch {
		case path == "/health" || path == "/v1/settlement-assets":
			return path, "", true, true
		case len(parts) == 3 && parts[0] == "v1" && (parts[1] == "invoices" || parts[1] == "split-payments" || parts[1] == "quant-bills") && validSegment(parts[2]):
			return path, "", true, true
		}
	}
	if method != http.MethodPost {
		return "", "", false, false
	}
	switch {
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "invoices" && validSegment(parts[2]) && parts[3] == "settlements":
		return path, "pay:settlement:submit", false, true
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "invoices" && validSegment(parts[2]) && (parts[3] == "refund-requests" || parts[3] == "disputes"):
		return path, "pay:case:create", false, true
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "invoices" && validSegment(parts[2]) && parts[3] == "sponsorship-quotes":
		return path, "pay:sponsorship:request", false, true
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "sponsorships" && validSegment(parts[2]) && parts[3] == "receipts":
		return path, "pay:sponsorship:request", false, true
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "invoices" && validSegment(parts[2]) && parts[3] == "route-quotes":
		return path, "pay:route:select", false, true
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "route-quotes" && validSegment(parts[2]) && parts[3] == "select":
		return path, "pay:route:select", false, true
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "bridge-transfers" && validSegment(parts[2]) && parts[3] == "refresh":
		return path, "pay:route:select", false, true
	case len(parts) == 6 && parts[0] == "v1" && parts[1] == "split-payments" && validSegment(parts[2]) && parts[3] == "shares" && validSegment(parts[4]) && parts[5] == "claim":
		return path, "pay:settlement:submit", false, true
	}
	return "", "", false, false
}

var payMerchantScopes = []string{"account:read", "merchant:session:create"}

func (s *Server) payMerchant(w http.ResponseWriter, r *http.Request) {
	if s.gateway.payProductURL == nil || len(s.gateway.payProductAssertionKey) < 32 {
		writeError(w, http.StatusServiceUnavailable, "YNX Merchant service is unavailable")
		return
	}
	upstreamPath, sessionExchange, ok := payMerchantRoute(r.Method, r.URL.EscapedPath())
	if !ok {
		writeError(w, http.StatusNotFound, "Merchant route not found")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, s.gateway.cfg.MaxBodyBytes+1))
	if err != nil || int64(len(body)) > s.gateway.cfg.MaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "Merchant request exceeds gateway policy")
		return
	}
	upstreamURL := *s.gateway.payProductURL
	upstreamURL.Path, upstreamURL.RawPath, upstreamURL.RawQuery = upstreamPath, "", r.URL.RawQuery
	request, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL.String(), bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusBadGateway, "unable to construct Merchant request")
		return
	}
	for _, header := range []string{"Accept", "Content-Type"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			request.Header.Set(header, value)
		}
	}
	if sessionExchange {
		session, authErr := s.authenticateProductSession(r, "merchant:session:create", "pay-merchant", "ynx-merchant-console-v1", "com.ynxweb4.merchant-console", payMerchantScopes)
		if authErr != nil {
			writeError(w, http.StatusUnauthorized, "active YNX Merchant Product Session proof required")
			return
		}
		if err := s.signProductAssertion(request, body, session, "pay-merchant", "ynx-merchant-console-v1", "com.ynxweb4.merchant-console", "https://pay.ynxweb4.com/merchant/wallet-auth/callback", false); err != nil {
			writeError(w, http.StatusServiceUnavailable, "unable to create bounded Merchant Gateway assertion")
			return
		}
	} else {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(authorization) < 24 || len(authorization) > 512 || !strings.HasPrefix(authorization, "Bearer mcs_") {
			writeError(w, http.StatusUnauthorized, "active short-lived Merchant session required")
			return
		}
		request.Header.Set("Authorization", authorization)
	}
	response, err := s.client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "YNX Merchant service unavailable")
		return
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, s.gateway.cfg.MaxResponseBytes+1))
	if err != nil || int64(len(responseBody)) > s.gateway.cfg.MaxResponseBytes {
		writeError(w, http.StatusBadGateway, "Merchant response exceeds gateway policy")
		return
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(responseBody)
}

func payMerchantRoute(method, escapedPath string) (string, bool, bool) {
	if !strings.HasPrefix(escapedPath, "/app/pay-merchant/") {
		return "", false, false
	}
	path := "/" + strings.TrimPrefix(escapedPath, "/app/pay-merchant/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if method == http.MethodPost && path == "/v1/merchant/sessions" {
		return path, true, true
	}
	if method == http.MethodGet {
		switch path {
		case "/v1/merchant/state", "/v1/merchant/providers/catalog", "/v1/merchant/operations", "/v1/merchant/analytics", "/v1/merchant/reconciliation.csv", "/v1/merchant/data-rights", "/v1/merchant/data-export", "/v1/merchant/capital":
			return path, false, true
		}
	}
	if method == http.MethodPut && (path == "/v1/merchant/providers" || path == "/v1/merchant/webhook") {
		return path, false, true
	}
	if method != http.MethodPost {
		return "", false, false
	}
	switch path {
	case "/v1/merchant/members", "/v1/merchant/catalog", "/v1/merchant/invoices", "/v1/merchant/split-payments", "/v1/merchant/quant-bills", "/v1/merchant/recurring-drafts", "/v1/merchant/webhook/rotate", "/v1/merchant/webhooks/bulk-retry/preview", "/v1/merchant/webhooks/bulk-retry", "/v1/merchant/data-deletion-requests", "/v1/merchant/ai/runs":
		return path, false, true
	}
	switch {
	case len(parts) == 5 && parts[0] == "v1" && parts[1] == "merchant" && parts[2] == "providers" && validSegment(parts[3]) && (parts[4] == "test" || parts[4] == "disable"):
	case len(parts) == 5 && parts[0] == "v1" && parts[1] == "merchant" && parts[2] == "webhooks" && validSegment(parts[3]) && parts[4] == "retry":
	case len(parts) == 5 && parts[0] == "v1" && parts[1] == "merchant" && parts[2] == "refunds" && validSegment(parts[3]) && (parts[4] == "submit" || parts[4] == "refresh"):
	case len(parts) == 5 && parts[0] == "v1" && parts[1] == "merchant" && parts[2] == "data-deletion-requests" && validSegment(parts[3]) && parts[4] == "cancel":
	case len(parts) == 6 && parts[0] == "v1" && parts[1] == "merchant" && parts[2] == "ai" && parts[3] == "runs" && validSegment(parts[4]) && parts[5] == "review":
	default:
		return "", false, false
	}
	return path, false, true
}

func (s *Server) authenticatePayProductSession(r *http.Request, scope string) (payProductSession, error) {
	return s.authenticateProductSession(r, scope, "pay", "ynx-pay-v1", "com.ynxweb4.pay", payProductScopes)
}

func (s *Server) authenticateProductSession(r *http.Request, scope, expectedProduct, expectedClient, expectedBundle string, expectedScopes []string) (payProductSession, error) {
	proof := strings.TrimSpace(r.Header.Get("X-YNX-Product-Session-Proof"))
	if proof == "" || len(proof) > 16<<10 || !containsText(expectedScopes, scope) {
		return payProductSession{}, errors.New("invalid Pay Product Session proof")
	}
	body, err := json.Marshal(map[string][]string{"requiredScopes": {scope}})
	if err != nil {
		return payProductSession{}, err
	}
	upstreamURL := *s.gateway.walletURL
	upstreamURL.Path, upstreamURL.RawPath, upstreamURL.RawQuery = "/v1/wallet/sessions/introspect", "", ""
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL.String(), bytes.NewReader(body))
	if err != nil {
		return payProductSession{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-YNX-Product-Session-Proof", proof)
	response, err := s.client.Do(request)
	if err != nil {
		return payProductSession{}, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil || response.StatusCode != http.StatusOK {
		return payProductSession{}, errors.New("canonical Wallet Gateway rejected Pay proof")
	}
	var envelope struct {
		OK     bool `json:"ok"`
		Result struct {
			Active  bool `json:"active"`
			Session struct {
				RequestingProduct string   `json:"requestingProduct"`
				ProductClientID   string   `json:"productClientId"`
				BundleID          string   `json:"bundleId"`
				Account           string   `json:"account"`
				ProductDeviceKey  string   `json:"productDeviceKey"`
				SessionBinding    string   `json:"sessionBinding"`
				RequestDigest     string   `json:"requestDigest"`
				Scopes            []string `json:"scopes"`
				IssuedAt          string   `json:"issuedAt"`
				ExpiresAt         string   `json:"expiresAt"`
			} `json:"session"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &envelope) != nil || !envelope.OK || !envelope.Result.Active {
		return payProductSession{}, errors.New("canonical Wallet Gateway returned an invalid Pay session")
	}
	session := envelope.Result.Session
	if session.RequestingProduct != expectedProduct || session.ProductClientID != expectedClient || session.BundleID != expectedBundle || !containsText(session.Scopes, scope) || !sameTextSet(session.Scopes, expectedScopes) {
		return payProductSession{}, errors.New("Pay Product Session binding mismatch")
	}
	issuedAt, issuedErr := time.Parse(time.RFC3339Nano, session.IssuedAt)
	expiresAt, expiresErr := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	now := s.gateway.cfg.Now().UTC()
	if issuedErr != nil || expiresErr != nil || issuedAt.After(now.Add(time.Minute)) || !expiresAt.After(now) || !digestPattern(session.SessionBinding) || !digestPattern(session.RequestDigest) || len(session.ProductDeviceKey) != 44 {
		return payProductSession{}, errors.New("Pay Product Session is invalid or expired")
	}
	account, accountErr := nativewallet.NormalizeNativeAddress(session.Account)
	if accountErr != nil {
		return payProductSession{}, errors.New("Pay Product Session account is invalid")
	}
	deviceDigest := sha256.Sum256([]byte(session.ProductDeviceKey))
	return payProductSession{Account: account, SessionID: session.SessionBinding, DeviceID: hex.EncodeToString(deviceDigest[:]), SessionBinding: session.SessionBinding, RequestDigest: session.RequestDigest, Scopes: append([]string(nil), session.Scopes...), IssuedAt: issuedAt, ExpiresAt: expiresAt}, nil
}

func (s *Server) signPayProductAssertion(request *http.Request, body []byte, session payProductSession) error {
	return s.signProductAssertion(request, body, session, "pay", "ynx-pay-v1", "com.ynxweb4.pay", "ynxpay://wallet-auth/callback", true)
}

func (s *Server) signProductAssertion(request *http.Request, body []byte, session payProductSession, product, clientID, bundleID, callback string, bindSessionDigest bool) error {
	now := s.gateway.cfg.Now().UTC()
	expiresAt := now.Add(3 * time.Minute)
	if session.ExpiresAt.Before(expiresAt) {
		expiresAt = session.ExpiresAt
	}
	if !expiresAt.After(now) {
		return errors.New("Pay Product Session expired")
	}
	nonceBytes := make([]byte, 24)
	if _, err := io.ReadFull(s.gateway.cfg.Random, nonceBytes); err != nil {
		return err
	}
	nonce := hex.EncodeToString(nonceBytes)
	scopes := append([]string(nil), session.Scopes...)
	sort.Strings(scopes)
	headers := map[string]string{
		"X-YNX-Account": session.Account, "X-YNX-Session-ID": session.SessionID, "X-YNX-Device-ID": session.DeviceID,
		"X-YNX-Product": product, "X-YNX-Client": clientID, "X-YNX-Bundle": bundleID,
		"X-YNX-Callback": callback, "X-YNX-Chain": "ynx_6423-1", "X-YNX-Scopes": strings.Join(scopes, " "),
		"X-YNX-Session-Binding": session.SessionBinding, "X-YNX-Request-Digest": session.RequestDigest,
		"X-YNX-Issued-At": now.Format(time.RFC3339Nano), "X-YNX-Expires-At": expiresAt.Format(time.RFC3339Nano), "X-YNX-Nonce": nonce,
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	bodyHash := sha256.Sum256(body)
	fields := []string{"YNX_PRODUCT_GATEWAY_ASSERTION_V1", request.Method, request.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), session.Account, session.SessionID, session.DeviceID, product, clientID, bundleID, callback, "ynx_6423-1", strings.Join(scopes, " ")}
	if bindSessionDigest {
		fields = append(fields, session.SessionBinding)
	}
	fields = append(fields, session.RequestDigest, headers["X-YNX-Issued-At"], headers["X-YNX-Expires-At"], nonce)
	material := strings.Join(fields, "\n")
	mac := hmac.New(sha256.New, s.gateway.payProductAssertionKey)
	_, _ = mac.Write([]byte(material))
	request.Header.Set("X-YNX-Gateway-Signature", hex.EncodeToString(mac.Sum(nil)))
	return nil
}

func sameTextSet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	a, b := append([]string(nil), left...), append([]string(nil), right...)
	sort.Strings(a)
	sort.Strings(b)
	return strings.Join(a, "\n") == strings.Join(b, "\n")
}

// authenticateBridgeProductSession consumes one exact, sender-constrained
// Bridge Product Session proof at the canonical Wallet Gateway. The browser
// never supplies account, product, device, scope or expiry assertions to the
// Bridge service: those values are derived only from this response.
func (s *Server) authenticateBridgeProductSession(r *http.Request, scope string) (AppSession, error) {
	proof := strings.TrimSpace(r.Header.Get("X-YNX-Product-Session-Proof"))
	if proof == "" || len(proof) > 16<<10 || (scope != "bridge:quote:read" && scope != "bridge:review:create") {
		return AppSession{}, errors.New("invalid Bridge Product Session proof")
	}
	body, err := json.Marshal(map[string][]string{"requiredScopes": {scope}})
	if err != nil {
		return AppSession{}, err
	}
	upstreamURL := *s.gateway.walletURL
	upstreamURL.Path, upstreamURL.RawPath, upstreamURL.RawQuery = "/v1/wallet/sessions/introspect", "", ""
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL.String(), bytes.NewReader(body))
	if err != nil {
		return AppSession{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-YNX-Product-Session-Proof", proof)
	response, err := s.client.Do(request)
	if err != nil {
		return AppSession{}, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil || response.StatusCode != http.StatusOK {
		return AppSession{}, errors.New("canonical Wallet Gateway rejected Bridge proof")
	}
	var envelope struct {
		OK     bool `json:"ok"`
		Result struct {
			Active  bool `json:"active"`
			Session struct {
				RequestingProduct string   `json:"requestingProduct"`
				ProductClientID   string   `json:"productClientId"`
				BundleID          string   `json:"bundleId"`
				Account           string   `json:"account"`
				ProductDeviceKey  string   `json:"productDeviceKey"`
				SessionBinding    string   `json:"sessionBinding"`
				Scopes            []string `json:"scopes"`
				IssuedAt          string   `json:"issuedAt"`
				ExpiresAt         string   `json:"expiresAt"`
			} `json:"session"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &envelope) != nil || !envelope.OK || !envelope.Result.Active {
		return AppSession{}, errors.New("canonical Wallet Gateway returned an invalid Bridge session")
	}
	session := envelope.Result.Session
	if session.RequestingProduct != "bridge" || session.ProductClientID != "ynx-bridge-web-v1" || session.BundleID != "web.ynx.bridge" || !containsText(session.Scopes, scope) {
		return AppSession{}, errors.New("Bridge Product Session binding mismatch")
	}
	issuedAt, issuedErr := time.Parse(time.RFC3339Nano, session.IssuedAt)
	expiresAt, expiresErr := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	now := s.gateway.cfg.Now().UTC()
	if issuedErr != nil || expiresErr != nil || issuedAt.After(now.Add(time.Minute)) || !expiresAt.After(now) || !digestPattern(session.SessionBinding) || len(session.ProductDeviceKey) != 44 {
		return AppSession{}, errors.New("Bridge Product Session is invalid or expired")
	}
	account, accountErr := nativewallet.NormalizeNativeAddress(session.Account)
	if accountErr != nil {
		return AppSession{}, errors.New("Bridge Product Session account is invalid")
	}
	deviceDigest := sha256.Sum256([]byte(session.ProductDeviceKey))
	return AppSession{ID: session.SessionBinding, Account: account, CanonicalAddress: account, DeviceID: hex.EncodeToString(deviceDigest[:]), Origin: "https://ynxweb4.com", IssuedAt: issuedAt, ExpiresAt: expiresAt, Status: "active"}, nil
}

func digestPattern(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && strings.ToLower(value) == value
}

func containsText(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func appUpstreamPath(service, path string) string {
	if service == "bridge" && (path == "/bridge/health" || path == "/bridge/version") {
		return strings.TrimPrefix(path, "/bridge")
	}
	return path
}

func (s *Server) session(w http.ResponseWriter, r *http.Request, binding string) {
	if binding == "" {
		writeError(w, http.StatusUnauthorized, "browser origin or native client binding is required")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, s.gateway.cfg.MaxBodyBytes+1))
	if err != nil || int64(len(body)) > s.gateway.cfg.MaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "request body exceeds gateway policy")
		return
	}
	path := strings.Trim(r.URL.EscapedPath(), "/")
	parts := strings.Split(path, "/")
	switch {
	case len(parts) == 3 && parts[0] == "app" && parts[1] == "session" && parts[2] == "challenges" && r.Method == http.MethodPost:
		var request ChallengeRequest
		if err := decodeOne(body, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response, err := s.gateway.CreateChallenge(binding, request)
		if err != nil {
			writeSessionError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, response)
	case len(parts) == 5 && parts[0] == "app" && parts[1] == "session" && parts[2] == "challenges" && parts[4] == "verify" && r.Method == http.MethodPost && validSegment(parts[3]):
		var request VerifyChallengeRequest
		if err := decodeOne(body, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response, err := s.gateway.VerifyChallenge(binding, parts[3], request)
		if err != nil {
			writeSessionError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, response)
	case len(parts) == 3 && parts[0] == "app" && parts[1] == "session" && parts[2] == "revoke" && r.Method == http.MethodPost:
		if len(strings.TrimSpace(string(body))) != 0 {
			var request struct{}
			if err := decodeOne(body, &request); err != nil {
				writeError(w, http.StatusBadRequest, "session revoke body must be empty")
				return
			}
		}
		if err := s.gateway.RevokeSession(binding, r.Header.Get("X-YNX-App-Session"), r.Header.Get("X-YNX-Device-ID")); err != nil {
			writeSessionError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
	default:
		writeError(w, http.StatusNotFound, "app session route not found")
	}
}

func (s *Server) preflight(w http.ResponseWriter, r *http.Request) {
	method := strings.ToUpper(strings.TrimSpace(r.Header.Get("Access-Control-Request-Method")))
	if method != http.MethodGet && method != http.MethodPost && method != http.MethodPut {
		writeError(w, http.StatusForbidden, "preflight method is not allowed")
		return
	}
	if strings.HasPrefix(r.URL.EscapedPath(), "/app/session/") {
		if !sessionRouteAllowed(method, r.URL.EscapedPath()) {
			writeError(w, http.StatusNotFound, "app session route not found")
			return
		}
	} else if strings.HasPrefix(r.URL.EscapedPath(), "/app/pay-product/") {
		if _, _, _, ok := payProductRoute(method, r.URL.EscapedPath()); !ok {
			writeError(w, http.StatusNotFound, "Pay product route not found")
			return
		}
	} else if strings.HasPrefix(r.URL.EscapedPath(), "/app/pay-merchant/") {
		if _, _, ok := payMerchantRoute(method, r.URL.EscapedPath()); !ok {
			writeError(w, http.StatusNotFound, "Merchant route not found")
			return
		}
	} else {
		service, upstreamPath, ok := resolveAppPath(r.URL.EscapedPath())
		if !ok || (!publicRouteAllowed(service, method, upstreamPath) && !protectedRouteAllowed(service, method, upstreamPath)) {
			writeError(w, http.StatusNotFound, "app route not found")
			return
		}
	}
	for _, raw := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
		header := http.CanonicalHeaderKey(strings.TrimSpace(raw))
		if header == "" {
			continue
		}
		if header == "Authorization" && !strings.HasPrefix(r.URL.EscapedPath(), "/app/pay-merchant/") {
			writeError(w, http.StatusForbidden, "preflight header Authorization is not allowed for this route")
			return
		}
		switch header {
		case "Accept", "Authorization", "Content-Type", "X-Ynx-App-Session", "X-Ynx-Device-Id", "X-Ynx-Timestamp", "X-Ynx-Device-Signature", "X-Ynx-Product-Session-Proof":
		default:
			writeError(w, http.StatusForbidden, fmt.Sprintf("preflight header %s is not allowed", header))
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func sessionRouteAllowed(method, escapedPath string) bool {
	parts := strings.Split(strings.Trim(escapedPath, "/"), "/")
	return method == http.MethodPost && ((len(parts) == 3 && parts[0] == "app" && parts[1] == "session" && (parts[2] == "challenges" || parts[2] == "revoke")) || (len(parts) == 5 && parts[0] == "app" && parts[1] == "session" && parts[2] == "challenges" && validSegment(parts[3]) && parts[4] == "verify"))
}

func resolveAppPath(escapedPath string) (string, string, bool) {
	if !strings.HasPrefix(escapedPath, "/app/") {
		return "", "", false
	}
	pieces := strings.SplitN(strings.TrimPrefix(escapedPath, "/app/"), "/", 2)
	if len(pieces) != 2 || (pieces[0] != "chat" && pieces[0] != "square" && pieces[0] != "pay" && pieces[0] != "social" && pieces[0] != "bridge") {
		return "", "", false
	}
	return pieces[0], "/" + pieces[0] + "/" + pieces[1], true
}

func bindPayPayer(body []byte, account string) ([]byte, error) {
	var payload map[string]any
	if err := decodeOne(body, &payload); err != nil {
		return nil, err
	}
	if _, supplied := payload["payer"]; supplied {
		return nil, errors.New("payer is bound to the authenticated app session and must not be supplied")
	}
	payload["payer"] = account
	return json.Marshal(payload)
}

func setCORS(w http.ResponseWriter, origin string) {
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-YNX-App-Session, X-YNX-Device-ID, X-YNX-Timestamp, X-YNX-Device-Signature, X-YNX-Product-Session-Proof")
	w.Header().Set("Access-Control-Max-Age", "600")
	w.Header().Add("Vary", "Origin")
}

func decodeOne(body []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("request body must be one bounded JSON object")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("request body must contain exactly one JSON object")
	}
	return nil
}

func writeSessionError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrInvalidSessionRequest):
		status = http.StatusBadRequest
	case errors.Is(err, ErrSessionUnauthorized):
		status = http.StatusUnauthorized
	case errors.Is(err, ErrSessionConflict):
		status = http.StatusConflict
	}
	writeError(w, status, err.Error())
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
