package aiproduct

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Config struct {
	GatewayURL              string
	GatewayKey              string
	ExactWalletCallback     string
	TrustURL                string
	ProviderName            string
	InputUSDPerMillion      float64
	OutputUSDPerMillion     float64
	ResourceUnitsPerKTokens int64
	GenerationTimeout       time.Duration
}

type Server struct {
	cfg         Config
	store       *Store
	client      *http.Client
	mux         *http.ServeMux
	static      fs.FS
	mu          sync.Mutex
	generations map[string]context.CancelFunc
	visitors    map[string][]time.Time
}

func NewServer(cfg Config, store *Store, static fs.FS) (*Server, error) {
	cfg.GatewayURL = strings.TrimRight(strings.TrimSpace(cfg.GatewayURL), "/")
	parsed, err := url.Parse(cfg.GatewayURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("exact AI Gateway URL is required")
	}
	if len(strings.TrimSpace(cfg.GatewayKey)) < 16 {
		return nil, errors.New("server-side AI Gateway key must contain at least 16 characters")
	}
	if cfg.ExactWalletCallback == "" {
		return nil, errors.New("exact YNX Wallet callback is required")
	}
	if cfg.ProviderName == "" {
		cfg.ProviderName = "configured OpenAI-compatible provider"
	}
	if cfg.ResourceUnitsPerKTokens <= 0 {
		cfg.ResourceUnitsPerKTokens = 1
	}
	if cfg.GenerationTimeout <= 0 {
		cfg.GenerationTimeout = 45 * time.Second
	}
	s := &Server{cfg: cfg, store: store, client: &http.Client{Timeout: cfg.GenerationTimeout + 5*time.Second}, mux: http.NewServeMux(), static: static, generations: map[string]context.CancelFunc{}, visitors: map[string][]time.Time{}}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler { return securityHeaders(s.mux) }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/meta", s.handleMeta)
	s.mux.HandleFunc("POST /api/auth/challenges", s.handleChallenge)
	s.mux.HandleFunc("POST /api/auth/challenges/{id}/verify", s.handleVerify)
	s.mux.HandleFunc("POST /api/auth/revoke", s.authed("", s.handleRevoke))
	s.mux.HandleFunc("GET /api/provider", s.authed("ai:generate", s.handleProvider))
	s.mux.HandleFunc("GET /api/usage", s.authed("ai:data-control", s.handleUsage))
	s.mux.HandleFunc("GET /api/conversations", s.authed("ai:conversations", s.handleConversationList))
	s.mux.HandleFunc("POST /api/conversations", s.authed("ai:conversations", s.handleConversationCreate))
	s.mux.HandleFunc("GET /api/conversations/{id}", s.authed("ai:conversations", s.handleConversationGet))
	s.mux.HandleFunc("PATCH /api/conversations/{id}", s.authed("ai:conversations", s.handleConversationPatch))
	s.mux.HandleFunc("DELETE /api/conversations/{id}", s.authed("ai:conversations", s.handleConversationDelete))
	s.mux.HandleFunc("POST /api/conversations/{id}/generate", s.authed("ai:generate", s.handleGenerate))
	s.mux.HandleFunc("GET /api/conversations/{id}/export", s.authed("ai:data-control", s.handleExport))
	s.mux.HandleFunc("POST /api/generations/{id}/cancel", s.authed("ai:generate", s.handleCancel))
	s.mux.HandleFunc("GET /api/permissions", s.authed("ai:permissions", s.handlePermissionList))
	s.mux.HandleFunc("POST /api/permissions", s.authed("ai:permissions", s.handlePermissionCreate))
	s.mux.HandleFunc("GET /api/actions", s.authed("ai:permissions", s.handleActionList))
	s.mux.HandleFunc("POST /api/actions", s.authed("ai:permissions", s.handleActionCreate))
	s.mux.HandleFunc("POST /api/actions/{id}/review", s.authed("ai:permissions", s.handleActionReview))
	s.mux.HandleFunc("GET /api/audit", s.authed("ai:data-control", s.handleAudit))
	s.mux.HandleFunc("GET /api/privacy", s.authed("ai:data-control", s.handlePrivacyGet))
	s.mux.HandleFunc("PUT /api/privacy", s.authed("ai:data-control", s.handlePrivacyPut))
	s.mux.HandleFunc("DELETE /api/privacy/data", s.authed("ai:data-control", s.handleDataDelete))
	s.mux.HandleFunc("GET /api/appeals", s.authed("ai:data-control", s.handleAppealList))
	s.mux.HandleFunc("POST /api/appeals", s.authed("ai:data-control", s.handleAppealCreate))
	if s.static != nil {
		s.mux.Handle("/", http.FileServer(http.FS(s.static)))
	}
}

