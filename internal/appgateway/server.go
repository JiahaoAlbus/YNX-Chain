package appgateway

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Server struct {
	gateway *Gateway
	client  *http.Client
	build   buildinfo.Info
}

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
	return &Server{gateway: gateway, client: &http.Client{Timeout: 8 * time.Second}, build: buildinfo.Normalize(build)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/app/health", s.appHealth)
	mux.HandleFunc("/app/", s.app)
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
	for _, service := range []string{"chat", "square", "pay", "social"} {
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
	health := Health{OK: ok, Service: "ynx-app-gatewayd", BrowserBoundary: "exact-https-origin", NativeBoundary: nativeMobileClient, OwnershipProof: "ynx1-secp256k1-plus-ed25519-device", SessionStorage: "integrity-checked-atomic-mode-0600-token-hashes-only", ActiveSessions: s.gateway.ActiveSessionCount(), RemoteDeployed: s.gateway.cfg.RemoteDeployed, Upstreams: upstreams, TruthfulStatus: status, Build: s.build}
	code := http.StatusOK
	if !ok {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, health)
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
		session, err := s.gateway.AuthenticateSession(binding, r.Header.Get("X-YNX-App-Session"), r.Header.Get("X-YNX-Device-ID"))
		if err != nil {
			writeError(w, http.StatusUnauthorized, "account-bound app session required")
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
	upstreamURL.Path = upstreamPath
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
	if method != http.MethodGet && method != http.MethodPost {
		writeError(w, http.StatusForbidden, "preflight method is not allowed")
		return
	}
	if strings.HasPrefix(r.URL.EscapedPath(), "/app/session/") {
		if !sessionRouteAllowed(method, r.URL.EscapedPath()) {
			writeError(w, http.StatusNotFound, "app session route not found")
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
		switch header {
		case "Accept", "Content-Type", "X-Ynx-App-Session", "X-Ynx-Device-Id", "X-Ynx-Timestamp", "X-Ynx-Device-Signature":
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
	if len(pieces) != 2 || (pieces[0] != "chat" && pieces[0] != "square" && pieces[0] != "pay" && pieces[0] != "social") {
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
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, X-YNX-App-Session, X-YNX-Device-ID, X-YNX-Timestamp, X-YNX-Device-Signature")
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
