package trustproduct

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type authorityResponse struct {
	Status int
	Header http.Header
	Body   []byte
}

func (s *Service) centralRequest(r *http.Request, method, path string, body []byte, session, device string) (authorityResponse, error) {
	if s.cfg.CentralGatewayURL == "" {
		return authorityResponse{}, errors.New("central Wallet/Gateway is unavailable or not configured")
	}
	if len(body) > maxBody {
		return authorityResponse{}, errors.New("authority request exceeds body limit")
	}
	req, err := http.NewRequestWithContext(r.Context(), method, s.cfg.CentralGatewayURL+path, bytes.NewReader(body))
	if err != nil {
		return authorityResponse{}, err
	}
	req.Header.Set("X-YNX-Client", s.cfg.CentralClientID)
	if session != "" {
		req.Header.Set("X-YNX-App-Session", strings.TrimSpace(strings.TrimPrefix(session, "Bearer ")))
	}
	if device != "" {
		req.Header.Set("X-YNX-Device-ID", device)
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return authorityResponse{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return authorityResponse{}, err
	}
	if len(raw) > maxBody {
		return authorityResponse{}, errors.New("central authority response exceeds body limit")
	}
	return authorityResponse{Status: resp.StatusCode, Header: resp.Header.Clone(), Body: raw}, nil
}

func (s *Service) registerAuthorityRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/meta", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"product": "ynx-trust-center", "chainId": "ynx_6423-1", "evmChainId": 6423, "nativeAsset": "YNXT", "centralGatewayConfigured": s.cfg.CentralGatewayURL != "", "centralClientId": s.cfg.CentralClientID, "walletCallback": "ynxtrust://auth/callback", "scopes": []string{"trust:evidence:write", "trust:evidence:read", "trust:appeal", "trust:transparency"}, "authority": "Governance and Trust status comes only from the central Gateway and authoritative Trust API."})
	})
	mux.HandleFunc("POST /api/auth/challenges", s.handleCentralChallenge)
	mux.HandleFunc("POST /api/auth/challenges/{id}/verify", s.handleCentralVerify)
	mux.HandleFunc("POST /api/auth/revoke", s.handleCentralRevoke)
	for _, route := range []struct{ pattern, path string }{
		{"POST /api/authority/evidence", "/app/trust/evidence"}, {"GET /api/authority/evidence/{id}", "/app/trust/evidence/{id}"},
		{"POST /api/authority/governance/requests", "/app/governance/requests"}, {"GET /api/authority/governance/requests/{id}", "/app/governance/requests/{id}"},
		{"POST /api/authority/governance/requests/{id}/review", "/app/governance/requests/{id}/review"}, {"POST /api/authority/governance/requests/{id}/reject", "/app/governance/requests/{id}/reject"},
		{"POST /api/authority/appeals", "/app/trust/appeals"}, {"GET /api/authority/appeals/{id}", "/app/trust/appeals/{id}"}, {"POST /api/authority/appeals/{id}/resolve", "/app/trust/appeals/{id}/resolve"},
		{"GET /api/authority/transparency", "/app/governance/transparency"}, {"GET /api/authority/validity-rules", "/app/governance/request-validity-rules"},
	} {
		pattern, path := route.pattern, route.path
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) { s.handleAuthorityProxy(w, r, expandPath(path, r)) })
	}
}
func expandPath(path string, r *http.Request) string {
	return strings.ReplaceAll(path, "{id}", url.PathEscape(r.PathValue("id")))
}
func readBoundedBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || len(raw) > maxBody || len(raw) > 0 && !json.Valid(raw) {
		writeJSON(w, 400, map[string]string{"error": "valid bounded JSON body required"})
		return nil, false
	}
	return raw, true
}
func (s *Service) handleCentralChallenge(w http.ResponseWriter, r *http.Request) {
	raw, ok := readBoundedBody(w, r)
	if !ok {
		return
	}
	resp, err := s.centralRequest(r, http.MethodPost, "/app/session/challenges", raw, "", "")
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": err.Error(), "state": "unavailable", "retry": "safe"})
		return
	}
	copyCentral(w, resp)
}
func (s *Service) handleCentralVerify(w http.ResponseWriter, r *http.Request) {
	raw, ok := readBoundedBody(w, r)
	if !ok {
		return
	}
	resp, err := s.centralRequest(r, http.MethodPost, "/app/session/challenges/"+url.PathEscape(r.PathValue("id"))+"/verify", raw, "", "")
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": err.Error(), "state": "unavailable", "retry": "safe"})
		return
	}
	if resp.Status/100 == 2 {
		var out struct {
			SessionID string    `json:"sessionId"`
			Token     string    `json:"token"`
			Account   string    `json:"account"`
			DeviceID  string    `json:"deviceId"`
			Scopes    []string  `json:"scopes"`
			ExpiresAt time.Time `json:"expiresAt"`
		}
		if json.Unmarshal(resp.Body, &out) != nil || out.Token == "" || out.SessionID == "" || out.Account == "" || out.DeviceID == "" || out.ExpiresAt.IsZero() {
			writeJSON(w, 502, map[string]string{"error": "central Gateway returned an invalid session binding"})
			return
		}
		if err := s.storeCentralSession(out.Token, CentralSession{ID: out.SessionID, Account: out.Account, DeviceID: out.DeviceID, Scopes: out.Scopes, ExpiresAt: out.ExpiresAt}); err != nil {
			writeJSON(w, 500, map[string]string{"error": "central session audit persistence failed"})
			return
		}
	}
	copyCentral(w, resp)
}
func (s *Service) handleCentralRevoke(w http.ResponseWriter, r *http.Request) {
	token, device := r.Header.Get("Authorization"), r.Header.Get("X-YNX-Device-ID")
	if _, err := s.authenticateCentral(token, device); err != nil {
		writeErr(w, err)
		return
	}
	resp, err := s.centralRequest(r, http.MethodPost, "/app/session/revoke", nil, token, device)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": err.Error(), "state": "unavailable", "retry": "safe"})
		return
	}
	if resp.Status/100 == 2 {
		_ = s.revokeCentral(token, device)
	}
	copyCentral(w, resp)
}
func (s *Service) handleAuthorityProxy(w http.ResponseWriter, r *http.Request, path string) {
	token, device := r.Header.Get("Authorization"), r.Header.Get("X-YNX-Device-ID")
	actor, err := s.authenticateCentral(token, device)
	if err != nil {
		writeErr(w, err)
		return
	}
	var raw []byte
	if r.Method != http.MethodGet {
		var ok bool
		raw, ok = readBoundedBody(w, r)
		if !ok {
			return
		}
	}
	requestPath := path
	if r.Method == http.MethodGet && r.URL.RawQuery != "" {
		requestPath += "?" + r.URL.RawQuery
	}
	resp, err := s.centralRequest(r, r.Method, requestPath, raw, token, device)
	if err != nil {
		s.recordAuthority(actor, r.Method, path, raw, nil, 502, "unavailable")
		writeJSON(w, 503, map[string]string{"error": "central Gateway or authoritative Trust API is unavailable", "state": "unavailable", "retry": "safe", "authority": "no local conclusion was substituted"})
		return
	}
	outcome := "authoritative_response"
	if resp.Status >= 400 {
		outcome = "authoritative_rejection"
	}
	s.recordAuthority(actor, r.Method, path, raw, resp.Body, resp.Status, outcome)
	copyCentral(w, resp)
}
func (s *Service) recordAuthority(a Actor, method, path string, req, res []byte, status int, outcome string) {
	rq := sha256.Sum256(req)
	rs := sha256.Sum256(res)
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := AuthorityAudit{ID: s.nextLocked("authority"), Actor: a.ID, Method: method, Path: path, RequestHash: hex.EncodeToString(rq[:]), Status: status, Outcome: outcome, At: s.cfg.Now().UTC()}
	if res != nil {
		entry.ResponseHash = hex.EncodeToString(rs[:])
	}
	s.data.AuthorityAudit = append(s.data.AuthorityAudit, entry)
	_ = s.saveLocked()
}
func copyCentral(w http.ResponseWriter, resp authorityResponse) {
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if id := resp.Header.Get("X-Request-ID"); id != "" {
		w.Header().Set("X-Request-ID", id)
	}
	w.WriteHeader(resp.Status)
	_, _ = w.Write(resp.Body)
}
