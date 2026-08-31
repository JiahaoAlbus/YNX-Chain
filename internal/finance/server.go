package finance

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const maxBodyBytes = 64 << 10

type ServerConfig struct {
	AllowedOrigins       []string
	WebDir               string
	CursorSigningKey     string
	OperationsKey        string
	WalletGatewayURL     string
	WalletGatewayClient  *http.Client
	LogWriter            io.Writer
	Now                  func() time.Time
	Build                buildinfo.Info
	RequireMultiInstance bool
}

type Server struct {
	service   *Service
	auth      *Authenticator
	cfg       ServerConfig
	mux       *http.ServeMux
	cursorKey []byte
	metrics   *financeMetrics
	logger    *log.Logger
	now       func() time.Time
	build     buildinfo.Info
}

func NewServer(service *Service, auth *Authenticator, cfg ServerConfig) (*Server, error) {
	if service == nil || service.Store == nil || service.Upstreams == nil || service.AI == nil || auth == nil {
		return nil, errors.New("finance server dependencies are incomplete")
	}
	if err := validateSupportLinks(service.Support); err != nil {
		return nil, err
	}
	if len(cfg.CursorSigningKey) < 32 {
		return nil, errors.New("finance cursor signing key must contain at least 32 characters")
	}
	if len(cfg.OperationsKey) < 32 {
		return nil, errors.New("finance operations key must contain at least 32 characters")
	}
	if cfg.RequireMultiInstance && !service.Store.MultiInstanceReady() {
		return nil, errors.New("finance production requires PostgreSQL multi-instance state and rate limiting")
	}
	if cfg.WalletGatewayURL != "" {
		parsed, err := url.Parse(strings.TrimRight(cfg.WalletGatewayURL, "/"))
		loopbackHTTP := parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1")
		if err != nil || (parsed.Scheme != "https" && !loopbackHTTP) || parsed.Host == "" || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, errors.New("finance Wallet Gateway URL must be an HTTPS origin or loopback HTTP development origin")
		}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	s := &Server{service: service, auth: auth, cfg: cfg, mux: http.NewServeMux(), cursorKey: []byte(cfg.CursorSigningKey), logger: newJSONLogger(cfg.LogWriter), now: now, build: buildinfo.Normalize(cfg.Build)}
	s.metrics = newFinanceMetrics(s.now())
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.observe(securityHeaders(s.mux)) }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /ready", s.ready)
	s.mux.HandleFunc("GET /version", s.version)
	s.mux.HandleFunc("GET /metrics", s.metricsEndpoint)
	s.mux.HandleFunc("POST /api/auth/logout", s.protected("", s.logout))
	s.mux.HandleFunc("GET /api/overview", s.protected("finance.portfolio.read", s.overview))
	s.mux.HandleFunc("GET /api/portfolio", s.protected("finance.portfolio.read", s.portfolio))
	s.mux.HandleFunc("GET /v1/domain/portfolio", s.protected("finance.portfolio.read", s.domainPortfolio))
	s.mux.HandleFunc("GET /api/sources", s.protected("finance.portfolio.read", s.sources))
	s.mux.HandleFunc("GET /api/activity", s.protected("finance.portfolio.read", s.activityPage))
	s.mux.HandleFunc("GET /api/profile", s.protected("finance.portfolio.read", s.profile))
	s.mux.HandleFunc("POST /api/categories", s.protected("finance.profile.write", s.createCategory))
	s.mux.HandleFunc("PUT /api/activity/{id}/category", s.protected("finance.profile.write", s.classifyActivity))
	s.mux.HandleFunc("POST /api/budgets", s.protected("finance.profile.write", s.createBudget))
	s.mux.HandleFunc("POST /api/reminders", s.protected("finance.profile.write", s.createReminder))
	s.mux.HandleFunc("POST /api/notes", s.protected("finance.profile.write", s.createNote))
	s.mux.HandleFunc("DELETE /api/notes/{id}", s.protected("finance.profile.write", s.deleteNote))
	s.mux.HandleFunc("PUT /api/privacy", s.protected("finance.profile.write", s.updatePrivacy))
	s.mux.HandleFunc("GET /api/statements", s.protected("finance.portfolio.read", s.statement))
	s.mux.HandleFunc("GET /api/monthly-review", s.protected("finance.portfolio.read", s.monthlyReview))
	s.mux.HandleFunc("GET /api/export", s.protected("finance.portfolio.read", s.export))
	s.mux.HandleFunc("GET /api/audit", s.protected("finance.portfolio.read", s.audit))
	s.mux.HandleFunc("GET /api/support", s.protected("finance.portfolio.read", s.support))
	s.mux.HandleFunc("GET /api/protocol-risk", s.protected("finance.portfolio.read", s.protocolRisk))
	s.mux.HandleFunc("DELETE /api/account", s.protected("finance.profile.write", s.deleteAccount))
	s.mux.HandleFunc("POST /api/ai/jobs", s.protected("finance.ai.draft", s.startAI))
	s.mux.HandleFunc("GET /api/ai/jobs/{id}", s.protected("finance.ai.draft", s.getAI))
	s.mux.HandleFunc("DELETE /api/ai/jobs/{id}", s.protected("finance.ai.draft", s.deleteAI))
	s.mux.HandleFunc("POST /api/ai/jobs/{id}/cancel", s.protected("finance.ai.draft", s.cancelAI))
	s.mux.HandleFunc("POST /api/ai/jobs/{id}/decision", s.protected("finance.ai.draft", s.decideAI))
	s.mux.HandleFunc("GET /", s.web)
	s.mux.HandleFunc("GET /auth/callback", s.web)
	s.mux.HandleFunc("GET /app.js", s.web)
	s.mux.HandleFunc("GET /read-sources.js", s.web)
	s.mux.HandleFunc("GET /styles.css", s.web)
	s.mux.HandleFunc("GET /manifest.webmanifest", s.web)
	s.mux.HandleFunc("GET /ynx-logo.png", s.web)
	s.mux.HandleFunc("GET /wallet-auth/callback", s.web)
	s.mux.HandleFunc("GET /wallet-auth.js", s.web)
	s.mux.HandleFunc("POST /wallet-gateway/v1/wallet/sessions/complete", s.walletSessionComplete)
	s.mux.HandleFunc("POST /wallet-gateway/v1/wallet/sessions/revoke", s.walletSessionRevoke)
}

