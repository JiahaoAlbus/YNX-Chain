package datafabricapi

import (
	"bytes"
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
	Store                    *datafabric.Store
	Repository               Repository
	Authorizer               Authorizer
	EventKeys                map[string][]byte
	EventKeyProducts         map[string]string
	PrivacyKey               []byte
	SchemaRegistry           *datafabric.SchemaRegistry
	ChainCommitmentVerifier  datafabric.ChainCommitmentVerifier
	BrokerKind               string
	DatabaseKind             string
	BrokerProbe              func(context.Context) error
	SourceCommit             string
	SourceRelease            string
	MaxBodyBytes             int64
	RateLimitPerMinute       uint32
	ProducerConcurrencyLimit uint32
}

type Server struct {
	cfg                  Config
	repo                 Repository
	mux                  *http.ServeMux
	requests             atomic.Uint64
	errors               atomic.Uint64
	replayMu             sync.Mutex
	replays              map[string]time.Time
	rateMu               sync.Mutex
	rates                map[string]rateWindow
	durationBuckets      [11]atomic.Uint64
	durationNanos        atomic.Uint64
	producerSlots        chan struct{}
	producerInFlight     atomic.Uint64
	producerPeak         atomic.Uint64
	producerBackpressure atomic.Uint64
	startedAt            time.Time
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
	if cfg.ProducerConcurrencyLimit == 0 {
		cfg.ProducerConcurrencyLimit = 128
	}
	if cfg.ProducerConcurrencyLimit > 4096 {
		return nil, errors.New("producer concurrency limit must be between 1 and 4096")
	}
	if cfg.SchemaRegistry == nil {
		cfg.SchemaRegistry = datafabric.DefaultSchemaRegistry()
	}
	if cfg.DatabaseKind == "" {
		if cfg.Store != nil {
			cfg.DatabaseKind = "file-local-development"
		} else {
			cfg.DatabaseKind = "external-transactional"
		}
	}
	if cfg.BrokerKind == "" {
		cfg.BrokerKind = "unobserved"
	}
	repository := cfg.Repository
	if repository == nil {
		repository = LocalRepository{Store: cfg.Store}
	}
	s := &Server{cfg: cfg, repo: repository, mux: http.NewServeMux(), replays: make(map[string]time.Time), rates: make(map[string]rateWindow), producerSlots: make(chan struct{}, cfg.ProducerConcurrencyLimit), startedAt: time.Now().UTC()}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.securityHeaders(s.mux) }

func (s *Server) routes() {
	datafabricconsole.Register(s.mux)
	s.mux.HandleFunc("GET /health", s.health)
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /version", s.version)
	s.mux.HandleFunc("GET /metrics", s.metrics)
	s.mux.HandleFunc("GET /v1/schemas", s.authorize("fabric.schemas.read", s.listSchemas))
	s.mux.HandleFunc("GET /v1/schemas/{eventType}/{version}", s.authorize("fabric.schemas.read", s.getSchema))
	s.mux.HandleFunc("POST /v1/schemas/compatibility", s.authorize("fabric.schemas.read", s.checkSchemaCompatibility))
	s.mux.HandleFunc("POST /replay", s.authorize("fabric.redelivery.manage", s.redelivery(datafabric.RedeliveryReplay)))
	s.mux.HandleFunc("POST /backfill", s.authorize("fabric.redelivery.manage", s.redelivery(datafabric.RedeliveryBackfill)))
	s.mux.HandleFunc("POST /v1/replay", s.authorize("fabric.redelivery.manage", s.redelivery(datafabric.RedeliveryReplay)))
	s.mux.HandleFunc("POST /v1/backfill", s.authorize("fabric.redelivery.manage", s.redelivery(datafabric.RedeliveryBackfill)))
	s.mux.HandleFunc("POST /v1/events", s.authorize("fabric.events.write", s.appendEvent))
	s.mux.HandleFunc("GET /v1/events", s.authorize("fabric.events.read", s.listEvents))
	s.mux.HandleFunc("POST "+datafabric.ProducerEventsPath, s.appendProducerEvent)
	s.mux.HandleFunc("POST /v1/ledger/journal", s.authorize("fabric.ledger.write", s.postJournal))
	s.mux.HandleFunc("GET /v1/ledger/journal", s.authorize("fabric.ledger.read", s.listJournal))
	s.mux.HandleFunc("POST /v1/ledger/journal/{id}/corrections", s.authorize("fabric.ledger.correct", s.postJournalCorrection))
	s.mux.HandleFunc("POST /v1/billing/rate-plans", s.authorize("fabric.billing.rates.manage", s.registerBillingRatePlan))
	s.mux.HandleFunc("GET /v1/billing/rate-plans", s.authorize("fabric.billing.rates.read", s.listBillingRatePlans))
	s.mux.HandleFunc("POST /v1/billing/settlements", s.authorize("fabric.billing.write", s.settleUsage))
	s.mux.HandleFunc("GET /v1/billing/settlements", s.authorize("fabric.billing.read", s.listBillingSettlements))
	s.mux.HandleFunc("POST /v1/sagas", s.authorize("fabric.sagas.write", s.startSaga))
	s.mux.HandleFunc("GET /v1/sagas/{id}", s.authorize("fabric.sagas.read", s.getSaga))
	s.mux.HandleFunc("POST /v1/sagas/{id}/steps", s.authorize("fabric.sagas.write", s.completeSagaStep))
	s.mux.HandleFunc("POST /v1/sagas/{id}/fail", s.authorize("fabric.sagas.write", s.failSaga))
	s.mux.HandleFunc("POST /v1/sagas/recovery/claims", s.authorize("fabric.sagas.recover", s.claimSagaRecoveries))
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
	key := credential.SessionID + "\x00" + credential.DeviceID + "\x00" + credential.RequestNonce
	return s.consumeReplayKey(key, expiresAt)
}

