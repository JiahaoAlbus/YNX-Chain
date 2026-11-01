package contribution

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	auth "github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/authresourcesource"
)

// PUBLIC differential ports are not reachable from the concrete production
// constructor. Signatures below deliberately are not Root/PQ credentials.
type publicOriginalSource struct {
	invalidateStoreOwner               bool
	mu                                 sync.Mutex
	manifest, consent, input           []byte
	claimValue                         *publicOriginalClaim
	currentErr, signatureErr, claimErr error
	claimCalls                         int
	retired                            bool
	runner                             *Runner
}

func (s *publicOriginalSource) Current(ctx context.Context) error {
	if s.runner != nil {
		if !s.runner.mu.TryLock() {
			return errors.New("PUBLIC: full Source Current called inside Store lock")
		}
		s.runner.mu.Unlock()
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.retired {
		return ErrStopped
	}
	return s.currentErr
}
func (s *publicOriginalSource) ReadOriginalManifest(context.Context) ([]byte, error) {
	return bytes.Clone(s.manifest), nil
}
func (s *publicOriginalSource) ReadOriginalConsent(context.Context) ([]byte, error) {
	return bytes.Clone(s.consent), nil
}
func (s *publicOriginalSource) ReadOriginalInput(context.Context) ([]byte, error) {
	return bytes.Clone(s.input), nil
}
func (s *publicOriginalSource) VerifyManifest(_ context.Context, _ string, p, sig []byte) error {
	if !bytes.Equal(p, s.manifest) || string(sig) != "PUBLIC manifest" {
		return ErrDenied
	}
	return s.signatureErr
}
func (s *publicOriginalSource) VerifyConsent(_ context.Context, _ string, p, sig []byte) error {
	if !bytes.Equal(p, s.consent) || string(sig) != "PUBLIC consent" {
		return ErrDenied
	}
	return s.signatureErr
}
func (s *publicOriginalSource) claim(context.Context) (originalClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claimCalls++
	if s.invalidateStoreOwner {
		if e := os.Rename(s.runner.path+".owner.lock", s.runner.path+".owner.lock.public-firstcause"); e != nil {
			return s.claimValue, e
		}
	}
	return s.claimValue, s.claimErr
}
func (s *publicOriginalSource) Retire() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retired = true
	return nil
}
func (s *publicOriginalSource) Join(context.Context) (bool, error)  { return true, nil }
func (s *publicOriginalSource) Close(context.Context) (bool, error) { return true, nil }

type publicOriginalClaim struct {
	mu                                   sync.Mutex
	raw                                  []byte
	readErr                              error
	complete                             bool
	closeGate                            chan struct{}
	checks, lockedChecks, closes, denyAt int
	runner                               *Runner
}