func (s *Server) walletSessionComplete(w http.ResponseWriter, r *http.Request) {
	s.proxyWalletGateway(w, r, "/v1/wallet/sessions/complete", false)
}

func (s *Server) walletSessionRevoke(w http.ResponseWriter, r *http.Request) {
	s.proxyWalletGateway(w, r, "/v1/wallet/sessions/revoke", true)
}

func (s *Server) proxyWalletGateway(w http.ResponseWriter, r *http.Request, path string, requireProof bool) {
	if s.cfg.WalletGatewayURL == "" {
		writeError(w, http.StatusServiceUnavailable, "wallet_gateway_unavailable", "Canonical Wallet Gateway is unavailable")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil || len(body) == 0 || len(body) > maxBodyBytes {
		writeError(w, http.StatusBadRequest, "invalid_request", "Wallet completion body is invalid")
		return
	}
	target := strings.TrimRight(s.cfg.WalletGatewayURL, "/") + path
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusBadGateway, "wallet_gateway_unavailable", "Canonical Wallet Gateway request failed")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if requireProof {
		proof := strings.TrimSpace(r.Header.Get("X-YNX-Product-Session-Proof"))
		if proof == "" || len(proof) > 8192 {
			writeError(w, http.StatusUnauthorized, "session_rejected", "Canonical Product Session proof is required")
			return
		}
		req.Header.Set("X-YNX-Product-Session-Proof", proof)
	}
	client := s.cfg.WalletGatewayClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	response, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "wallet_gateway_unavailable", "Canonical Wallet Gateway did not respond")
		return
	}
	defer response.Body.Close()
	result, err := io.ReadAll(io.LimitReader(response.Body, maxBodyBytes+1))
	if err != nil || len(result) > maxBodyBytes {
		writeError(w, http.StatusBadGateway, "wallet_gateway_invalid", "Canonical Wallet Gateway response is invalid")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(result)
}
func (s *Server) classifyActivity(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		CategoryID     string `json:"categoryId"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	state := s.service.Store.Account(session.Account)
	p := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	if !p.ExplorerStatus.Available {
		writeError(w, 503, "source_unavailable", "Explorer evidence is unavailable; classification was not changed")
		return
	}
	if err := s.service.Classify(session.Account, r.PathValue("id"), input.CategoryID, input.IdempotencyKey, p.Activity); err != nil {
		writeError(w, 422, "classification_rejected", err.Error())
		return
	}
	writeJSON(w, 200, s.service.Store.Account(session.Account).Classifications[r.PathValue("id")])
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	stateStore := s.service.Store.StateStoreMode()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "ynx-finance", "version": "1.2.0", "build": s.build, "observabilityVersion": observabilityVersion, "chainId": ChainID, "nativeSymbol": "YNXT", "custody": "none", "portfolio": "read-only", "configuredReadSources": s.service.Upstreams.ConfiguredReadSources(), "stateStore": stateStore, "rateLimitStore": s.service.Store.RateLimitMode(), "multiInstanceState": s.service.Store.MultiInstanceReady(), "truthfulStatus": "runtime-upstream-backed"})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	stateStore := s.service.Store.StateStoreMode()
	if err := s.service.Store.StateStoreReady(); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "service": "ynx-finance", "stateStore": stateStore, "rateLimitStore": s.service.Store.RateLimitMode(), "multiInstanceState": s.service.Store.MultiInstanceReady(), "error": "authoritative state store unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "ynx-finance", "stateStore": stateStore, "rateLimitStore": s.service.Store.RateLimitMode(), "multiInstanceState": s.service.Store.MultiInstanceReady()})
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.build)
}

type handler func(http.ResponseWriter, *http.Request, Session)

func (s *Server) protected(scope string, next handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && !s.originAllowed(r) {
			writeError(w, http.StatusForbidden, "origin_not_allowed", "Request origin is not registered")
			return
		}
		session, err := s.auth.Verify(r.Header.Get("X-YNX-Product-Session-Proof"), scope)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "session_rejected", err.Error())
			return
		}
		allowed, rateErr := s.allow(session.Token, r.Method)
		if rateErr != nil {
			writeError(w, http.StatusServiceUnavailable, "rate_limiter_unavailable", "Finance rate limiter is unavailable")
			return
		}
		if !allowed {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Finance request rate limit exceeded")
			return
		}
		next(w, r, session)
	}
}

func (s *Server) allow(token, method string) (bool, error) {
	limit := 240
	if method != http.MethodGet {
		limit = 30
	}
	digest := sha256.Sum256([]byte(token))
	return s.service.Store.AllowRate(method+":"+hex.EncodeToString(digest[:]), limit, time.Minute, s.now())
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request, _ Session) {
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request, session Session) {
	state := s.service.Store.Account(session.Account)
	portfolio := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	writeJSON(w, http.StatusOK, map[string]any{"portfolio": portfolio, "profile": state, "budgetProgress": s.service.BudgetProgress(session.Account, portfolio, time.Now().UTC()), "alerts": s.service.Alerts(session.Account, portfolio), "support": s.service.Support, "boundaries": productBoundaries()})
}
func (s *Server) portfolio(w http.ResponseWriter, r *http.Request, session Session) {
	state := s.service.Store.Account(session.Account)
	writeJSON(w, http.StatusOK, s.observedPortfolio(r.Context(), session.Account, state.Classifications))
}

func (s *Server) domainPortfolio(w http.ResponseWriter, r *http.Request, session Session) {
	observed := s.observedPortfolio(r.Context(), session.Account, s.service.Store.Account(session.Account).Classifications)
	domain := s.service.DomainPortfolio(session.Account, observed, s.build.Release)
	if domain.TotalValue == "" {
		domain.TotalValue = "0"
	}
	writeJSON(w, http.StatusOK, domain)
}

func (s *Server) sources(w http.ResponseWriter, r *http.Request, session Session) {
	sources := s.service.Upstreams.ReadSourcesForAccount(r.Context(), session.Account, s.now().UTC())
	s.observeReadSources(sources)
	live := make([]string, 0, 3)
	for _, id := range []string{"exchange", "dex", "quant"} {
		if sources[id].Status.Available {
			live = append(live, id)
		}
	}
	liveState := "none"
	if len(live) > 0 {
		liveState = strings.Join(live, ",")
	}
	integrationState := "accepted=exchange,dex,quant;live=" + liveState + ";pending=economics"
	writeJSON(w, http.StatusOK, map[string]any{
		"consumerEnvelopeVersion": ReadSourceEnvelopeVersion,
		"readOnly":                true,
		"sources":                 sources,
		"integrationState":        integrationState,
	})
}

func (s *Server) activityPage(w http.ResponseWriter, r *http.Request, session Session) {
	state := s.service.Store.Account(session.Account)
	p := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, 400, "invalid_limit", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	offset := 0
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, err := s.decodeActivityCursor(raw, session.Account, p.Activity)
		if err != nil {
			writeError(w, 400, "invalid_cursor", "cursor is invalid, stale, or belongs to another account")
			return
		}
		offset = parsed
	}
	if offset > len(p.Activity) {
		offset = len(p.Activity)
	}
	end := offset + limit
	if end > len(p.Activity) {
		end = len(p.Activity)
	}
	next := ""
	if end < len(p.Activity) {
		next = s.encodeActivityCursor(session.Account, end, p.Activity)
	}
	writeJSON(w, 200, map[string]any{"items": p.Activity[offset:end], "nextCursor": next, "coverage": p.ExplorerStatus.Coverage, "completeHistory": false, "sourceStatus": p.ExplorerStatus, "asOf": p.AsOf})
}

type activityCursor struct {
	Version  int    `json:"v"`
	Account  string `json:"account"`
	Offset   int    `json:"offset"`
	Snapshot string `json:"snapshot"`
}

func (s *Server) encodeActivityCursor(account string, offset int, activity []Activity) string {
	payload, _ := json.Marshal(activityCursor{Version: 1, Account: account, Offset: offset, Snapshot: activitySnapshot(activity)})
	mac := hmac.New(sha256.New, s.cursorKey)
	_, _ = mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) decodeActivityCursor(raw, account string, activity []Activity) (int, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return 0, errors.New("cursor format is invalid")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, err
	}
	mac := hmac.New(sha256.New, s.cursorKey)
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return 0, errors.New("cursor signature is invalid")
	}
	var cursor activityCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return 0, err
	}
	if cursor.Version != 1 || cursor.Account != account || cursor.Offset < 0 || cursor.Snapshot != activitySnapshot(activity) {
		return 0, errors.New("cursor binding is invalid")
	}
	return cursor.Offset, nil
}

func activitySnapshot(activity []Activity) string {
	hash := sha256.New()
	for _, item := range activity {
		_, _ = hash.Write([]byte(item.ID))
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(item.Timestamp.UTC().Format(time.RFC3339Nano)))
		_, _ = hash.Write([]byte{0})
	}
	return base64.RawURLEncoding.EncodeToString(hash.Sum(nil))
}

func (s *Server) profile(w http.ResponseWriter, _ *http.Request, session Session) {
	writeJSON(w, http.StatusOK, s.service.Store.Account(session.Account))
}

func (s *Server) createCategory(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		Name           string `json:"name"`
		Color          string `json:"color"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	value, err := s.service.AddCategory(session.Account, input.Name, input.Color, input.IdempotencyKey)
	if err != nil {
		writeError(w, 422, "category_rejected", err.Error())
		return
	}
	writeJSON(w, 201, value)
}
func (s *Server) createBudget(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		Name           string    `json:"name"`
		CategoryID     string    `json:"categoryId"`
		LimitYNXT      int64     `json:"limitYnxt"`
		Period         string    `json:"period"`
		StartsAt       time.Time `json:"startsAt"`
		IdempotencyKey string    `json:"idempotencyKey"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	value, err := s.service.AddBudget(session.Account, input.Name, input.CategoryID, input.LimitYNXT, input.Period, input.StartsAt, input.IdempotencyKey)
	if err != nil {
		writeError(w, 422, "budget_rejected", err.Error())
		return
	}
	writeJSON(w, 201, value)
}
func (s *Server) createReminder(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		Title          string    `json:"title"`
		AmountYNXT     *int64    `json:"amountYnxt"`
		Schedule       string    `json:"schedule"`
		NextDueAt      time.Time `json:"nextDueAt"`
		SourceRef      string    `json:"sourceRef"`
		IdempotencyKey string    `json:"idempotencyKey"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	value, err := s.service.AddReminder(session.Account, input.Title, input.Schedule, input.SourceRef, input.AmountYNXT, input.NextDueAt, input.IdempotencyKey)
	if err != nil {
		writeError(w, 422, "reminder_rejected", err.Error())
		return
	}
	writeJSON(w, 201, value)
}

