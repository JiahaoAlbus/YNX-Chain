//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

type proofCurrentCountReader struct {
	r        io.Reader
	bytes    int64
	calls    int
	maxChunk int
}

func (r *proofCurrentCountReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	r.bytes += int64(n)
	r.calls++
	if n > r.maxChunk {
		r.maxChunk = n
	}
	return n, err
}

type proofCurrentFailReader struct{}

func (proofCurrentFailReader) Read([]byte) (int, error) { return 0, errors.New("PUBLIC read refusal") }

func TestProofHostOriginalCurrentSingleFDStreamAndFixedDigest(t *testing.T) {
	path, raw := publicHeldCurrentFile(t, 65537)
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	digest := sha256.Sum256(raw)
	for _, mode := range []string{"exact", "different-raw", "short-raw", "long-raw", "short-stream", "different-stream", "zero-digest", "other-digest", "read-error"} {
		t.Run(mode, func(t *testing.T) {
			retained := bytes.Clone(raw)
			expected := digest
			var input io.Reader = io.NewSectionReader(f, 0, int64(len(raw)))
			switch mode {
			case "different-raw":
				retained[32768] ^= 1
			case "short-raw":
				retained = retained[:len(retained)-1]
			case "long-raw":
				retained = append(retained, 'x')
			case "short-stream":
				input = io.NewSectionReader(f, 0, int64(len(raw)-1))
			case "different-stream":
				changed := bytes.Clone(raw)
				changed[len(changed)-1] ^= 1
				input = bytes.NewReader(changed)
			case "zero-digest":
				expected = [32]byte{}
			case "other-digest":
				expected[0] ^= 1
			case "read-error":
				input = proofCurrentFailReader{}
			}
			counted := &proofCurrentCountReader{r: input}
			n, e := proofHostCompareCurrentBytes(counted, retained, expected)
			if mode == "exact" {
				if e != nil || n != int64(len(raw)) || counted.bytes != int64(len(raw)) || counted.calls != 4 || counted.maxChunk != 32768 {
					t.Fatal("normal current did not process exactly one complete bounded FD stream", n, counted.bytes, counted.calls, counted.maxChunk, e)
				}
				return
			}
			if e == nil {
				t.Fatal("raw alias, FD contents, fixed original digest or read failure was ignored")
			}
		})
	}
}

func publicHeldCurrentFile(t *testing.T, size int) (string, []byte) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	raw := bytes.Repeat([]byte("PUBLIC-CURRENT-BYTES-ONLY\n"), size/24+1)[:size]
	path := filepath.Join(root, "original.public")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return path, raw
}

func TestProofHostOriginalCurrentAliasedBytesAndLifecycle(t *testing.T) {
	const size = 65537
	for _, mode := range []string{"raw-first", "raw-chunk-edge", "raw-last", "raw-short", "raw-long", "captured-alias", "closed-fd"} {
		t.Run(mode, func(t *testing.T) {
			path, raw := publicHeldCurrentFile(t, size)
			held, err := readProofHostOriginal(path, proofHostSHA(raw), size)
			if err != nil {
				t.Fatal(err)
			}
			defer held.file.Close()
			if err = held.unchanged(); err != nil {
				t.Fatal("untouched complete bytes refused", err)
			}
			switch mode {
			case "raw-first", "raw-chunk-edge", "raw-last":
				index := 0
				if mode == "raw-chunk-edge" {
					index = 32768
				} else if mode == "raw-last" {
					index = len(held.raw) - 1
				}
				alias := held.raw
				alias[index] ^= 1
				if held.unchanged() == nil {
					t.Fatal("mutable raw alias escaped actual byte comparison")
				}
				alias[index] ^= 1
				if err = held.unchanged(); err != nil {
					t.Fatal("original bytes restored in memory differ", err)
				}
				return
			case "raw-short":
				held.raw = held.raw[:len(held.raw)-1]
			case "raw-long":
				held.raw = append(held.raw, 'x')
			case "captured-alias":
				captured, e := capturePQEngineState(path)
				if e != nil {
					t.Fatal(e)
				}
				other, e := holdProofHostCapturedState(captured)
				if e != nil {
					t.Fatal(e)
				}
				defer other.file.Close()
				captured.data[len(captured.data)-1] ^= 1
				if other.unchanged() == nil {
					t.Fatal("captured state alias was treated as immutable")
				}
				return
			case "closed-fd":
				if err = held.file.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if held.unchanged() == nil {
				t.Fatal("changed original or closed FD accepted")
			}
		})
	}
}

// Fixed eight read-only calls over 4 MiB PUBLIC repeated text. This is a bounded
// micro observation, not a sustained load or a whole-protocol performance claim.
// Setup/admission is outside the interval; no keys, ledger or Node is created.
func TestProofHostOriginalCurrentMicroEvidence(t *testing.T) {
	const size, calls = 4 << 20, 8
	path, raw := publicHeldCurrentFile(t, size)
	held, err := readProofHostOriginal(path, proofHostSHA(raw), size)
	if err != nil {
		t.Fatal(err)
	}
	defer held.file.Close()
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	started := time.Now()
	completed := 0
	for ; completed < calls; completed++ {
		if err = held.unchanged(); err != nil {
			t.Fatal("actual held FD current failed", err)
		}
	}
	elapsed := time.Since(started).Nanoseconds()
	runtime.ReadMemStats(&after)
	record := struct {
		Schema           string `json:"schema"`
		FileBytes        int    `json:"fileBytes"`
		CompletedCalls   int    `json:"completedCalls"`
		ElapsedNS        int64  `json:"elapsedNs"`
		TotalAllocBytes  uint64 `json:"totalAllocBytes"`
		Mallocs          uint64 `json:"mallocs"`
		HeapAllocBefore  uint64 `json:"heapAllocBefore"`
		HeapAllocAfter   uint64 `json:"heapAllocAfter"`
		DenominatorBytes int    `json:"denominatorBytes"`
	}{"YNX-HELD-ORIGINAL-CURRENT-MICRO/v1", size, completed, elapsed, after.TotalAlloc - before.TotalAlloc, after.Mallocs - before.Mallocs, before.HeapAlloc, after.HeapAlloc, completed * size}
	out, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	t.Log(string(out))
}
