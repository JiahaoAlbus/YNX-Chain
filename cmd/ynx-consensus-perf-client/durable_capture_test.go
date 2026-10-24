package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"runtime"
	"testing"
	"time"
)

type captureReadFunc func([]byte) (int, error)

func (f captureReadFunc) Read(p []byte) (int, error) { return f(p) }

func TestNativeStreamingMeasuredCaptureRejectsChangedLengthErrorsAndCancellation(t *testing.T) {
	payload := bytes.Repeat([]byte("signed-input"), 7000)
	for _, n := range []int{0, 1, 32768, 32769, len(payload)} {
		got, err := captureMeasuredDurableInput(context.Background(), bytes.NewReader(payload[:n]), int64(n), int64(len(payload)))
		if err != nil || !bytes.Equal(got, payload[:n]) || cap(got) != n {
			t.Fatalf("capture length %d: %v", n, err)
		}
	}
	for _, change := range []int{-1, 1} {
		if _, err := captureMeasuredDurableInput(context.Background(), bytes.NewReader(payload), int64(len(payload)+change), int64(len(payload)+1)); err == nil {
			t.Fatal("changed length accepted", change)
		}
	}
	calls := 0
	reader := captureReadFunc(func(p []byte) (int, error) { calls++; return 0, io.EOF })
	for _, scope := range [][2]int64{{-1, 10}, {11, 10}, {0, -1}, {0, (512 << 20) + 1}} {
		if _, err := captureMeasuredDurableInput(context.Background(), reader, scope[0], scope[1]); err == nil || calls != 0 {
			t.Fatal("invalid bound allocated/read")
		}
	}
	sentinel := errors.New("read failed")
	if _, err := captureMeasuredDurableInput(context.Background(), captureReadFunc(func([]byte) (int, error) { return 0, sentinel }), 1, 1); !errors.Is(err, sentinel) {
		t.Fatal("read cause lost", err)
	}
	if _, err := captureMeasuredDurableInput(context.Background(), captureReadFunc(func([]byte) (int, error) { return 0, nil }), 1, 1); !errors.Is(err, io.ErrNoProgress) {
		t.Fatal("empty read spun/accepted", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := captureMeasuredDurableInput(ctx, reader, 1, 1); !errors.Is(err, context.Canceled) || calls != 0 {
		t.Fatal("cancelled capture read", err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	observed := 0
	cancelReader := captureReadFunc(func(p []byte) (int, error) { observed++; copy(p, payload); cancel(); return len(p), nil })
	if _, err := captureMeasuredDurableInput(ctx, cancelReader, int64(len(payload)), int64(len(payload))); !errors.Is(err, context.Canceled) || observed != 1 {
		t.Fatal("cancellation advanced capture", err, observed)
	}
	// The final extra-byte read is mandatory even for a zero-length capture.
	if _, err := captureMeasuredDurableInput(context.Background(), bytes.NewReader([]byte{1}), 0, 10); err == nil {
		t.Fatal("zero prefix hid later bytes")
	}
}

func TestNativeStreamingMeasuredCaptureSameSignedJournalAllocation(t *testing.T) {
	_, _, path, _, _ := durableJournalFixture(t, "block-journal")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	expected := sha256.Sum256(data)
	baseline := func() ([]byte, error) {
		return io.ReadAll(io.LimitReader(bytes.NewReader(data), durableSnapshotLimit+1))
	}
	candidate := func() ([]byte, error) {
		return captureMeasuredDurableInput(context.Background(), bytes.NewReader(data), int64(len(data)), durableSnapshotLimit)
	}
	measure := func(read func() ([]byte, error)) (uint64, uint64, int64) {
		t.Helper()
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		start := time.Now()
		for i := 0; i < 16; i++ {
			got, err := read()
			if err != nil || len(got) != len(data) || sha256.Sum256(got) != expected {
				t.Fatal("same signed journal differs", err)
			}
		}
		elapsed := time.Since(start).Nanoseconds()
		runtime.ReadMemStats(&after)
		return after.TotalAlloc - before.TotalAlloc, after.Mallocs - before.Mallocs, elapsed
	}
	a, am, ans := measure(baseline)
	b, bm, bns := measure(candidate)
	beforeAllocs := testing.AllocsPerRun(8, func() {
		if _, err := baseline(); err != nil {
			t.Fatal(err)
		}
	})
	afterAllocs := testing.AllocsPerRun(8, func() {
		if _, err := candidate(); err != nil {
			t.Fatal(err)
		}
	})
	if afterAllocs >= beforeAllocs {
		t.Fatal("capture allocation count did not decrease", beforeAllocs, afterAllocs)
	}
	t.Logf("SAME_SIGNED_JOURNAL_CAPTURE bytes=%d sha256=%x samples=16 baselineTotalAlloc=%d candidateTotalAlloc=%d baselineMallocs=%d candidateMallocs=%d baselineNs=%d candidateNs=%d baselineAllocsPerRun=%.0f candidateAllocsPerRun=%.0f networkRSSAttribution=false", len(data), expected, a, b, am, bm, ans, bns, beforeAllocs, afterAllocs)
}
