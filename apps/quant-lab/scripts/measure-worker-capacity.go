//go:build ignore

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantpackage"
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantworker"
)

type latencySummary struct {
	Count     int       `json:"count"`
	P50MS     float64   `json:"p50Ms"`
	P95MS     float64   `json:"p95Ms"`
	P99MS     float64   `json:"p99Ms"`
	MaxMS     float64   `json:"maxMs"`
	SamplesMS []float64 `json:"samplesMs"`
}

type machineEvidence struct {
	GOOS     string `json:"goos"`
	GOARCH   string `json:"goarch"`
	Go       string `json:"goVersion"`
	CPUCount int    `json:"cpuCount"`
}

type workerEvidence struct {
	SchemaVersion        int             `json:"schemaVersion"`
	Source               string          `json:"source"`
	SourceCommit         string          `json:"sourceCommit"`
	GeneratedAt          time.Time       `json:"generatedAt"`
	Machine              machineEvidence `json:"machine"`
	Jobs                 int             `json:"jobs"`
	BarsPerJob           int             `json:"barsPerJob"`
	Errors               int             `json:"errors"`
	WallMilliseconds     float64         `json:"wallMilliseconds"`
	ThroughputJobsSecond float64         `json:"throughputJobsPerSecond"`
	ServiceLatency       latencySummary  `json:"serviceLatency"`
	QueueAge             latencySummary  `json:"queueAge"`
	InitialStateBytes    int64           `json:"initialStateBytes"`
	FinalStateBytes      int64           `json:"finalStateBytes"`
	StateGrowthBytes     int64           `json:"stateGrowthBytes"`
	OutboxBytes          int64           `json:"outboxBytes"`
	CompletedResults     int             `json:"completedResults"`
	PercentileMethod     string          `json:"percentileMethod"`
	TruthBoundary        string          `json:"truthBoundary"`
}

var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

func main() {
	jobs := flag.Int("jobs", 40, "number of deterministic local worker jobs")
	barCount := flag.Int("bars", 512, "bars per deterministic backtest job")
	sourceCommit := flag.String("source-commit", "", "full 40-character source commit")
	output := flag.String("output", "", "optional JSON evidence output path")
	flag.Parse()
	if !commitPattern.MatchString(*sourceCommit) {
		fatalf("source-commit must be a full lowercase 40-character git SHA")
	}
	if *jobs < 1 || *jobs > 1000 || *barCount < 20 || *barCount > 100000 {
		fatalf("invalid workload jobs=%d bars=%d", *jobs, *barCount)
	}

	tempDir, err := os.MkdirTemp("", "ynx-quant-worker-capacity-")
	if err != nil {
		fatalf("create worker capacity directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	statePath := filepath.Join(tempDir, "state.json")
	inbox := filepath.Join(tempDir, "inbox")
	outbox := filepath.Join(tempDir, "outbox")
	if err := os.MkdirAll(inbox, 0o700); err != nil {
		fatalf("create worker inbox: %v", err)
	}
	service, err := quantlab.New(quantlab.Config{StatePath: statePath})
	if err != nil {
		fatalf("create worker service: %v", err)
	}
	initialStateBytes := fileSize(statePath)

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fatalf("generate ephemeral capacity signer: %v", err)
	}
	const signerKeyID = "capacity-local"
	verifier := quantpackage.Verifier{
		TrustedSigners:      map[string]ed25519.PublicKey{signerKeyID: publicKey},
		DependencyAllowlist: map[string]map[string]string{},
	}
	worker := quantworker.Worker{
		Inbox:           inbox,
		Outbox:          outbox,
		Service:         service,
		PackageVerifier: verifier,
	}

	request := deterministicRequest(*barCount, *sourceCommit)
	canonical, err := json.Marshal(request)
	if err != nil {
		fatalf("marshal deterministic request: %v", err)
	}
	requestDigest := sha256.Sum256(canonical)
	payloadHash := hex.EncodeToString(requestDigest[:])
	scanDigest := sha256.Sum256([]byte("ynx-quant-local-capacity-scan-evidence-v1"))
	manifest := quantpackage.Manifest{
		Schema:         1,
		PackageID:      "capacity-local",
		Version:        "1",
		Runtime:        "ynx-built-in-ma-v1",
		SourceSHA256:   quantpackage.HashString(request.Strategy.Source + "\n" + request.Strategy.SourceCommit),
		ArtifactSHA256: payloadHash,
		Dependencies:   []quantpackage.Dependency{},
		Permissions:    quantpackage.Permissions{},
		Limits: quantpackage.Limits{
			CPUMilliseconds:  30_000,
			MemoryBytes:      256 << 20,
			WallMilliseconds: 60_000,
			MaxInputBars:     *barCount,
		},
		DeterministicClock: true,
		CheckpointRecovery: true,
		Scan: quantpackage.ScanEvidence{
			SecretScanPassed:  true,
			MalwareScanPassed: true,
			ScannerVersion:    "local-capacity-fixture-v1",
			EvidenceSHA256:    hex.EncodeToString(scanDigest[:]),
		},
		SignerKeyID: signerKeyID,
	}
	manifest = quantpackage.Sign(manifest, privateKey)

	createdAt := make(map[string]time.Time, *jobs)
	for index := 0; index < *jobs; index++ {
		jobID := fmt.Sprintf("capacity-%06d", index+1)
		job := quantworker.Job{Schema: 1, ID: jobID, PayloadHash: payloadHash, Request: request, Package: manifest}
		encoded, err := json.Marshal(job)
		if err != nil {
			fatalf("marshal job %s: %v", jobID, err)
		}
		createdAt[jobID] = time.Now()
		if err := os.WriteFile(filepath.Join(inbox, jobID+".json"), encoded, 0o600); err != nil {
			fatalf("write job %s: %v", jobID, err)
		}
	}

	serviceSamples := make([]float64, 0, *jobs)
	queueSamples := make([]float64, 0, *jobs)
	errorsCount := 0
	completed := 0
	wallStart := time.Now()
	for index := 0; index < *jobs; index++ {
		started := time.Now()
		result, runErr := worker.RunOne()
		completedAt := time.Now()
		serviceSamples = append(serviceSamples, milliseconds(completedAt.Sub(started)))
		if runErr != nil || result.Status != "completed" {
			errorsCount++
			continue
		}
		queuedAt, ok := createdAt[result.JobID]
		if !ok {
			errorsCount++
			continue
		}
		queueSamples = append(queueSamples, milliseconds(completedAt.Sub(queuedAt)))
		completed++
	}
	wallDuration := time.Since(wallStart)

	outboxBytes := int64(0)
	entries, err := os.ReadDir(outbox)
	if err != nil {
		fatalf("read worker outbox: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			fatalf("stat worker output %s: %v", entry.Name(), err)
		}
		outboxBytes += info.Size()
	}

	wallSeconds := wallDuration.Seconds()
	throughput := 0.0
	if wallSeconds > 0 {
		throughput = float64(completed) / wallSeconds
	}
	finalStateBytes := fileSize(statePath)
	evidence := workerEvidence{
		SchemaVersion: 1,
		Source:        "ynx-quant-worker-deterministic-built-in-local-capacity",
		SourceCommit:  *sourceCommit,
		GeneratedAt:   time.Now().UTC(),
		Machine: machineEvidence{
			GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, Go: runtime.Version(), CPUCount: runtime.NumCPU(),
		},
		Jobs:                 *jobs,
		BarsPerJob:           *barCount,
		Errors:               errorsCount,
		WallMilliseconds:     milliseconds(wallDuration),
		ThroughputJobsSecond: throughput,
		ServiceLatency:       summarize(serviceSamples),
		QueueAge:             summarize(queueSamples),
		InitialStateBytes:    initialStateBytes,
		FinalStateBytes:      finalStateBytes,
		StateGrowthBytes:     finalStateBytes - initialStateBytes,
		OutboxBytes:          outboxBytes,
		CompletedResults:     completed,
		PercentileMethod:     "nearest-rank over retained raw wall-clock samples",
		TruthBoundary:        "Local deterministic built-in strategy fixture with an ephemeral signer; not production signing, provider latency, public capacity, or live-funds evidence.",
	}
	if evidence.Errors != 0 || evidence.CompletedResults != *jobs {
		fatalf("worker capacity workload incomplete: completed=%d errors=%d", evidence.CompletedResults, evidence.Errors)
	}
	encoded, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		fatalf("marshal worker evidence: %v", err)
	}
	encoded = append(encoded, '\n')
	if *output != "" {
		if err := writeAtomic(*output, encoded); err != nil {
			fatalf("write worker evidence: %v", err)
		}
	}
	fmt.Print(string(encoded))
}

