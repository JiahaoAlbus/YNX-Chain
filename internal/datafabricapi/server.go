package datafabricapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricconsole"
)

type Config struct {
	Store              *datafabric.Store
	Repository         Repository
	Authorizer         Authorizer
	EventKeys          map[string][]byte
	EventKeyProducts   map[string]string
	PrivacyKey         []byte
	SourceCommit       string
	SourceRelease      string
	MaxBodyBytes       int64
	RateLimitPerMinute uint32
}

type Server struct {
	cfg             Config
	repo            Repository
	mux             *http.ServeMux
	requests        atomic.Uint64
	errors          atomic.Uint64
	replayMu        sync.Mutex
	replays         map[string]time.Time
	rateMu          sync.Mutex
	rates           map[string]rateWindow
	durationBuckets [11]atomic.Uint64
	durationNanos   atomic.Uint64
}

func New(cfg Config) (*Server, error) {
	if (cfg.Store == nil) == (cfg.Repository == nil) || cfg.Authorizer == nil || len(cfg.EventKeys) == 0 || len(cfg.EventKeyProducts) != len(cfg.EventKeys) || len(cfg.PrivacyKey) < 32 || cfg.SourceCommit == "" || cfg.SourceRelease == "" {
		return nil, errors.New("store, canonical authorizer, event keys, privacy key, source commit, and source release are required")
	}
	for keyID := range cfg.EventKeys {
		if cfg.EventKeyProducts[keyID] == "" {
			return nil, errors.New("every event key must be bound to one product")
		}
	}
	if cfg.MaxBodyBytes == 0 {
		cfg.MaxBodyBytes = 1024 * 1024
	}
	if cfg.MaxBodyBytes < 4096 || cfg.MaxBodyBytes > 4*1024*1024 {
		return nil, errors.New("max body bytes must be between 4096 and 4194304")
	}
	if cfg.RateLimitPerMinute == 0 {
		cfg.RateLimitPerMinute = 120
	}
	if cfg.RateLimitPerMinute > 10000 {
		return nil, errors.New("rate limit must be between 1 and 10000 requests per minute")
	}
	repository := cfg.Repository
	if repository == nil {
		repository = LocalRepository{Store: cfg.Store}
	}
	s := &Server{cfg: cfg, repo: repository, mux: http.NewServeMux(), replays: make(map[string]time.Time), rates: make(map[string]rateWindow)}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.securityHeaders(s.mux) }

func (s *Server) routes() {
	datafabricconsole.Register(s.mux)
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /version", s.version)
	s.mux.HandleFunc("GET /metrics", s.metrics)
	s.mux.HandleFunc("POST /v1/events", s.authorize("fabric.events.write", s.appendEvent))
	s.mux.HandleFunc("GET /v1/events", s.authorize("fabric.events.read", s.listEvents))
	s.mux.HandleFunc("POST /v1/ledger/journal", s.authorize("fabric.ledger.write", s.postJournal))
	s.mux.HandleFunc("GET /v1/ledger/journal", s.authorize("fabric.ledger.read", s.listJournal))
	s.mux.HandleFunc("POST /v1/sagas", s.authorize("fabric.sagas.write", s.startSaga))
	s.mux.HandleFunc("GET /v1/sagas/{id}", s.authorize("fabric.sagas.read", s.getSaga))
	s.mux.HandleFunc("POST /v1/sagas/{id}/steps", s.authorize("fabric.sagas.write", s.completeSagaStep))
	s.mux.HandleFunc("POST /v1/sagas/{id}/fail", s.authorize("fabric.sagas.write", s.failSaga))
	s.mux.HandleFunc("POST /v1/sagas/{id}/compensations", s.authorize("fabric.sagas.write", s.completeSagaCompensation))
	s.mux.HandleFunc("POST /v1/sagas/{id}/manual-recovery", s.authorize("fabric.sagas.recover", s.manualSagaRecovery))
	s.mux.HandleFunc("POST /v1/reconciliations", s.authorize("fabric.reconciliation.write", s.reconcile))
	s.mux.HandleFunc("GET /v1/reconciliations", s.authorize("fabric.reconciliation.read", s.listReconciliations))
	s.mux.HandleFunc("GET /v1/audit/export", s.authorize("fabric.audit.export", s.auditExport))
	s.mux.HandleFunc("GET /v1/privacy/export", s.authorize("fabric.privacy.export", s.subjectExport))
	s.mux.HandleFunc("POST /v1/privacy/erase", s.authorize("fabric.privacy.erase", s.subjectErasure))
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		s.requests.Add(1)
		ctx, traceID, traceparent := requestTraceContext(r.Context(), r.Header.Get("Traceparent"))
		r = r.WithContext(ctx)
		w.Header().Set("Traceparent", traceparent)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		requestID := r.Header.Get("X-YNX-Request-ID")
		if len(requestID) > 128 || strings.ContainsAny(requestID, "\r\n\t") {
			requestID = ""
		}
		if requestID != "" {
			w.Header().Set("X-YNX-Request-ID", requestID)
		}
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		duration := time.Since(started)
		s.observeDuration(duration)
		slog.Info("data fabric request", "requestId", requestID, "traceId", traceID, "method", r.Method, "path", r.URL.Path, "status", recorder.status, "bytes", recorder.bytes, "durationMs", duration.Milliseconds())
	})
}

