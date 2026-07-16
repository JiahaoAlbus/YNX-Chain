package music

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/appgateway"
)

type Server struct {
	service *Service
	auth    *appgateway.Gateway
	binding string
	web     fs.FS
	mux     *http.ServeMux
}

func NewServer(service *Service, auth *appgateway.Gateway, binding string, web fs.FS) *Server {
	s := &Server{service: service, auth: auth, binding: binding, web: web, mux: http.NewServeMux()}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return securityHeaders(s.mux) }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("POST /api/auth/challenges", s.challenge)
	s.mux.HandleFunc("POST /api/auth/challenges/{id}/verify", s.verify)
	s.mux.HandleFunc("POST /api/auth/wallet-v1/session", s.walletSession)
	s.mux.HandleFunc("GET /api/me", s.api(s.me))
	s.mux.HandleFunc("PUT /api/profile", s.api(s.profile))
	s.mux.HandleFunc("POST /api/creator/onboarding", s.api(s.creator))
	s.mux.HandleFunc("POST /api/creator/tracks", s.api(s.upload))
	s.mux.HandleFunc("POST /api/creator/tracks/{id}/release", s.api(s.release))
	s.mux.HandleFunc("GET /api/catalog", s.api(s.catalog))
	s.mux.HandleFunc("GET /api/tracks/{id}", s.api(s.track))
	s.mux.HandleFunc("GET /api/tracks/{id}/media", s.api(s.media))
	s.mux.HandleFunc("GET /api/tracks/{id}/artwork", s.api(s.artwork))
	s.mux.HandleFunc("PUT /api/library", s.api(s.library))
	s.mux.HandleFunc("POST /api/playback/{id}/position", s.api(s.position))
	s.mux.HandleFunc("POST /api/playlists", s.api(s.playlist))
	s.mux.HandleFunc("POST /api/cases", s.api(s.openCase))
	s.mux.HandleFunc("POST /api/creator/allocations", s.api(s.allocate))
	s.mux.HandleFunc("POST /api/creator/settlements", s.api(s.settlement))
	s.mux.HandleFunc("POST /api/ai/proposals", s.api(s.aiProposal))
	s.mux.HandleFunc("GET /api/ai/status", s.api(s.aiStatus))
	s.mux.HandleFunc("GET /api/ai/proposals/{id}/stream", s.api(s.aiStream))
	s.mux.HandleFunc("POST /api/ai/proposals/{id}/review", s.api(s.aiReview))
	s.mux.Handle("GET /", http.FileServer(http.FS(s.web)))
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	err := s.service.VerifyIntegrity()
	status := http.StatusOK
	if err != nil {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"ok": err == nil, "service": "ynx-music", "persistence": "atomic-json-sha256", "mediaEngine": "HTMLMediaElement with HTTP range support", "licensedPublicCatalog": false, "productionStreaming": false})
}
func (s *Server) challenge(w http.ResponseWriter, r *http.Request) {
	var req appgateway.ChallengeRequest
	if !decode(w, r, &req, 16<<10) {
		return
	}
	res, err := s.auth.CreateChallenge(s.binding, req)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}
func (s *Server) verify(w http.ResponseWriter, r *http.Request) {
	var req appgateway.VerifyChallengeRequest
	if !decode(w, r, &req, 16<<10) {
		return
	}
	res, err := s.auth.VerifyChallenge(s.binding, r.PathValue("id"), req)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) walletSession(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Allow(r.RemoteAddr) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "music auth rate limit exceeded"})
		return
	}
	var q walletExchangeRequest
	if !decode(w, r, &q, 64<<10) {
		return
	}
	if q.ProductClientID != musicProductClient || q.BundleID != musicBundleID || len(q.Response) < 32 || len(q.ExpectedNonce) < 32 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "exact Wallet product binding and response are required"})
		return
	}
	key := responseReplayKey(q.Response)
	s.service.mu.Lock()
	if s.service.state.Idempotency[key] != "" {
		s.service.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Wallet response replay rejected"})
		return
	}
	s.service.mu.Unlock()
	var session walletSession
	if err := s.service.centralJSON(r.Context(), s.service.cfg.WalletSessionURL, s.service.cfg.WalletGatewayKey, q, &session); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "YNX Wallet Gateway unavailable", "central": true})
		return
	}
	if session.Token == "" || session.DeviceID == "" {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Wallet Gateway returned an incomplete session"})
		return
	}
	if _, err := normalizeActor(session.Account); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Wallet Gateway returned an invalid account"})
		return
	}
	if err := s.service.mutate(session.Account, "wallet_session_exchanged", musicProductClient, map[string]string{"deviceId": session.DeviceID, "expiresAt": session.ExpiresAt}, func(st *persistentState) error {
		if st.Idempotency[key] != "" {
			return ErrConflict
		}
		st.Idempotency[key] = "consumed"
		return nil
	}); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