func (s *Server) createNote(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		RecordID       string `json:"recordId"`
		Body           string `json:"body"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	state := s.service.Store.Account(session.Account)
	p := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	if input.RecordID != "" && !p.ExplorerStatus.Available {
		writeError(w, 503, "source_unavailable", "Explorer evidence is unavailable; linked note was not created")
		return
	}
	note, err := s.service.AddNote(session.Account, input.RecordID, input.Body, input.IdempotencyKey, p.Activity)
	if err != nil {
		writeError(w, 422, "note_rejected", err.Error())
		return
	}
	writeJSON(w, 201, note)
}

func (s *Server) deleteNote(w http.ResponseWriter, r *http.Request, session Session) {
	if err := s.service.DeleteNote(session.Account, r.PathValue("id")); err != nil {
		writeError(w, 404, "note_not_found", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) updatePrivacy(w http.ResponseWriter, r *http.Request, session Session) {
	var input Privacy
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	if err := s.service.SetPrivacy(session.Account, input); err != nil {
		writeError(w, 500, "persistence_failed", err.Error())
		return
	}
	writeJSON(w, 200, s.service.Store.Account(session.Account).Privacy)
}

func (s *Server) statement(w http.ResponseWriter, r *http.Request, session Session) {
	from, to, err := statementRange(r)
	if err != nil {
		writeError(w, 400, "invalid_period", err.Error())
		return
	}
	state := s.service.Store.Account(session.Account)
	portfolio := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	activities := []Activity{}
	incoming, outgoing, fees := int64(0), int64(0), int64(0)
	for _, item := range portfolio.Activity {
		if item.Timestamp.Before(from) || !item.Timestamp.Before(to) {
			continue
		}
		activities = append(activities, item)
		fees += item.Fee
		if item.Direction == "incoming" {
			incoming += item.Amount
		} else {
			outgoing += item.Amount
		}
	}
	receipts := []PayReceipt{}
	if state.Privacy.IncludePayInStatements {
		for _, item := range portfolio.PayReceipts {
			if !item.CreatedAt.Before(from) && item.CreatedAt.Before(to) {
				receipts = append(receipts, item)
			}
		}
	}
	writeJSON(w, 200, map[string]any{"account": session.Account, "network": ChainID, "symbol": "YNXT", "from": from, "toExclusive": to, "activity": activities, "payReceipts": receipts, "totals": map[string]int64{"incomingYnxt": incoming, "outgoingYnxt": outgoing, "feesYnxt": fees}, "currentBalanceYnxt": portfolio.BalanceYNXT, "openingBalance": "unavailable: activity endpoint is bounded and no fiat valuation is inferred", "sourceStatus": map[string]SourceStatus{"explorer": portfolio.ExplorerStatus, "pay": portfolio.PayStatus}})
}

func (s *Server) monthlyReview(w http.ResponseWriter, r *http.Request, session Session) {
	now := time.Now().UTC()
	year, month := now.Year(), int(now.Month())
	if raw := r.URL.Query().Get("year"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 2020 || parsed > 2200 {
			writeError(w, 400, "invalid_year", "year is invalid")
			return
		}
		year = parsed
	}
	if raw := r.URL.Query().Get("month"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 12 {
			writeError(w, 400, "invalid_month", "month is invalid")
			return
		}
		month = parsed
	}
	from := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	state := s.service.Store.Account(session.Account)
	p := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	incoming, outgoing, fees := int64(0), int64(0), int64(0)
	count := 0
	byCategory := map[string]int64{}
	for _, item := range p.Activity {
		if item.Timestamp.Before(from) || !item.Timestamp.Before(to) {
			continue
		}
		count++
		fees += item.Fee
		if item.Direction == "incoming" {
			incoming += item.Amount
		} else {
			outgoing += item.Amount
			byCategory[item.Category] += item.Amount + item.Fee
		}
	}
	writeJSON(w, 200, map[string]any{"period": from.Format("2006-01"), "from": from, "toExclusive": to, "network": ChainID, "symbol": "YNXT", "activityCount": count, "totals": map[string]int64{"incomingYnxt": incoming, "outgoingYnxt": outgoing, "feesYnxt": fees}, "categorySpendYnxt": byCategory, "budgetProgress": s.service.BudgetProgress(session.Account, p, to.Add(-time.Nanosecond)), "sourceStatus": map[string]SourceStatus{"explorer": p.ExplorerStatus, "pay": p.PayStatus}, "legal": "Source-bounded personal review; not a bank statement, fiat valuation, tax advice, or investment advice."})
}

func (s *Server) export(w http.ResponseWriter, r *http.Request, session Session) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}
	state := s.service.Store.Account(session.Account)
	p := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	if format == "json" {
		w.Header().Set("Content-Disposition", `attachment; filename="ynx-finance-export.json"`)
		writeJSON(w, 200, map[string]any{"exportedAt": time.Now().UTC(), "account": session.Account, "portfolio": p, "profile": state, "audit": s.service.Store.Audit(session.Account)})
		return
	}
	if format != "csv" {
		writeError(w, 400, "invalid_format", "format must be json or csv")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="ynx-finance-activity.csv"`)
	c := csv.NewWriter(w)
	_ = c.Write([]string{"record_id", "timestamp", "direction", "type", "amount_ynxt", "fee_ynxt", "from", "to", "category", "source"})
	for _, a := range p.Activity {
		_ = c.Write([]string{a.ID, a.Timestamp.Format(time.RFC3339), a.Direction, a.Type, strconv.FormatInt(a.Amount, 10), strconv.FormatInt(a.Fee, 10), a.From, a.To, a.Category, a.Source})
	}
	c.Flush()
}