var requestDurationBounds = [...]float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}

func (s *Server) observeDuration(duration time.Duration) {
	seconds := duration.Seconds()
	for index, bound := range requestDurationBounds {
		if seconds <= bound {
			s.durationBuckets[index].Add(1)
		}
	}
	s.durationBuckets[len(s.durationBuckets)-1].Add(1)
	s.durationNanos.Add(uint64(duration))
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(data []byte) (int, error) {
	count, err := r.ResponseWriter.Write(data)
	r.bytes += count
	return count, err
}

func (s *Server) authorize(scope string, next func(http.ResponseWriter, *http.Request, Principal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		credential, err := credentialFromRequest(r)
		if err != nil {
			s.writeError(w, http.StatusUnauthorized, "canonical_session_required", err.Error())
			return
		}
		if err := verifyRequestContent(r, s.cfg.MaxBodyBytes); err != nil {
			s.writeError(w, http.StatusUnauthorized, "canonical_content_tampered", "Canonical request content binding is invalid")
			return
		}
		requestTime, err := time.Parse(time.RFC3339Nano, credential.RequestTimestamp)
		if err != nil || requestTime.Before(time.Now().UTC().Add(-2*time.Minute)) || requestTime.After(time.Now().UTC().Add(30*time.Second)) {
			s.writeError(w, http.StatusUnauthorized, "canonical_request_stale", "Canonical request timestamp is outside the accepted freshness window")
			return
		}
		principal, err := s.cfg.Authorizer.Authorize(r.Context(), credential, scope)
		if err != nil {
			s.writeError(w, http.StatusUnauthorized, "canonical_introspection_denied", "Canonical Wallet/App Gateway authorization failed")
			return
		}
		if !s.consumeReplayBinding(credential, principal.ExpiresAt) {
			s.writeError(w, http.StatusUnauthorized, "canonical_request_replayed", "Canonical request binding was already consumed")
			return
		}
		if !s.allowSessionRequest(principal) {
			w.Header().Set("Retry-After", "60")
			s.writeError(w, http.StatusTooManyRequests, "canonical_session_rate_limited", "Canonical session request rate exceeded the local service limit")
			return
		}
		next(w, r, principal)
	}
}

type rateWindow struct {
	Started time.Time
	Count   uint32
}

func (s *Server) allowSessionRequest(principal Principal) bool {
	now := time.Now().UTC()
	key := principal.SessionID + "\x00" + principal.DeviceID + "\x00" + principal.Product
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	for candidate, window := range s.rates {
		if now.Sub(window.Started) >= time.Minute {
			delete(s.rates, candidate)
		}
	}
	window, exists := s.rates[key]
	if !exists {
		if len(s.rates) >= 100000 {
			return false
		}
		window = rateWindow{Started: now}
	}
	if window.Count >= s.cfg.RateLimitPerMinute {
		return false
	}
	window.Count++
	s.rates[key] = window
	return true
}

func verifyRequestContent(r *http.Request, maxBodyBytes int64) error {
	provided, err := hex.DecodeString(r.Header.Get("X-YNX-Content-SHA256"))
	if err != nil || len(provided) != sha256.Size {
		return errors.New("content SHA-256 is required")
	}
	var source io.Reader = http.NoBody
	if r.Body != nil {
		source = r.Body
	}
	body, err := io.ReadAll(io.LimitReader(source, maxBodyBytes+1))
	if err != nil || int64(len(body)) > maxBodyBytes {
		return errors.New("request body exceeds the signed content limit")
	}
	r.Body = io.NopCloser(strings.NewReader(string(body)))
	digest := sha256.Sum256(body)
	if subtle.ConstantTimeCompare(provided, digest[:]) != 1 {
		return datafabric.ErrTampered
	}
	return nil
}

func (s *Server) consumeReplayBinding(credential Credential, expiresAt time.Time) bool {
	now := time.Now().UTC()
	key := credential.SessionID + "\x00" + credential.DeviceID + "\x00" + credential.RequestNonce
	s.replayMu.Lock()
	defer s.replayMu.Unlock()
	for candidate, expiry := range s.replays {
		if !now.Before(expiry) {
			delete(s.replays, candidate)
		}
	}
	if _, exists := s.replays[key]; exists || len(s.replays) >= 100000 {
		return false
	}
	if expiresAt.After(now.Add(10 * time.Minute)) {
		expiresAt = now.Add(10 * time.Minute)
	}
	s.replays[key] = expiresAt
	return true
}

func (s *Server) appendEvent(w http.ResponseWriter, r *http.Request, principal Principal) {
	event, err := datafabric.DecodeEnvelopeStrict(http.MaxBytesReader(w, r.Body, s.cfg.MaxBodyBytes))
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_event", err.Error())
		return
	}
	if event.Product != principal.Product || (principal.AccountID != "" && event.Actor.AccountID != principal.AccountID) || (principal.SessionID != "" && event.Actor.SessionID != principal.SessionID) {
		s.writeError(w, http.StatusForbidden, "authority_mismatch", "Event product, account, or session does not match canonical authorization")
		return
	}
	key, exists := s.cfg.EventKeys[event.Integrity.KeyID]
	if !exists {
		s.writeError(w, http.StatusForbidden, "unknown_integrity_key", "Event integrity key is not registered")
		return
	}
	if s.cfg.EventKeyProducts[event.Integrity.KeyID] != event.Product {
		s.writeError(w, http.StatusForbidden, "integrity_key_product_mismatch", "Event integrity key is not registered for this product")
		return
	}
	if err := s.repo.Append(r.Context(), event, key); err != nil {
		status := http.StatusConflict
		if errors.Is(err, datafabric.ErrTampered) {
			status = http.StatusForbidden
		}
		message := "Canonical event was rejected by the authoritative repository"
		if errors.Is(err, datafabric.ErrDuplicate) || errors.Is(err, datafabric.ErrOutOfOrder) || errors.Is(err, datafabric.ErrTampered) {
			message = err.Error()
		}
		s.writeError(w, status, "event_rejected", message)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"eventId": event.EventID, "status": "committed-to-outbox", "auditId": event.AuditID})
}

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request, principal Principal) {
	events := make([]datafabric.EventEnvelope, 0)
	stored, err := s.repo.Events(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	for _, event := range stored {
		if event.Product == principal.Product {
			events = append(events, event)
		}
	}
	page, nextCursor, err := paginate(r, events, func(event datafabric.EventEnvelope) string { return event.EventID })
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_page", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": page, "nextCursor": nextCursor, "source": "ynx-operational-event-store", "asOf": time.Now().UTC(), "version": s.cfg.SourceRelease, "status": "authoritative"})
}