func (c *publicOriginalClaim) CurrentNoIO() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.checks++
	if c.runner != nil {
		if !c.runner.mu.TryLock() {
			c.lockedChecks++
		} else {
			c.runner.mu.Unlock()
		}
	}
	if c.denyAt > 0 && c.checks >= c.denyAt {
		return ErrDenied
	}
	return nil
}
func (c *publicOriginalClaim) ReadOriginal(context.Context) ([]byte, error) {
	return bytes.Clone(c.raw), c.readErr
}
func (c *publicOriginalClaim) Close() (bool, error) {
	if c.closeGate != nil {
		<-c.closeGate
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closes++
	return c.complete, nil
}

func publicOriginalDocuments(t *testing.T, job string) ([]byte, []byte, []byte) {
	t.Helper()
	input := []byte(`{"classification":"PUBLIC_SOURCE_PORT_REAL_FIXED_WASM"}`)
	limits := Limits{CPUMilli: "1000", MemoryBytes: "25165824", StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
	expires := time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)
	// Sorted DATA fixture only, never used by production code to reconstruct
	// Source originals. The actual sole-SDK interoperability case checks it.
	manifest, _ := json.Marshal(map[string]any{"expiresAt": expires, "input": map[string]any{"bytes": Bind(input).Bytes, "sha3_512": Bind(input).SHA3512, "sha512": Bind(input).SHA512}, "issuer": "public-issuer", "job": job, "kind": PublicBlockHistogramKind, "limits": map[string]string{"cpuMilli": limits.CPUMilli, "durationMillis": limits.DurationMillis, "egressBytes": "0", "memoryBytes": limits.MemoryBytes, "storageBytes": "0"}})
	consent, _ := json.Marshal(map[string]any{"allow": true, "expiresAt": expires, "job": job, "limits": map[string]string{"cpuMilli": limits.CPUMilli, "durationMillis": limits.DurationMillis, "egressBytes": "0", "memoryBytes": limits.MemoryBytes, "storageBytes": "0"}, "manifest": map[string]string{"bytes": Bind(manifest).Bytes, "sha3_512": Bind(manifest).SHA3512, "sha512": Bind(manifest).SHA512}, "nonce": "public-once", "principal": "public-person"})
	return manifest, consent, input
}
func publicOnceRaw(t *testing.T, manifest, consent []byte) []byte {
	t.Helper()
	w, c, e := originalDocuments(manifest, consent)
	if e != nil {
		t.Fatal(e)
	}
	var out bytes.Buffer
	for _, s := range []string{"YNX-NETWORK-RESOURCE-ONCE/V1", c.Principal, c.Nonce, w.Job, "public-request", "public-lifecycle", string(manifest), string(consent)} {
		_ = binary.Write(&out, binary.BigEndian, uint32(len(s)))
		out.WriteString(s)
	}
	return out.Bytes()
}
func buildPublicOriginalWorker(t *testing.T) string {
	t.Helper()
	dir, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	worker := filepath.Join(dir, processWorkerName)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-p", "1", "-o", worker, ".")
	cmd.Dir = "../wasmworker"
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOMAXPROCS=2", "CGO_ENABLED=0")
	if cache := os.Getenv("YNX_NETWORK_WORKER_GOMODCACHE"); cache != "" {
		cmd.Env = append(cmd.Env, "GOMODCACHE="+cache)
	}
	if out, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("fixed worker fixture compile: %v %s", e, out)
	}
	return worker
}
func publicOriginalRunner(t *testing.T, worker, path string, s *publicOriginalSource) *Runner {
	t.Helper()
	raw, e := os.ReadFile(worker)
	if e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256(raw)
	executor, e := NewPinnedWASMExecutor(worker, hex.EncodeToString(sum[:]))
	if e != nil {
		t.Fatal(e)
	}
	r, e := open(path, nil, false)
	if e != nil {
		t.Fatal(e)
	}
	r.executor = executor
	r.original = &originalExecution{source: s, claims: map[string]*originalClaimOwner{}}
	s.runner = r
	s.claimValue.runner = r
	t.Cleanup(func() { s.claimValue.mu.Lock(); s.claimValue.complete = true; s.claimValue.mu.Unlock(); _ = r.Close() })
	return r
}
func originalPublicStart(r *Runner) (Record, error) {
	return r.StartOriginalContribution(context.Background(), []byte("PUBLIC manifest"), []byte("PUBLIC consent"))
}

