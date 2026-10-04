package quantlab

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type paperProcessFixture struct {
	DatabaseURL, Namespace, StatePath string
	Online                            bool
	ResearchOnline                    bool
	ScheduleAt                        int64
	HoldSchedule                      bool
}

func TestPaperProcessRejectsUnapprovedDatabaseBeforeStart(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	fixture := paperProcessFixture{DatabaseURL: "postgres://isolated_fixture@127.0.0.1:9/wrong_database", Namespace: "quant-process-it-negative", StatePath: filepath.Join(t.TempDir(), "must-not-exist.json")}
	input, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestQuantPostgresPaperProcessHelper$", "-test.timeout=4s")
	cmd.Env = append(os.Environ(), "YNX_QUANT_PAPER_PROCESS_FIXTURE=1")
	cmd.Stdin = bytes.NewReader(input)
	output, err := cmd.CombinedOutput()
	if err == nil || ctx.Err() != nil || !bytes.Contains(output, []byte("requires exact loopback QA database and isolated namespace")) || bytes.Contains(output, []byte("paperProcessURL=")) {
		t.Fatal("unapproved fixture did not fail before readiness")
	}
	if _, err := os.Lstat(fixture.StatePath); !os.IsNotExist(err) {
		t.Fatal("rejected child created a state path")
	}
}

// Only the test binary exposes this endpoint. Its synthetic market is explicitly
// local Paper data, not public prices, wallet authorization or Testnet trading.
func TestQuantPostgresPaperProcessHelper(t *testing.T) {
	if os.Getenv("YNX_QUANT_PAPER_PROCESS_FIXTURE") != "1" {
		t.Skip("isolated child process helper")
	}
	var fixture paperProcessFixture
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixture); err != nil {
		t.Fatal("invalid isolated process fixture")
	}
	u, err := url.Parse(fixture.DatabaseURL)
	if err != nil || u.Hostname() != "127.0.0.1" || u.Path != "/ynx_quant_qa" || !strings.HasPrefix(fixture.Namespace, "quant-process-it-") {
		t.Fatal("requires exact loopback QA database and isolated namespace")
	}
	cfg := Config{DatabaseURL: fixture.DatabaseURL, StateNamespace: fixture.Namespace, StatePath: fixture.StatePath}
	if fixture.Online {
		cfg.MarketData = &submissionMarket{}
	}
	if fixture.ResearchOnline {
		cfg.MarketData = &replayResearchMarket{}
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM)
	defer signal.Stop(stop)
	var handler http.Handler
	if fixture.ScheduleAt != 0 {
		cfg.Now = func() time.Time { return time.Unix(0, fixture.ScheduleAt).UTC() }
		cfg.MarketData = fixtureMarket{bars: bars()}
		enter, resume := make(chan struct{}), make(chan struct{})
		if fixture.HoldSchedule {
			cfg.MarketData = pausedScheduleMarket{fixtureMarket: fixtureMarket{bars: bars()}, enter: enter, resume: resume}
		}
		service, err := New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer service.Close()
		if fixture.HoldSchedule {
			// Readiness is emitted only after actual RunDueSchedules has persisted
			// its claim and reached the controlled blocked market call.
			done := make(chan error, 1)
			go func() { _, err := service.RunDueSchedules(); done <- err }()
			select {
			case <-enter:
			case <-done:
				t.Fatal("schedule never reached controlled market")
			case <-time.After(5 * time.Second):
				t.Fatal("schedule claim timeout")
			}
		} else if _, err := service.RunDueSchedules(); err != nil {
			t.Fatal(err)
		}
		handler = NewServer(service)
	} else {
		tenantServer, err := NewTenantServer(cfg, "all")
		if err != nil {
			t.Fatal(err)
		}
		defer tenantServer.Close()
		handler = tenantServer
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	fmt.Println("paperProcessURL=" + server.URL)
	<-stop
}

type paperProcessEndpoint struct {
	URL   string
	Close func()
	Crash func()
}

