package mail

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"
)

const mailObservabilityVersion = "mail-observability-v1"

var safeMailRequestID = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,128}$`)

type mailObservability struct {
	mu        sync.Mutex
	startedAt time.Time
	requests  uint64
	errors    uint64
	inFlight  int64
}

type mailObservedWriter struct {
	http.ResponseWriter
	status int
}

func (w *mailObservedWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *mailObservedWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func newMailObservability() *mailObservability {
	return &mailObservability{startedAt: time.Now().UTC()}
}

func (o *mailObservability) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := r.Header.Get("X-Request-ID")
		if !safeMailRequestID.MatchString(requestID) {
			requestID = newMailRequestID()
		}
		w.Header().Set("X-Request-ID", requestID)
		o.mu.Lock()
		o.inFlight++
		o.mu.Unlock()
		observed := &mailObservedWriter{ResponseWriter: w}
		next.ServeHTTP(observed, r)
		status := observed.status
		if status == 0 {
			status = http.StatusOK
		}
		o.mu.Lock()
		o.inFlight--
		o.requests++
		if status >= 400 {
			o.errors++
		}
		o.mu.Unlock()
		event, _ := json.Marshal(map[string]any{
			"event":        "mail.http.completed",
			"requestId":    requestID,
			"method":       r.Method,
			"route":        r.Pattern,
			"status":       status,
			"durationMs":   time.Since(started).Milliseconds(),
			"privacyClass": "no-body-no-query-no-account",
		})
		log.Print(string(event))
	})
}

func (o *mailObservability) metrics(w http.ResponseWriter, _ *http.Request) {
	o.mu.Lock()
	payload := map[string]any{
		"schemaVersion":        "mail-metrics-v1",
		"observabilityVersion": mailObservabilityVersion,
		"service":              "ynx-mail",
		"startedAt":            o.startedAt,
		"observedAt":           time.Now().UTC(),
		"requests":             o.requests,
		"errors":               o.errors,
		"inFlight":             o.inFlight,
		"processScope":         "in-memory counters reset on restart",
		"privacyBoundary":      "No body, query, account, token, address, subject, recipient or remote address is collected.",
	}
	o.mu.Unlock()
	writeJSON(w, http.StatusOK, payload)
}

func newMailRequestID() string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "mail_request_unavailable"
	}
	return "mail_" + hex.EncodeToString(raw[:])
}
