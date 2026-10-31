package ynxbatch

// Opt-in, public-output-only diagnostics of the unchanged production provider.
// No deterministic entropy, provider replacement, scheduling change or key export.
import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"runtime/pprof"
	"sort"
	"strconv"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/slhdsa"
)

type slhBaselineSample struct {
	Caller      int   `json:"caller"`
	Sequence    int   `json:"sequence"`
	Nanoseconds int64 `json:"nanoseconds"`
}
type slhBaselineResult struct {
	Mode                   string                `json:"mode"`
	CallerScope            string                `json:"caller_scope"`
	Provider               string                `json:"provider"`
	Entropy                string                `json:"entropy"`
	Context                string                `json:"context"`
	Go                     string                `json:"go"`
	OS                     string                `json:"os"`
	Arch                   string                `json:"arch"`
	GOMAXPROCS             int                   `json:"gomaxprocs"`
	NumCPU                 int                   `json:"num_cpu"`
	Callers                int                   `json:"callers"`
	SharedKey              bool                  `json:"shared_key"`
	SamplesPerCaller       int                   `json:"samples_per_caller"`
	WarmupPerCaller        int                   `json:"warmup_per_caller"`
	QuantileMethod         string                `json:"quantile_method"`
	P50NS                  int64                 `json:"p50_ns"`
	P95NS                  int64                 `json:"p95_ns"`
	P99NS                  int64                 `json:"p99_ns"`
	WallNS                 int64                 `json:"wall_ns"`
	OperationsPerSecond    float64               `json:"operations_per_second"`
	CPUUserNS              int64                 `json:"cpu_user_ns"`
	CPUSystemNS            int64                 `json:"cpu_system_ns"`
	CPUCoresUsed           float64               `json:"cpu_cores_used"`
	TotalAllocBytes        uint64                `json:"total_alloc_bytes"`
	Mallocs                uint64                `json:"mallocs"`
	GoroutinesBefore       int                   `json:"goroutines_before"`
	GoroutinesAfterJoin    int                   `json:"goroutines_after_join"`
	Verified               int                   `json:"verified"`
	TamperRejected         bool                  `json:"tamper_rejected"`
	DestroyedKeys          int                   `json:"destroyed_keys"`
	DestroyRejects         bool                  `json:"destroy_rejects"`
	ProviderStats          ParallelProviderStats `json:"provider_stats"`
	ExperimentalScheduling any                   `json:"experimental_scheduling,omitempty"`
	Samples                []slhBaselineSample   `json:"samples"`
}

func slhBaselineQuantile(sorted []int64, q float64) int64 {
	return sorted[int(math.Ceil(float64(len(sorted))*q))-1]
}

// TestSLHOriginalProviderBaseline is deliberately skipped by ordinary CI. The
// sample count is explicit; order statistics are measured operation latencies,
// never Go benchmark averages. Set YNX_SLH_BASELINE_OUTPUT to a private directory.
func TestSLHOriginalProviderBaseline(t *testing.T) {
	out := os.Getenv("YNX_SLH_BASELINE_OUTPUT")
	if out == "" {
		t.Skip("opt-in original-provider sampler; set YNX_SLH_BASELINE_OUTPUT")
	}
	if !filepath.IsAbs(out) {
		t.Fatal("output must be an absolute private artifact directory")
	}
	n := 200
	if s := os.Getenv("YNX_SLH_BASELINE_SAMPLES"); s != "" {
		v, err := strconv.Atoi(s)
		if err != nil || v < 2 || v > 10000 {
			t.Fatal("samples must be 2..10000 per caller")
		}
		n = v
	}
	if err := os.MkdirAll(out, 0700); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		mode    string
		callers int
		shared  bool
	}{
		{"slh", 1, false}, {"batch-sequential", 1, false}, {"batch-existing-pair", 1, false},
		{"slh", 2, false}, {"batch-sequential", 2, false}, {"batch-existing-pair", 2, false},
		{"batch-existing-pair", 2, true},
	}
	for _, c := range cases {
		name := fmt.Sprintf("%s-c%d-shared%t", c.mode, c.callers, c.shared)
		t.Run(name, func(t *testing.T) { slhBaselineRun(t, out, name, c.mode, c.callers, c.shared, n) })
	}
}

type slhBaselineArtifact struct {
	raw  []byte
	wire []byte
}

