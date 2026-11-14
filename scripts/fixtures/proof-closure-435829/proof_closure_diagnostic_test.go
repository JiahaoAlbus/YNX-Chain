//go:build linux && amd64 && ynx_proof_closure_diagnostic

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime/pprof"
	"strconv"
	"testing"
	"time"
)

// Test-only caller of the ORIGINAL normal CLI. The original pinned context,
// request and all source paths stay byte-exact. No key, signer, node, network,
// time-window extension, skipped verification, or business retry is available.
// The historical clock is the original Actions job's observed completion time;
// it is NOT a recovered sample of the interrupted verifier's actual clock.
func TestProofClosure435829HistoricalOriginal(t *testing.T) {
	proofClosure435829(t, true)
}

func TestProofClosure435829CurrentClockOriginal(t *testing.T) {
	proofClosure435829(t, false)
}

func proofClosure435829(t *testing.T, historical bool) {
	t.Helper()
	casePath := os.Getenv("YNX_PROOF_CLOSURE_CASE")
	index := os.Getenv("YNX_PROOF_CLOSURE_INDEX")
	outputPath := os.Getenv("YNX_PROOF_CLOSURE_OUTPUT")
	for _, p := range []string{casePath, outputPath} {
		if !canonicalAbsolutePath(p) {
			t.Fatal("explicit canonical diagnostic directories required")
		}
	}
	if index != "00000" && index != "00001" {
		t.Fatal("only the two original interrupted invocations are selected")
	}
	resolved, e := filepath.EvalSymlinks(casePath)
	if e != nil || resolved != casePath {
		t.Fatal("diagnostic source path differs")
	}
	if e = os.Mkdir(outputPath, 0700); e != nil {
		t.Fatal("exclusive diagnostic result directory required")
	}
	manifestRaw, e := readPublicFile(filepath.Join(casePath, "closure", index, "original-public-proof-manifest.json"), 8<<10)
	pins := map[string]string{"00000": "68308050423d993863f9adb8a1a533eb590175552cab98390a1bd6a0f92b8b76", "00001": "a3f705532a1cc8237ca0a62bb3ad281b58c9a5d7f44c8016ea449b684fc5ea49"}
	if e != nil || !matchesSHA256(manifestRaw, pins[index]) {
		t.Fatal("original closure pin differs")
	}
	var manifest struct {
		Entries map[string]struct {
			Bytes                int64  `json:"bytes"`
			SHA256               string `json:"sha256"`
			OriginalAbsolutePath string `json:"originalAbsolutePath"`
		} `json:"entries"`
		OriginalContextSHA256 string `json:"originalContextSHA256"`
		OriginalRequestSHA256 string `json:"originalRequestSHA256"`
	}
	if json.Unmarshal(manifestRaw, &manifest) != nil || len(manifest.Entries) != 9 {
		t.Fatal("original complete nine-role closure required")
	}
	// Stream the independent exact-byte inventory before entering the profiled
	// verifier; do not charge this independent intake to migration decoding.
	for role, row := range manifest.Entries {
		if row.Bytes <= 0 || row.Bytes > 1<<30 {
			t.Fatal("original bounded public input required", role)
		}
		f, before, err := openPublicFile(row.OriginalAbsolutePath, row.Bytes)
		if err != nil {
			t.Fatal("original absolute public input unavailable", role)
		}
		h := sha256.New()
		n, err := io.Copy(h, io.NewSectionReader(f, 0, before.Size()))
		currentErr := checkPublicFile(f, row.OriginalAbsolutePath, before)
		closeErr := f.Close()
		if err != nil || currentErr != nil || closeErr != nil || n != row.Bytes || hex.EncodeToString(h.Sum(nil)) != row.SHA256 {
			t.Fatal("original input changed", role)
		}
	}
	jobRaw, e := readPublicFile(filepath.Join(casePath, "evidence", "JOB.json"), 16<<10)
	if e != nil || !matchesSHA256(jobRaw, "d1dbab37536379753efcfdc78ea03a0efd5a9e75a6965c3bbcaf912e12e8de40") {
		t.Fatal("original observation receipt differs")
	}
	var job struct {
		CompletedAt string `json:"completed_at"`
	}
	if json.Unmarshal(jobRaw, &job) != nil || job.CompletedAt != "2026-11-14T10:06:52Z" {
		t.Fatal("original completion clock unavailable")
	}
	historicalNow, e := time.Parse(time.RFC3339, job.CompletedAt)
	if e != nil {
		t.Fatal("invalid original completion clock")
	}
	clock := time.Now
	clockMode := "current-real-clock"
	if historical {
		clock = func() time.Time { return historicalNow }
		clockMode = "offline-original-job-completion-clock"
	}
	context := manifest.Entries["context"]
	request := manifest.Entries["request"]
	if context.SHA256 != manifest.OriginalContextSHA256 || request.SHA256 != manifest.OriginalRequestSHA256 {
		t.Fatal("independent target pins differ")
	}
	input, e := os.Open(request.OriginalAbsolutePath)
	if e != nil {
		t.Fatal("original request missing")
	}
	defer input.Close()
	cpu, e := os.OpenFile(filepath.Join(outputPath, "CPU.pprof"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		t.Fatal("exclusive CPU profile required")
	}
	if e = pprof.StartCPUProfile(cpu); e != nil {
		cpu.Close()
		t.Fatal("CPU observer did not start")
	}
	var output bytes.Buffer
	started := time.Now()
	status := run([]string{"--trust-context", context.OriginalAbsolutePath, "--trust-context-sha256", context.SHA256}, input, &output, clock)
	elapsed := time.Since(started)
	pprof.StopCPUProfile()
	if e = cpu.Close(); e != nil {
		t.Fatal("CPU profile close failed")
	}
	// Retain the original response even when the expected result fails. Never
	// write it under the original operation or reinterpret its online UNKNOWN.
	write := func(name string, raw []byte) {
		t.Helper()
		f, err := os.OpenFile(filepath.Join(outputPath, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			t.Fatal("exclusive diagnostic output required")
		}
		_, err = f.Write(raw)
		if err == nil {
			err = f.Sync()
		}
		closed := f.Close()
		if err != nil || closed != nil {
			t.Fatal("diagnostic output incomplete")
		}
	}
	write("NORMAL-CLI-RESULT.json", output.Bytes())
	var result transactionCommandResult
	parseErr := json.Unmarshal(output.Bytes(), &result)
	summary := struct {
		Version                 string `json:"version"`
		ClockMode               string `json:"clockMode"`
		Invocation              string `json:"invocation"`
		ElapsedNs               string `json:"elapsedNs"`
		ExitCode                int    `json:"exitCode"`
		Code                    string `json:"code"`
		OnlineFinalityQualified bool   `json:"onlineFinalityQualified"`
		OriginalUnknownReplaced bool   `json:"originalUnknownReplaced"`
		TransactionReplayed     bool   `json:"transactionReplayed"`
		NodeStarted             bool   `json:"nodeStarted"`
	}{"YNX-PROOF-CLOSURE-OFFLINE-PROFILE/v1", clockMode, index, strconv.FormatInt(elapsed.Nanoseconds(), 10), status, result.Code, false, false, false, false}
	raw, e := json.Marshal(summary)
	if e != nil {
		t.Fatal("diagnostic summary encode failed")
	}
	write("PROFILE-RESULT.json", append(raw, '\n'))
	if parseErr != nil {
		t.Fatal("normal CLI did not return a complete bounded result")
	}
	if historical {
		allowed := map[string]string{"VERIFIED_TRANSACTION_DATA": "succeeded", "VERIFIED_TRANSACTION_REJECTED_DATA": "rejected", "VERIFIED_TRANSACTION_PARTIAL_DATA": "partial"}
		if status != 0 || result.Result == nil || allowed[result.Code] == "" || allowed[result.Code] != result.Result.Outcome || !result.Result.Included || !result.Result.Finalized || result.Result.NativeGrant {
			t.Fatal("offline historical normal verification did not pass", status, result.Code)
		}
	} else {
		// The original 600-second trust period has elapsed. No wall-clock override
		// is used here, and even a historic signature cannot grant current trust.
		if status != 1 || result.Code != "PROOF_REJECTED" || result.Result != nil {
			t.Fatal("current normal verifier did not retain historical rejection", status, result.Code)
		}
	}
	t.Logf("PUBLIC offline diagnostic clock=%s invocation=%s elapsedNs=%d normalExit=%d code=%s onlineFinalityQualified=false originalUNKNOWNunchanged=true", clockMode, index, elapsed.Nanoseconds(), status, result.Code)
}