func (s *Server) consumeReplayKey(key string, expiresAt time.Time) bool {
	now := time.Now().UTC()
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

type schemaCompatibilityRequest struct {
	EventType   string `json:"eventType"`
	FromVersion string `json:"fromVersion"`
	ToVersion   string `json:"toVersion"`
}

func (s *Server) listSchemas(w http.ResponseWriter, _ *http.Request, principal Principal) {
	writeJSON(w, http.StatusOK, map[string]any{
		"registryVersion": s.cfg.SchemaRegistry.Version(),
		"schemas":         s.cfg.SchemaRegistry.Definitions(principal.Product),
		"source":          "ynx-data-fabric-schema-registry",
		"asOf":            time.Now().UTC(),
		"status":          "authoritative",
	})
}

func (s *Server) getSchema(w http.ResponseWriter, r *http.Request, principal Principal) {
	definition, err := s.cfg.SchemaRegistry.Resolve(r.PathValue("eventType"), r.PathValue("version"), time.Now().UTC())
	if err != nil {
		s.writeDataFabricError(w, http.StatusNotFound, err)
		return
	}
	if definition.Product != principal.Product {
		s.writeError(w, http.StatusForbidden, string(datafabric.CodeSchemaProductMismatch), "Schema belongs to another product")
		return
	}
	writeJSON(w, http.StatusOK, definition)
}

func (s *Server) checkSchemaCompatibility(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[schemaCompatibilityRequest](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, string(datafabric.CodeInvalidVersion), err.Error())
		return
	}
	definition, err := s.cfg.SchemaRegistry.Resolve(input.EventType, input.ToVersion, time.Now().UTC())
	if err != nil {
		s.writeDataFabricError(w, http.StatusBadRequest, err)
		return
	}
	if definition.Product != principal.Product {
		s.writeError(w, http.StatusForbidden, string(datafabric.CodeSchemaProductMismatch), "Schema belongs to another product")
		return
	}
	report, err := s.cfg.SchemaRegistry.Compatibility(input.EventType, input.FromVersion, input.ToVersion)
	if err != nil {
		s.writeDataFabricError(w, http.StatusBadRequest, err)
		return
	}
	status := http.StatusOK
	if !report.Compatible {
		status = http.StatusConflict
	}
	writeJSON(w, status, report)
}

type redeliveryRequest struct {
	DryRun         bool       `json:"dryRun"`
	IdempotencyKey string     `json:"idempotencyKey,omitempty"`
	EventType      string     `json:"eventType,omitempty"`
	AggregateType  string     `json:"aggregateType,omitempty"`
	AggregateID    string     `json:"aggregateId,omitempty"`
	FromSequence   uint64     `json:"fromSequence,omitempty"`
	ToSequence     uint64     `json:"toSequence,omitempty"`
	OccurredFrom   *time.Time `json:"occurredFrom,omitempty"`
	OccurredTo     *time.Time `json:"occurredTo,omitempty"`
	Limit          int        `json:"limit"`
	PreviewHash    string     `json:"previewHash,omitempty"`
	Reason         string     `json:"reason,omitempty"`
	ApprovalID     string     `json:"approvalId,omitempty"`
	ApprovalStatus string     `json:"approvalStatus,omitempty"`
	Confirm        bool       `json:"confirm"`
	AuditID        string     `json:"auditId,omitempty"`
}

