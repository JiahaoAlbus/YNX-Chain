package main_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
)

func wasmRunnerBinary(t *testing.T) (string, string) {
	t.Helper()
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("fixed executable ownership checks require the supplied Unix adapter")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	worker := filepath.Join(directory, "ynx-network-task-worker")
	cmd := exec.Command(filepath.Join(runtime.GOROOT(), "bin/go"), "build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-p", "1", "-o", worker, ".")
	cmd.Dir = filepath.Join(root, "apps/network/wasmworker")
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOMAXPROCS=2")
	if cache := os.Getenv("YNX_NETWORK_WORKER_GOMODCACHE"); cache != "" {
		cmd.Env = append(cmd.Env, "GOMODCACHE="+cache)
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("actual worker build: %v %s", err, out)
	}
	code, err := os.ReadFile(worker)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(code)
	return worker, hex.EncodeToString(sum[:])
}

type wasmRunnerFixture struct {
	r                 *contribution.Runner
	executor          *contribution.PinnedWASMExecutor
	path, worker, pin string
	work              contribution.Work
	consent           contribution.Consent
	issuer, person    ed25519.PrivateKey
	input             []byte
	authority         sandboxAuthority
}

func wasmRunner(t *testing.T, worker, pin string, input []byte) wasmRunnerFixture {
	t.Helper()
	ip, ik, _ := ed25519.GenerateKey(rand.Reader)
	pp, pk, _ := ed25519.GenerateKey(rand.Reader)
	executor, err := contribution.NewPinnedWASMExecutor(worker, pin)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "wasm-journal.json")
	authority := sandboxAuthority{ip, pp}
	r, err := contribution.NewControlledWASMSandbox(path, authority, executor)
	if err != nil {
		executor.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	limits := contribution.Limits{CPUMilli: "1000", MemoryBytes: strconv.Itoa(contribution.HistogramMemoryBytes + 2*len(input) + (64 << 10)), StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
	w := contribution.Work{Job: "isolated-job-1", Kind: contribution.PublicBlockHistogramKind, Issuer: "isolated-issuer", Input: contribution.Bind(input), Limits: limits, ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)}
	c := contribution.Consent{Principal: "isolated-person", Job: w.Job, Manifest: contribution.Bind(contribution.ManifestPayload(w)), Limits: limits, ExpiresAt: w.ExpiresAt, Nonce: "wasm-once", Allow: true}
	return wasmRunnerFixture{r, executor, path, worker, pin, w, c, ik, pk, input, authority}
}
func (f wasmRunnerFixture) start(ctx context.Context) (contribution.Record, error) {
	return f.r.StartContribution(ctx, f.work, f.consent, ed25519.Sign(f.issuer, contribution.ManifestPayload(f.work)), ed25519.Sign(f.person, contribution.ConsentPayload(f.consent)), f.input)
}
func TestP09WASMRunnerSignedFullLifecycle(t *testing.T) {
	worker, pin := wasmRunnerBinary(t)
	input := []byte(` {"height":"42","hash":"public-test-block","transactions":[]} `)
	f := wasmRunner(t, worker, pin, input)
	bad := f.consent
	bad.Allow = false
	if _, err := f.r.StartContribution(context.Background(), f.work, bad, ed25519.Sign(f.issuer, contribution.ManifestPayload(f.work)), ed25519.Sign(f.person, contribution.ConsentPayload(bad)), input); !errors.Is(err, contribution.ErrInvalid) {
		t.Fatalf("disallowed consent: %v", err)
	}
	if f.executor.Executions() != 0 {
		t.Fatal("failed consent started worker")
	}
	if _, err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := f.r.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	rec, ok := f.r.Record(f.work.Job)
	if !ok || rec.State != "submitted" || f.executor.Executions() != 1 {
		t.Fatalf("actual worker result: %+v starts%v", rec, f.executor.Executions())
	}
	// Deliberately corrupt a mathematically valid-looking output binding: only
	// the independent Go recount may create a receipt or increase the meter.
	wrong := rec.Result
	wrong.Output = contribution.Bind(make([]byte, 1024))
	if _, err := f.r.VerifyWorkReceipt(context.Background(), f.work.Job, wrong, input); !errors.Is(err, contribution.ErrInvalid) {
		t.Fatalf("wrong output accepted: %v", err)
	}
	if f.r.VerifyResourceMeter().VerifiedJobs != 0 {
		t.Fatal("unverified bytes counted")
	}
	receipt, err := f.r.VerifyWorkReceipt(context.Background(), f.work.Job, rec.Result, input)
	if err != nil {
		t.Fatal(err)
	}
	again, err := f.r.VerifyWorkReceipt(context.Background(), f.work.Job, rec.Result, input)
	if err != nil || again != receipt {
		t.Fatal("duplicate original receipt changed")
	}
	if _, err = f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.executor.Executions() != 1 {
		t.Fatal("duplicate job spawned a new worker")
	}
	meter := f.r.VerifyResourceMeter()
	if meter.VerifiedJobs != 1 || meter.VerifiedBytes != uint64(len(input)) || meter.Rewards != "NOT_AUTHORIZED" || meter.CPUServiceVerified || receipt.Class != contribution.SandboxClass {
		t.Fatalf("false meter: %+v", meter)
	}
	if err = f.r.StopContribution(context.Background()); err != nil {
		t.Fatal(err)
	}
	if active, started, _ := f.executor.LocalProcess(); active || started {
		t.Fatal("worker remains after stop")
	}
	if _, err = f.start(context.Background()); !errors.Is(err, contribution.ErrStopped) {
		t.Fatalf("restart scheduling after stop: %v", err)
	}
	if err = f.r.Close(); err != nil {
		t.Fatal(err)
	}
	// Reopen schedules nothing and historical bytes count zero. Fresh identical
	// signatures permit only an independent audit, not rerunning the old job.
	next, err := contribution.NewPinnedWASMExecutor(worker, pin)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := contribution.NewControlledWASMSandbox(f.path, f.authority, next)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if next.Executions() != 0 || reopened.VerifyResourceMeter().VerifiedJobs != 0 {
		t.Fatal("reopen revived task or historical meter")
	}
	if _, err = reopened.VerifyWorkReceipt(context.Background(), f.work.Job, rec.Result, input); !errors.Is(err, contribution.ErrDenied) {
		t.Fatalf("historical audit without fresh original signatures: %v", err)
	}
	f.r = reopened
	if _, err = f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	restored, err := reopened.VerifyWorkReceipt(context.Background(), f.work.Job, rec.Result, input)
	if err != nil || restored.ID != receipt.ID || next.Executions() != 0 || reopened.VerifyResourceMeter().VerifiedJobs != 1 {
		t.Fatalf("fresh historical recount: %+v %v", restored, err)
	}
}
func TestP09WASMRunnerStopCancelsOwnedChild(t *testing.T) {
	worker, pin := wasmRunnerBinary(t)
	input := append([]byte(`{"payload":"`), bytes.Repeat([]byte("x"), 2<<20)...)
	input = append(input, []byte(`"}`)...)
	f := wasmRunner(t, worker, pin, input)
	f.work.Limits.CPUMilli = "100"
	f.consent.Limits = f.work.Limits
	f.consent.Manifest = contribution.Bind(contribution.ManifestPayload(f.work))
	if _, err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(4 * time.Second)
	for {
		active, started, read := f.executor.LocalProcess()
		if active && started && read > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("actual child did not start")
		}
		runtime.Gosched()
	}
	if err := f.r.StopContribution(context.Background()); err != nil {
		t.Fatal(err)
	}
	if active, started, _ := f.executor.LocalProcess(); active || started {
		t.Fatal("Stop returned before real child Wait")
	}
	if f.r.VerifyResourceMeter().ActiveWorkers != 0 {
		t.Fatal("quota still reserved")
	}
	if f.executor.Executions() != 1 {
		t.Fatal("unexpected extra process")
	}
	rec, ok := f.r.Record(f.work.Job)
	if !ok || rec.State != "stopped" || rec.Receipt != nil {
		t.Fatalf("stopped original record: %+v", rec)
	}
}