func (s *Server) postJournal(w http.ResponseWriter, r *http.Request, principal Principal) {
	entry, err := decodeStrict[datafabric.JournalEntry](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_journal", err.Error())
		return
	}
	event, exists, repositoryErr := s.repo.Event(r.Context(), entry.EventID)
	if repositoryErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if !exists || event.Product != principal.Product {
		s.writeError(w, http.StatusForbidden, "journal_authority_mismatch", "Journal event is missing or belongs to another product")
		return
	}
	if err := s.repo.PostJournal(r.Context(), entry); err != nil {
		s.writeError(w, http.StatusConflict, "journal_rejected", "Journal was rejected by the authoritative repository")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"entryId": entry.EntryID, "status": "recorded", "auditId": entry.AuditID})
}

func (s *Server) listJournal(w http.ResponseWriter, r *http.Request, principal Principal) {
	entries, err := s.journalForProduct(r.Context(), principal.Product)
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	page, nextCursor, err := paginate(r, entries, func(entry datafabric.JournalEntry) string { return entry.EntryID })
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_page", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": page, "nextCursor": nextCursor, "source": "ynx-billing-ledger", "asOf": time.Now().UTC(), "version": s.cfg.SourceRelease, "status": "authoritative"})
}

func (s *Server) getSaga(w http.ResponseWriter, r *http.Request, principal Principal) {
	instance, exists, err := s.repo.Saga(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	if !exists {
		s.writeError(w, http.StatusNotFound, "saga_not_found", "Saga was not found")
		return
	}
	if instance.Product != principal.Product {
		s.writeError(w, http.StatusForbidden, "saga_authority_mismatch", "Saga belongs to another product")
		return
	}
	writeJSON(w, http.StatusOK, instance)
}

func (s *Server) listReconciliations(w http.ResponseWriter, r *http.Request, principal Principal) {
	runs := make([]datafabric.ReconciliationRun, 0)
	stored, err := s.repo.Reconciliations(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	for _, run := range stored {
		if run.Product == principal.Product {
			runs = append(runs, run)
		}
	}
	page, nextCursor, err := paginate(r, runs, func(run datafabric.ReconciliationRun) string { return run.RunID })
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_page", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": page, "nextCursor": nextCursor, "source": "ynx-reconciliation-store", "asOf": time.Now().UTC(), "version": s.cfg.SourceRelease, "status": "authoritative"})
}