func (s *Server) audit(w http.ResponseWriter, _ *http.Request, session Session) {
	writeJSON(w, 200, map[string]any{"events": s.service.Store.Audit(session.Account)})
}
func (s *Server) support(w http.ResponseWriter, _ *http.Request, _ Session) {
	writeJSON(w, 200, s.service.Support)
}
func (s *Server) protocolRisk(w http.ResponseWriter, _ *http.Request, _ Session) {
	writeJSON(w, 200, map[string]any{"enabled": false, "message": "No optional investment, lending, staking, custody, brokerage, or cross-chain module is enabled.", "requiredDisclosureFields": []string{"counterparty", "custody", "contract", "principalLossRisk", "fee", "liquidityRisk", "jurisdictionRisk", "signatureBoundary"}, "signatureBoundary": "Finance may prepare a review intent only. YNX Wallet must show and sign any future supported protocol action; Finance cannot sign."})
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		Confirmation string `json:"confirmation"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	if input.Confirmation != "DELETE FINANCE DATA" {
		writeError(w, 422, "confirmation_required", "confirmation must exactly equal DELETE FINANCE DATA")
		return
	}
	if err := s.service.Store.DeleteAccount(session.Account); err != nil {
		writeError(w, 500, "persistence_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) startAI(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		Kind           string   `json:"kind"`
		RecordIDs      []string `json:"recordIds"`
		ContextClasses []string `json:"contextClasses"`
		Consent        bool     `json:"consent"`
		OutputLocale   string   `json:"outputLocale"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	state := s.service.Store.Account(session.Account)
	p := s.observedPortfolio(r.Context(), session.Account, state.Classifications)
	if !p.ExplorerStatus.Available {
		writeError(w, 503, "source_unavailable", "AI cannot use activity while Explorer evidence is unavailable")
		return
	}
	job, err := s.service.StartAI(r.Context(), session.Account, input.Kind, input.RecordIDs, input.ContextClasses, input.Consent, p, input.OutputLocale)
	if err != nil {
		writeError(w, 503, "ai_unavailable", err.Error())
		return
	}
	writeJSON(w, 202, job)
}
func (s *Server) getAI(w http.ResponseWriter, r *http.Request, session Session) {
	job, ok := s.service.aiJob(session.Account, r.PathValue("id"))
	if !ok {
		writeError(w, 404, "job_not_found", "AI job was not found")
		return
	}
	writeJSON(w, 200, job)
}
func (s *Server) deleteAI(w http.ResponseWriter, r *http.Request, session Session) {
	if err := s.service.DeleteAI(session.Account, r.PathValue("id")); err != nil {
		writeError(w, 409, "delete_rejected", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) cancelAI(w http.ResponseWriter, r *http.Request, session Session) {
	if err := s.service.CancelAI(session.Account, r.PathValue("id")); err != nil {
		writeError(w, 409, "cancel_rejected", err.Error())
		return
	}
	w.WriteHeader(202)
}
func (s *Server) decideAI(w http.ResponseWriter, r *http.Request, session Session) {
	var input struct {
		Decision string `json:"decision"`
	}
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	if err := s.service.DecideAI(session.Account, r.PathValue("id"), input.Decision); err != nil {
		writeError(w, 422, "decision_rejected", err.Error())
		return
	}
	job, _ := s.service.aiJob(session.Account, r.PathValue("id"))
	writeJSON(w, 200, job)
}

func (s *Server) web(w http.ResponseWriter, r *http.Request) {
	name := map[string]string{"/": "index.html", "/auth/callback": "index.html", "/wallet-auth/callback": "index.html", "/app.js": "app.js", "/wallet-auth.js": "wallet-auth.js", "/read-sources.js": "read-sources.js", "/styles.css": "styles.css", "/manifest.webmanifest": "manifest.webmanifest", "/ynx-logo.png": "ynx-logo.png"}[r.URL.Path]
	if name == "" || s.cfg.WebDir == "" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.WebDir, name))
}

