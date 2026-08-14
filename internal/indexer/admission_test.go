package indexer

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestAdmissionRateLimitAndBoundedQueue(t *testing.T) {
	rate := newAdmissionController(Limits{MaxConcurrent: 2, MaxRequestsPerSec: 1, QueueWait: 20 * time.Millisecond})
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	handler := rate.wrap(next)
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/health", nil))
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/health", nil))
	if first.Code != http.StatusNoContent || second.Code != http.StatusTooManyRequests || second.Header().Get("Retry-After") != "1" {
		t.Fatalf("first=%d second=%d retry=%q", first.Code, second.Code, second.Header().Get("Retry-After"))
	}

	queue := newAdmissionController(Limits{MaxConcurrent: 1, MaxRequestsPerSec: 100, QueueWait: 15 * time.Millisecond})
	entered := make(chan struct{})
	release := make(chan struct{})
	blocking := queue.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusNoContent)
	}))
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		blocking.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/txs", nil))
	}()
	<-entered
	queued := httptest.NewRecorder()
	blocking.ServeHTTP(queued, httptest.NewRequest(http.MethodGet, "/txs", nil))
	close(release)
	wg.Wait()
	if queued.Code != http.StatusServiceUnavailable {
		t.Fatalf("queue status=%d body=%s", queued.Code, queued.Body.String())
	}
}
