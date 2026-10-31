package main_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
)

// Temporary ordinary Ed25519 fixture signatures authenticate only this isolated
// sandbox. They are neither the original issuer's authority nor PQ support.
type sandboxAuthority struct{ issuer, person ed25519.PublicKey }

func (a sandboxAuthority) VerifyManifest(ctx context.Context, issuer string, payload, sig []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if issuer != "isolated-issuer" || !ed25519.Verify(a.issuer, payload, sig) {
		return errors.New("bad issuer signature")
	}
	return nil
}
func (a sandboxAuthority) VerifyConsent(ctx context.Context, principal string, payload, sig []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if principal != "isolated-person" || !ed25519.Verify(a.person, payload, sig) {
		return errors.New("bad consent signature")
	}
	return nil
}

type sandboxFixture struct {
	r              *contribution.Runner
	path           string
	authority      sandboxAuthority
	issuer, person ed25519.PrivateKey
	input          []byte
	w              contribution.Work
	c              contribution.Consent
}

func newSandboxFixture(t *testing.T) sandboxFixture {
	t.Helper()
	ip, ik, _ := ed25519.GenerateKey(rand.Reader)
	pp, pk, _ := ed25519.GenerateKey(rand.Reader)
	f := sandboxFixture{path: filepath.Join(t.TempDir(), "contribution.json"), authority: sandboxAuthority{ip, pp}, issuer: ik, person: pk, input: bytes.Repeat([]byte("fixed public block bytes"), 300)}
	var err error
	f.r, err = contribution.NewControlledSandbox(f.path, f.authority)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = f.r.Close() })
	f.w = contribution.Work{Job: "isolated-job-1", Kind: "verify_chunk", Issuer: "isolated-issuer", Input: contribution.Bind(f.input),
		Limits: contribution.Limits{CPUMilli: "1000", MemoryBytes: strconv.Itoa(len(f.input) + (64 << 10)), StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}, ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)}
	f.c = contribution.Consent{Principal: "isolated-person", Job: f.w.Job, Manifest: contribution.Bind(contribution.ManifestPayload(f.w)), Limits: f.w.Limits, ExpiresAt: f.w.ExpiresAt, Nonce: "one-use-approval", Allow: true}
	return f
}
func (f *sandboxFixture) resign() {
	f.c.Job = f.w.Job
	f.c.Manifest = contribution.Bind(contribution.ManifestPayload(f.w))
	f.c.Limits = f.w.Limits
}
func (f sandboxFixture) start(ctx context.Context) (contribution.Record, error) {
	return f.r.StartContribution(ctx, f.w, f.c, ed25519.Sign(f.issuer, contribution.ManifestPayload(f.w)), ed25519.Sign(f.person, contribution.ConsentPayload(f.c)), f.input)
}
func (f sandboxFixture) submitted(t *testing.T) contribution.Record {
	t.Helper()
	if _, err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	if err := f.r.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	rec, ok := f.r.Record(f.w.Job)
	if !ok || rec.State != "submitted" {
		t.Fatalf("record=%+v", rec)
	}
	return rec
}

