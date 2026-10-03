package quantlab

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSavedResearchCancelsActualHTTPMarketFetchAndBodyWithoutReplay(t *testing.T) {
	for _, phase := range []string{"headers", "body"} {
		for _, keyed := range []bool{false, true} {
			t.Run(phase+map[bool]string{false: "-legacy", true: "-keyed"}[keyed], func(t *testing.T) {
				arrived, stopped := make(chan struct{}), make(chan struct{})
				var calls atomic.Int64
				market := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					if phase == "body" {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(200)
						_, _ = w.Write([]byte(`{"market":`))
						w.(http.Flusher).Flush()
					}
					close(arrived)
					<-r.Context().Done()
					close(stopped)
				}))
				defer market.Close()
				path := filepath.Join(t.TempDir(), "state.json")
				s, err := New(Config{StatePath: path, MarketData: HTTPExchangeMarketData{BaseURL: market.URL, Client: market.Client()}})
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				if _, err := s.RunBacktest(request()); err != nil {
					t.Fatal(err)
				}
				before, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				input := request()
				payload := map[string]any{"strategy": input.Strategy, "assumptions": input.Assumptions}
				if keyed {
					payload["idempotencyKey"] = researchFixtureKey
				}
				body, _ := json.Marshal(payload)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				r := httptest.NewRequest(http.MethodPost, "/v1/backtests/from-market", strings.NewReader(string(body))).WithContext(ctx)
				r.RemoteAddr = "127.0.0.1:12345"
				r.Header.Set("X-YNX-Preview-Mode", "local-paper")
				w := httptest.NewRecorder()
				done := make(chan struct{})
				go func() { NewServer(s).ServeHTTP(w, r); close(done) }()
				select {
				case <-arrived:
				case <-time.After(2 * time.Second):
					t.Fatal("market request did not arrive")
				}
				cancel()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					t.Fatal("cancelled handler retained market slot")
				}
				select {
				case <-stopped:
				case <-time.After(2 * time.Second):
					t.Fatal("actual upstream HTTP request did not cancel")
				}
				after, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if w.Code != http.StatusRequestTimeout || calls.Load() != 1 || !reflect.DeepEqual(before, after) {
					t.Fatalf("status=%d calls=%d changed=%v", w.Code, calls.Load(), !reflect.DeepEqual(before, after))
				}
			})
		}
	}
}

type observedContextTransport struct {
	deadline time.Time
	calls    int
}

func (t *observedContextTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	t.calls++
	t.deadline, _ = r.Context().Deadline()
	return nil, errors.New("controlled unavailable")
}

func TestHTTPMarketHistoryBindsTenSecondCeilingAndEarlierCallerDeadline(t *testing.T) {
	for _, budget := range []time.Duration{0, 200 * time.Millisecond} {
		ctx := context.Background()
		cancel := func() {}
		if budget > 0 {
			ctx, cancel = context.WithTimeout(ctx, budget)
		}
		defer cancel()
		transport := &observedContextTransport{}
		start := time.Now()
		_, _, err := (HTTPExchangeMarketData{BaseURL: "https://market.invalid", Client: &http.Client{Transport: transport}}).HistoryContext(ctx, "YNXT-YUSD_TEST", 20)
		if err != ErrUnavailable || transport.calls != 1 || transport.deadline.IsZero() {
			t.Fatalf("missing context bound: %v", err)
		}
		limit := 10 * time.Second
		if budget > 0 {
			limit = budget
		}
		if transport.deadline.After(start.Add(limit + 50*time.Millisecond)) {
			t.Fatal("caller deadline was extended")
		}
	}
}
