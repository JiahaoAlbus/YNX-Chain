package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Exercise main/execute and the persisted report through the normal CLI.
// Four deliberately failing HTTP endpoints are not validators or a lab.
func TestDeclaredCohortCLIProcess(t *testing.T) {
	if os.Getenv("YNX_TEST_DECLARED_CLI_CHILD") == "1" {
		for i, arg := range os.Args {
			if arg == "--" {
				os.Args = append([]string{os.Args[0]}, os.Args[i+1:]...)
				break
			}
		}
		flag.CommandLine = flag.NewFlagSet("declared-cohort-cli-test", flag.ExitOnError)
		main()
		return
	}
	path, _, m, _, _ := senderFixture(t)
	var submissions atomic.Int32
	for i := range m.Nodes {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var request struct {
				Method string          `json:"method"`
				ID     json.RawMessage `json:"id"`
			}
			if r.Method == http.MethodPost {
				_ = json.NewDecoder(r.Body).Decode(&request)
			}
			if r.URL.Path == "/status" || request.Method == "status" {
				if len(request.ID) == 0 {
					request.ID = json.RawMessage(`-1`)
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"node_info": map[string]any{"network": m.ChainID}}})
				return
			}
			submissions.Add(1)
			http.Error(w, "deliberate local transport failure; no execution", http.StatusServiceUnavailable)
		}))
		defer server.Close()
		m.Nodes[i].RPCURL = server.URL
	}
	manifestRaw, _ := json.Marshal(m)
	if err := os.WriteFile(path, manifestRaw, 0600); err != nil {
		t.Fatal(err)
	}
	bundlePath := filepath.Join(filepath.Dir(path), consensus.EphemeralSenderFile)
	raw, err := os.ReadFile(bundlePath)
	if err != nil {
		t.Fatal(err)
	}
	var bundle consensus.EphemeralSenderBundle
	if err = json.Unmarshal(raw, &bundle); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(manifestRaw)
	bundle.ManifestSHA256 = hex.EncodeToString(digest[:])
	raw, _ = json.Marshal(bundle)
	if err = os.WriteFile(bundlePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(filepath.Dir(path), "declared-report.json")
	args := []string{"-test.run=^TestDeclaredCohortCLIProcess$", "--", "-manifest", path, "-transactions", filepath.Join(filepath.Dir(path), "transactions.json"), "-output", output, "-sender-mode", "ready-pool", "-rounds", "2", "-offered-rate", "1000", "-cohort-window", "6ms", "-concurrency", "1", "-observers", "1", "-timeout", "2s"}
	child := exec.Command(os.Args[0], args...)
	child.Env = append(os.Environ(), "YNX_TEST_DECLARED_CLI_CHILD=1")
	console, err := child.CombinedOutput()
	if err == nil {
		t.Fatal("transport failures became a successful CLI run", string(console))
	}
	raw, err = os.ReadFile(output)
	if err != nil {
		t.Fatal(err, string(console))
	}
	var result report
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.DeclaredCohort == nil || !result.DeclaredCohort.WindowCompleted || len(result.Transactions) != 6 || result.Summary.FinalSubmitted != 0 || submissions.Load() != 3 {
		t.Fatalf("normal CLI lost failed demand: submissions=%d report=%s console=%s", submissions.Load(), raw, console)
	}
	files := map[string]string{"manifest": path, "input": filepath.Join(filepath.Dir(path), "transactions.json"), "plan": output + ".cohort-plan.json", "summary": output, "journal": filepath.Join(filepath.Dir(path), readySenderJournalName)}
	hashes := map[string]string{}
	nodeArgs := []string{"../../scripts/loadtest/same-control-readback.mjs"}
	for _, name := range []string{"manifest", "journal", "summary", "plan", "input"} {
		files[name], err = filepath.EvalSymlinks(files[name])
		if err != nil {
			t.Fatal(err)
		}
		b, e := os.ReadFile(files[name])
		if e != nil {
			t.Fatal(e)
		}
		h := sha256.Sum256(b)
		hashes[name] = hex.EncodeToString(h[:])
		nodeArgs = append(nodeArgs, "--"+name, files[name])
	}
	bindings := map[string]any{"run": "declared-original-cli-negative-flow", "count": 3, "rounds": 2, "fromHeight": "1", "untilHeight": "99", "sha256": hashes}
	bindingRaw, _ := json.Marshal(bindings)
	canonicalParent, err := filepath.EvalSymlinks(filepath.Dir(output))
	if err != nil {
		t.Fatal(err)
	}
	bindingPath := filepath.Join(canonicalParent, "declared-bindings.json")
	if err = os.WriteFile(bindingPath, bindingRaw, 0600); err != nil {
		t.Fatal(err)
	}
	readback := filepath.Join(canonicalParent, "declared-readback.json")
	nodeArgs = append(nodeArgs, "--bindings", bindingPath, "--output", readback)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node required for original readback CLI flow", err)
	}
	decoded, err := exec.Command(node, nodeArgs...).CombinedOutput()
	if err != nil {
		t.Fatal("actual Go report rejected by original Node CLI", err, string(decoded))
	}
	measured, err := os.ReadFile(readback)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(measured), `"denominator":6`) || !strings.Contains(string(measured), `"finalCommitBusinessSuccess":0`) {
		t.Fatal("failed requests lost from original CLI measurement", string(measured))
	}
	t.Log("normal main -> independent arrival -> three failed HTTP submissions -> persisted six-request report/journal/plan -> original readback CLI; zero execution/finality claims")
}

