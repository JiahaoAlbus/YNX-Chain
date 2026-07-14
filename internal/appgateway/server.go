package appgateway

import (
	"bytes"
	"encoding/json"
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
	for _, service := range []string{"chat", "square"} {
		base, _, _, _ := s.gateway.upstream(service)
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
	status := "local-browser-safe-gateway-not-remote-deployed"
	if s.gateway.cfg.RemoteDeployed {
		status = "remote-first-party-app-gateway"
	}
	health := Health{OK: ok, Service: "ynx-app-gatewayd", BrowserBoundary: "read-only-square-exact-routes-service-keys-server-side", RemoteDeployed: s.gateway.cfg.RemoteDeployed, Upstreams: upstreams, TruthfulStatus: status, Build: s.build}
	code := http.StatusOK
	if !ok {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, health)
}

func (s *Server) app(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && !s.gateway.OriginAllowed(origin) {
		writeError(w, http.StatusForbidden, "origin is not allowed")
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
	service, upstreamPath, ok := resolveAppPath(r.URL.EscapedPath())
	if !ok {
		writeError(w, http.StatusNotFound, "app route not found")
		return
	}
	if !routeAllowed(service, r.Method, upstreamPath) {
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
	base, key, keyHeader, _ := s.gateway.upstream(service)
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

func (s *Server) preflight(w http.ResponseWriter, r *http.Request) {
	method := strings.ToUpper(strings.TrimSpace(r.Header.Get("Access-Control-Request-Method")))
	if method != http.MethodGet && method != http.MethodPost {
		writeError(w, http.StatusForbidden, "preflight method is not allowed")
		return
	}
	service, upstreamPath, ok := resolveAppPath(r.URL.EscapedPath())
	if !ok || !routeAllowed(service, method, upstreamPath) {
		writeError(w, http.StatusNotFound, "app route not found")
		return
	}
	for _, raw := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
		header := http.CanonicalHeaderKey(strings.TrimSpace(raw))
		if header == "" {
			continue
		}
		switch header {
		case "Accept", "Content-Type", "X-Ynx-Device-Id", "X-Ynx-Timestamp", "X-Ynx-Device-Signature":
		default:
			writeError(w, http.StatusForbidden, fmt.Sprintf("preflight header %s is not allowed", header))
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func resolveAppPath(escapedPath string) (string, string, bool) {
	if !strings.HasPrefix(escapedPath, "/app/") {
		return "", "", false
	}
	pieces := strings.SplitN(strings.TrimPrefix(escapedPath, "/app/"), "/", 2)
	if len(pieces) != 2 || (pieces[0] != "chat" && pieces[0] != "square") {
		return "", "", false
	}
	return pieces[0], "/" + pieces[0] + "/" + pieces[1], true
}

func setCORS(w http.ResponseWriter, origin string) {
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, X-YNX-Device-ID, X-YNX-Timestamp, X-YNX-Device-Signature")
	w.Header().Set("Access-Control-Max-Age", "600")
	w.Header().Add("Vary", "Origin")
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
