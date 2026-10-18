package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime/pprof"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const validationProfileBytes = 1 << 20

type validationProfileResult struct {
	Scope        string `json:"scope"`
	Calls        int    `json:"successfulCalls"`
	FailedCalls  int    `json:"failedCalls"`
	ElapsedNs    int64  `json:"elapsedNs"`
	ProfileBytes int64  `json:"profileBytes"`
}

type boundedCPUProfileWriter struct {
	file    *os.File
	written int64
	err     error
}

func (w *boundedCPUProfileWriter) Write(p []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	if int64(len(p)) > validationProfileBytes-w.written {
		w.err = errors.New("validation CPU profile exceeded 1MiB cap")
		return 0, w.err
	}
	n, err := w.file.Write(p)
	w.written += int64(n)
	if err == nil && n != len(p) {
		err = io.ErrShortWrite
	}
	w.err = err
	return n, err
}

// A test-only diagnostic of the complete existing validator, not a replacement
// validation path. CPU samples contain stacks, never transaction keys or heap.
func captureStateValidationCPU(ctx context.Context, path string, validate func() error) (result validationProfileResult, err error) {
	result.Scope = "full existing immutable committed-state Validate only; max32 calls and2s before next call, within parent deadline; not business throughput"
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return result, err
	}
	defer func() {
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
	}()
	writer := &boundedCPUProfileWriter{file: file}
	if err = pprof.StartCPUProfile(writer); err != nil {
		return result, err
	}
	started := time.Now()
	defer func() {
		pprof.StopCPUProfile()
		result.ElapsedNs = time.Since(started).Nanoseconds()
		result.ProfileBytes = writer.written
		if err == nil {
			err = writer.err
		}
	}()
	for result.Calls < 32 && time.Since(started) < 2*time.Second {
		if err = ctx.Err(); err != nil {
			return result, err
		}
		if err = validate(); err != nil {
			result.FailedCalls++
			return result, fmt.Errorf("original committed-state validator failed: %w", err)
		}
		result.Calls++
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	if result.Calls == 0 {
		err = errors.New("no actual state validation sampled")
	}
	return result, err
}

func TestStreamingWorkloadValidationProfilePreservesFailureAndState(t *testing.T) {
	_, migration, path, _, _ := durableReaderFixture(t)
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state consensus.CommittedState
	if err := json.Unmarshal(original, &state); err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	expected := errors.New("controlled original-validator failure")
	calls := 0
	output := t.TempDir() + "/validation.cpu.pprof"
	result, err := captureStateValidationCPU(context.Background(), output, func() error {
		calls++
		if calls == 3 {
			return expected
		}
		return state.Validate(migration)
	})
	if !errors.Is(err, expected) || result.Calls != 2 || result.FailedCalls != 1 || result.ProfileBytes <= 0 || result.ProfileBytes > validationProfileBytes {
		t.Fatal("profile masked original failure or bounds", result, err)
	}
	after, err := json.Marshal(state)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("profiling altered committed state", err)
	}
	file, err := os.Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	z, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer z.Close()
	data, err := io.ReadAll(io.LimitReader(z, validationProfileBytes+1))
	if err != nil || len(data) == 0 || len(data) > validationProfileBytes {
		t.Fatal("profile archive invalid", err)
	}
	if _, err := captureStateValidationCPU(context.Background(), output, func() error { return nil }); err == nil {
		t.Fatal("existing failure evidence overwritten")
	}
}