func startPaperProcess(t *testing.T, fixture paperProcessFixture) paperProcessEndpoint {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestQuantPostgresPaperProcessHelper$", "-test.timeout=45s")
	cmd.Env = append(os.Environ(), "YNX_QUANT_PAPER_PROCESS_FIXTURE=1")
	cmd.Stdin = bytes.NewReader(input)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	// Do not publish the fixture DSN or raw request/response diagnostics.
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	ready, done := make(chan string, 1), make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if line := scanner.Text(); strings.HasPrefix(line, "paperProcessURL=") {
				ready <- strings.TrimPrefix(line, "paperProcessURL=")
			}
		}
		done <- cmd.Wait()
	}()
	var once sync.Once
	terminate := func(crash bool) {
		once.Do(func() {
			if crash {
				if err := cmd.Process.Kill(); err != nil {
					t.Errorf("Quant child SIGKILL failed: %v", err)
				}
			} else {
				_ = cmd.Process.Signal(syscall.SIGTERM)
			}
			select {
			case err := <-done:
				if crash {
					exit, ok := err.(*exec.ExitError)
					if !ok {
						t.Errorf("Quant child did not exit through SIGKILL: %v", err)
					} else if status, ok := exit.Sys().(syscall.WaitStatus); !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
						t.Error("Quant child termination was not SIGKILL")
					}
				} else if err != nil {
					t.Errorf("Quant child did not stop cleanly: %v", err)
				}
			case <-time.After(5 * time.Second):
				_ = cmd.Process.Kill()
				<-done
				t.Error("Quant child failed bounded shutdown")
			}
		})
	}
	closeProcess := func() { terminate(false) }
	t.Cleanup(closeProcess)
	select {
	case endpoint := <-ready:
		u, err := url.Parse(endpoint)
		if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
			t.Fatal("invalid isolated child endpoint")
		}
		t.Logf("actual Quant PostgreSQL process pid=%d paperMarket=%t researchMarket=%t scheduledResearch=%t", cmd.Process.Pid, fixture.Online, fixture.ResearchOnline, fixture.ScheduleAt != 0)
		return paperProcessEndpoint{URL: endpoint, Close: closeProcess, Crash: func() { terminate(true) }}
	case err := <-done:
		// Already reaped. Never turn an observed terminal exit into a timeout or
		// consume the same Wait result again during registered cleanup.
		once.Do(func() {})
		t.Fatalf("Quant child exited before readiness: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("Quant child startup timeout")
	}
	return paperProcessEndpoint{}
}

func TestPostgreSQLPaperHTTPProcessesReplayRiskAndTenantIsolation(t *testing.T) {
	for _, costs := range []bool{false, true} {
		name := "legacy"
		if costs {
			name = "explicit_costs"
		}
		t.Run(name, func(t *testing.T) { runPostgreSQLPaperHTTPProcesses(t, costs) })
	}
}