func (s *Server) redelivery(mode datafabric.RedeliveryMode) func(http.ResponseWriter, *http.Request, Principal) {
	return func(w http.ResponseWriter, r *http.Request, principal Principal) {
		input, err := decodeStrict[redeliveryRequest](w, r, s.cfg.MaxBodyBytes)
		if err != nil {
			s.writeError(w, http.StatusBadRequest, "DF_REDELIVERY_REQUEST_INVALID_V1", err.Error())
			return
		}
		scope := datafabric.RedeliveryScope{
			Product: principal.Product, EventType: input.EventType, AggregateType: input.AggregateType,
			AggregateID: input.AggregateID, FromSequence: input.FromSequence, ToSequence: input.ToSequence,
			OccurredFrom: input.OccurredFrom, OccurredTo: input.OccurredTo, Limit: input.Limit,
		}
		if err := scope.Validate(); err != nil {
			s.writeError(w, http.StatusBadRequest, "DF_REDELIVERY_SCOPE_INVALID_V1", err.Error())
			return
		}
		now := time.Now().UTC()
		if input.DryRun {
			preview, err := s.repo.PreviewRedelivery(r.Context(), mode, scope, now)
			if err != nil {
				s.writeRepositoryError(w)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"preview": preview, "requiresApproval": true, "executionEndpoint": r.URL.Path})
			return
		}
		command := datafabric.RedeliveryCommand{
			RequestID: r.Header.Get("X-YNX-Request-ID"), IdempotencyKey: input.IdempotencyKey, Mode: mode, Scope: scope,
			PreviewHash: input.PreviewHash, Reason: input.Reason, ApprovalID: input.ApprovalID,
			ApprovalStatus: input.ApprovalStatus, Confirmed: input.Confirm, AuditID: input.AuditID,
			RequestedBy: principal.AccountID, RequestedAt: now, ControlVersion: "1.0",
			SourceCommit: s.cfg.SourceCommit, SourceRelease: s.cfg.SourceRelease,
		}
		if err := command.Validate(); err != nil {
			s.writeError(w, http.StatusBadRequest, "DF_REDELIVERY_APPROVAL_INVALID_V1", err.Error())
			return
		}
		run, err := s.repo.ExecuteRedelivery(r.Context(), command, now)
		if err != nil {
			if datafabric.ErrorCodeOf(err) != "" {
				s.writeDataFabricError(w, http.StatusConflict, err)
			} else {
				s.writeRepositoryError(w)
			}
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"run": run, "businessCompletion": "pending-consumer-effects", "exactlyOnceClaim": "idempotent-effect-not-broker-delivery"})
	}
}