type authedHandler func(http.ResponseWriter, *http.Request, ProductSession)

func (s *Server) authed(scope string, next authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := s.store.Authenticate(r.Header.Get("Authorization"), r.Header.Get("X-YNX-Device-ID"))
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		if scope != "" && !hasScope(session.Scopes, scope) {
			writeError(w, http.StatusForbidden, "product session does not include the required scope")
			return
		}
		limit := 240
		if scope == "ai:generate" && r.Method == http.MethodPost {
			limit = 30
		}
		if !s.allow(session.ID, limit, time.Now().UTC()) {
			writeError(w, http.StatusTooManyRequests, "YNX AI client rate limit exceeded")
			return
		}
		next(w, r, session)
	}
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}
func (s *Server) allow(key string, limit int, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := now.Add(-time.Minute)
	kept := s.visitors[key][:0]
	for _, at := range s.visitors[key] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= limit {
		s.visitors[key] = kept
		return false
	}
	s.visitors[key] = append(kept, now)
	return true
}

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"product": ProductID, "chainId": ChainID, "network": ChainNetwork, "nativeAsset": NativeAsset, "walletCallback": s.cfg.ExactWalletCallback, "scopes": []string{"ai:conversations", "ai:generate", "ai:permissions", "ai:data-control"}, "truthBoundary": "provider output only appears after a successful provider-backed Gateway stream"})
}
func (s *Server) handleChallenge(w http.ResponseWriter, r *http.Request) {
	var in ChallengeInput
	if !decodeJSON(w, r, &in, 32<<10) {
		return
	}
	out, err := s.store.CreateWalletChallenge(in, s.cfg.ExactWalletCallback)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, out)
}
func (s *Server) handleVerify(w http.ResponseWriter, r *http.Request) {
	var in VerifyInput
	if !decodeJSON(w, r, &in, 32<<10) {
		return
	}
	out, err := s.store.VerifyWalletChallenge(r.PathValue("id"), in)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, out)
}
func (s *Server) handleRevoke(w http.ResponseWriter, r *http.Request, session ProductSession) {
	if err := s.store.RevokeSession(r.Header.Get("Authorization"), r.Header.Get("X-YNX-Device-ID")); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gatewayRequest(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.cfg.GatewayURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-YNX-AI-Key", s.cfg.GatewayKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return s.client.Do(req)
}

func (s *Server) providerStatus(ctx context.Context) map[string]any {
	resp, err := s.gatewayRequest(ctx, http.MethodGet, "/health", nil)
	if err != nil {
		return map[string]any{"available": false, "status": "unavailable", "error": "YNX AI Gateway is unreachable", "quotaKnown": false, "quota": "not reported by provider", "provider": s.cfg.ProviderName}
	}
	defer resp.Body.Close()
	var health map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&health); err != nil {
		return map[string]any{"available": false, "status": "unavailable", "error": "YNX AI Gateway returned an invalid health response", "quotaKnown": false, "quota": "not reported by provider", "provider": s.cfg.ProviderName}
	}
	available := resp.StatusCode == http.StatusOK && health["ok"] == true
	health["available"] = available
	health["status"] = map[bool]string{true: "available", false: "unavailable"}[available]
	health["quotaKnown"] = false
	health["quota"] = "not reported by provider"
	health["provider"] = s.cfg.ProviderName
	return health
}
func (s *Server) handleProvider(w http.ResponseWriter, r *http.Request, session ProductSession) {
	status := s.providerStatus(r.Context())
	code := http.StatusOK
	if status["available"] != true {
		code = http.StatusBadGateway
	}
	writeJSON(w, code, status)
}
func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request, session ProductSession) {
	writeJSON(w, http.StatusOK, map[string]any{"usage": s.store.Usage(session.Account), "quotaKnown": false, "quota": "not reported by provider", "warning": "Token, resource, and money values are estimates because the current Gateway does not return provider usage metadata."})
}