type apiHandler func(http.ResponseWriter, *http.Request, string)

func (s *Server) api(next apiHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.Allow(r.RemoteAddr) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "music API rate limit exceeded"})
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		session, err := s.auth.AuthenticateSession(s.binding, token, r.Header.Get("X-YNX-Device-ID"))
		if err != nil {
			var central walletSession
			verify := map[string]string{"token": token, "deviceId": r.Header.Get("X-YNX-Device-ID"), "productClientId": musicProductClient, "bundleId": musicBundleID}
			if token == "" || s.service.centralJSON(r.Context(), s.service.cfg.WalletVerifyURL, s.service.cfg.WalletGatewayKey, verify, &central) != nil || central.Token != token || central.DeviceID != verify["deviceId"] {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in with YNX Wallet session required"})
				return
			}
			if _, e := normalizeActor(central.Account); e != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Wallet session account invalid"})
				return
			}
			next(w, r, central.Account)
			return
		}
		next(w, r, session.Account)
	}
}
func (s *Server) me(w http.ResponseWriter, r *http.Request, a string) {
	writeJSON(w, http.StatusOK, s.service.Snapshot(a))
}
func (s *Server) profile(w http.ResponseWriter, r *http.Request, a string) {
	var req Profile
	if !decode(w, r, &req, 32<<10) {
		return
	}
	p, e := s.service.UpsertProfile(a, req)
	result(w, p, e)
}
func (s *Server) creator(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		DisplayName string `json:"displayName"`
		Bio         string `json:"bio"`
	}
	if !decode(w, r, &q, 8<<10) {
		return
	}
	p, e := s.service.OnboardCreator(a, q.DisplayName, q.Bio)
	result(w, p, e)
}
func fileUpload(h *multipart.FileHeader) (Upload, error) {
	f, e := h.Open()
	if e != nil {
		return Upload{}, e
	}
	return Upload{Reader: f, MIME: h.Header.Get("Content-Type"), Filename: h.Filename}, nil
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request, a string) {
	r.Body = http.MaxBytesReader(w, r.Body, s.service.cfg.MaxUploadBytes+s.service.cfg.MaxUploadBytes/4+1<<20)
	if e := r.ParseMultipartForm(1 << 20); e != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid or oversized multipart upload"})
		return
	}
	audioHeader, _, e := r.FormFile("audio")
	if e != nil {
		writeJSON(w, 400, map[string]string{"error": "audio is required"})
		return
	}
	audioFH := r.MultipartForm.File["audio"][0]
	audio := Upload{Reader: audioHeader, MIME: audioFH.Header.Get("Content-Type"), Filename: audioFH.Filename}
	defer audioHeader.Close()
	var art *Upload
	if hs := r.MultipartForm.File["artwork"]; len(hs) > 0 {
		u, e := fileUpload(hs[0])
		if e != nil {
			writeErr(w, e)
			return
		}
		if c, ok := u.Reader.(io.Closer); ok {
			defer c.Close()
		}
		art = &u
	}
	explicit, _ := strconv.ParseBool(r.FormValue("explicit"))
	t, e := s.service.UploadTrack(a, TrackUpload{Title: r.FormValue("title"), ArtistName: r.FormValue("artistName"), Album: r.FormValue("album"), Description: r.FormValue("description"), Explicit: explicit, Audio: audio, Artwork: art, AudioProvenance: r.FormValue("audioProvenance"), ArtworkProvenance: r.FormValue("artworkProvenance"), RightsBasis: r.FormValue("rightsBasis"), Territories: strings.FieldsFunc(r.FormValue("territories"), func(v rune) bool { return v == ',' }), Licensor: r.FormValue("licensor"), EvidenceRef: r.FormValue("evidenceRef")})
	resultStatus(w, t, e, http.StatusCreated)
}
func (s *Server) release(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		State  string `json:"state"`
		Reason string `json:"reason"`
	}
	if !decode(w, r, &q, 8<<10) {
		return
	}
	t, e := s.service.SetRelease(a, r.PathValue("id"), q.State, q.Reason)
	result(w, t, e)
}
func (s *Server) catalog(w http.ResponseWriter, r *http.Request, a string) {
	v, e := s.service.Catalog(a, r.URL.Query().Get("q"))
	result(w, map[string]any{"tracks": v}, e)
}
func (s *Server) track(w http.ResponseWriter, r *http.Request, a string) {
	v, e := s.service.Track(a, r.PathValue("id"))
	result(w, v, e)
}
func (s *Server) media(w http.ResponseWriter, r *http.Request, a string) {
	s.serveMedia(w, r, a, "audio")
}
func (s *Server) artwork(w http.ResponseWriter, r *http.Request, a string) {
	s.serveMedia(w, r, a, "artwork")
}
func (s *Server) serveMedia(w http.ResponseWriter, r *http.Request, a, kind string) {
	file, mime, e := s.service.Media(a, r.PathValue("id"), kind)
	if e != nil {
		writeErr(w, e)
		return
	}
	f, e := os.Open(file)
	if e != nil {
		writeErr(w, e)
		return
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		writeErr(w, e)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, path.Base(file), st.ModTime(), f)
}
func (s *Server) library(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		Favorites, Queue []string
		Downloads        map[string]string
	}
	if !decode(w, r, &q, 64<<10) {
		return
	}
	v, e := s.service.UpdateLibrary(a, q.Favorites, q.Queue, q.Downloads)
	result(w, v, e)
}
func (s *Server) position(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		SessionRef     string `json:"sessionRef"`
		PositionMillis int64  `json:"positionMillis"`
		Completed      bool   `json:"completed"`
	}
	if !decode(w, r, &q, 8<<10) {
		return
	}
	l, u, e := s.service.SavePosition(a, r.PathValue("id"), q.SessionRef, q.PositionMillis, q.Completed)
	result(w, map[string]any{"listener": l, "usage": u}, e)
}
func (s *Server) playlist(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		Name, Description string
		TrackIDs          []string
	}
	if !decode(w, r, &q, 32<<10) {
		return
	}
	v, e := s.service.CreatePlaylist(a, q.Name, q.Description, q.TrackIDs)
	resultStatus(w, v, e, http.StatusCreated)
}
func (s *Server) openCase(w http.ResponseWriter, r *http.Request, a string) {
	var q struct{ Kind, TrackID, Reason, EvidenceRef string }
	if !decode(w, r, &q, 16<<10) {
		return
	}
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotency == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Idempotency-Key is required for YNX Trust"})
		return
	}
	var v Case
	var e error
	if old, ok := s.service.Idempotency("trust", idempotency); ok {
		v, e = s.service.CaseByID(a, old)
	} else {
		v, e = s.service.OpenCase(a, q.Kind, q.TrackID, q.Reason, q.EvidenceRef)
		if e == nil {
			e = s.service.ClaimIdempotency(a, "trust", idempotency, v.ID)
		}
	}
	if e != nil {
		resultStatus(w, v, e, http.StatusCreated)
		return
	}
	if v.Kind != q.Kind || v.TrackID != q.TrackID || v.Reason != strings.TrimSpace(q.Reason) || v.EvidenceRef != strings.TrimSpace(q.EvidenceRef) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "YNX Trust idempotency tamper rejected"})
		return
	}
	input := map[string]any{"type": "open_case", "idempotencyKey": idempotency, "subject": q.TrackID, "requestScope": "music.rights", "purpose": q.Reason, "requestedAction": q.Kind, "evidence": []map[string]any{{"source": "ynx-music", "digest": q.EvidenceRef, "summary": q.Reason, "collectedAt": s.service.cfg.Now().UTC(), "visibleToSubject": true}}}
	var central struct {
		ID string `json:"id"`
	}
	if err := s.service.centralJSON(r.Context(), s.service.cfg.TrustGatewayURL, s.service.cfg.TrustGatewayKey, input, &central); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "YNX Trust unavailable", "localCase": v, "central": true})
		return
	}
	v, e = s.service.LinkCentralCase(a, v.ID, central.ID)
	resultStatus(w, v, e, http.StatusCreated)
}
func (s *Server) allocate(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		SourceRecord   string
		AmountMicros   int64
		UsageRecordIDs []string
	}
	if !decode(w, r, &q, 32<<10) {
		return
	}
	v, e := s.service.Allocate(a, q.SourceRecord, q.AmountMicros, q.UsageRecordIDs)
	resultStatus(w, v, e, http.StatusCreated)
}
func (s *Server) settlement(w http.ResponseWriter, r *http.Request, a string) {
	var q struct{ AllocationID, PayTo string }
	if !decode(w, r, &q, 8<<10) {
		return
	}
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotency == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Idempotency-Key is required for YNX Pay"})
		return
	}
	var v SettlementIntent
	var e error
	if old, ok := s.service.Idempotency("pay", idempotency); ok {
		v, e = s.service.SettlementByID(a, old)
	} else {
		v, e = s.service.Settlement(a, q.AllocationID, q.PayTo)
		if e == nil {
			e = s.service.ClaimIdempotency(a, "pay", idempotency, v.ID)
		}
	}
	if e != nil {
		resultStatus(w, v, e, http.StatusCreated)
		return
	}
	if v.AllocationID != q.AllocationID || v.PayTo != q.PayTo {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "YNX Pay idempotency tamper rejected"})
		return
	}
	input := map[string]any{"type": "music_creator_settlement", "idempotencyKey": idempotency, "productIntentId": v.ID, "asset": "YNXT", "amountMicros": v.AmountMicros, "payTo": v.PayTo, "status": "requires_wallet_review"}
	var central struct {
		ID        string `json:"id"`
		ReviewURI string `json:"reviewUri"`
		Status    string `json:"status"`
	}
	if err := s.service.centralJSON(r.Context(), s.service.cfg.PayGatewayURL, s.service.cfg.PayGatewayKey, input, &central); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "YNX Pay unavailable; intent is not paid", "localIntent": v, "central": true})
		return
	}
	if central.Status != "requires_wallet_review" {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "YNX Pay returned an unsafe settlement state"})
		return
	}
	v, e = s.service.LinkCentralSettlement(a, v.ID, central.ID, central.ReviewURI)
	resultStatus(w, v, e, http.StatusCreated)
}
func (s *Server) aiProposal(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		Kind, Intent, Provider, Model string
		TrackIDs                      []string
		Permission                    bool
	}
	if !decode(w, r, &q, 32<<10) {
		return
	}
	v, e := s.service.CreateAIProposal(a, q.Kind, q.Intent, q.Provider, q.Model, q.TrackIDs, q.Permission)
	resultStatus(w, v, e, http.StatusAccepted)
}
func (s *Server) aiStatus(w http.ResponseWriter, r *http.Request, a string) {
	if strings.TrimSpace(s.service.cfg.AIGatewayURL) == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "configured": false, "error": "YNX AI Gateway is not configured"})
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, strings.TrimRight(s.service.cfg.AIGatewayURL, "/")+"/health", nil)
	req.Header.Set("X-YNX-AI-Key", s.service.cfg.AIGatewayKey)
	resp, err := s.service.cfg.HTTPClient.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]any{"ok": false, "configured": true, "error": err.Error()})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 64<<10))
}
func (s *Server) aiStream(w http.ResponseWriter, r *http.Request, a string) {
	id := r.PathValue("id")
	proposal, err := s.service.SetAIStatus(a, id, "streaming", "")
	if err != nil {
		writeErr(w, err)
		return
	}
	gateway := strings.TrimRight(strings.TrimSpace(s.service.cfg.AIGatewayURL), "/")
	if gateway == "" || s.service.cfg.AIGatewayKey == "" {
		_, _ = s.service.SetAIStatus(a, id, "provider_failed", "YNX AI Gateway is not configured")
		writeJSON(w, 503, map[string]string{"error": "YNX AI Gateway is not configured; no result was generated"})
		return
	}
	q := url.Values{}
	q.Set("session", proposal.ID)
	q.Set("q", proposal.Intent+". Use only these authorized YNX Music track IDs: "+strings.Join(proposal.ContextTrackIDs, ","))
	up, err := http.NewRequestWithContext(r.Context(), http.MethodGet, gateway+"/ai/stream?"+q.Encode(), nil)
	if err != nil {
		writeErr(w, err)
		return
	}
	up.Header.Set("X-YNX-AI-Key", s.service.cfg.AIGatewayKey)
	resp, err := s.service.cfg.HTTPClient.Do(up)
	if err != nil {
		status := "provider_failed"
		if errors.Is(err, context.Canceled) {
			status = "cancelled"
		}
		_, _ = s.service.SetAIStatus(a, id, status, err.Error())
		writeJSON(w, 502, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_, _ = s.service.SetAIStatus(a, id, "provider_failed", string(body))
		writeJSON(w, 502, map[string]string{"error": "YNX AI Gateway rejected the request"})
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, 500, map[string]string{"error": "streaming unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	var result strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			var token struct {
				Text string `json:"text"`
			}
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &token) == nil {
				result.WriteString(token.Text)
			}
		}
		_, _ = fmt.Fprintln(w, line)
		flusher.Flush()
	}
	if r.Context().Err() != nil {
		_, _ = s.service.SetAIStatus(a, id, "cancelled", result.String())
		return
	}
	if err := scanner.Err(); err != nil {
		_, _ = s.service.SetAIStatus(a, id, "provider_failed", err.Error())
		return
	}
	_, _ = s.service.SetAIStatus(a, id, "completed", result.String())
}
func (s *Server) aiReview(w http.ResponseWriter, r *http.Request, a string) {
	var q struct {
		Action string `json:"action"`
		Name   string `json:"name"`
	}
	if !decode(w, r, &q, 8<<10) {
		return
	}
	if q.Action == "reject" {
		p, e := s.service.AIProposal(a, r.PathValue("id"))
		if e == nil {
			p, e = s.service.SetAIStatus(a, p.ID, "rejected", p.Result)
		}
		result(w, p, e)
		return
	}
	if q.Action == "apply" {
		p, applied, e := s.service.ApplyAIResult(a, r.PathValue("id"), q.Name)
		result(w, map[string]any{"proposal": p, "applied": applied}, e)
		return
	}
	writeErr(w, ErrInvalid)
}
func decode(w http.ResponseWriter, r *http.Request, out any, limit int64) bool {
	defer r.Body.Close()
	d := json.NewDecoder(io.LimitReader(r.Body, limit+1))
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid JSON request"})
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		writeJSON(w, 400, map[string]string{"error": "request must contain one JSON value"})
		return false
	}
	return true
}
func result(w http.ResponseWriter, v any, e error) { resultStatus(w, v, e, http.StatusOK) }
func resultStatus(w http.ResponseWriter, v any, e error, status int) {
	if e != nil {
		writeErr(w, e)
		return
	}
	writeJSON(w, status, v)
}
func writeErr(w http.ResponseWriter, e error) {
	status := 500
	switch {
	case errors.Is(e, ErrInvalid):
		status = 400
	case errors.Is(e, ErrUnauthorized), errors.Is(e, appgateway.ErrSessionUnauthorized):
		status = 403
	case errors.Is(e, ErrNotFound):
		status = 404
	case errors.Is(e, ErrConflict):
		status = 409
	}
	writeJSON(w, status, map[string]string{"error": e.Error()})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

var _ = fmt.Sprintf
var _ = time.Second
