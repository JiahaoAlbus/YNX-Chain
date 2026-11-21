package consensus

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"
)

// This is the exact original byte-capture expression, not another decoder or
// validation provider. All authority and source-identity checks remain normal.
func beforePQStateCapture(source io.Reader, size int64) ([]byte, error) {
	return io.ReadAll(io.LimitReader(source, size+1))
}

type pqCaptureChunkReader struct {
	data     []byte
	chunk    int
	terminal error
	empty    bool
}

func (r *pqCaptureChunkReader) Read(p []byte) (int, error) {
	if r.empty {
		r.empty = false
		return 0, nil
	}
	if len(r.data) == 0 {
		return 0, r.terminal
	}
	if len(p) > r.chunk {
		p = p[:r.chunk]
	}
	n := copy(p, r.data)
	r.data = r.data[n:]
	if len(r.data) == 0 {
		return n, r.terminal
	}
	return n, nil
}

func TestPQStateCapturePreservesOriginalBytesAndIOErrors(t *testing.T) {
	failure := errors.New("original synthetic read failure")
	for _, length := range []int{0, 1, 511, 512, 513, 4096} {
		for _, size := range []int64{0, 1, 511, 512, 513, 4096, 4097} {
			for _, chunk := range []int{1, 17, 8192} {
				for _, terminal := range []error{io.EOF, failure} {
					factory := func() *pqCaptureChunkReader {
						return &pqCaptureChunkReader{data: bytes.Repeat([]byte{0xa7}, length), chunk: chunk, terminal: terminal, empty: true}
					}
					beforeReader, afterReader := factory(), factory()
					before, beforeErr := beforePQStateCapture(beforeReader, size)
					after, afterErr := readPQEngineStateBytes(afterReader, size)
					if !bytes.Equal(before, after) || beforeErr != afterErr || len(beforeReader.data) != len(afterReader.data) {
						t.Fatalf("capture changed bytes/error/consumption length=%d size=%d chunk=%d terminal=%v: %d/%v -> %d/%v", length, size, chunk, terminal, len(before), beforeErr, len(after), afterErr)
					}
				}
			}
		}
	}
}

func TestPQStateCaptureKnownSizeDoesNotReadPastGrowthSentinel(t *testing.T) {
	for _, size := range []int64{0, 1, 4096} {
		r := bytes.NewReader(bytes.Repeat([]byte("x"), int(size)+100))
		got, err := readPQEngineStateBytes(r, size)
		if err != nil || int64(len(got)) != size+1 || r.Len() != 99 {
			t.Fatal("known-size read lost its original growth sentinel or consumed later bytes", size, len(got), r.Len(), err)
		}
	}
	for _, size := range []int64{-1} {
		r := bytes.NewReader([]byte("preserve"))
		if got, err := readPQEngineStateBytes(r, size); err == nil || got != nil || r.Len() != 8 {
			t.Fatal("impossible allocation size was read or accepted", size, err)
		}
	}
	// The large-file path preserves the original read and error ordering even
	// at 32-bit MaxInt and at the int64 addition boundary.
	for _, size := range []int64{math.MaxInt32, math.MaxInt64 - 1, math.MaxInt64} {
		for _, terminal := range []error{io.EOF, errors.New("synthetic original I/O error")} {
			beforeReader := &pqCaptureChunkReader{data: []byte("preserve"), chunk: 2, terminal: terminal}
			afterReader := &pqCaptureChunkReader{data: []byte("preserve"), chunk: 2, terminal: terminal}
			before, beforeErr := beforePQStateCapture(beforeReader, size)
			after, afterErr := readPQEngineStateBytes(afterReader, size)
			if !bytes.Equal(before, after) || beforeErr != afterErr || len(beforeReader.data) != len(afterReader.data) {
				t.Fatalf("large boundary changed original bytes/error/consumption size=%d: %q/%v -> %q/%v", size, before, beforeErr, after, afterErr)
			}
		}
	}
}

func TestPQStateCaptureLargeRejectedReadKeepsOriginalAllocationBound(t *testing.T) {
	for _, size := range []int64{8 << 20, 64 << 20, math.MaxInt64 - 1} {
		for _, terminal := range []error{io.EOF, errors.New("original immediate read error")} {
			t.Run(fmt.Sprintf("%d/%v", size, terminal), func(t *testing.T) {
				before, beforeErr := beforePQStateCapture(&pqCaptureChunkReader{terminal: terminal}, size)
				after, afterErr := readPQEngineStateBytes(&pqCaptureChunkReader{terminal: terminal}, size)
				if !bytes.Equal(before, after) || beforeErr != afterErr || cap(after) > cap(before) {
					t.Fatalf("large stale size changed immediate rejection cost: cap %d -> %d, error %v -> %v", cap(before), cap(after), beforeErr, afterErr)
				}
			})
		}
	}
	// Actual original descriptor with a previously large stat and a subsequent
	// truncate: do not materialize the missing old length before observing EOF.
	f, err := os.CreateTemp(t.TempDir(), "synthetic-original")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := f.Truncate(64 << 20); err != nil {
		t.Fatal(err)
	}
	before, err := f.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(0); err != nil {
		t.Fatal(err)
	}
	raw, err := readPQEngineStateBytes(f, before.Size())
	if err != nil || len(raw) != 0 || cap(raw) > 512 {
		t.Fatal("stale original FD allocated its old size", cap(raw), err)
	}
	// The threshold is only an optimization: complete larger inputs are still
	// read in full through the original size+1 expression, never rejected/truncated.
	large := bytes.Repeat([]byte("z"), (8<<20)+1)
	raw, err = readPQEngineStateBytes(bytes.NewReader(large), int64(len(large)))
	if err != nil || !bytes.Equal(raw, large) {
		t.Fatal("allocation threshold changed source acceptance", err)
	}
}