func (s *Server) appendEvent(w http.ResponseWriter, r *http.Request, principal Principal) {
	event, err := datafabric.DecodeEnvelopeStrict(http.MaxBytesReader(w, r.Body, s.cfg.MaxBodyBytes))
	if err != nil {
		s.writeDataFabricError(w, http.StatusBadRequest, err)
		return
	}
	if !principalOwnsEvent(principal, event, true) {
		s.writeError(w, http.StatusForbidden, string(datafabric.CodeWrongProduct), "Event product, account, or session does not match canonical authorization")
		return
	}
	if err := s.cfg.SchemaRegistry.ValidateEnvelope(event); err != nil {
		s.writeDataFabricError(w, http.StatusUnprocessableEntity, err)
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
	if !s.verifyChainCommitment(w, r, event, key) {
		return
	}
	if err := s.repo.Append(r.Context(), event, key); err != nil {
		status := http.StatusConflict
		if errors.Is(err, datafabric.ErrTampered) {
			status = http.StatusForbidden
		}
		if code := datafabric.ErrorCodeOf(err); code != "" {
			s.writeDataFabricError(w, status, err)
		} else {
			s.writeError(w, status, "DF_EVENT_REJECTED_V1", "Canonical event was rejected by the authoritative repository")
		}
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
		if principalOwnsEvent(principal, event, false) {
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

func (s *Server) appendProducerEvent(w http.ResponseWriter, r *http.Request) {
	keyID := strings.TrimSpace(r.Header.Get(datafabric.ProducerKeyIDHeader))
	timestamp := strings.TrimSpace(r.Header.Get(datafabric.ProducerTimestampHeader))
	nonce := strings.TrimSpace(r.Header.Get(datafabric.ProducerNonceHeader))
	signature := strings.TrimSpace(r.Header.Get(datafabric.ProducerSignatureHeader))
	key, exists := s.cfg.EventKeys[keyID]
	if !exists {
		s.writeError(w, http.StatusUnauthorized, string(datafabric.CodeWrongSignature), "Product producer key is not registered")
		return
	}
	requestTime, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil || requestTime.Location() != time.UTC || requestTime.Before(time.Now().UTC().Add(-2*time.Minute)) || requestTime.After(time.Now().UTC().Add(30*time.Second)) {
		s.writeError(w, http.StatusUnauthorized, string(datafabric.CodeReplay), "Product producer timestamp is outside the accepted freshness window")
		return
	}
	body, err := readBoundedBody(r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, string(datafabric.CodeOversizedPayload), "Product producer body exceeds the canonical limit")
		return
	}
	if err := datafabric.VerifyProducerDeliverySignature(signature, keyID, timestamp, nonce, body, key); err != nil {
		s.writeError(w, http.StatusUnauthorized, string(datafabric.CodeWrongSignature), "Product producer delivery signature is invalid")
		return
	}
	if !s.acquireProducerSlot() {
		w.Header().Set("Retry-After", "1")
		s.writeError(w, http.StatusTooManyRequests, "producer_backpressure", "Product producer concurrency limit is saturated; retry with bounded backoff")
		return
	}
	defer s.releaseProducerSlot()
	if !s.consumeReplayKey("producer\x00"+keyID+"\x00"+nonce, requestTime.Add(10*time.Minute)) {
		s.writeError(w, http.StatusUnauthorized, string(datafabric.CodeReplay), "Product producer delivery nonce was already consumed")
		return
	}
	event, err := datafabric.DecodeEnvelopeStrict(bytes.NewReader(body))
	if err != nil {
		s.writeDataFabricError(w, http.StatusBadRequest, err)
		return
	}
	if s.cfg.EventKeyProducts[keyID] != event.Product || event.Integrity.KeyID != keyID {
		s.writeError(w, http.StatusForbidden, string(datafabric.CodeWrongProduct), "Product producer key does not own this event")
		return
	}
	if !s.allowSessionRequest(Principal{SessionID: keyID, DeviceID: "product-producer", Product: event.Product}) {
		w.Header().Set("Retry-After", "60")
		s.writeError(w, http.StatusTooManyRequests, "producer_rate_limited", "Product producer request rate exceeded the service limit")
		return
	}
	if err := s.cfg.SchemaRegistry.ValidateEnvelope(event); err != nil {
		s.writeDataFabricError(w, http.StatusUnprocessableEntity, err)
		return
	}
	if !s.verifyChainCommitment(w, r, event, key) {
		return
	}
	if err := s.repo.Append(r.Context(), event, key); err != nil {
		if errors.Is(err, datafabric.ErrDuplicate) {
			writeJSON(w, http.StatusOK, map[string]any{"eventId": event.EventID, "status": "already-committed", "auditId": event.AuditID})
			return
		}
		status := http.StatusConflict
		if errors.Is(err, datafabric.ErrTampered) {
			status = http.StatusForbidden
		}
		if code := datafabric.ErrorCodeOf(err); code != "" {
			s.writeDataFabricError(w, status, err)
		} else {
			s.writeError(w, status, "DF_EVENT_REJECTED_V1", "Product event was rejected by the authoritative repository")
		}
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"eventId": event.EventID, "status": "committed-to-outbox", "auditId": event.AuditID})
}

func (s *Server) acquireProducerSlot() bool {
	select {
	case s.producerSlots <- struct{}{}:
		inFlight := s.producerInFlight.Add(1)
		for peak := s.producerPeak.Load(); inFlight > peak && !s.producerPeak.CompareAndSwap(peak, inFlight); peak = s.producerPeak.Load() {
		}
		return true
	default:
		s.producerBackpressure.Add(1)
		return false
	}
}

func (s *Server) releaseProducerSlot() {
	<-s.producerSlots
	s.producerInFlight.Add(^uint64(0))
}

func (s *Server) verifyChainCommitment(w http.ResponseWriter, r *http.Request, event datafabric.EventEnvelope, key []byte) bool {
	if event.ChainCommitmentID == "" {
		return true
	}
	if err := event.Verify(key); err != nil {
		s.writeDataFabricError(w, http.StatusForbidden, err)
		return false
	}
	if err := datafabric.VerifyChainCommitmentReference(r.Context(), s.cfg.ChainCommitmentVerifier, event); err != nil {
		status := http.StatusUnprocessableEntity
		if datafabric.ErrorCodeOf(err) == datafabric.CodeChainCommitmentUnavailable {
			status = http.StatusServiceUnavailable
		}
		s.writeDataFabricError(w, status, err)
		return false
	}
	return true
}

func readBoundedBody(r *http.Request, maxBodyBytes int64) ([]byte, error) {
	source := io.Reader(http.NoBody)
	if r.Body != nil {
		source = r.Body
	}
	body, err := io.ReadAll(io.LimitReader(source, maxBodyBytes+1))
	if err != nil || int64(len(body)) > maxBodyBytes {
		return nil, errors.New("body exceeds canonical limit")
	}
	return body, nil
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
	if !exists || !principalOwnsEvent(principal, event, false) {
		s.writeError(w, http.StatusForbidden, "journal_authority_mismatch", "Journal event is missing or belongs to another product or account")
		return
	}
	if err := s.repo.PostJournal(r.Context(), entry); err != nil {
		code := datafabric.ErrorCodeOf(err)
		if code == "" {
			s.writeError(w, http.StatusConflict, "journal_rejected", "Journal was rejected by the authoritative repository")
			return
		}
		s.writeError(w, http.StatusConflict, string(code), "Journal was rejected by the authoritative repository")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"entryId": entry.EntryID, "status": "recorded", "auditId": entry.AuditID})
}

func (s *Server) postJournalCorrection(w http.ResponseWriter, r *http.Request, principal Principal) {
	entry, err := decodeStrict[datafabric.JournalEntry](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_journal_correction", err.Error())
		return
	}
	targetID := r.PathValue("id")
	if entry.CorrectionOf != targetID {
		s.writeError(w, http.StatusBadRequest, string(datafabric.CodeLedgerCorrectionInvalid), "Correction target does not match the canonical route")
		return
	}
	target, exists, repositoryErr := s.repo.JournalEntry(r.Context(), targetID)
	if repositoryErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if !exists {
		s.writeError(w, http.StatusNotFound, string(datafabric.CodeLedgerCorrectionTargetMissing), "Correction target was not found")
		return
	}
	targetEvent, exists, repositoryErr := s.repo.Event(r.Context(), target.EventID)
	if repositoryErr != nil {
		s.writeRepositoryError(w)
		return
	}
	correctionEvent, correctionEventExists, repositoryErr := s.repo.Event(r.Context(), entry.EventID)
	if repositoryErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if !exists || !correctionEventExists || !principalOwnsEvent(principal, targetEvent, false) || !principalOwnsEvent(principal, correctionEvent, false) {
		s.writeError(w, http.StatusForbidden, "journal_authority_mismatch", "Correction authority does not belong to this product and account")
		return
	}
	if err := s.repo.PostCorrection(r.Context(), entry); err != nil {
		code := datafabric.ErrorCodeOf(err)
		if code == "" {
			code = datafabric.CodeLedgerCorrectionInvalid
		}
		s.writeError(w, http.StatusConflict, string(code), "Journal correction was rejected by the authoritative repository")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"entryId": entry.EntryID, "correctionOf": entry.CorrectionOf, "status": "reversal-recorded", "auditId": entry.AuditID})
}

