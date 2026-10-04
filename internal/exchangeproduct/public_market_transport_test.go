package exchangeproduct

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// Model errors reported by the HTTP transport, not market data or orders.
type marketTransportRecorder struct {
	*httptest.ResponseRecorder
	deadlines     int
	flushes       int
	deadlineError error
	flushError    error
	onFlush       func()
}

func (w *marketTransportRecorder) SetWriteDeadline(time.Time) error {
	w.deadlines++
	return w.deadlineError
}
func (w *marketTransportRecorder) FlushError() error {
	w.flushes++
	if w.onFlush != nil {
		w.onFlush()
	}
	return w.flushError
}

func TestMarketStreamStopsOnTransportFailure(t *testing.T) {
	for _, kind := range []string{"flush", "deadline"} {
		t.Run(kind, func(t *testing.T) {
			service, _, _ := newTestService(t)
			server := NewServer(service)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			w := &marketTransportRecorder{ResponseRecorder: httptest.NewRecorder()}
			if kind == "flush" {
				w.flushError = errors.New("peer disconnected")
			} else {
				w.deadlineError = errors.New("transport deadline failed")
			}
			done := make(chan struct{})
			go func() {
				server.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/market-data/stream", nil).WithContext(ctx))
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(200 * time.Millisecond):
				cancel()
				<-done
				t.Fatal("failed transport kept the stream and concurrency slot alive")
			}
			if kind == "deadline" && w.Body.Len() != 0 {
				t.Fatal("wrote after deadline failure")
			}
			if kind == "flush" && w.flushes != 1 {
				t.Fatalf("flushes=%d", w.flushes)
			}
			if len(server.concurrency) != 0 || server.inFlight.Load() != 0 {
				t.Fatal("retired subscriber still occupies server request capacity")
			}
		})
	}
}

func TestMarketStreamSourceFailureGetsFreshWriteDeadline(t *testing.T) {
	service, _, path := newTestService(t)
	previous := marketDataStreamPollInterval
	marketDataStreamPollInterval = time.Millisecond
	defer func() { marketDataStreamPollInterval = previous }()
	w := &marketTransportRecorder{ResponseRecorder: httptest.NewRecorder()}
	w.onFlush = func() {
		if w.flushes == 1 {
			if err := os.Rename(path, path+".retained"); err != nil {
				t.Error(err)
			}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	NewServer(service).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/market-data/stream", nil).WithContext(ctx))
	if w.deadlines != 2 || w.flushes != 2 {
		t.Fatalf("source failure did not renew bounded transport: deadlines=%d flushes=%d", w.deadlines, w.flushes)
	}
}
