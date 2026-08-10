package mail

import (
	"net/http"
	"sync/atomic"
)

type mailCapacity struct {
	tokens      chan struct{}
	queued      atomic.Int64
	maxInFlight int
	maxQueued   int
}

func newMailCapacity(options HandlerOptions) *mailCapacity {
	if options.MaxInFlight <= 0 {
		options.MaxInFlight = 128
	}
	if options.MaxQueued <= 0 {
		options.MaxQueued = 256
	}
	return &mailCapacity{
		tokens:      make(chan struct{}, options.MaxInFlight),
		maxInFlight: options.MaxInFlight,
		maxQueued:   options.MaxQueued,
	}
}

func (c *mailCapacity) snapshot() map[string]any {
	return map[string]any{
		"active":         len(c.tokens),
		"queued":         c.queued.Load(),
		"maxInFlight":    c.maxInFlight,
		"maxQueued":      c.maxQueued,
		"overloadPolicy": "bounded queue then HTTP 429; health and metrics remain available",
	}
}

func (c *mailCapacity) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/health" || r.URL.Path == "/v1/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		select {
		case c.tokens <- struct{}{}:
			defer func() { <-c.tokens }()
			next.ServeHTTP(w, r)
			return
		default:
		}
		for {
			queued := c.queued.Load()
			if queued >= int64(c.maxQueued) {
				w.Header().Set("Retry-After", "1")
				writeJSON(w, http.StatusTooManyRequests, map[string]any{
					"error":    "mail_capacity_exhausted",
					"detail":   "The bounded Mail request queue is full. Retry after one second.",
					"capacity": c.snapshot(),
				})
				return
			}
			if c.queued.CompareAndSwap(queued, queued+1) {
				break
			}
		}
		defer c.queued.Add(-1)
		select {
		case c.tokens <- struct{}{}:
			defer func() { <-c.tokens }()
			next.ServeHTTP(w, r)
		case <-r.Context().Done():
			writeJSON(w, http.StatusRequestTimeout, map[string]string{
				"error":  "request_cancelled",
				"detail": "The request ended before Mail capacity became available.",
			})
		}
	})
}