func TestOriginalSourceConsumerStoreAndFixedWorker(t *testing.T) {
	worker := buildPublicOriginalWorker(t)
	t.Run("canonical-once-final-fence-and-cold-history", func(t *testing.T) {
		m, c, input := publicOriginalDocuments(t, "public-job")
		claim := &publicOriginalClaim{raw: publicOnceRaw(t, m, c), complete: true}
		s := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: claim}
		path := filepath.Join(t.TempDir(), "journal.json")
		r := publicOriginalRunner(t, worker, path, s)
		if _, e := originalPublicStart(r); e != nil {
			t.Fatal(e)
		}
		if e := r.Wait(context.Background()); e != nil {
			t.Fatal(e)
		}
		rec, _ := r.Record("public-job")
		if rec.State != "verified" || rec.Receipt == nil || rec.Receipt.Class != OriginalLocalClass || rec.Manifest != Bind(m) || rec.Manifest == Bind(ManifestPayload(rec.Work)) || r.executor.Executions() != 1 || claim.lockedChecks < 2 || !bytes.Equal(rec.Original.ManifestOriginal, m) {
			t.Fatalf("not original/fenced/recomputed: %+v checks=%d locked=%d", rec, claim.checks, claim.lockedChecks)
		}
		meter := r.VerifyResourceMeter()
		if meter.VerifiedJobs != 1 || meter.CPUServiceVerified || meter.Rewards != "NOT_AUTHORIZED" || meter.OriginalClaimsPending != 0 {
			t.Fatal(meter)
		}
		p, e := r.VerifyWorkReceipt(context.Background(), rec.Work.Job, rec.Result, input)
		if e != nil || p != *rec.Receipt {
			t.Fatal(p, e)
		}
		if _, e = originalPublicStart(r); e != nil || r.executor.Executions() != 1 || s.claimCalls != 1 {
			t.Fatal("duplicate claimed/reran", e)
		}
		rec.Original.ManifestOriginal[0] = 'X'
		fresh, _ := r.Record("public-job")
		if !bytes.Equal(fresh.Original.ManifestOriginal, m) {
			t.Fatal("caller mutated journal original")
		}
		if e = r.Close(); e != nil {
			t.Fatal(e)
		}
		coldSource := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: &publicOriginalClaim{raw: publicOnceRaw(t, m, c), complete: true}}
		cold := publicOriginalRunner(t, worker, path, coldSource)
		old, e := originalPublicStart(cold)
		if e != nil || old.State != "historical" || old.Receipt == nil || old.Receipt.ID != p.ID || cold.executor.Executions() != 0 || coldSource.claimCalls != 0 || cold.VerifyResourceMeter().VerifiedJobs != 0 {
			t.Fatalf("cold replay/promotion: %+v %v", old, e)
		}
		if _, e = cold.VerifyWorkReceipt(context.Background(), old.Work.Job, old.Result, input); !errors.Is(e, ErrDenied) {
			t.Fatal("cold data became fresh verification", e)
		}
	})
	t.Run("Source0-or-bad-signature-no-journal-mutation", func(t *testing.T) {
		m, c, input := publicOriginalDocuments(t, "public-denied")
		s := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: &publicOriginalClaim{complete: true}, currentErr: ErrDenied}
		path := filepath.Join(t.TempDir(), "journal.json")
		r := publicOriginalRunner(t, worker, path, s)
		before, _ := os.ReadFile(path)
		if _, e := originalPublicStart(r); e == nil {
			t.Fatal("Source0 admitted")
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) || s.claimCalls != 0 || len(r.data.Nonces) != 0 {
			t.Fatal("Source0 changed original store")
		}
		s.currentErr = nil
		s.signatureErr = ErrDenied
		if _, e := originalPublicStart(r); e == nil {
			t.Fatal("bad signatures admitted")
		}
		after, _ = os.ReadFile(path)
		if !bytes.Equal(before, after) || s.claimCalls != 0 {
			t.Fatal("signature failure consumed nonce")
		}
	})
	t.Run("partial-claim-unknown-retained-and-never-replayed", func(t *testing.T) {
		m, c, input := publicOriginalDocuments(t, "public-partial")
		claim := &publicOriginalClaim{readErr: ErrDenied}
		s := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: claim, claimErr: errors.New("PUBLIC original once write UNKNOWN")}
		path := filepath.Join(t.TempDir(), "journal.json")
		r := publicOriginalRunner(t, worker, path, s)
		rec, e := originalPublicStart(r)
		if e == nil || rec.State != "unknown" || len(r.data.Nonces) != 1 || r.executor.Executions() != 0 || r.VerifyResourceMeter().OriginalClaimsPending != 1 {
			t.Fatal(rec, e)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Millisecond)
		defer cancel()
		if e = r.StopContribution(ctx); e == nil {
			t.Fatal("pending claim falsely drained")
		}
		stored, _ := r.Record(rec.Work.Job)
		if stored.Original.FirstCause != "PUBLIC original once write UNKNOWN" || stored.Original.CleanupFailure == "" {
			t.Fatal(stored)
		}
		claim.mu.Lock()
		claim.complete = true
		claim.mu.Unlock()
		if e = r.Close(); e != nil {
			t.Fatal(e)
		}
		freshS := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: &publicOriginalClaim{complete: true}}
		cold := publicOriginalRunner(t, worker, path, freshS)
		if _, e = originalPublicStart(cold); !errors.Is(e, ErrConflict) || freshS.claimCalls != 0 || cold.executor.Executions() != 0 {
			t.Fatal("UNKNOWN replayed", e)
		}
	})
	t.Run("final-NoIO-denial-binds-UNKNOWN-without-worker", func(t *testing.T) {
		m, c, input := publicOriginalDocuments(t, "public-fence")
		claim := &publicOriginalClaim{raw: publicOnceRaw(t, m, c), complete: true, denyAt: 1}
		s := &publicOriginalSource{manifest: m, consent: c, input: input, claimValue: claim}
		r := publicOriginalRunner(t, worker, filepath.Join(t.TempDir(), "journal.json"), s)
		rec, e := originalPublicStart(r)
		if e == nil || rec.State != "unknown" || len(r.data.Nonces) != 1 || r.executor.Executions() != 0 || claim.lockedChecks != 1 {
			t.Fatal("final original transaction skipped Native fence", rec, e)
		}
	})
}