func TestP0907ContributionDeniedByDefault(t *testing.T) {
	f := newSandboxFixture(t)
	r, err := contribution.NewDisabled(filepath.Join(t.TempDir(), "disabled.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	_, err = r.StartContribution(context.Background(), f.w, f.c, []byte("fake"), []byte("fake"), f.input)
	if !errors.Is(err, contribution.ErrDenied) {
		t.Fatalf("default allowed: %v", err)
	}
	if m := r.VerifyResourceMeter(); m.State != "disabled" || m.ActiveWorkers != 0 || m.VerifiedJobs != 0 || m.Rewards != "NOT_AUTHORIZED" {
		t.Fatalf("default meter=%+v", m)
	}
	if _, err := contribution.NewControlledSandbox(filepath.Join(t.TempDir(), "nil.json"), nil); !errors.Is(err, contribution.ErrDenied) {
		t.Fatal("nil authority enabled")
	}
}

func TestP0907ContributionExactApprovalAndBounds(t *testing.T) {
	tests := []struct {
		name string
		edit func(*sandboxFixture)
		want error
	}{
		{"unsupported host work", func(f *sandboxFixture) { f.w.Kind = "bounded_compute"; f.resign() }, contribution.ErrUnsupported},
		{"default approval false", func(f *sandboxFixture) { f.c.Allow = false }, contribution.ErrInvalid},
		{"changed manifest", func(f *sandboxFixture) { f.w.Issuer = "other" }, contribution.ErrInvalid},
		{"wrong job", func(f *sandboxFixture) { f.c.Job = "other" }, contribution.ErrInvalid},
		{"changed limits", func(f *sandboxFixture) { f.c.Limits.CPUMilli = "999" }, contribution.ErrInvalid},
		{"wrong input bytes", func(f *sandboxFixture) { f.input[0] ^= 1 }, contribution.ErrInvalid},
		{"forged SHA3", func(f *sandboxFixture) { f.w.Input.SHA3512 = strings.Repeat("0", 128); f.resign() }, contribution.ErrInvalid},
		{"forged SHA512", func(f *sandboxFixture) { f.w.Input.SHA512 = strings.Repeat("0", 128); f.resign() }, contribution.ErrInvalid},
		{"memory cap", func(f *sandboxFixture) { f.w.Limits.MemoryBytes = "1"; f.resign() }, contribution.ErrLimit},
		{"CPU cap", func(f *sandboxFixture) { f.w.Limits.CPUMilli = "1001"; f.resign() }, contribution.ErrLimit},
		{"storage forbidden", func(f *sandboxFixture) { f.w.Limits.StorageBytes = "1"; f.resign() }, contribution.ErrLimit},
		{"egress forbidden", func(f *sandboxFixture) { f.w.Limits.EgressBytes = "1"; f.resign() }, contribution.ErrLimit},
		{"wall cap", func(f *sandboxFixture) { f.w.Limits.DurationMillis = "5001"; f.resign() }, contribution.ErrLimit},
		{"noncanonical units", func(f *sandboxFixture) { f.w.Limits.CPUMilli = "010"; f.resign() }, contribution.ErrInvalid},
		{"oversized numeric metadata", func(f *sandboxFixture) { f.w.Limits.MemoryBytes = strings.Repeat("1", 1000); f.resign() }, contribution.ErrInvalid},
		{"oversized expiry metadata", func(f *sandboxFixture) { f.w.ExpiresAt = strings.Repeat("1", 1000); f.resign() }, contribution.ErrInvalid},
		{"expired consent", func(f *sandboxFixture) { f.c.ExpiresAt = time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano) }, contribution.ErrInvalid},
		{"oversized input", func(f *sandboxFixture) {
			f.input = make([]byte, contribution.MaxInputBytes+1)
			f.w.Input = contribution.Bind(f.input)
			f.resign()
		}, contribution.ErrLimit},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newSandboxFixture(t)
			tc.edit(&f)
			if _, err := f.start(context.Background()); !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
			if m := f.r.VerifyResourceMeter(); m.ActiveWorkers != 0 || m.VerifiedJobs != 0 || m.ReservedMemoryBytes != 0 {
				t.Fatalf("failed preflight reserved resources: %+v", m)
			}
		})
	}
	t.Run("real signature mismatch", func(t *testing.T) {
		f := newSandboxFixture(t)
		_, err := f.r.StartContribution(context.Background(), f.w, f.c, ed25519.Sign(f.person, contribution.ManifestPayload(f.w)), ed25519.Sign(f.person, contribution.ConsentPayload(f.c)), f.input)
		if !errors.Is(err, contribution.ErrDenied) {
			t.Fatalf("forged publisher: %v", err)
		}
	})
	t.Run("real consent signature mismatch", func(t *testing.T) {
		f := newSandboxFixture(t)
		_, err := f.r.StartContribution(context.Background(), f.w, f.c, ed25519.Sign(f.issuer, contribution.ManifestPayload(f.w)), ed25519.Sign(f.issuer, contribution.ConsentPayload(f.c)), f.input)
		if !errors.Is(err, contribution.ErrDenied) {
			t.Fatalf("forged consent: %v", err)
		}
	})
}