func (s *Server) handleConversationList(w http.ResponseWriter, r *http.Request, session ProductSession) {
	archived, _ := strconv.ParseBool(r.URL.Query().Get("archived"))
	writeJSON(w, http.StatusOK, map[string]any{"conversations": s.store.ListConversations(session.Account, archived)})
}
func (s *Server) handleConversationCreate(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		Title string `json:"title"`
	}
	if !decodeJSON(w, r, &in, 8<<10) {
		return
	}
	c, err := s.store.CreateConversation(session.Account, in.Title)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, c)
}
func (s *Server) handleConversationGet(w http.ResponseWriter, r *http.Request, session ProductSession) {
	c, messages, err := s.store.Conversation(session.Account, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "conversation not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversation": c, "messages": messages})
}
func (s *Server) handleConversationPatch(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		Title    *string `json:"title"`
		Archived *bool   `json:"archived"`
	}
	if !decodeJSON(w, r, &in, 8<<10) {
		return
	}
	id := r.PathValue("id")
	var c Conversation
	var err error
	if in.Title != nil {
		c, err = s.store.RenameConversation(session.Account, id, *in.Title)
	} else if in.Archived != nil {
		c, err = s.store.ArchiveConversation(session.Account, id, *in.Archived)
	} else {
		err = errors.New("title or archived is required")
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, c)
}
func (s *Server) handleConversationDelete(w http.ResponseWriter, r *http.Request, session ProductSession) {
	if r.URL.Query().Get("confirm") != "delete" {
		writeError(w, http.StatusBadRequest, "confirm=delete is required")
		return
	}
	if err := s.store.DeleteConversation(session.Account, r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, "conversation not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type generationInput struct {
	GenerationID    string   `json:"generationId"`
	Prompt          string   `json:"prompt"`
	Provider        string   `json:"provider"`
	Model           string   `json:"model"`
	IncludedContext []string `json:"includedContext"`
	ExcludedContext []string `json:"excludedContext"`
	RetryOf         string   `json:"retryOf"`
}

func (s *Server) handleGenerate(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in generationInput
	if !decodeJSON(w, r, &in, 64<<10) {
		return
	}
	in.GenerationID = boundedText(in.GenerationID, 100)
	in.Prompt = boundedText(in.Prompt, 8000)
	if in.GenerationID == "" || in.Prompt == "" {
		writeError(w, http.StatusBadRequest, "generationId and prompt are required")
		return
	}
	if _, _, err := s.store.Conversation(session.Account, r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, "conversation not found")
		return
	}
	policy := s.store.Policy(session.Account)
	if err := validateContext(policy, in.IncludedContext, in.ExcludedContext); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := s.providerStatus(r.Context())
	if status["available"] != true {
		writeError(w, http.StatusBadGateway, "AI provider is unavailable; no substitute answer was generated")
		return
	}
	model, _ := status["model"].(string)
	if in.Model != "" && in.Model != model {
		writeError(w, http.StatusBadRequest, "requested model is not the model configured by the YNX AI Gateway")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.GenerationTimeout)
	s.mu.Lock()
	if _, exists := s.generations[in.GenerationID]; exists {
		s.mu.Unlock()
		cancel()
		writeError(w, http.StatusConflict, "generationId is already active")
		return
	}
	s.generations[in.GenerationID] = cancel
	s.mu.Unlock()
	defer func() { cancel(); s.mu.Lock(); delete(s.generations, in.GenerationID); s.mu.Unlock() }()
	user := Message{Role: "user", Content: in.Prompt, Status: "complete", IncludedContext: cleanList(in.IncludedContext), ExcludedContext: cleanList(in.ExcludedContext), RetryOf: in.RetryOf}
	if _, err := s.store.AddMessage(session.Account, r.PathValue("id"), user); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	path := "/ai/stream?session=" + url.QueryEscape(r.PathValue("id")) + "&q=" + url.QueryEscape(in.Prompt)
	resp, err := s.gatewayRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		s.streamFailure(w, "timeout_or_gateway_unavailable", in.GenerationID)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		message := "AI provider is unavailable; no substitute answer was generated"
		if len(raw) > 0 {
			message += " (Gateway request failed)"
		}
		s.streamFailure(w, message, in.GenerationID)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	writeSSE(w, "metadata", map[string]any{"generationId": in.GenerationID, "provider": s.cfg.ProviderName, "model": model, "actualUsageReported": false})
	flusher.Flush()
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	event := ""
	answer := strings.Builder{}
	requestID := ""
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		switch event {
		case "metadata":
			var meta map[string]any
			_ = json.Unmarshal([]byte(data), &meta)
			requestID, _ = meta["requestId"].(string)
		case "token":
			var token struct {
				Text string `json:"text"`
			}
			if json.Unmarshal([]byte(data), &token) == nil && token.Text != "" {
				answer.WriteString(token.Text)
				writeSSE(w, "token", token)
				flusher.Flush()
			}
		case "done":
			event = "done"
		}
	}
	if err := scanner.Err(); err != nil || ctx.Err() != nil {
		s.streamFailureAfterStart(w, flusher, "Generation interrupted. Retry is available; no completion was claimed.", in.GenerationID)
		return
	}
	if strings.TrimSpace(answer.String()) == "" {
		s.streamFailureAfterStart(w, flusher, "Provider returned no content; no substitute answer was generated.", in.GenerationID)
		return
	}
	cost := s.estimateCost(in.Prompt, answer.String())
	assistant := Message{Role: "assistant", Content: answer.String(), Status: "complete", Provider: s.cfg.ProviderName, Model: model, RequestID: requestID, RetryOf: in.RetryOf, IncludedContext: cleanList(in.IncludedContext), ExcludedContext: cleanList(in.ExcludedContext), Cost: cost}
	saved, err := s.store.AddMessage(session.Account, r.PathValue("id"), assistant)
	if err != nil {
		s.streamFailureAfterStart(w, flusher, "Response arrived but encrypted persistence failed.", in.GenerationID)
		return
	}
	writeSSE(w, "done", map[string]any{"generationId": in.GenerationID, "messageId": saved.ID, "cost": cost})
	flusher.Flush()
}