func TestOriginalConcreteSource0ConstructorHasNoStoreSideEffect(t *testing.T) {
	ctx := context.Background()
	source, sourceErr := auth.Open(ctx)
	if source != nil {
		defer func() {
			if e := source.Retire(); e != nil {
				t.Error(e)
			}
			if b, e := source.Join(ctx); !b || e != nil {
				t.Error("original Root0 join", b, e)
			}
			if b, e := source.Close(ctx); !b || e != nil {
				t.Error("original Root0 close", b, e)
			}
		}()
	}
	if sourceErr == nil {
		t.Fatal("test requires actual empty Root/no platform Source")
	}
	dir := filepath.Join(t.TempDir(), "must-remain-absent")
	r, e := NewOriginalSourceRunner(ctx, filepath.Join(dir, "journal.json"), source, nil)
	if r != nil || e == nil {
		t.Fatal("genuine Source0 admitted", r, e)
	}
	if _, e = os.Lstat(dir); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("Source0 created journal/owner/nonce directory", e)
	}
}

func TestOriginalDataDecoderRejectsWrappersDuplicatesAndClaimDrift(t *testing.T) {
	m, c, _ := publicOriginalDocuments(t, "public-data")
	w, consent, e := originalDocuments(m, c)
	if e != nil {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{ManifestPayload(w), append([]byte{0xef, 0xbb, 0xbf}, m...), []byte(`{"job":"a","job":"b"}`), append(bytes.Clone(m), []byte(" ")...)} {
		if _, _, e = originalDocuments(bad, c); e == nil {
			t.Fatal("non-original body accepted")
		}
	}
	raw := publicOnceRaw(t, m, c)
	raw[len(raw)-1] ^= 1
	if validateOnceOriginal(raw, w, consent, m, c) == nil {
		t.Fatal("Native recovery drift accepted")
	}
}

func TestOriginalCanonicalFixtureMatchesSoleSDKDATA(t *testing.T) {
	file := "/Volumes/西部数据/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ai-resource-closed-source-published-20261101/source/packages/wallet-auth/native/original-network-resource-source-contract.mjs"
	if _, e := os.Stat(file); e != nil {
		t.Skip("sole-SDK published fixture codec not installed on this CI host; no interoperability claim")
	}
	m, c, input := publicOriginalDocuments(t, "public-sdk-data")
	raw, _ := json.Marshal(map[string]any{"manifest": json.RawMessage(m), "consent": json.RawMessage(c), "input": input, "module": file})
	js := `import fs from 'node:fs';import{pathToFileURL}from'node:url';const x=JSON.parse(fs.readFileSync(0,'utf8')),s=await import(pathToFileURL(x.module)),b=Buffer.from(x.input,'base64');const m=s.encodeOriginalNetworkResourceManifestV1DATA(x.manifest,b,Date.now()),c=s.encodeOriginalNetworkResourceConsentV1DATA(x.consent,m.manifestOriginal,b,Date.now());if(m.authorized||m.RootAdmission||c.authorized||c.RootAdmission)throw Error('DATA cannot grant');process.stdout.write(JSON.stringify({manifest:m.manifestOriginal,consent:c.consentOriginal}));`
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "--input-type=module", "-e", js)
	cmd.Stdin = bytes.NewReader(raw)
	out, e := cmd.CombinedOutput()
	if e != nil {
		t.Fatalf("original sole-SDK DATA codec: %v %s", e, out)
	}
	var result struct{ Manifest, Consent string }
	if json.Unmarshal(out, &result) != nil || !bytes.Equal([]byte(result.Manifest), m) || !bytes.Equal([]byte(result.Consent), c) {
		t.Fatal("fixture not exact original SDK canonical DTO", string(out))
	}
}