func paginate[T any](r *http.Request, values []T, identifier func(T) string) ([]T, string, error) {
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			return nil, "", errors.New("page limit must be an integer from 1 through 200")
		}
		limit = parsed
	}
	start := 0
	if cursor := r.URL.Query().Get("cursor"); cursor != "" {
		found := false
		for index, value := range values {
			if identifier(value) == cursor {
				start, found = index+1, true
				break
			}
		}
		if !found {
			return nil, "", errors.New("page cursor is absent from the authorized result set")
		}
	}
	end := min(start+limit, len(values))
	page := values[start:end]
	nextCursor := ""
	if end < len(values) && len(page) != 0 {
		nextCursor = identifier(page[len(page)-1])
	}
	return page, nextCursor, nil
}

type startSagaRequest struct {
	SagaID        string              `json:"sagaId"`
	Kind          datafabric.SagaKind `json:"kind"`
	AggregateID   string              `json:"aggregateId"`
	CorrelationID string              `json:"correlationId"`
	AuditID       string              `json:"auditId"`
	Deadline      time.Time           `json:"deadline"`
}

type sagaEventRequest struct {
	EventID string `json:"eventId"`
}

type sagaFailureRequest struct {
	Reason string `json:"reason"`
}

func (s *Server) startSaga(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[startSagaRequest](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_saga", err.Error())
		return
	}
	product, exists := datafabric.SagaProduct(input.Kind)
	if !exists || product != principal.Product {
		s.writeError(w, http.StatusForbidden, "saga_authority_mismatch", "Saga kind does not belong to the authorized product")
		return
	}
	instance, err := datafabric.NewSaga(input.SagaID, input.Kind, input.AggregateID, input.CorrelationID, input.AuditID, time.Now().UTC(), input.Deadline)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_saga", err.Error())
		return
	}
	if err := s.repo.StartSaga(r.Context(), instance); err != nil {
		s.writeError(w, http.StatusConflict, "saga_rejected", "Saga was rejected by the authoritative repository")
		return
	}
	writeJSON(w, http.StatusCreated, instance)
}