func (s *Server) listJournal(w http.ResponseWriter, r *http.Request, principal Principal) {
	entries, err := s.journalForPrincipal(r.Context(), principal)
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

func (s *Server) registerBillingRatePlan(w http.ResponseWriter, r *http.Request, principal Principal) {
	plan, err := decodeStrict[datafabric.BillingRatePlan](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, string(datafabric.CodeBillingRatePlanInvalid), err.Error())
		return
	}
	if plan.Product != principal.Product {
		s.writeError(w, http.StatusForbidden, string(datafabric.CodeBillingAuthorityMismatch), "Billing rate plan belongs to another product")
		return
	}
	plan.SourceCommit, plan.SourceRelease = s.cfg.SourceCommit, s.cfg.SourceRelease
	if err := s.repo.RegisterBillingRatePlan(r.Context(), plan); err != nil {
		status := http.StatusUnprocessableEntity
		if datafabric.ErrorCodeOf(err) == datafabric.CodeBillingRatePlanDuplicate {
			status = http.StatusConflict
		}
		s.writeDataFabricError(w, status, err)
		return
	}
	writeJSON(w, http.StatusCreated, plan)
}

func (s *Server) listBillingRatePlans(w http.ResponseWriter, r *http.Request, principal Principal) {
	stored, err := s.repo.BillingRatePlans(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	plans := make([]datafabric.BillingRatePlan, 0)
	for _, plan := range stored {
		if plan.Product == principal.Product {
			plans = append(plans, plan)
		}
	}
	page, nextCursor, err := paginate(r, plans, func(plan datafabric.BillingRatePlan) string {
		return plan.PlanID + ":" + plan.Version
	})
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_page", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ratePlans": page, "nextCursor": nextCursor, "source": "ynx-billing-rate-authority", "asOf": time.Now().UTC(), "version": s.cfg.SourceRelease, "status": "authoritative"})
}

func (s *Server) settleUsage(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[datafabric.BillingSettlementRequest](w, r, s.cfg.MaxBodyBytes)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, string(datafabric.CodeBillingUsageInvalid), err.Error())
		return
	}
	event, exists, repositoryErr := s.repo.Event(r.Context(), input.UsageEventID)
	if repositoryErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if !exists || !principalOwnsEvent(principal, event, false) {
		s.writeError(w, http.StatusForbidden, string(datafabric.CodeBillingAuthorityMismatch), "Usage event is missing or belongs to another product or account")
		return
	}
	input.SourceCommit, input.SourceRelease = s.cfg.SourceCommit, s.cfg.SourceRelease
	settlement, err := s.repo.SettleUsage(r.Context(), input)
	if err != nil {
		status := http.StatusUnprocessableEntity
		if datafabric.ErrorCodeOf(err) == datafabric.CodeBillingAlreadySettled {
			status = http.StatusConflict
		}
		s.writeDataFabricError(w, status, err)
		return
	}
	writeJSON(w, http.StatusCreated, settlement)
}