func TestP0908ContributionIndependentReceiptAndP0910Meter(t *testing.T) {
	f := newSandboxFixture(t)
	rec := f.submitted(t)
	if m := f.r.VerifyResourceMeter(); m.VerifiedJobs != 0 || m.VerifiedBytes != 0 || m.MeasuredBytesRead != uint64(2*len(f.input)) {
		t.Fatalf("worker self-report counted: %+v", m)
	}
	bad := rec.Result
	bad.Output.SHA512 = strings.Repeat("f", 128)
	if _, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, bad, f.input); err == nil {
		t.Fatal("forged output accepted")
	}
	wrong := append([]byte(nil), f.input...)
	wrong[0] ^= 1
	if _, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, rec.Result, wrong); err == nil {
		t.Fatal("forged storage accepted")
	}
	rc, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, rec.Result, f.input)
	if err != nil {
		t.Fatal(err)
	}
	if rc.Class != contribution.SandboxClass || rc.VerifiedBytes != uint64(len(f.input)) {
		t.Fatalf("receipt=%+v", rc)
	}
	before := f.r.VerifyResourceMeter()
	again, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, rec.Result, f.input)
	if err != nil || again != rc {
		t.Fatalf("duplicate receipt: %+v %v", again, err)
	}
	if after := f.r.VerifyResourceMeter(); after != before || after.VerifiedJobs != 1 || after.VerifiedBytes != uint64(len(f.input)) || after.CPUServiceVerified || after.Rewards != "NOT_AUTHORIZED" {
		t.Fatalf("duplicate meter: before=%+v after=%+v", before, after)
	}
	if _, err := f.start(context.Background()); err != nil {
		t.Fatalf("exact job retry did not reuse result: %v", err)
	}
	if after := f.r.VerifyResourceMeter(); after != before {
		t.Fatalf("exact retry reran job %+v", after)
	}
	f.w.Job = "isolated-job-2"
	f.resign()
	if _, err := f.start(context.Background()); !errors.Is(err, contribution.ErrConflict) {
		t.Fatalf("consent nonce replay: %v", err)
	}
}