func (s *Server) completeSagaStep(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[sagaEventRequest](w, r, s.cfg.MaxBodyBytes)
	authorized, authorityErr := s.authorizedSaga(r.Context(), r.PathValue("id"), principal.Product)
	if authorityErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if err != nil || !authorized {
		s.writeError(w, http.StatusForbidden, "saga_step_rejected", "Saga request or authority is invalid")
		return
	}
	if err := s.repo.CompleteSagaStep(r.Context(), r.PathValue("id"), input.EventID, time.Now().UTC()); err != nil {
		s.writeError(w, http.StatusConflict, "saga_step_rejected", "Saga step was rejected by the authoritative repository")
		return
	}
	instance, _, _ := s.repo.Saga(r.Context(), r.PathValue("id"))
	writeJSON(w, http.StatusOK, instance)
}

func (s *Server) failSaga(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[sagaFailureRequest](w, r, s.cfg.MaxBodyBytes)
	authorized, authorityErr := s.authorizedSaga(r.Context(), r.PathValue("id"), principal.Product)
	if authorityErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if err != nil || !authorized {
		s.writeError(w, http.StatusForbidden, "saga_failure_rejected", "Saga request or authority is invalid")
		return
	}
	if err := s.repo.FailSaga(r.Context(), r.PathValue("id"), input.Reason, time.Now().UTC()); err != nil {
		s.writeError(w, http.StatusConflict, "saga_failure_rejected", "Saga transition was rejected by the authoritative repository")
		return
	}
	instance, _, _ := s.repo.Saga(r.Context(), r.PathValue("id"))
	writeJSON(w, http.StatusOK, instance)
}

func (s *Server) completeSagaCompensation(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[sagaEventRequest](w, r, s.cfg.MaxBodyBytes)
	authorized, authorityErr := s.authorizedSaga(r.Context(), r.PathValue("id"), principal.Product)
	if authorityErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if err != nil || !authorized {
		s.writeError(w, http.StatusForbidden, "saga_compensation_rejected", "Saga request or authority is invalid")
		return
	}
	if err := s.repo.CompleteSagaCompensation(r.Context(), r.PathValue("id"), input.EventID, time.Now().UTC()); err != nil {
		s.writeError(w, http.StatusConflict, "saga_compensation_rejected", "Saga compensation was rejected by the authoritative repository")
		return
	}
	instance, _, _ := s.repo.Saga(r.Context(), r.PathValue("id"))
	writeJSON(w, http.StatusOK, instance)
}

func (s *Server) manualSagaRecovery(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[sagaFailureRequest](w, r, s.cfg.MaxBodyBytes)
	authorized, authorityErr := s.authorizedSaga(r.Context(), r.PathValue("id"), principal.Product)
	if authorityErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if err != nil || !authorized {
		s.writeError(w, http.StatusForbidden, "manual_recovery_rejected", "Saga request or authority is invalid")
		return
	}
	if err := s.repo.RequireSagaManualRecovery(r.Context(), r.PathValue("id"), input.Reason, time.Now().UTC()); err != nil {
		s.writeError(w, http.StatusConflict, "manual_recovery_rejected", "Manual recovery transition was rejected by the authoritative repository")
		return
	}
	instance, _, _ := s.repo.Saga(r.Context(), r.PathValue("id"))
	writeJSON(w, http.StatusOK, instance)
}

func (s *Server) authorizedSaga(ctx context.Context, id, product string) (bool, error) {
	instance, exists, err := s.repo.Saga(ctx, id)
	return exists && instance.Product == product, err
}

type reconcileRequest struct {
	RunID           string                             `json:"runId"`
	JournalEntryID  string                             `json:"journalEntryId"`
	AuditID         string                             `json:"auditId"`
	RequiredSources []string                           `json:"requiredSources"`
	Observations    []datafabric.SettlementObservation `json:"observations"`
}