func (s *Server) streamFailure(w http.ResponseWriter, message, generationID string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	writeSSE(w, "error", map[string]any{"generationId": generationID, "error": message, "retryable": true})
}
func (s *Server) streamFailureAfterStart(w http.ResponseWriter, flusher http.Flusher, message, generationID string) {
	writeSSE(w, "error", map[string]any{"generationId": generationID, "error": message, "retryable": true})
	flusher.Flush()
}
func writeSSE(w io.Writer, event string, value any) {
	raw, _ := json.Marshal(value)
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, raw)
}

func (s *Server) estimateCost(prompt, answer string) Cost {
	input := int64((len([]rune(prompt)) + 3) / 4)
	output := int64((len([]rune(answer)) + 3) / 4)
	tokens := input + output
	moneyKnown := s.cfg.InputUSDPerMillion > 0 || s.cfg.OutputUSDPerMillion > 0
	money := float64(input)*s.cfg.InputUSDPerMillion/1_000_000 + float64(output)*s.cfg.OutputUSDPerMillion/1_000_000
	units := (tokens*s.cfg.ResourceUnitsPerKTokens + 999) / 1000
	return Cost{InputTokensEstimate: input, OutputTokensEstimate: output, ResourceUnits: units, MoneyUSD: money, MoneyKnown: moneyKnown, ActualUsageReported: false, Basis: "character-based estimate; Gateway/provider usage metadata unavailable"}
}
func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request, session ProductSession) {
	s.mu.Lock()
	cancel, ok := s.generations[r.PathValue("id")]
	s.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "generation is not active")
		return
	}
	cancel()
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "cancelling", "generationId": r.PathValue("id")})
}
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request, session ProductSession) {
	c, messages, err := s.store.Conversation(session.Account, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "conversation not found")
		return
	}
	if r.URL.Query().Get("format") == "text" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=ynx-ai-conversation.txt")
		_, _ = fmt.Fprintf(w, "%s\n\n", c.Title)
		for _, m := range messages {
			_, _ = fmt.Fprintf(w, "[%s] %s\n\n", m.Role, m.Content)
		}
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=ynx-ai-conversation.json")
	writeJSON(w, http.StatusOK, map[string]any{"conversation": c, "messages": messages, "exportedAt": time.Now().UTC(), "privacyNotice": "Export contains decrypted conversation content selected by the signed-in user."})
}