func slhBaselineRun(t *testing.T, out, name, mode string, callers int, shared bool, n int) {
	t.Helper()
	keys := make([]*PrivateKey, callers)
	for i := range keys {
		if shared && i > 0 {
			keys[i] = keys[0]
			continue
		}
		key, _, err := KeyGen()
		if err != nil {
			t.Fatal(err)
		}
		keys[i] = key
		registerSLHBaselineSyntheticKey(t, key)
		t.Cleanup(key.Destroy)
	}
	metadata := Metadata{ChainID: bytes.Repeat([]byte{51}, 32), Owner: "public-synthetic-slh-baseline", Purpose: "TX-BATCH"}
	messages := [][]byte{bytes.Repeat([]byte{52}, 256)}
	// Obtain the genuine canonical CERT/B message without inventing a domain.
	template, err := BatchSign(keys[0], metadata, messages, SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	templateWire, err := template.CertificateWire()
	if err != nil {
		t.Fatal(err)
	}
	template.Discard()
	cert, err := DecodeCertificate(templateWire)
	if err != nil {
		t.Fatal(err)
	}
	_, mb, err := certificateMessages(cert)
	if err != nil {
		t.Fatal(err)
	}
	var provider *ParallelProvider
	if mode == "batch-existing-pair" {
		provider, err = NewParallelProvider(2)
		if err != nil {
			t.Fatal(err)
		}
	}
	options := SignOptions{Optimized: true, ParallelProvider: provider}
	sign := func(k *PrivateKey) (slhBaselineArtifact, int64, error) {
		start := time.Now()
		if mode == "slh" {
			// Same protected key lifetime and real upstream call as provider.go, with
			// original rand.Reader and nil (empty) FIPS pure-mode context.
			s := k.state
			s.mu.Lock()
			sig, e := signProviderSLH(s.b, rand.Reader, mb)
			s.mu.Unlock()
			return slhBaselineArtifact{raw: sig}, time.Since(start).Nanoseconds(), e
		}
		batch, e := BatchSign(k, metadata, messages, options)
		elapsed := time.Since(start).Nanoseconds()
		if e != nil {
			return slhBaselineArtifact{}, elapsed, e
		}
		wire, e := batch.CertificateWire()
		batch.Discard()
		return slhBaselineArtifact{wire: wire}, elapsed, e
	}
	const warmup = 2
	for i := range keys {
		for j := 0; j < warmup; j++ {
			_, _, e := sign(keys[i])
			if e != nil {
				t.Fatal(e)
			}
		}
	}
	artifacts := make([][]slhBaselineArtifact, callers)
	samples := make([][]slhBaselineSample, callers)
	for i := range keys {
		artifacts[i] = make([]slhBaselineArtifact, n)
		samples[i] = make([]slhBaselineSample, n)
	}
	profile, err := os.Create(filepath.Join(out, name+".cpu.pprof"))
	if err != nil {
		t.Fatal(err)
	}
	if err = pprof.StartCPUProfile(profile); err != nil {
		profile.Close()
		t.Fatal(err)
	}
	var before, after runtime.MemStats
	var cpuBefore, cpuAfter syscall.Rusage
	runtime.ReadMemStats(&before)
	if err = syscall.Getrusage(syscall.RUSAGE_SELF, &cpuBefore); err != nil {
		pprof.StopCPUProfile()
		profile.Close()
		t.Fatal(err)
	}
	goroutines := runtime.NumGoroutine()
	startGate := make(chan struct{})
	failures := make(chan error, callers)
	var wg sync.WaitGroup
	for caller := 0; caller < callers; caller++ {
		wg.Add(1)
		go func(caller int) {
			defer wg.Done()
			<-startGate
			for j := 0; j < n; j++ {
				a, ns, e := sign(keys[caller])
				if e != nil {
					failures <- e
					return
				}
				artifacts[caller][j] = a
				samples[caller][j] = slhBaselineSample{caller, j, ns}
			}
		}(caller)
	}
	start := time.Now()
	close(startGate)
	wg.Wait()
	wall := time.Since(start)
	if err = syscall.Getrusage(syscall.RUSAGE_SELF, &cpuAfter); err != nil {
		pprof.StopCPUProfile()
		profile.Close()
		t.Fatal(err)
	}
	runtime.ReadMemStats(&after)
	afterJoin := runtime.NumGoroutine()
	pprof.StopCPUProfile()
	if err = profile.Close(); err != nil {
		t.Fatal(err)
	}
	close(failures)
	for e := range failures {
		t.Fatal(e)
	}
	r := slhBaselineResult{Mode: mode, CallerScope: "BatchSign incl key mutex, canonical trees, dual signatures, encode; wire clone/discard excluded from latency", Provider: ProviderVersion + " SLH-DSA-SHA2-256f" + slhProviderExperimentLabel(), Entropy: "crypto/rand.Reader unchanged; fresh synthetic KeyGen", Context: "FIPS pure mode, nil context; canonical CERT/B domain unchanged", Go: runtime.Version(), OS: runtime.GOOS, Arch: runtime.GOARCH, GOMAXPROCS: runtime.GOMAXPROCS(0), NumCPU: runtime.NumCPU(), Callers: callers, SharedKey: shared, SamplesPerCaller: n, WarmupPerCaller: warmup, QuantileMethod: "nearest-rank ceil(p*N), pooled closed-loop operation latency; no confidence interval", WallNS: wall.Nanoseconds(), OperationsPerSecond: float64(callers*n) / wall.Seconds(), TotalAllocBytes: after.TotalAlloc - before.TotalAlloc, Mallocs: after.Mallocs - before.Mallocs, GoroutinesBefore: goroutines, GoroutinesAfterJoin: afterJoin}
	if mode == "slh" {
		r.CallerScope = "SLH backend identified by provider field + original per-key mutex; canonical CERT/B message reused; no BatchSign framing or ML-DSA"
	}
	cpuNS := func(v syscall.Timeval) int64 { return v.Sec*int64(time.Second) + int64(v.Usec)*1000 }
	r.CPUUserNS = cpuNS(cpuAfter.Utime) - cpuNS(cpuBefore.Utime)
	r.CPUSystemNS = cpuNS(cpuAfter.Stime) - cpuNS(cpuBefore.Stime)
	r.CPUCoresUsed = float64(r.CPUUserNS+r.CPUSystemNS) / float64(r.WallNS)
	durations := make([]int64, 0, callers*n)
	for i := range samples {
		r.Samples = append(r.Samples, samples[i]...)
		for _, s := range samples[i] {
			durations = append(durations, s.Nanoseconds)
		}
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	r.P50NS = slhBaselineQuantile(durations, .50)
	r.P95NS = slhBaselineQuantile(durations, .95)
	r.P99NS = slhBaselineQuantile(durations, .99)
	// Verify EVERY sampled output after signing wall/CPU/latency measurement.
	for i := range artifacts {
		for _, a := range artifacts[i] {
			if mode == "slh" {
				pub := &slhdsa.PublicKey{ID: slhdsa.SHA2_256f}
				if e := pub.UnmarshalBinary(keys[i].state.public.PKB); e != nil {
					t.Fatal(e)
				}
				if !slhdsa.Verify(pub, slhdsa.NewMessage(mb), a.raw, nil) {
					t.Fatal("SLH verification failed")
				}
			} else {
				c, e := DecodeCertificate(a.wire)
				if e != nil {
					t.Fatal(e)
				}
				p, e := importPublic(c.Context)
				if e != nil {
					t.Fatal(e)
				}
				if e = verifySignatures(c, p); e != nil {
					t.Fatal(e)
				}
			}
			r.Verified++
		}
	}
	a := artifacts[0][0]
	if mode == "slh" {
		pub := &slhdsa.PublicKey{ID: slhdsa.SHA2_256f}
		if e := pub.UnmarshalBinary(keys[0].state.public.PKB); e != nil {
			t.Fatal(e)
		}
		bad := clone(a.raw)
		bad[0] ^= 1
		r.TamperRejected = !slhdsa.Verify(pub, slhdsa.NewMessage(mb), bad, nil)
	} else {
		c, e := DecodeCertificate(a.wire)
		if e != nil {
			t.Fatal(e)
		}
		p, e := importPublic(c.Context)
		if e != nil {
			t.Fatal(e)
		}
		c.SigmaB[0] ^= 1
		r.TamperRejected = verifySignatures(c, p) != nil
	}
	if !r.TamperRejected {
		t.Fatal("tampered SLH signature accepted")
	}
	r.ProviderStats = provider.Stats()
	r.ExperimentalScheduling = slhProviderExperimentSnapshot()
	if r.ProviderStats.InFlight != 0 {
		t.Fatal("provider worker did not join")
	}
	r.DestroyRejects = true
	for i, k := range keys {
		if shared && i > 0 {
			continue
		}
		k.Destroy()
		r.DestroyedKeys++
		b, e := BatchSign(k, metadata, messages, options)
		if e == nil || b != nil {
			r.DestroyRejects = false
			t.Fatal("destroyed handle accepted")
		}
	}
	encoded, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(out, name+".json"), append(encoded, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("samples=%d p50=%.3fms p95=%.3fms p99=%.3fms throughput=%.3f ops/s CPU=%.3f cores verified=%d destroy_rejects=%t", len(durations), float64(r.P50NS)/1e6, float64(r.P95NS)/1e6, float64(r.P99NS)/1e6, r.OperationsPerSecond, r.CPUCoresUsed, r.Verified, r.DestroyRejects)
}