func (s *Server) reconcile(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[reconcileRequest](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_reconciliation", err.Error())
		return
	}
	entry, exists, repositoryErr := s.repo.JournalEntry(r.Context(), input.JournalEntryID)
	if repositoryErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if !exists {
		s.writeError(w, http.StatusNotFound, "journal_not_found", "Journal entry was not found")
		return
	}
	event, exists, repositoryErr := s.repo.Event(r.Context(), entry.EventID)
	if repositoryErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if !exists || event.Product != principal.Product {
		s.writeError(w, http.StatusForbidden, "reconciliation_authority_mismatch", "Journal belongs to another product")
		return
	}
	run, err := s.repo.ReconcileJournal(r.Context(), input.RunID, input.JournalEntryID, input.AuditID, s.cfg.SourceCommit, s.cfg.SourceRelease, input.RequiredSources, input.Observations, time.Now().UTC())
	if err != nil {
		s.writeError(w, http.StatusConflict, "reconciliation_rejected", "Reconciliation was rejected by the authoritative repository")
		return
	}
	writeJSON(w, http.StatusCreated, run)
}

func (s *Server) auditExport(w http.ResponseWriter, r *http.Request, principal Principal) {
	storedEvents, err := s.repo.Events(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	events := make([]datafabric.EventEnvelope, 0)
	for _, event := range storedEvents {
		if event.Product == principal.Product {
			events = append(events, event)
		}
	}
	sagas := make([]datafabric.SagaInstance, 0)
	storedSagas, err := s.repo.Sagas(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	for _, saga := range storedSagas {
		if saga.Product == principal.Product {
			sagas = append(sagas, saga)
		}
	}
	runs := make([]datafabric.ReconciliationRun, 0)
	storedRuns, err := s.repo.Reconciliations(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	for _, run := range storedRuns {
		if run.Product == principal.Product {
			runs = append(runs, run)
		}
	}
	journal, err := s.journalForProduct(r.Context(), principal.Product)
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"product": principal.Product, "events": events, "journal": journal, "sagas": sagas, "reconciliations": runs, "source": "ynx-data-fabric-audit-export", "asOf": time.Now().UTC(), "version": s.cfg.SourceRelease, "status": "authoritative"})
}

func (s *Server) subjectExport(w http.ResponseWriter, r *http.Request, principal Principal) {
	if principal.AccountID == "" {
		s.writeError(w, http.StatusForbidden, "subject_identity_required", "Canonical account identity is required")
		return
	}
	export, err := s.repo.ExportSubject(r.Context(), principal.AccountID, s.cfg.SourceRelease, time.Now().UTC())
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "subject_export_rejected", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, export)
}

type erasureRequest struct {
	AuditID string `json:"auditId"`
}