// Change only this test's private unkeyed journal, including its checksum and
// both matching output fields. Fresh signatures must not make false math valid.
func TestP09WASMHistoricalOutputRequiresIndependentMath(t *testing.T) {
	worker, pin := wasmRunnerBinary(t)
	f := wasmRunner(t, worker, pin, []byte(`{"height":"fixture-only"}`))
	if _, err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := f.r.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	rec, _ := f.r.Record(f.work.Job)
	if _, err := f.r.VerifyWorkReceipt(context.Background(), f.work.Job, rec.Result, f.input); err != nil {
		t.Fatal(err)
	}
	if err := f.r.Close(); err != nil {
		t.Fatal(err)
	}
	var snap struct {
		Version int                            `json:"version"`
		Jobs    map[string]contribution.Record `json:"jobs"`
		Nonces  map[string]string              `json:"nonces"`
	}
	if _, err := productstore.Load(f.path, &snap); err != nil {
		t.Fatal(err)
	}
	forged := snap.Jobs[f.work.Job]
	forged.Result.Output = contribution.Bind(make([]byte, contribution.HistogramOutputBytes))
	forged.Receipt.Result = forged.Result
	snap.Jobs[f.work.Job] = forged
	if err := productstore.Save(f.path, snap); err != nil {
		t.Fatal(err)
	}
	next, err := contribution.NewPinnedWASMExecutor(worker, pin)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := contribution.NewControlledWASMSandbox(f.path, f.authority, next)
	if err != nil {
		_ = next.Close()
		t.Fatal(err)
	}
	defer reopened.Close()
	f.r = reopened
	if _, err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.VerifyWorkReceipt(context.Background(), f.work.Job, forged.Result, f.input); !errors.Is(err, contribution.ErrInvalid) {
		t.Fatalf("checksum-valid false output: %v", err)
	}
	if next.Executions() != 0 || reopened.VerifyResourceMeter().VerifiedJobs != 0 {
		t.Fatal("historical false math started worker or credited meter")
	}
}