func (s *Server) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range s.cfg.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}
func statementRange(r *http.Request) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	from := now.AddDate(0, -1, 0)
	to := now
	var err error
	if v := r.URL.Query().Get("from"); v != "" {
		from, err = time.Parse(time.RFC3339, v)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		to, err = time.Parse(time.RFC3339, v)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
	}
	if !to.After(from) || to.Sub(from) > 366*24*time.Hour {
		return time.Time{}, time.Time{}, errors.New("statement period must be positive and at most 366 days")
	}
	return from, to, nil
}
func decodeStrict(w http.ResponseWriter, r *http.Request, out any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request must contain one JSON object")
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	errorID := stableErrorID(code)
	requestID := requestIDFromWriter(w)
	w.Header().Set(errorIDHeader, errorID)
	writeJSON(w, status, map[string]string{"code": code, "error": message, "errorId": errorID, "requestId": requestID})
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		next.ServeHTTP(w, r)
	})
}
func productBoundaries() map[string]any {
	return map[string]any{"isBank": false, "isCustodian": false, "isBroker": false, "isInvestmentAdvisor": false, "fiatBalance": "not provided", "crossChainBalances": "not provided", "returns": "not promised", "accountControl": "YNX Wallet only", "data": "live Explorer and Pay records or explicit unavailable/empty state"}
}