func (s *Server) handlePermissionCreate(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		ConversationID string `json:"conversationId"`
		Scope          string `json:"scope"`
		Purpose        string `json:"purpose"`
		ExpiryHours    int64  `json:"expiryHours"`
	}
	if !decodeJSON(w, r, &in, 16<<10) {
		return
	}
	if in.ExpiryHours < 1 || in.ExpiryHours > 24 || boundedText(in.Scope, 80) == "" || boundedText(in.Purpose, 240) == "" {
		writeError(w, http.StatusBadRequest, "bounded scope, purpose, and 1-24 hour expiry are required")
		return
	}
	payload := map[string]any{"sessionId": in.ConversationID, "requester": session.Account, "scope": in.Scope, "purpose": in.Purpose, "expiryHours": in.ExpiryHours}
	resp, err := s.gatewayRequest(r.Context(), http.MethodPost, "/ai/permissions", payload)
	if err != nil {
		writeError(w, http.StatusBadGateway, "permission Gateway unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, "permission was not accepted by the Gateway")
		return
	}
	var gateway map[string]any
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&gateway) != nil {
		writeError(w, http.StatusBadGateway, "invalid permission Gateway response")
		return
	}
	gatewayID, _ := gateway["id"].(string)
	record := PermissionRecord{ID: randomID("permission"), Account: session.Account, SessionID: in.ConversationID, Scope: in.Scope, Purpose: in.Purpose, Status: "active", GatewayID: gatewayID, CreatedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(time.Duration(in.ExpiryHours) * time.Hour)}
	if err := s.store.SavePermission(record); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, record)
}
func (s *Server) handlePermissionList(w http.ResponseWriter, r *http.Request, session ProductSession) {
	writeJSON(w, http.StatusOK, map[string]any{"permissions": s.store.Permissions(session.Account)})
}