func TestDeclaredCohortPlanPredeclaresFullDemandAndRefusesOverwrite(t *testing.T) {
	p, err := makeDeclaredCohortPlan([]byte("manifest"), []byte("input"), "genesis", "migration", 3, 2, 1000, 6*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Rows) != 6 || p.WindowEndNs != "6000000" || p.Rows[5].ArrivalNs != "5000000" || p.Rows[0].SigningMode != "pre_signed" || p.Rows[3].SigningMode != "online_signed" {
		t.Fatal("incomplete plan", p)
	}
	seen := map[string]bool{}
	for _, r := range p.Rows {
		if seen[r.ID] {
			t.Fatal("duplicate logical identity")
		}
		seen[r.ID] = true
	}
	again, _ := makeDeclaredCohortPlan([]byte("manifest"), []byte("input"), "genesis", "migration", 3, 2, 1000, 6*time.Millisecond)
	if p.Rows[5].ID != again.Rows[5].ID {
		t.Fatal("same source invented a new logical identity")
	}
	path := filepath.Join(t.TempDir(), "plan.json")
	digest, err := persistDeclaredCohort(path, p)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	sum := sha256.Sum256(raw)
	if digest != hex.EncodeToString(sum[:]) {
		t.Fatal("durable plan digest differs")
	}
	if _, err = persistDeclaredCohort(path, p); err == nil {
		t.Fatal("plan overwritten")
	}
	after, _ := os.ReadFile(path)
	if string(raw) != string(after) {
		t.Fatal("old plan changed")
	}
	for _, window := range []time.Duration{0, 5 * time.Millisecond, 7 * time.Millisecond, 31 * time.Second} {
		if _, err = makeDeclaredCohortPlan([]byte("m"), []byte("i"), "g", "a", 3, 2, 1000, window); err == nil {
			t.Fatal("postselected or over-cap window accepted", window)
		}
	}
}
func TestDeclaredCohortOriginalReadyPoolKeepsUnsentFutureRequests(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t)
	pool, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	input := transactionInput{}
	for _, tx := range initial {
		input.Transactions = append(input.Transactions, base64.StdEncoding.EncodeToString(tx))
	}
	inputRaw, _ := json.Marshal(input)
	window := time.Duration(float64(6) * float64(time.Second) / 1000)
	plan, err := makeDeclaredCohortPlan(manifest, inputRaw, m.GenesisHash, m.MigrationStateHash, 3, 2, 1000, window)
	if err != nil {
		t.Fatal(err)
	}
	planPath := filepath.Join(t.TempDir(), "plan.json")
	digest, err := persistDeclaredCohort(planPath, plan)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	origin := time.Now()
	cohort := startDeclaredCohort(ctx, origin, planPath, plan, digest)
	results := readyResults(3)
	raws := make([]cmttypes.Tx, 6)
	submissions := 0
	stats, runErr := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 1000, concurrency: 1, observers: 1, cohort: cohort}, pool, raws, results, func(i int) (time.Time, bool) {
		if cohort.releaseTimes[i].IsZero() {
			t.Error("effect preceded independent logical arrival")
		}
		submissions++
		return time.Now(), false
	}, func(int, <-chan acceptedObservation, func(int)) {})
	if runErr == nil || submissions != 3 || stats.Quarantined != 3 {
		t.Fatal("original UNKNOWN/quarantine behavior changed", submissions, stats, runErr)
	}
	if err = cohort.finish(ctx, true); err != nil {
		t.Fatal(err)
	}
	snapshot := cohort.snapshot(time.Now())
	if !snapshot.WindowCompleted || len(snapshot.ReleasedOffsetNs) != 6 {
		t.Fatal("failed/unsigned future logical requests disappeared", snapshot)
	}
	for _, at := range snapshot.ReleasedOffsetNs {
		if at == nil {
			t.Fatal("independent logical demand was gated by successful predecessors")
		}
	}
	for _, row := range results[3:] {
		if row.Hash != "" || row.Status != "not_submitted" {
			t.Fatal("future failure was signed or faked", row)
		}
	}
}
func TestDeclaredCohortCancellationRetainsOriginalPlanWithoutInventingArrivals(t *testing.T) {
	plan, err := makeDeclaredCohortPlan([]byte("m"), []byte("i"), "g", "a", 3, 2, 100, 60*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	origin := time.Now()
	c := startDeclaredCohort(ctx, origin, "fixture-path", plan, "fixture-digest")
	if err = c.waitArrival(ctx, 0); err != nil {
		t.Fatal(err)
	}
	cancel()
	_ = c.finish(ctx, false)
	r := c.snapshot(time.Now())
	if r.WindowCompleted || len(c.plan.Rows) != 6 || len(r.ReleasedOffsetNs) != 6 || r.ReleasedOffsetNs[5] != nil {
		t.Fatal("cancelled generation became completion", r)
	}
}

func TestDeclaredCohortSignedExecutionPersistenceAndRestart(t *testing.T) {
	// Reuse the original full workflow, including real native signatures, fee/
	// nonce state execution, Sync and cold reopen. Its quorum flags are the same
	// explicit test gate inputs as before, never a four-node performance result.
	testReadySenderFastAccount(t, false, false, true)
}

func TestDeclaredCohortOptionsKeepOriginalResourceAndModeBounds(t *testing.T) {
	base := options{manifest: "manifest", transactions: "transactions", output: "output", senderMode: "ready-pool", rounds: 2, offeredRate: 1000, concurrency: 1, observers: 1, timeout: time.Second, poll: 50 * time.Millisecond, cohortWindow: 6 * time.Millisecond}
	if err := validateOptions(base); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*options){func(o *options) { o.cohortWindow = 2 * time.Second }, func(o *options) { o.reuseResultSlots = true }, func(o *options) { o.terminalStream = true }, func(o *options) { o.senderMode = "rounds" }, func(o *options) { o.offeredRate = math.Inf(1) }} {
		o := base
		mutate(&o)
		if validateOptions(o) == nil {
			t.Fatal("unsupported cohort extended existing limits")
		}
	}
}