func TestP0909ContributionStopReleasesAndRestartDisabled(t *testing.T) {
	f := newSandboxFixture(t)
	f.input = bytes.Repeat([]byte("x"), 1<<20)
	f.w.Input = contribution.Bind(f.input)
	f.w.Limits.MemoryBytes = strconv.Itoa(len(f.input) + (64 << 10))
	f.resign()
	if _, err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := f.r.StopContribution(ctx); err != nil {
		t.Fatal(err)
	}
	m := f.r.VerifyResourceMeter()
	if m.ActiveWorkers != 0 || m.ReservedMemoryBytes != 0 || m.State != "stopped" || m.VerifiedJobs != 0 || m.MeasuredBytesRead < uint64(len(f.input)) {
		t.Fatalf("stop did not release/preserve: %+v", m)
	}
	f.w.Job = "after-stop"
	f.c.Nonce = "after-stop"
	f.resign()
	if _, err := f.start(context.Background()); !errors.Is(err, contribution.ErrStopped) {
		t.Fatalf("scheduled after stop: %v", err)
	}
	if err := f.r.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := contribution.NewDisabled(f.path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	restored := r.VerifyResourceMeter()
	if restored.State != "disabled" || restored.ActiveWorkers != 0 || restored.ReservedMemoryBytes != 0 || restored.MeasuredBytesRead != m.MeasuredBytesRead {
		t.Fatalf("restart lost usage or resumed: %+v", restored)
	}
	if _, err := r.StartContribution(context.Background(), f.w, f.c, []byte("sig"), []byte("sig"), f.input); !errors.Is(err, contribution.ErrDenied) {
		t.Fatalf("restart enabled: %v", err)
	}
}

func TestP0907ContributionExclusiveCapacityAndCancellation(t *testing.T) {
	f := newSandboxFixture(t)
	if _, err := contribution.NewDisabled(f.path); err == nil {
		t.Fatal("second writer accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.start(ctx); err == nil {
		t.Fatal("cancelled operation started")
	}
	if m := f.r.VerifyResourceMeter(); m.ActiveWorkers != 0 || m.ReservedMemoryBytes != 0 {
		t.Fatalf("cancelled reserved %+v", m)
	}
	// The first approval's deliberately low duty cycle keeps this fixed local
	// worker active while the second independently approved job asks for quota.
	f.input = bytes.Repeat([]byte("x"), 32<<10)
	f.w.Input = contribution.Bind(f.input)
	f.w.Limits.CPUMilli = "1"
	f.w.Limits.MemoryBytes = strconv.Itoa(len(f.input) + (64 << 10))
	f.resign()
	if _, err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.w.Job = "parallel-job"
	f.c.Nonce = "parallel-approval"
	f.resign()
	if _, err := f.start(context.Background()); !errors.Is(err, contribution.ErrCapacity) {
		t.Fatalf("concurrent operation bypassed capacity: %v", err)
	}
	stopCtx, stopCancel := context.WithTimeout(context.Background(), time.Second)
	defer stopCancel()
	if err := f.r.StopContribution(stopCtx); err != nil {
		t.Fatal(err)
	}
	if m := f.r.VerifyResourceMeter(); m.ActiveWorkers != 0 || m.ReservedMemoryBytes != 0 {
		t.Fatalf("worker/quota after stop: %+v", m)
	}
}

func TestP0908ContributionRestartRequiresRecomputation(t *testing.T) {
	f := newSandboxFixture(t)
	rec := f.submitted(t)
	first, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, rec.Result, f.input)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.r.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := contribution.NewControlledSandbox(f.path, f.authority)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if m := r.VerifyResourceMeter(); m.State != "disabled" || m.ActiveWorkers != 0 || m.VerifiedJobs != 0 {
		t.Fatalf("restored unkeyed journal counted as fresh proof: %+v", m)
	}
	old, ok := r.Record(f.w.Job)
	if !ok || old.State != "historical" || old.Receipt == nil || old.Receipt.ID != first.ID {
		t.Fatalf("lost historical receipt: %+v", old)
	}
	if _, err := r.VerifyWorkReceipt(context.Background(), f.w.Job, old.Result, f.input); !errors.Is(err, contribution.ErrDenied) {
		t.Fatalf("journal restored authority without signatures: %v", err)
	}
	f.r = r
	if _, err := f.start(context.Background()); err != nil {
		t.Fatalf("fresh authority checks for old job failed: %v", err)
	}
	if m := r.VerifyResourceMeter(); m.ActiveWorkers != 0 || m.VerifiedJobs != 0 {
		t.Fatalf("reauthorization reran old job: %+v", m)
	}
	again, err := r.VerifyWorkReceipt(context.Background(), f.w.Job, old.Result, f.input)
	if err != nil || again.ID != first.ID {
		t.Fatalf("same receipt ID not recomputed: %+v %v", again, err)
	}
	if m := r.VerifyResourceMeter(); m.VerifiedJobs != 1 || m.VerifiedBytes != uint64(len(f.input)) {
		t.Fatalf("recomputed meter: %+v", m)
	}
}

func TestP0908ContributionRejectsMalformedStoredReceipt(t *testing.T) {
	f := newSandboxFixture(t)
	rec := f.submitted(t)
	if _, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, rec.Result, f.input); err != nil {
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
	forged := snap.Jobs[f.w.Job]
	forged.Receipt.VerifiedBytes++
	snap.Jobs[f.w.Job] = forged
	if err := productstore.Save(f.path, snap); err != nil {
		t.Fatal(err)
	}
	if r, err := contribution.NewDisabled(f.path); err == nil {
		_ = r.Close()
		t.Fatal("checksum-valid forged verified byte count accepted")
	}
}

func TestP0909ContributionPersistenceFailureIsNotSuccessfulStop(t *testing.T) {
	f := newSandboxFixture(t)
	rec := f.submitted(t)
	if err := os.Mkdir(f.path+".tmp", 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, rec.Result, f.input); err == nil {
		t.Fatal("failed receipt save reported success")
	}
	if err := f.r.Wait(context.Background()); err == nil {
		t.Fatal("failed persistence hidden by Wait")
	}
	if err := f.r.StopContribution(context.Background()); err == nil {
		t.Fatal("failed accounting persistence hidden by Stop")
	}
	if err := f.r.Close(); err == nil {
		t.Fatal("failed accounting persistence hidden by Close")
	}
	if m := f.r.VerifyResourceMeter(); m.ActiveWorkers != 0 || m.ReservedMemoryBytes != 0 || m.Accounting != "UNKNOWN_LOCAL_PERSISTENCE" || m.VerifiedJobs != 0 {
		t.Fatalf("failure claimed durable verification: %+v", m)
	}
}

func TestP0907ContributionDeadlinePreservesPartialUsage(t *testing.T) {
	f := newSandboxFixture(t)
	f.input = bytes.Repeat([]byte("x"), 16<<10)
	f.w.Input = contribution.Bind(f.input)
	f.w.Limits.CPUMilli = "1"
	f.w.Limits.DurationMillis = "1"
	f.w.Limits.MemoryBytes = strconv.Itoa(len(f.input) + (64 << 10))
	f.resign()
	if _, err := f.start(context.Background()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("wall deadline not enforced: %v", err)
	}
	if m := f.r.VerifyResourceMeter(); m.ActiveWorkers != 0 || m.ReservedMemoryBytes != 0 || m.VerifiedJobs != 0 {
		t.Fatalf("deadline resource leak: %+v", m)
	}
	// The durable claim is consumed even when input checking exceeds the limit;
	// retrying this job cannot silently start a second worker.
	rec, ok := f.r.Record(f.w.Job)
	if ok && rec.State != "stopped" {
		t.Fatalf("deadline first cause lost: %+v", rec)
	}
}

func TestP0908ContributionConsentExpiryStopsNewAudit(t *testing.T) {
	f := newSandboxFixture(t)
	cached := newSandboxFixture(t)
	expires := time.Now().Add(time.Second)
	f.c.ExpiresAt = expires.UTC().Format(time.RFC3339Nano)
	cached.c.ExpiresAt = f.c.ExpiresAt
	rec := f.submitted(t)
	old := cached.submitted(t)
	first, err := cached.r.VerifyWorkReceipt(context.Background(), cached.w.Job, old.Result, cached.input)
	if err != nil {
		t.Fatal(err)
	}
	if wait := time.Until(expires); wait > 0 {
		time.Sleep(wait)
	}
	if _, err := f.r.VerifyWorkReceipt(context.Background(), f.w.Job, rec.Result, f.input); !errors.Is(err, contribution.ErrDenied) {
		t.Fatalf("expired consent launched audit: %v", err)
	}
	if m := f.r.VerifyResourceMeter(); m.ActiveWorkers != 0 || m.VerifiedJobs != 0 || m.ReservedMemoryBytes != 0 {
		t.Fatalf("expiry audit side effects: %+v", m)
	}
	again, err := cached.r.VerifyWorkReceipt(context.Background(), cached.w.Job, old.Result, cached.input)
	if err != nil || again != first {
		t.Fatalf("cached evidence became a new operation: %+v %v", again, err)
	}
}