func (s *Server) handleActionCreate(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		ConversationID string `json:"conversationId"`
		Kind           string `json:"kind"`
		Scope          string `json:"scope"`
		Description    string `json:"description"`
		PayloadPreview string `json:"payloadPreview"`
	}
	if !decodeJSON(w, r, &in, 32<<10) {
		return
	}
	if in.Kind != "tool" && in.Kind != "action" && in.Kind != "chain_action" {
		writeError(w, http.StatusBadRequest, "kind must be tool, action, or chain_action")
		return
	}
	if boundedText(in.Description, 500) == "" || boundedText(in.Scope, 80) == "" {
		writeError(w, http.StatusBadRequest, "scope and description are required")
		return
	}
	payload := map[string]any{"sessionId": in.ConversationID, "requester": session.Account, "scope": in.Scope, "actionType": in.Kind, "description": in.Description, "expiryHours": 1}
	resp, err := s.gatewayRequest(r.Context(), http.MethodPost, "/ai/actions", payload)
	if err != nil {
		writeError(w, http.StatusBadGateway, "action review Gateway unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, "action proposal was rejected by the Gateway")
		return
	}
	var gateway map[string]any
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&gateway) != nil {
		writeError(w, http.StatusBadGateway, "invalid action Gateway response")
		return
	}
	gatewayID, _ := gateway["id"].(string)
	record := ActionRecord{ID: randomID("action"), Account: session.Account, ConversationID: in.ConversationID, Kind: in.Kind, Scope: in.Scope, Description: boundedText(in.Description, 500), PayloadPreview: boundedText(in.PayloadPreview, 1000), Status: "pending_review", GatewayID: gatewayID, WalletStillNeeded: in.Kind == "chain_action", CreatedAt: time.Now().UTC()}
	if err := s.store.SaveAction(record); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, record)
}
func (s *Server) handleActionList(w http.ResponseWriter, r *http.Request, session ProductSession) {
	writeJSON(w, http.StatusOK, map[string]any{"actions": s.store.Actions(session.Account), "executionBoundary": "approval records review only; YNX AI never signs, transfers, publishes, sends, changes permissions, freezes, or bypasses Wallet/Trust"})
}
func (s *Server) handleActionReview(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		Decision            string `json:"decision"`
		PermissionGatewayID string `json:"permissionGatewayId"`
	}
	if !decodeJSON(w, r, &in, 8<<10) {
		return
	}
	record, ok := s.store.Action(session.Account, r.PathValue("id"))
	if !ok || record.Status != "pending_review" {
		writeError(w, http.StatusNotFound, "pending action not found")
		return
	}
	if in.Decision != "approve" && in.Decision != "reject" {
		writeError(w, http.StatusBadRequest, "decision must be approve or reject")
		return
	}
	path := "/ai/actions/" + url.PathEscape(record.GatewayID) + "/" + in.Decision
	payload := map[string]any{"approver": session.Account}
	if in.Decision == "approve" {
		if in.PermissionGatewayID == "" {
			writeError(w, http.StatusBadRequest, "explicit permissionGatewayId is required for approval")
			return
		}
		payload["permissionId"] = in.PermissionGatewayID
	}
	resp, err := s.gatewayRequest(r.Context(), http.MethodPost, path, payload)
	if err != nil {
		writeError(w, http.StatusBadGateway, "action review Gateway unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, http.StatusBadRequest, "Gateway rejected the review decision")
		return
	}
	record.Status = map[string]string{"approve": "approved_not_executed", "reject": "rejected"}[in.Decision]
	record.PermissionID = in.PermissionGatewayID
	record.ReviewedAt = time.Now().UTC()
	if err := s.store.SaveAction(record); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"action": record, "executed": false, "nextBoundary": map[bool]string{true: "open YNX Wallet for a separate transaction review and signature", false: "no action executes automatically"}[record.WalletStillNeeded]})
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request, session ProductSession) {
	writeJSON(w, http.StatusOK, map[string]any{"audit": s.store.Audits(session.Account), "integrity": "SHA-256 linked local audit chain; Gateway retains its separate prompt-hash audit"})
}
func (s *Server) handlePrivacyGet(w http.ResponseWriter, r *http.Request, session ProductSession) {
	writeJSON(w, http.StatusOK, map[string]any{"policy": s.store.Policy(session.Account), "contentProtection": "AES-256-GCM at rest with account/conversation/message associated data", "providerBoundary": "only context explicitly included for a generation is sent; secrets and recovery material are forbidden"})
}
func (s *Server) handlePrivacyPut(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in DataPolicy
	if !decodeJSON(w, r, &in, 16<<10) {
		return
	}
	p, err := s.store.SetPolicy(session.Account, in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}
func (s *Server) handleDataDelete(w http.ResponseWriter, r *http.Request, session ProductSession) {
	if r.URL.Query().Get("confirm") != "delete-all" {
		writeError(w, http.StatusBadRequest, "confirm=delete-all is required")
		return
	}
	if err := s.store.DeleteAccount(session.Account); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) handleAppealCreate(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		ConversationID string `json:"conversationId"`
		ActionID       string `json:"actionId"`
		Reason         string `json:"reason"`
	}
	if !decodeJSON(w, r, &in, 16<<10) {
		return
	}
	if boundedText(in.Reason, 1000) == "" {
		writeError(w, http.StatusBadRequest, "appeal reason is required")
		return
	}
	record := Appeal{ID: randomID("appeal"), Account: session.Account, ConversationID: in.ConversationID, ActionID: in.ActionID, Reason: boundedText(in.Reason, 1000), Status: "submitted_for_trust_review", TrustURL: s.cfg.TrustURL, CreatedAt: time.Now().UTC()}
	if err := s.store.SaveAppeal(record); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, record)
}
func (s *Server) handleAppealList(w http.ResponseWriter, r *http.Request, session ProductSession) {
	writeJSON(w, http.StatusOK, map[string]any{"appeals": s.store.Appeals(session.Account), "trustUrl": s.cfg.TrustURL})
}

func validateContext(policy DataPolicy, included, excluded []string) error {
	allowed := map[string]bool{}
	for _, v := range policy.AllowedContextTypes {
		allowed[v] = true
	}
	seen := map[string]bool{}
	for _, v := range cleanList(included) {
		if !allowed[v] {
			return fmt.Errorf("context type %q is not allowed by the data policy", v)
		}
		seen[v] = true
	}
	for _, v := range cleanList(excluded) {
		if seen[v] {
			return fmt.Errorf("context type %q cannot be both included and excluded", v)
		}
	}
	return nil
}
func cleanList(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
func decodeJSON(w http.ResponseWriter, r *http.Request, out any, max int64) bool {
	decoder := json.NewDecoder(io.LimitReader(r.Body, max+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		writeError(w, http.StatusBadRequest, "request must contain one JSON value")
		return false
	}
	return true
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		next.ServeHTTP(w, r)
	})
}
