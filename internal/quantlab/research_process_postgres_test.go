package quantlab

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Actual OS services and PostgreSQL, controlled synthetic history adapter.
// Browser tenant bindings are not authenticated Wallet accounts or public prices.
func TestPostgreSQLResearchHTTPProcessesReplayAndTenantRecovery(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := fmt.Sprintf("quant-process-it-research-%d", time.Now().UnixNano())
	cfg := Config{DatabaseURL: databaseURL, StateNamespace: namespace, StatePath: filepath.Join(t.TempDir(), "unused.json")}
	root, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	store := root.store.(*postgresStateStore)
	tenants := []string{strings.Repeat("c", 64), strings.Repeat("d", 64)}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key IN ($1,$2,$3)`, namespace, namespace+":tenant:"+tenants[0], namespace+":tenant:"+tenants[1]); err != nil {
			t.Error(err)
		}
	})
	fixture := paperProcessFixture{DatabaseURL: databaseURL, Namespace: namespace, StatePath: cfg.StatePath, ResearchOnline: true}
	one, two := startPaperProcess(t, fixture), startPaperProcess(t, fixture)
	client := &http.Client{Timeout: 5 * time.Second}
	type response struct {
		status int
		body   []byte
		err    error
		tenant int
	}
	call := func(base string, tenant int, method, path string, body []byte) response {
		r, err := http.NewRequest(method, base+path, bytes.NewReader(body))
		if err != nil {
			return response{err: err}
		}
		r.Header.Set(TenantHeader, tenants[tenant])
		r.Header.Set("X-YNX-Preview-Mode", "local-paper")
		r.Header.Set("Content-Type", "application/json")
		result, err := client.Do(r)
		if err != nil {
			return response{err: err}
		}
		defer result.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(result.Body, 8<<20))
		return response{result.StatusCode, raw, err, tenant}
	}
	requests := make([]map[string]any, 2)
	inputs := make([][]byte, 2)
	for i := range tenants {
		q := request()
		q.Strategy.Name = fmt.Sprintf("Isolated research tenant %d", i)
		q.Strategy.Seed += int64(i)
		q.Assumptions.FeeBPS += int64(i)
		requests[i] = map[string]any{"strategy": q.Strategy, "assumptions": q.Assumptions, "idempotencyKey": researchFixtureKey}
		inputs[i], err = json.Marshal(requests[i])
		if err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	results := make(chan response, 12)
	for i := 0; i < 12; i++ {
		go func(i int) {
			<-start
			base := one.URL
			if i%2 == 1 {
				base = two.URL
			}
			results <- call(base, i/6, "POST", "/v1/backtests/from-market", inputs[i/6])
		}(i)
	}
	close(start)
	for i := 0; i < 12; i++ {
		r := <-results
		if r.err != nil || r.status != 201 && r.status != 409 {
			t.Fatalf("concurrent research status=%d err=%v", r.status, r.err)
		}
	}
	receipts := make([]Experiment, 2)
	receiptBytes := make([][]byte, 2)
	for i := range tenants {
		r := call(two.URL, i, "POST", "/v1/backtests/from-market", inputs[i])
		if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &receipts[i]) != nil || receipts[i].Status != "completed_oos" || receipts[i].ResearchRequestKey != researchFixtureKey || receipts[i].Strategy.Name != fmt.Sprintf("Isolated research tenant %d", i) {
			t.Fatalf("bound research receipt status=%d err=%v", r.status, r.err)
		}
		receiptBytes[i] = r.body
	}
	if receipts[0].Strategy.StrategyHash == receipts[1].Strategy.StrategyHash {
		t.Fatal("distinct tenant assumptions mixed strategy identity")
	}
	one.Close()
	two.Close()
	fixture.ResearchOnline = false
	restarted := startPaperProcess(t, fixture)
	for i := range tenants {
		row := func() (int64, string) {
			t.Helper()
			var revision int64
			var payload string
			if err := store.db.QueryRow(`SELECT revision,payload::text FROM ynx_quant_state WHERE state_key=$1`, namespace+":tenant:"+tenants[i]).Scan(&revision, &payload); err != nil {
				t.Fatal(err)
			}
			return revision, payload
		}
		beforeRevision, beforePayload := row()
		for attempt := 0; attempt < 3; attempt++ {
			r := call(restarted.URL, i, "POST", "/v1/backtests/from-market", inputs[i])
			if r.err != nil || r.status != 201 || !bytes.Equal(r.body, receiptBytes[i]) {
				t.Fatalf("offline exact receipt replay status=%d err=%v", r.status, r.err)
			}
		}
		changed := map[string]any{"strategy": requests[1-i]["strategy"], "assumptions": requests[1-i]["assumptions"], "idempotencyKey": researchFixtureKey}
		body, _ := json.Marshal(changed)
		r := call(restarted.URL, i, "POST", "/v1/backtests/from-market", body)
		if r.err != nil || r.status != 409 {
			t.Fatalf("foreign request same-key accepted status=%d err=%v", r.status, r.err)
		}
		changed["strategy"], changed["assumptions"], changed["idempotencyKey"] = requests[i]["strategy"], requests[i]["assumptions"], "quant-research-87654321-4321-4321-4321-cba987654321"
		body, _ = json.Marshal(changed)
		r = call(restarted.URL, i, "POST", "/v1/backtests/from-market", body)
		if r.err != nil || r.status != 503 {
			t.Fatalf("fresh offline research substituted data status=%d err=%v", r.status, r.err)
		}
		r = call(restarted.URL, i, "GET", "/v1/snapshot", nil)
		var snapshot struct {
			Experiments   map[string]Experiment   `json:"experiments"`
			Strategies    map[string]StrategySpec `json:"strategies"`
			Audit         []AuditEvent            `json:"audit"`
			Paper         PaperState              `json:"paper"`
			TestnetOrders map[string]TestnetOrder `json:"testnetOrders"`
		}
		if r.err != nil || r.status != 200 || json.Unmarshal(r.body, &snapshot) != nil || len(snapshot.Experiments) != 1 || len(snapshot.Strategies) != 1 || len(snapshot.Audit) != 3 || len(snapshot.Paper.Orders) != 0 || len(snapshot.TestnetOrders) != 0 || !reflect.DeepEqual(snapshot.Experiments[receipts[i].ID], receipts[i]) {
			t.Fatalf("restart isolation status=%d err=%v experiments=%d strategies=%d audit=%d paper=%d testnet=%d receiptEqual=%v", r.status, r.err, len(snapshot.Experiments), len(snapshot.Strategies), len(snapshot.Audit), len(snapshot.Paper.Orders), len(snapshot.TestnetOrders), reflect.DeepEqual(snapshot.Experiments[receipts[i].ID], receipts[i]))
		}
		if afterRevision, afterPayload := row(); afterRevision != beforeRevision || afterPayload != beforePayload {
			t.Fatal("replays or refusals changed SQL state, revision or audit")
		}
	}
	restarted.Close()
	secondLaunch := startPaperProcess(t, fixture)
	for i := range tenants {
		r := call(secondLaunch.URL, i, "POST", "/v1/backtests/from-market", inputs[i])
		if r.err != nil || r.status != 201 || !bytes.Equal(r.body, receiptBytes[i]) {
			t.Fatal("second launch failed durable exact replay")
		}
	}
}
