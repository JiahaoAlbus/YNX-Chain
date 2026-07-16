package resourceproduct

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
		writeJSON(w, 200, map[string]any{"product": "ynx-resource-market", "chainId": "ynx_6423-1", "evmChainId": 6423, "nativeAsset": "YNXT", "centralGatewayConfigured": s.cfg.CentralGatewayURL != "", "centralClientId": s.cfg.CentralClientID, "walletCallback": "ynxresource://auth/callback", "scopes": []string{"resource:read", "resource:quote", "resource:intent", "resource:history", "resource:dispute"}, "authority": "Quote, capacity allocation and transaction state come only from the central Gateway and authoritative Resource API.", "assetBoundary": "No product route signs, transfers, freezes or settles YNXT."})
	})
	mux.HandleFunc("POST /api/auth/challenges", s.handleCentralChallenge)
	mux.HandleFunc("POST /api/auth/challenges/{id}/verify", s.handleCentralVerify)
	mux.HandleFunc("POST /api/auth/revoke", s.handleCentralRevoke)
	mux.HandleFunc("POST /api/authority/intents", s.handleIntentCreate)
	mux.HandleFunc("POST /api/authority/intents/{id}/retry", s.handleIntentRetry)
	mux.HandleFunc("GET /api/authority/intents/{id}", s.handleIntentGet)
	for _, route := range []struct{ pattern, path string }{
		{"GET /api/authority/policy", "/app/resource-market/policy"}, {"GET /api/authority/quote", "/app/resource-market/quote"}, {"GET /api/authority/analytics", "/app/resource-market/analytics"}, {"GET /api/authority/balances/{address}", "/app/resource-market/balances/{address}"}, {"GET /api/authority/income/{address}", "/app/resource-market/income/{address}"},
		{"POST /api/authority/delegations", "/app/resource-market/delegations"}, {"GET /api/authority/delegations/{address}", "/app/resource-market/delegations/{address}"}, {"POST /api/authority/rent", "/app/resource-market/rent"},
		{"POST /api/authority/pools", "/app/resource-market/pools"}, {"GET /api/authority/pools", "/app/resource-market/pools"}, {"GET /api/authority/pools/{id}", "/app/resource-market/pools/{id}"}, {"POST /api/authority/pools/{id}/fund", "/app/resource-market/pools/{id}/fund"}, {"POST /api/authority/pools/{id}/policy", "/app/resource-market/pools/{id}/policy"}, {"POST /api/authority/pools/{id}/status", "/app/resource-market/pools/{id}/status"},
		{"POST /api/authority/sponsorships", "/app/resource-market/sponsorships"}, {"GET /api/authority/sponsorships", "/app/resource-market/sponsorships"}, {"GET /api/authority/sponsorships/{id}", "/app/resource-market/sponsorships/{id}"}, {"GET /api/authority/sponsor-audit", "/app/resource-market/sponsor-audit"},
	} {
		pattern, path := route.pattern, route.path
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) { s.handleAuthorityProxy(w, r, expandPath(path, r)) })
	}
}
func expandPath(path string, r *http.Request) string {
	path = strings.ReplaceAll(path, "{id}", url.PathEscape(r.PathValue("id")))
	return strings.ReplaceAll(path, "{address}", url.PathEscape(r.PathValue("address")))
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
		writeJSON(w, 503, map[string]string{"error": "central Gateway or authoritative Resource API is unavailable", "state": "unavailable", "retry": "safe", "settlement": "not asserted"})
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

type intentInput struct {
	Kind           string          `json:"kind"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Payload        json.RawMessage `json:"payload"`
}

func intentPath(kind string) (string, bool) {
	v, ok := map[string]string{"delegation": "/app/resource-market/delegations", "rental": "/app/resource-market/rent", "sponsorship": "/app/resource-market/sponsorships"}[kind]
	return v, ok
}
func (s *Service) handleIntentCreate(w http.ResponseWriter, r *http.Request) {
	s.handleIntent(w, r, "")
}
func (s *Service) handleIntentRetry(w http.ResponseWriter, r *http.Request) {
	s.handleIntent(w, r, r.PathValue("id"))
}
func (s *Service) handleIntent(w http.ResponseWriter, r *http.Request, retryID string) {
	token, device := r.Header.Get("Authorization"), r.Header.Get("X-YNX-Device-ID")
	actor, err := s.authenticateCentral(token, device)
	if err != nil {
		writeErr(w, err)
		return
	}
	raw, ok := readBoundedBody(w, r)
	if !ok {
		return
	}
	var in intentInput
	if json.Unmarshal(raw, &in) != nil || in.IdempotencyKey == "" || len(in.Payload) == 0 {
		writeJSON(w, 422, map[string]string{"error": "kind, idempotencyKey and signed payload are required"})
		return
	}
	path, ok := intentPath(in.Kind)
	if !ok {
		writeJSON(w, 422, map[string]string{"error": "kind must be delegation, rental or sponsorship"})
		return
	}
	sum := sha256.Sum256(in.Payload)
	hash := hex.EncodeToString(sum[:])
	now := s.cfg.Now().UTC()
	s.mu.Lock()
	var intent PurchaseIntent
	if retryID != "" {
		var exists bool
		intent, exists = s.data.Intents[retryID]
		if !exists || intent.Owner != actor.ID {
			s.mu.Unlock()
			writeJSON(w, 404, map[string]string{"error": "purchase intent not found"})
			return
		}
		if intent.RequestHash != hash || intent.Kind != in.Kind || intent.IdempotencyKey != in.IdempotencyKey {
			s.mu.Unlock()
			writeJSON(w, 409, map[string]string{"error": "retry payload does not match the original purchase intent"})
			return
		}
	} else {
		for _, v := range s.data.Intents {
			if v.Owner == actor.ID && v.IdempotencyKey == in.IdempotencyKey {
				if v.RequestHash != hash || v.Kind != in.Kind {
					s.mu.Unlock()
					writeJSON(w, 409, map[string]string{"error": "idempotency key reused with different intent"})
					return
				}
				s.mu.Unlock()
				writeJSON(w, 200, v)
				return
			}
		}
		intent = PurchaseIntent{ID: s.nextLocked("intent"), Owner: actor.ID, Kind: in.Kind, IdempotencyKey: in.IdempotencyKey, RequestHash: hash, Status: "submitting", AuthorityPath: path, FeeSettlement: "not proven; authoritative settlement evidence required", CreatedAt: now, UpdatedAt: now}
		s.data.Intents[intent.ID] = intent
		_ = s.saveLocked()
	}
	intent.Attempts++
	intent.UpdatedAt = now
	s.data.Intents[intent.ID] = intent
	_ = s.saveLocked()
	s.mu.Unlock()
	resp, callErr := s.centralRequest(r, http.MethodPost, path, in.Payload, token, device)
	s.mu.Lock()
	intent = s.data.Intents[intent.ID]
	if callErr != nil {
		intent.Status = "failed"
		intent.LastError = "central Gateway or authoritative Resource API unavailable"
		s.data.Intents[intent.ID] = intent
		_ = s.saveLocked()
		s.mu.Unlock()
		s.recordAuthority(actor, http.MethodPost, path, in.Payload, nil, 502, "unavailable")
		writeJSON(w, 503, map[string]any{"intent": intent, "retry": "resubmit exact signed payload", "settlement": "not asserted"})
		return
	}
	intent.Status = "authority_rejected"
	if resp.Status >= 500 {
		intent.Status = "failed"
		intent.LastError = "central Gateway or authoritative Resource API unavailable"
	}
	if resp.Status/100 == 2 {
		intent.Status = "pending_authority_confirmation"
		var data map[string]any
		if json.Unmarshal(resp.Body, &data) == nil {
			txHash, objectID := extractEvidence(data, in.Kind)
			intent.TransactionHash = txHash
			intent.AuthorityObjectID = objectID
			if txHash != "" && objectID != "" {
				intent.Status = "authority_confirmed_capacity"
			}
		}
	}
	if resp.Status/100 == 2 {
		intent.LastError = ""
	}
	if resp.Status >= 400 && resp.Status < 500 {
		intent.LastError = "authoritative Resource API rejected the signed intent"
	}
	s.data.Intents[intent.ID] = intent
	_ = s.saveLocked()
	s.mu.Unlock()
	outcome := "authoritative_response"
	if resp.Status >= 400 {
		outcome = "authoritative_rejection"
	}
	s.recordAuthority(actor, http.MethodPost, path, in.Payload, resp.Body, resp.Status, outcome)
	code := 422
	if resp.Status/100 == 2 {
		code = 200
	} else if resp.Status >= 500 {
		code = 503
	}
	writeJSON(w, code, map[string]any{"intent": intent, "authorityStatus": resp.Status, "authorityResponse": json.RawMessage(resp.Body)})
}
func extractEvidence(data map[string]any, kind string) (string, string) {
	tx := ""
	if v, ok := data["transaction"].(map[string]any); ok {
		tx, _ = v["hash"].(string)
	}
	keys := map[string][]string{"delegation": {"delegation"}, "rental": {"rental"}, "sponsorship": {"sponsorship"}}[kind]
	id := ""
	for _, k := range keys {
		if v, ok := data[k].(map[string]any); ok {
			id, _ = v["id"].(string)
		}
	}
	return tx, id
}
func (s *Service) handleIntentGet(w http.ResponseWriter, r *http.Request) {
	actor, err := s.authenticateCentral(r.Header.Get("Authorization"), r.Header.Get("X-YNX-Device-ID"))
	if err != nil {
		writeErr(w, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.data.Intents[r.PathValue("id")]
	if !ok || v.Owner != actor.ID {
		writeJSON(w, 404, map[string]string{"error": "purchase intent not found"})
		return
	}
	writeJSON(w, 200, v)
}