func runPostgreSQLPaperHTTPProcesses(t *testing.T, costsEnabled bool) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := fmt.Sprintf("quant-process-it-%d", time.Now().UnixNano())
	cfg := Config{DatabaseURL: databaseURL, StateNamespace: namespace, StatePath: filepath.Join(t.TempDir(), "unused.json")}
	root, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	store := root.store.(*postgresStateStore)
	tenants := []string{strings.Repeat("a", 64), strings.Repeat("b", 64)}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key IN ($1,$2,$3)`, namespace, namespace+":tenant:"+tenants[0], namespace+":tenant:"+tenants[1]); err != nil {
			t.Error(err)
		}
	})
	if _, err := root.Kill("isolated diagnostic seed, not tenant risk"); err != nil {
		t.Fatal(err)
	}
	hashes := make([]string, 2)
	initialCash := make([]int64, 2)
	for i, tenant := range tenants {
		tenantConfig := cfg
		tenantConfig.StateNamespace += ":tenant:" + tenant
		seed, err := New(tenantConfig)
		if err != nil {
			t.Fatal(err)
		}
		q := request()
		q.Strategy.Seed += int64(i)
		experiment, err := seed.RunBacktest(q)
		initialCash[i] = seed.state.Paper.Cash
		_ = seed.Close()
		if err != nil {
			t.Fatal(err)
		}
		hashes[i] = experiment.Strategy.StrategyHash
	}
	fixture := paperProcessFixture{DatabaseURL: databaseURL, Namespace: namespace, StatePath: cfg.StatePath, Online: true}
	one, two := startPaperProcess(t, fixture), startPaperProcess(t, fixture)
	client := &http.Client{Timeout: 5 * time.Second}
	type result struct {
		status int
		body   []byte
		err    error
	}
	call := func(base, tenant, method, path string, body []byte) result {
		r, err := http.NewRequest(method, base+path, bytes.NewReader(body))
		if err != nil {
			return result{err: err}
		}
		r.Header.Set(TenantHeader, tenant)
		r.Header.Set("X-YNX-Preview-Mode", "local-paper")
		r.Header.Set("Content-Type", "application/json")
		response, err := client.Do(r)
		if err != nil {
			return result{err: err}
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return result{response.StatusCode, raw, err}
	}
	intents := make([][]byte, 2)
	for i := range tenants {
		intent := map[string]any{"strategyHash": hashes[i], "side": "buy", "amount": 1_000_000 * (i + 1), "idempotencyKey": "same-key-two-isolated-tenants"}
		if costsEnabled {
			intent["executionCosts"] = map[string]any{"policy": PaperCostPolicyV1, "feeBPS": 10 + 5*i, "slippageBPS": 5 + 5*i}
		}
		intents[i], _ = json.Marshal(intent)
	}
	start := make(chan struct{})
	results := make(chan result, 16)
	for i := 0; i < 16; i++ {
		go func(i int) {
			<-start
			base := one.URL
			if i%2 == 1 {
				base = two.URL
			}
			results <- call(base, tenants[i/8], "POST", "/v1/paper/orders", intents[i/8])
		}(i)
	}
	close(start)
	for i := 0; i < 16; i++ {
		r := <-results
		if r.err != nil || r.status != 201 && r.status != 409 {
			t.Fatalf("concurrent Paper status=%d err=%v", r.status, r.err)
		}
	}
	receipts := make([]PaperOrder, 2)
	for i, tenant := range tenants {
		r := call(two.URL, tenant, "POST", "/v1/paper/orders", intents[i])
		if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &receipts[i]) != nil || receipts[i].StrategyHash != hashes[i] || receipts[i].Amount != int64(1_000_000*(i+1)) || receipts[i].Filled != receipts[i].Amount {
			t.Fatalf("bound tenant receipt status=%d err=%v", r.status, r.err)
		}
		if costsEnabled {
			wantPrice := []int64{1_200_600, 1_201_200}[i]
			wantNotional := []int64{1_200_600, 2_402_400}[i]
			wantFee := []int64{1201, 3604}[i]
			if receipts[i].CostPolicy != PaperCostPolicyV1 || receipts[i].FeeBPS != int64(10+5*i) || receipts[i].SlippageBPS != int64(5+5*i) || receipts[i].ExecutionPriceMicro != wantPrice || receipts[i].ExecutedNotionalMicro != wantNotional || receipts[i].FeeMicro != wantFee {
				t.Fatalf("tenant %d wrong exact cost receipt: %+v", i, receipts[i])
			}
		}
	}
	r := call(one.URL, tenants[0], "POST", "/v1/risk/kill", []byte(`{"reason":"controlled multi-process tenant kill"}`))
	if r.err != nil || r.status != 200 {
		t.Fatalf("kill status=%d err=%v", r.status, r.err)
	}
	one.Close()
	two.Close()
	fixture.Online = false // Restarted process has no market; replays are reads.
	restarted := startPaperProcess(t, fixture)
	for i, tenant := range tenants {
		storedRow := func() (int64, string) {
			t.Helper()
			var revision int64
			var payload string
			if err := store.db.QueryRow(`SELECT revision,payload::text FROM ynx_quant_state WHERE state_key=$1`, namespace+":tenant:"+tenant).Scan(&revision, &payload); err != nil {
				t.Fatal(err)
			}
			return revision, payload
		}
		revisionBefore, payloadBefore := storedRow()
		r := call(restarted.URL, tenant, "GET", "/v1/snapshot", nil)
		var before struct {
			Paper PaperState `json:"paper"`
		}
		if r.err != nil || r.status != 200 || json.Unmarshal(r.body, &before) != nil || len(before.Paper.Orders) != 1 || before.Paper.KillSwitch != (i == 0) {
			t.Fatalf("restart isolated state status=%d err=%v", r.status, r.err)
		}
		if costsEnabled {
			if before.Paper.Cash != initialCash[i]-receipts[i].ExecutedNotionalMicro-receipts[i].FeeMicro || before.Paper.DailyRisk == nil || before.Paper.DailyRisk.Loss != []int64{1801, 6004}[i] {
				t.Fatal("SQL cost charged twice or missing immediate marked loss")
			}
			var altered map[string]any
			_ = json.Unmarshal(intents[i], &altered)
			altered["executionCosts"] = map[string]any{"policy": PaperCostPolicyV1, "feeBPS": 99, "slippageBPS": 5 + 5*i}
			body, _ := json.Marshal(altered)
			if result := call(restarted.URL, tenant, "POST", "/v1/paper/orders", body); result.err != nil || result.status != 409 {
				t.Fatalf("changed SQL cost identity accepted: %d/%v", result.status, result.err)
			}
			delete(altered, "executionCosts")
			body, _ = json.Marshal(altered)
			if result := call(restarted.URL, tenant, "POST", "/v1/paper/orders", body); result.err != nil || result.status != 409 {
				t.Fatalf("legacy SQL request reused cost receipt: %d/%v", result.status, result.err)
			}
		}
		for replay := 0; replay < 4; replay++ {
			r = call(restarted.URL, tenant, "POST", "/v1/paper/orders", intents[i])
			var order PaperOrder
			if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &order) != nil || !reflect.DeepEqual(order, receipts[i]) {
				t.Fatalf("offline replay status=%d err=%v", r.status, r.err)
			}
		}
		var changed map[string]any
		_ = json.Unmarshal(intents[i], &changed)
		changed["amount"] = 3_000_000
		body, _ := json.Marshal(changed)
		r = call(restarted.URL, tenant, "POST", "/v1/paper/orders", body)
		if r.err != nil || r.status != 409 {
			t.Fatalf("changed key accepted: status=%d err=%v", r.status, r.err)
		}
		changed["strategyHash"], changed["idempotencyKey"] = hashes[1-i], "foreign-strategy-new-key"
		body, _ = json.Marshal(changed)
		r = call(restarted.URL, tenant, "POST", "/v1/paper/orders", body)
		if r.err != nil || r.status != 403 {
			t.Fatalf("foreign strategy not refused: status=%d err=%v", r.status, r.err)
		}
		changed["strategyHash"], changed["idempotencyKey"] = hashes[i], "fresh-own-strategy-new-key"
		body, _ = json.Marshal(changed)
		r = call(restarted.URL, tenant, "POST", "/v1/paper/orders", body)
		expected := 503 // Non-killed tenant is unavailable without a market.
		if i == 0 {
			expected = 403 // Persisted kill must fence before any market lookup.
		}
		if r.err != nil || r.status != expected {
			t.Fatalf("fresh admission status=%d expected=%d err=%v", r.status, expected, r.err)
		}
		r = call(restarted.URL, tenant, "GET", "/v1/snapshot", nil)
		var after struct {
			Paper PaperState `json:"paper"`
		}
		if r.err != nil || r.status != 200 || json.Unmarshal(r.body, &after) != nil || !reflect.DeepEqual(before.Paper, after.Paper) {
			t.Fatal("offline retry/refusal mutated tenant Paper balance, orders or risk")
		}
		if revisionAfter, payloadAfter := storedRow(); revisionAfter != revisionBefore || payloadAfter != payloadBefore {
			t.Fatal("receipt replay/refusal changed PostgreSQL revision, audit or research state")
		}
	}
}