func (s *Server) subjectErasure(w http.ResponseWriter, r *http.Request, principal Principal) {
	if principal.AccountID == "" {
		s.writeError(w, http.StatusForbidden, "subject_identity_required", "Canonical account identity is required")
		return
	}
	input, err := decodeStrict[erasureRequest](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "erasure_request_invalid", err.Error())
		return
	}
	record, err := s.repo.RecordErasure(r.Context(), principal.AccountID, input.AuditID, s.cfg.PrivacyKey, time.Now().UTC())
	if err != nil && !errors.Is(err, datafabric.ErrDuplicate) {
		s.writeError(w, http.StatusConflict, "erasure_request_rejected", "Erasure request was rejected by the authoritative repository")
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *Server) journalForProduct(ctx context.Context, product string) ([]datafabric.JournalEntry, error) {
	entries := make([]datafabric.JournalEntry, 0)
	journal, err := s.repo.Journal(ctx)
	if err != nil {
		return nil, err
	}
	for _, entry := range journal {
		event, exists, err := s.repo.Event(ctx, entry.EventID)
		if err != nil {
			return nil, err
		}
		if exists && event.Product == product {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func decodeStrict[T any](w http.ResponseWriter, r *http.Request, maxBytes int64) (T, error) {
	var value T
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return value, errors.New("multiple JSON values are not allowed")
		}
		return value, err
	}
	return value, nil
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	err := s.repo.AuditIntegrity(r.Context(), s.cfg.EventKeys)
	status := http.StatusOK
	body := map[string]any{"ok": true, "version": s.cfg.SourceRelease, "sourceCommit": s.cfg.SourceCommit, "integrity": "verified", "asOf": time.Now().UTC()}
	if err != nil {
		status, body["ok"], body["integrity"] = http.StatusServiceUnavailable, false, "failed"
		body["failure"] = "persistent integrity audit failed"
	}
	writeJSON(w, status, body)
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"service": "ynx-data-fabric", "version": s.cfg.SourceRelease, "sourceCommit": s.cfg.SourceCommit})
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	stats, err := s.repo.Stats(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	_, _ = io.WriteString(w,
		"# TYPE ynx_data_fabric_requests_total counter\n"+
			"ynx_data_fabric_requests_total "+uintText(s.requests.Load())+"\n"+
			"# TYPE ynx_data_fabric_errors_total counter\n"+
			"ynx_data_fabric_errors_total "+uintText(s.errors.Load())+"\n"+
			"ynx_data_fabric_events "+uintText(stats.Events)+"\n"+
			"ynx_data_fabric_outbox_pending "+uintText(stats.OutboxPending)+"\n"+
			"ynx_data_fabric_outbox_oldest_available_timestamp_seconds "+strconv.FormatFloat(stats.OutboxOldestUnix, 'f', 6, 64)+"\n"+
			"ynx_data_fabric_inbox_effects "+uintText(stats.InboxEffects)+"\n"+
			"ynx_data_fabric_dead_letters "+uintText(stats.DeadLetters)+"\n"+
			"ynx_data_fabric_journal_entries "+uintText(stats.JournalEntries)+"\n"+
			"ynx_data_fabric_sagas_running "+uintText(stats.SagasRunning)+"\n"+
			"ynx_data_fabric_sagas_recovery "+uintText(stats.SagasRecovery)+"\n"+
			"ynx_data_fabric_reconciliations "+uintText(stats.Reconciliations)+"\n"+
			"ynx_data_fabric_reconciliation_mismatches "+uintText(stats.ReconciliationMismatches)+"\n"+
			"ynx_data_fabric_erasure_requests "+uintText(stats.ErasureRequests)+"\n"+
			"ynx_data_fabric_analytics_facts "+uintText(stats.AnalyticsFacts)+"\n"+
			requestDurationMetrics(&s.durationBuckets, s.durationNanos.Load()))
}

func requestDurationMetrics(buckets *[11]atomic.Uint64, nanos uint64) string {
	var builder strings.Builder
	builder.WriteString("# TYPE ynx_data_fabric_request_duration_seconds histogram\n")
	for index, bound := range requestDurationBounds {
		builder.WriteString("ynx_data_fabric_request_duration_seconds_bucket{le=\"")
		builder.WriteString(strconv.FormatFloat(bound, 'f', -1, 64))
		builder.WriteString("\"} ")
		builder.WriteString(uintText(buckets[index].Load()))
		builder.WriteByte('\n')
	}
	builder.WriteString("ynx_data_fabric_request_duration_seconds_bucket{le=\"+Inf\"} ")
	builder.WriteString(uintText(buckets[len(buckets)-1].Load()))
	builder.WriteString("\nynx_data_fabric_request_duration_seconds_sum ")
	builder.WriteString(strconv.FormatFloat(float64(nanos)/float64(time.Second), 'f', 9, 64))
	builder.WriteString("\nynx_data_fabric_request_duration_seconds_count ")
	builder.WriteString(uintText(buckets[len(buckets)-1].Load()))
	builder.WriteByte('\n')
	return builder.String()
}

func (s *Server) writeRepositoryError(w http.ResponseWriter) {
	s.writeError(w, http.StatusServiceUnavailable, "repository_unavailable", "Authoritative Data Fabric repository is unavailable")
}

func (s *Server) writeError(w http.ResponseWriter, status int, code, message string) {
	s.errors.Add(1)
	random := make([]byte, 8)
	_, _ = rand.Read(random)
	writeJSON(w, status, map[string]any{"error": code, "message": message, "errorId": "err_" + hex.EncodeToString(random)})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func uintText(value uint64) string {
	if value == 0 {
		return "0"
	}
	var buffer [20]byte
	i := len(buffer)
	for value > 0 {
		i--
		buffer[i] = byte('0' + value%10)
		value /= 10
	}
	return string(buffer[i:])
}