func deterministicRequest(barCount int, sourceCommit string) quantlab.BacktestRequest {
	bars := make([]quantlab.Bar, barCount)
	start := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	for index := range bars {
		closeValue := int64(100_000 + index*3 + (index%37)*11)
		bars[index] = quantlab.Bar{
			Time:   start.Add(time.Duration(index) * time.Minute),
			Open:   closeValue - 5,
			High:   closeValue + 50,
			Low:    closeValue - 50,
			Close:  closeValue,
			Volume: 5_000_000 + int64(index%17)*10_000,
		}
	}
	return quantlab.BacktestRequest{
		Strategy: quantlab.StrategySpec{
			ID:           "worker-capacity-ma",
			Name:         "Worker capacity moving average",
			Family:       "transparent",
			Source:       "quant://capacity/built-in-ma",
			SourceCommit: sourceCommit,
			License:      "Apache-2.0",
			Params:       map[string]int64{"fast": 3, "slow": 8},
			Limitations:  "Synthetic deterministic bars for local capacity measurement only",
		},
		Bars: bars,
		Assumptions: quantlab.Assumptions{
			FeeBPS:             10,
			SlippageBPS:        5,
			LatencyBars:        1,
			ParticipationBPS:   1000,
			Seed:               7,
			TrainEnd:           barCount / 2,
			WalkForwardWindows: 4,
		},
	}
}

func summarize(samples []float64) latencySummary {
	copySamples := append([]float64(nil), samples...)
	sorted := append([]float64(nil), samples...)
	sort.Float64s(sorted)
	return latencySummary{
		Count:     len(copySamples),
		P50MS:     percentile(sorted, 0.50),
		P95MS:     percentile(sorted, 0.95),
		P99MS:     percentile(sorted, 0.99),
		MaxMS:     percentile(sorted, 1.00),
		SamplesMS: copySamples,
	}
}

func percentile(sorted []float64, fraction float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(float64(len(sorted))*fraction+0.999999999999) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func milliseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1_000_000
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0
		}
		fatalf("stat %s: %v", filepath.Base(path), err)
	}
	return info.Size()
}

func writeAtomic(path string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".capacity-*.json")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o644); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