func TestPQStateCaptureOriginalAtomicFileAndAuthority(t *testing.T) {
	fixture := newPQReadFixture(t, "atomic-json")
	original, err := os.ReadFile(fixture.path)
	if err != nil {
		t.Fatal(err)
	}
	// JSON whitespace is public synthetic padding. It exercises the actual
	// known-size file, strict decoder and complete pinned authority path; it
	// is not a captured production state or a throughput measurement.
	padded := append(append([]byte(nil), original...), bytes.Repeat([]byte(" \n"), 1<<19)...)
	if err := os.WriteFile(fixture.path, padded, 0600); err != nil {
		t.Fatal(err)
	}
	unchanged := preservePQEngineCheckpoint(t, fixture.path)
	capture, err := capturePQEngineState(fixture.path)
	if err != nil || capture.layout != "atomic-json" || !bytes.Equal(capture.data, padded) {
		t.Fatal("original capture mismatch", err)
	}
	before, err := beforePQStateCapture(bytes.NewReader(padded), int64(len(padded)))
	if err != nil || !bytes.Equal(before, capture.data) {
		t.Fatal("original byte oracle mismatch", err)
	}
	witness := fixture.app.validatedMigration
	want, err := readPQEngineCommittedStateOwned(fixture.path, witness, fixture.auth, nil, func(string) (*pqEngineStateRead, error) {
		old := *capture
		old.data = before
		return &old, nil
	})
	if err != nil {
		t.Fatal("original state oracle rejected input", err)
	}
	got, err := readPQEngineCommittedStateOwned(fixture.path, witness, fixture.auth, nil, capturePQEngineState)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatal("actual full state authority changed", err)
	}
	unchanged()
	// Exact bytes stay invalid: neither a matching file identity nor previous
	// valid authority repairs an unknown field, trailing value or wrong ledger.
	for name, raw := range map[string][]byte{
		"unknown-field":  append([]byte(`{"notAStateField":true,`), original[1:]...),
		"trailing-value": append(append([]byte(nil), original...), []byte(` {}`)...),
		"missing-ledger": []byte(`{}`),
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(fixture.path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			preserve := preservePQEngineCheckpoint(t, fixture.path)
			_, actualErr := readPQEngineCommittedStateOwned(fixture.path, witness, fixture.auth, nil, capturePQEngineState)
			_, originalErr := readPQEngineCommittedStateOwned(fixture.path, witness, fixture.auth, nil, func(path string) (*pqEngineStateRead, error) {
				originalCapture, err := capturePQEngineState(path)
				if err != nil {
					return nil, err
				}
				originalCapture.data, err = beforePQStateCapture(bytes.NewReader(raw), int64(len(raw)))
				return originalCapture, err
			})
			if actualErr == nil || originalErr == nil || actualErr.Error() != originalErr.Error() {
				t.Fatal("original rejection/first cause changed", originalErr, actualErr)
			}
			preserve()
		})
	}
}

func TestPQStateCaptureRemovesRepeatedBufferGrowth(t *testing.T) {
	payload := bytes.Repeat([]byte("public-synthetic-state-bytes"), 1<<16)
	var retained []byte
	oldAllocs := testing.AllocsPerRun(3, func() { retained, _ = beforePQStateCapture(bytes.NewReader(payload), int64(len(payload))) })
	newAllocs := testing.AllocsPerRun(3, func() { retained, _ = readPQEngineStateBytes(bytes.NewReader(payload), int64(len(payload))) })
	if !bytes.Equal(retained, payload) || newAllocs >= oldAllocs || newAllocs > 2 {
		t.Fatal("known-size capture regained repeated growth", oldAllocs, newAllocs)
	}
	t.Logf("synthetic same bytes=%d capture allocations original=%.0f exact-size=%.0f; not end-to-end verifier/RSS/TPS", len(payload), oldAllocs, newAllocs)
}

func BenchmarkPQStateCaptureSameInput(b *testing.B) {
	for _, size := range []int{64 << 10, 2 << 20, 3213766, 3449204, 8 << 20} {
		input := []byte(strings.Repeat("x", size))
		for _, version := range []string{"original", "exact-size"} {
			b.Run(fmt.Sprintf("%d/%s", size, version), func(b *testing.B) {
				read := beforePQStateCapture
				if version == "exact-size" {
					read = readPQEngineStateBytes
				}
				b.ReportAllocs()
				b.SetBytes(int64(len(input)))
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					got, err := read(bytes.NewReader(input), int64(len(input)))
					if err != nil || len(got) != len(input) || got[len(got)-1] != 'x' {
						b.Fatal("same input changed", err)
					}
				}
			})
		}
	}
}