func (s *Server) listBillingSettlements(w http.ResponseWriter, r *http.Request, principal Principal) {
	stored, err := s.repo.BillingSettlements(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	settlements := make([]datafabric.BillingSettlement, 0)
	for _, settlement := range stored {
		event, exists, eventErr := s.repo.Event(r.Context(), settlement.UsageEventID)
		if eventErr != nil {
			s.writeRepositoryError(w)
			return
		}
		if exists && principalOwnsEvent(principal, event, false) {
			settlements = append(settlements, settlement)
		}
	}
	page, nextCursor, err := paginate(r, settlements, func(settlement datafabric.BillingSettlement) string {
		return settlement.SettlementID
	})
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_page", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settlements": page, "nextCursor": nextCursor, "source": "ynx-usage-billing-settlement", "asOf": time.Now().UTC(), "version": s.cfg.SourceRelease, "status": "authoritative"})
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
	if owned, authorityErr := s.principalOwnsSaga(r.Context(), principal, instance); authorityErr != nil {
		s.writeRepositoryError(w)
		return
	} else if !owned {
		s.writeError(w, http.StatusForbidden, "saga_authority_mismatch", "Saga belongs to another product or account")
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
		owned, authorityErr := s.principalOwnsReconciliation(r.Context(), principal, run)
		if authorityErr != nil {
			s.writeRepositoryError(w)
			return
		}
		if owned {
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

type sagaRecoveryClaimRequest struct {
	LeaseSeconds uint32 `json:"leaseSeconds"`
	Limit        int    `json:"limit"`
}

type sagaRecoveryCompletionRequest struct {
	TaskID     string `json:"taskId"`
	LeaseOwner string `json:"leaseOwner"`
	EventID    string `json:"eventId"`
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
	if owned, authorityErr := s.principalOwnsSagaCoordinates(r.Context(), principal, input.AggregateID, input.CorrelationID); authorityErr != nil {
		s.writeRepositoryError(w)
		return
	} else if !owned {
		s.writeError(w, http.StatusForbidden, "saga_authority_mismatch", "Saga aggregate and correlation do not belong to the authorized account")
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
	authorized, authorityErr := s.authorizedSagaEvent(r.Context(), r.PathValue("id"), input.EventID, principal)
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
	authorized, authorityErr := s.authorizedSaga(r.Context(), r.PathValue("id"), principal)
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

func (s *Server) claimSagaRecoveries(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[sagaRecoveryClaimRequest](w, r, s.cfg.MaxBodyBytes)
	if err != nil || input.LeaseSeconds < 5 || input.LeaseSeconds > 900 || input.Limit <= 0 || input.Limit > 200 {
		s.writeError(w, http.StatusBadRequest, "invalid_saga_recovery_claim", "Saga recovery claim is invalid")
		return
	}
	now := time.Now().UTC()
	tasks, err := s.repo.ClaimSagaRecoveries(r.Context(), principal.Product, principal.DeviceID, now, time.Duration(input.LeaseSeconds)*time.Second, input.Limit)
	if err != nil {
		s.writeError(w, http.StatusConflict, "saga_recovery_claim_rejected", "Saga recovery claim was rejected by the authoritative repository")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks, "source": "ynx-saga-recovery", "asOf": now, "version": s.cfg.SourceRelease, "status": "authoritative"})
}

func (s *Server) completeSagaCompensation(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[sagaRecoveryCompletionRequest](w, r, s.cfg.MaxBodyBytes)
	authorized, authorityErr := s.authorizedSagaEvent(r.Context(), r.PathValue("id"), input.EventID, principal)
	if authorityErr != nil {
		s.writeRepositoryError(w)
		return
	}
	if err != nil || !authorized {
		s.writeError(w, http.StatusForbidden, "saga_compensation_rejected", "Saga request or authority is invalid")
		return
	}
	if input.LeaseOwner != principal.DeviceID {
		s.writeError(w, http.StatusForbidden, "saga_compensation_rejected", "Saga recovery lease belongs to another canonical device")
		return
	}
	if err := s.repo.CompleteSagaRecovery(r.Context(), r.PathValue("id"), input.TaskID, principal.DeviceID, input.EventID, time.Now().UTC()); err != nil {
		code := datafabric.ErrorCodeOf(err)
		if code == "" {
			s.writeError(w, http.StatusConflict, "saga_compensation_rejected", "Saga compensation was rejected by the authoritative repository")
			return
		}
		s.writeError(w, http.StatusConflict, string(code), "Saga compensation was rejected by the authoritative repository")
		return
	}
	instance, _, _ := s.repo.Saga(r.Context(), r.PathValue("id"))
	writeJSON(w, http.StatusOK, instance)
}

func (s *Server) manualSagaRecovery(w http.ResponseWriter, r *http.Request, principal Principal) {
	input, err := decodeStrict[sagaFailureRequest](w, r, s.cfg.MaxBodyBytes)
	authorized, authorityErr := s.authorizedSaga(r.Context(), r.PathValue("id"), principal)
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

func (s *Server) authorizedSaga(ctx context.Context, id string, principal Principal) (bool, error) {
	instance, exists, err := s.repo.Saga(ctx, id)
	if err != nil || !exists {
		return false, err
	}
	return s.principalOwnsSaga(ctx, principal, instance)
}

func (s *Server) authorizedSagaEvent(ctx context.Context, sagaID, eventID string, principal Principal) (bool, error) {
	instance, exists, err := s.repo.Saga(ctx, sagaID)
	if err != nil || !exists {
		return false, err
	}
	owned, err := s.principalOwnsSaga(ctx, principal, instance)
	if err != nil || !owned {
		return false, err
	}
	event, eventExists, err := s.repo.Event(ctx, eventID)
	if err != nil {
		return false, err
	}
	return eventExists && principalOwnsEvent(principal, event, false) && event.CorrelationID == instance.CorrelationID && event.AggregateID == instance.AggregateID, nil
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
	if !exists || !principalOwnsEvent(principal, event, false) {
		s.writeError(w, http.StatusForbidden, "reconciliation_authority_mismatch", "Journal belongs to another product or account")
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
	storedPlans, err := s.repo.BillingRatePlans(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	plans := make([]datafabric.BillingRatePlan, 0)
	for _, plan := range storedPlans {
		if plan.Product == principal.Product {
			plans = append(plans, plan)
		}
	}
	storedSettlements, err := s.repo.BillingSettlements(r.Context())
	if err != nil {
		s.writeRepositoryError(w)
		return
	}
	settlements := make([]datafabric.BillingSettlement, 0)
	for _, settlement := range storedSettlements {
		if settlement.Product == principal.Product {
			settlements = append(settlements, settlement)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"product": principal.Product, "events": events, "journal": journal, "billingRatePlans": plans, "billingSettlements": settlements, "sagas": sagas, "reconciliations": runs, "source": "ynx-data-fabric-audit-export", "asOf": time.Now().UTC(), "version": s.cfg.SourceRelease, "status": "authoritative"})
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

func (s *Server) journalForPrincipal(ctx context.Context, principal Principal) ([]datafabric.JournalEntry, error) {
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
		if exists && principalOwnsEvent(principal, event, false) {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

// journalForProduct is reserved for the product-wide fabric.audit.export
// scope. User-facing ledger reads use journalForPrincipal instead.
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

func principalOwnsEvent(principal Principal, event datafabric.EventEnvelope, requireSession bool) bool {
	if !canonicalPrincipalIDPattern.MatchString(principal.AccountID) || event.Product != principal.Product || event.Actor.AccountID != principal.AccountID {
		return false
	}
	return !requireSession || event.Actor.SessionID == principal.SessionID
}

func (s *Server) principalOwnsSagaCoordinates(ctx context.Context, principal Principal, aggregateID, correlationID string) (bool, error) {
	events, err := s.repo.Events(ctx)
	if err != nil {
		return false, err
	}
	for _, event := range events {
		if principalOwnsEvent(principal, event, false) && event.AggregateID == aggregateID && event.CorrelationID == correlationID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) principalOwnsSaga(ctx context.Context, principal Principal, instance datafabric.SagaInstance) (bool, error) {
	if instance.Product != principal.Product {
		return false, nil
	}
	return s.principalOwnsSagaCoordinates(ctx, principal, instance.AggregateID, instance.CorrelationID)
}

func (s *Server) principalOwnsReconciliation(ctx context.Context, principal Principal, run datafabric.ReconciliationRun) (bool, error) {
	entry, exists, err := s.repo.JournalEntry(ctx, run.JournalEntry)
	if err != nil || !exists {
		return false, err
	}
	event, exists, err := s.repo.Event(ctx, entry.EventID)
	return exists && principalOwnsEvent(principal, event, false), err
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
	asOf := time.Now().UTC()
	status := http.StatusOK
	degraded := []string{}
	dependencyStatus := map[string]any{
		"database": map[string]any{"kind": s.cfg.DatabaseKind, "status": "verified"},
		"broker":   map[string]any{"kind": s.cfg.BrokerKind, "status": "unobserved"},
	}
	body := map[string]any{
		"ok": true, "commit": s.cfg.SourceCommit, "release": s.cfg.SourceRelease,
		"schemaVersion": s.cfg.SchemaRegistry.Version(), "startedAt": s.startedAt,
		"asOf": asOf, "databaseStatus": "verified", "brokerStatus": "unobserved",
		"ledgerStatus": "verified", "consumerLag": uint64(0), "deadLetterCount": uint64(0),
		"lastReconciliation": nil, "degradedState": degraded, "dependencyStatus": dependencyStatus,
		"integrity": "verified",
	}
	stats, statsErr := s.repo.Stats(r.Context())
	if statsErr != nil {
		status = http.StatusServiceUnavailable
		body["ok"], body["databaseStatus"], body["ledgerStatus"], body["integrity"] = false, "failed", "unknown", "unknown"
		dependencyStatus["database"] = map[string]any{"kind": s.cfg.DatabaseKind, "status": "failed"}
		degraded = append(degraded, "authoritative-repository-unavailable")
	} else {
		body["consumerLag"] = stats.OutboxPending
		body["deadLetterCount"] = stats.DeadLetters
	}
	if integrityErr := s.repo.AuditIntegrity(r.Context(), s.cfg.EventKeys); integrityErr != nil {
		status = http.StatusServiceUnavailable
		body["ok"], body["ledgerStatus"], body["integrity"] = false, "failed", "failed"
		degraded = append(degraded, "persistent-integrity-audit-failed")
	}
	if reconciliations, reconciliationErr := s.repo.Reconciliations(r.Context()); reconciliationErr != nil {
		status = http.StatusServiceUnavailable
		body["ok"] = false
		degraded = append(degraded, "reconciliation-status-unavailable")
	} else {
		var last *datafabric.ReconciliationRun
		for index := range reconciliations {
			candidate := reconciliations[index]
			if last == nil || candidate.CompletedAt.After(last.CompletedAt) {
				copy := candidate
				last = &copy
			}
		}
		if last != nil {
			body["lastReconciliation"] = map[string]any{"runId": last.RunID, "status": last.Status, "coverage": last.Coverage, "completedAt": last.CompletedAt}
		}
	}
	if s.cfg.BrokerProbe != nil {
		probeCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		probeErr := s.cfg.BrokerProbe(probeCtx)
		cancel()
		if probeErr != nil {
			status = http.StatusServiceUnavailable
			body["ok"], body["brokerStatus"] = false, "failed"
			dependencyStatus["broker"] = map[string]any{"kind": s.cfg.BrokerKind, "status": "failed"}
			degraded = append(degraded, "broker-unavailable")
		} else {
			body["brokerStatus"] = "verified"
			dependencyStatus["broker"] = map[string]any{"kind": s.cfg.BrokerKind, "status": "verified"}
		}
	} else {
		degraded = append(degraded, "broker-status-unobserved")
	}
	body["degradedState"] = degraded
	writeJSON(w, status, body)
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"service": "ynx-data-fabric", "release": s.cfg.SourceRelease, "commit": s.cfg.SourceCommit, "schemaVersion": s.cfg.SchemaRegistry.Version(), "startedAt": s.startedAt})
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
			"# TYPE ynx_data_fabric_producer_inflight gauge\n"+
			"ynx_data_fabric_producer_inflight "+uintText(s.producerInFlight.Load())+"\n"+
			"ynx_data_fabric_producer_concurrency_limit "+uintText(uint64(s.cfg.ProducerConcurrencyLimit))+"\n"+
			"ynx_data_fabric_producer_peak_inflight "+uintText(s.producerPeak.Load())+"\n"+
			"# TYPE ynx_data_fabric_producer_backpressure_total counter\n"+
			"ynx_data_fabric_producer_backpressure_total "+uintText(s.producerBackpressure.Load())+"\n"+
			"ynx_data_fabric_events "+uintText(stats.Events)+"\n"+
			"ynx_data_fabric_outbox_pending "+uintText(stats.OutboxPending)+"\n"+
			"ynx_data_fabric_outbox_oldest_available_timestamp_seconds "+strconv.FormatFloat(stats.OutboxOldestUnix, 'f', 6, 64)+"\n"+
			"ynx_data_fabric_inbox_effects "+uintText(stats.InboxEffects)+"\n"+
			"ynx_data_fabric_dead_letters "+uintText(stats.DeadLetters)+"\n"+
			"ynx_data_fabric_journal_entries "+uintText(stats.JournalEntries)+"\n"+
			"ynx_data_fabric_billing_rate_plans "+uintText(stats.BillingRatePlans)+"\n"+
			"ynx_data_fabric_billing_settlements "+uintText(stats.BillingSettlements)+"\n"+
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

func (s *Server) writeDataFabricError(w http.ResponseWriter, status int, err error) {
	code := datafabric.ErrorCodeOf(err)
	if code == "" {
		code = "DF_REQUEST_INVALID_V1"
	}
	s.errors.Add(1)
	random := make([]byte, 8)
	_, _ = rand.Read(random)
	body := map[string]any{"error": code, "message": err.Error(), "errorId": "err_" + hex.EncodeToString(random)}
	if evidence := datafabric.ErrorEvidenceOf(err); len(evidence) != 0 {
		body["evidence"] = evidence
	}
	writeJSON(w, status, body)
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
