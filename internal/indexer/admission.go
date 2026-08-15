package indexer

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Limits bounds public Indexer work before it reaches storage or Chain RPC.
// Zero values are replaced with conservative defaults.
type Limits struct {
	MaxConcurrent     int
	MaxRequestsPerSec int
	QueueWait         time.Duration
}

func normalizeLimits(in Limits) Limits {
	if in.MaxConcurrent <= 0 {
		in.MaxConcurrent = 64
	}
	if in.MaxRequestsPerSec <= 0 {
		in.MaxRequestsPerSec = 500
	}
	if in.QueueWait <= 0 {
		in.QueueWait = 150 * time.Millisecond
	}
	return in
}

type admissionController struct {
	limits Limits
	slots  chan struct{}

	mu          sync.Mutex
	windowStart time.Time
	windowCount int
}

func newAdmissionController(limits Limits) *admissionController {
	limits = normalizeLimits(limits)
	return &admissionController{limits: limits, slots: make(chan struct{}, limits.MaxConcurrent), windowStart: time.Now()}
}

func (a *admissionController) allowRate(now time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if now.Sub(a.windowStart) >= time.Second {
		a.windowStart = now
		a.windowCount = 0
	}
	if a.windowCount >= a.limits.MaxRequestsPerSec {
		return false
	}
	a.windowCount++
	return true
}

func (a *admissionController) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.allowRate(time.Now()) {
			w.Header().Set("Retry-After", "1")
			writePublicError(w, http.StatusTooManyRequests, "rate_limited", "Indexer request capacity is temporarily exhausted. Retry shortly.")
			return
		}
		timer := time.NewTimer(a.limits.QueueWait)
		defer timer.Stop()
		select {
		case a.slots <- struct{}{}:
			defer func() { <-a.slots }()
			next.ServeHTTP(w, r)
		case <-timer.C:
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(a.limits.QueueWait.Seconds()))))
			writePublicError(w, http.StatusServiceUnavailable, "capacity_exhausted", "Indexer is at its bounded concurrency limit. Retry shortly.")
		case <-r.Context().Done():
			return
		}
	})
}
