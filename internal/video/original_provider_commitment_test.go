package video

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// Disposable TLS original clients, never actual Pay/AI permissions or finality.
func TestVideoOriginalOperationPayoutProviderWireDurable(t *testing.T) {
	s, owner := payoutFixture(t)
	var calls atomic.Int32
	var wire, endpoint, key string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		b, _ := io.ReadAll(r.Body)
		wire = videoOriginalDigest(b)
		endpoint = videoOriginalDigest([]byte("https://" + r.Host + r.URL.Path))
		var v struct {
			IdempotencyKey string `json:"idempotencyKey"`
		}
		json.Unmarshal(b, &v)
		key = v.IdempotencyKey
		w.WriteHeader(503)
	}))
	defer server.Close()
	s.cfg.Pay = PayClient{Endpoint: server.URL, Token: "controlled-token", Client: server.Client()}
	g := operationVideoGrant(s)
	g.Actor = owner
	g.Operation.Path = "/api/payouts"
	sc := videoLease(t, s, context.Background(), g, false)
	if _, err := sc.CreatePayoutIntent(context.Background(), owner, 5); err == nil {
		t.Fatal("unknown provider completed")
	}
	i := s.store.state.OriginalOperations[g.Operation.OperationID].Identity
	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	rb, err := recovered.ReadOriginalBusinessOperationResults(context.Background(), i)
	if err != nil || len(rb.Record.Providers) != 1 || len(rb.Payouts) != 1 {
		t.Fatal(rb, err)
	}
	p := rb.Record.Providers[0]
	if p.Kind != "payout" || p.ObjectID != key || p.Commitment.WireDigest != wire || p.Commitment.EndpointDigest != endpoint || p.Commitment.ProviderRequestKey != key || calls.Load() != 1 {
		t.Fatal(p)
	}
	public, _ := json.Marshal(rb.Payouts[0])
	if strings.Contains(string(public), "wireDigest") || strings.Contains(string(public), "controlled-token") {
		t.Fatal("private descriptor escaped original HTTP object")
	}
	rb.Record.Providers[0].Commitment.WireDigest = "foreign"
	fresh, err := recovered.ReadOriginalBusinessOperationResults(context.Background(), i)
	if err != nil || fresh.Record.Providers[0].Commitment.WireDigest != wire {
		t.Fatal(fresh, err)
	}
	if _, err = videoLease(t, recovered, context.Background(), g, false).CreatePayoutIntent(context.Background(), owner, 5); err == nil || calls.Load() != 1 {
		t.Fatal("unknown was resent", err)
	}
}
func TestVideoOriginalOperationAIDescriptorMatchesOriginalWire(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "generate", true: "stream"}[stream], func(t *testing.T) {
			var raw []byte
			var path string
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ = io.ReadAll(r.Body)
				path = r.URL.Path
				w.Header().Set("Content-Type", "application/json")
				if stream {
					w.Write([]byte("{\"Delta\":\"original\",\"Provider\":\"fixture\",\"Model\":\"fixture\",\"Units\":1,\"Done\":true}\n"))
				} else {
					w.Write([]byte(`{"Provider":"fixture","Model":"fixture","Text":"original","Units":1}`))
				}
			}))
			defer server.Close()
			g := GatewayAI{Endpoint: server.URL, Token: "controlled-token", Client: server.Client()}
			in := AIRequest{Kind: "summary", VideoID: "original-video", ContextClasses: []string{"public-metadata"}, ContextPreview: "original"}
			c, err := g.OriginalAICommitment(in, stream)
			if err != nil {
				t.Fatal(err)
			}
			if stream {
				_, err = g.Stream(context.Background(), in, func(string) error { return nil })
			} else {
				_, err = g.Generate(context.Background(), in)
			}
			if err != nil || c.WireDigest != videoOriginalDigest(raw) || c.EndpointDigest != videoOriginalDigest([]byte(server.URL+path)) || c.ProviderRequestKey != "" {
				t.Fatal(c, err)
			}
		})
	}
}
func TestVideoOriginalOperationMissingProviderDescriptorClosed(t *testing.T) {
	s, owner := payoutFixture(t)
	var calls atomic.Int32
	s.cfg.Pay = videoPayFixture(func(context.Context, string, int64, string) (string, error) { calls.Add(1); return "fake-ACK", nil })
	g := operationVideoGrant(s)
	g.Actor = owner
	if _, err := videoLease(t, s, context.Background(), g, false).CreatePayoutIntent(context.Background(), owner, 5); !errors.Is(err, ErrVideoTransactionUnavailable) || calls.Load() != 0 || len(s.store.state.OriginalOperations) != 0 || len(s.store.state.PayoutIntents) != 0 {
		t.Fatal(err)
	}
}

func TestVideoOriginalOperationAIProviderAdmissionAndColdReadback(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "original AI metadata")
	job, err := s.PrepareAI(c.Owner, v.ID, "summary", []string{"metadata"})
	if err != nil {
		t.Fatal(err)
	}
	type observed struct{ wire, endpoint string }
	observation := make(chan observed, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		observation <- observed{videoOriginalDigest(b), videoOriginalDigest([]byte("https://" + r.Host + r.URL.Path))}
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Write([]byte("{\"Delta\":\"original local result\",\"Provider\":\"fixture\",\"Model\":\"fixture\",\"Units\":1,\"Done\":true}\n"))
	}))
	defer server.Close()
	s.cfg.AI = GatewayAI{Endpoint: server.URL, Token: "controlled-token", Client: server.Client()}
	g := operationVideoGrant(s)
	g.Actor = c.Owner
	g.Operation.Path = "/api/ai/" + job.ID + "/run"
	result, err := videoLease(t, s, context.Background(), g, false).RunAI(context.Background(), c.Owner, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	observedWire := <-observation
	i := s.store.state.OriginalOperations[g.Operation.OperationID].Identity
	recovered, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	rb, err := recovered.ReadOriginalBusinessOperationResults(context.Background(), i)
	if err != nil || len(rb.Record.Providers) != 1 || len(rb.AIJobs) != 1 || rb.AIJobs[0].Result != result.Result {
		t.Fatal(rb, err)
	}
	p := rb.Record.Providers[0]
	if p.Kind != "ai_job" || p.ObjectID != job.ID || p.Commitment.WireDigest != observedWire.wire || p.Commitment.EndpointDigest != observedWire.endpoint || p.Commitment.ProviderRequestKey != "" {
		t.Fatal(p)
	}
	rb.AIJobs[0].ContextClasses[0] = "foreign"
	fresh, err := recovered.ReadOriginalBusinessOperationResults(context.Background(), i)
	if err != nil || fresh.AIJobs[0].ContextClasses[0] != "metadata" {
		t.Fatal(fresh, err)
	}
}
