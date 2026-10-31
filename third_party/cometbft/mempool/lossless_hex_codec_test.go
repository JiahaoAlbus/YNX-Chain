package mempool

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sync"
	"testing"
	"time"
)

// These exact C bytes bind the existing EncodePQTransaction layout from
// internal/consensus/account_policy.go; no new wire validator is substituted.
// The application owner additionally tests its real encoder through this codec.
func originalCForLosslessTest(kind string, wire []byte) []byte {
	return []byte(`{"version":1,"type":"` + kind + `","wireHex":"` + hex.EncodeToString(wire) + `"}`)
}

func losslessTestCodec(t *testing.T, max int) *LosslessHexCodec {
	t.Helper()
	c, err := NewLosslessHexCodec(max, LosslessHexLimits{})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func losslessTestFrame(t *testing.T, c *LosslessHexCodec, original []byte) []byte {
	t.Helper()
	frame, eligible, err := c.Pack(original)
	if err != nil || !eligible || frame == nil {
		t.Fatalf("pack original: eligible=%v error=%v", eligible, err)
	}
	return frame
}

func TestLosslessHexSixOriginalCKindsAndOwnedRoundTrip(t *testing.T) {
	c := losslessTestCodec(t, 2<<20)
	wire := make([]byte, 2*losslessHexChunkBytes+129)
	for i := range wire {
		wire[i] = byte(i * 73)
	}
	for _, tc := range []struct {
		kind string
		id   byte
	}{
		{"pq_transfer", 1}, {"account_migration", 2}, {"account_revocation", 3},
		{"pq_whole", 4}, {"pq_ethereum_value", 5}, {"account_initial", 6},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			original := originalCForLosslessTest(tc.kind, wire)
			pristine := bytes.Clone(original)
			frame := losslessTestFrame(t, c, original)
			if !bytes.Equal(original, pristine) {
				t.Fatal("Pack modified the original transaction")
			}
			if len(frame) != 48+len(wire) || string(frame[:4]) != "YNXP" || frame[4] != 1 || frame[5] != 1 || frame[6] != tc.id || frame[7] != 0 {
				t.Fatalf("unexpected fixed frame header: %x", frame[:16])
			}
			if int(binary.BigEndian.Uint32(frame[8:12])) != len(original) || int(binary.BigEndian.Uint32(frame[12:16])) != len(wire) || !bytes.Equal(frame[48:], wire) {
				t.Fatal("header lengths or raw bytes changed")
			}
			sum := sha256.Sum256(original)
			if !bytes.Equal(frame[16:48], sum[:]) {
				t.Fatal("frame integrity covers something other than the original C bytes")
			}
			restored, err := c.Restore(frame)
			if err != nil || !bytes.Equal(restored, original) {
				t.Fatalf("exact original C round trip failed: %v", err)
			}
			if uint64(len(restored)) > 2*uint64(len(frame)) {
				t.Fatal("restored/frame ratio exceeded two")
			}
			// Each operation owns its result. Mutation of an input or an earlier
			// returned buffer cannot alter a later restored transaction.
			original[0] ^= 1
			if !bytes.Equal(restored, pristine) {
				t.Fatal("Restore returned an alias of Pack input")
			}
			restored[0] ^= 1
			again, err := c.Restore(frame)
			if err != nil || !bytes.Equal(again, pristine) {
				t.Fatal("Restore reused caller-owned mutable output")
			}
			frame[len(frame)-1] ^= 1
			if !bytes.Equal(again, pristine) {
				t.Fatal("Restore output aliases the frame")
			}
		})
	}
}

func TestLosslessHexGoldenCFrame(t *testing.T) {
	original := []byte(`{"version":1,"type":"pq_transfer","wireHex":"0001feff"}`)
	c := losslessTestCodec(t, 1024)
	frame := losslessTestFrame(t, c, original)
	// Digest obtained independently with shasum -a 256 on the literal C bytes.
	digest, err := hex.DecodeString("4b662122bb99e798499ee619df958635d2cbad0d278ae4c4c988a26e81497db2")
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte{'Y', 'N', 'X', 'P', 1, 1, 1, 0, 0, 0, 0, byte(len(original)), 0, 0, 0, 4}, digest...)
	want = append(want, 0, 1, 254, 255)
	if !bytes.Equal(frame, want) {
		t.Fatalf("frame vector mismatch:\n got %x\nwant %x", frame, want)
	}
	restored, err := c.Restore(want)
	if err != nil || !bytes.Equal(restored, original) {
		t.Fatalf("golden restore failed: %v", err)
	}
}

func TestLosslessHexLegacyShapesRemainUnchangedAndUnsent(t *testing.T) {
	c := losslessTestCodec(t, 4096)
	for _, input := range []string{
		"", "legacy-native-transaction", `{}`, `{"type":"pq_transfer","version":1,"wireHex":"00"}`,
		` {"version":1,"type":"pq_transfer","wireHex":"00"}`,
		`{"version":1,"type":"pq_transfer","wireHex":"00"} `,
		`{"version":2,"type":"pq_transfer","wireHex":"00"}`,
		`{"version":1.0,"type":"pq_transfer","wireHex":"00"}`,
		`{"version":1,"type":"unknown","wireHex":"00"}`,
		`{"version":1,"type":"pq_transfer","wire":"00"}`,
		`{"version":1,"type":"pq_transfer","wireHex":"00","other":1}`,
		`{"version":1,"type":"pq_transfer","wireHex":"00","wireHex":"00"}`,
		`{"version":1,"type":"pq_transfer","wireHex":"\u0030\u0030"}`,
		`{"version":1,"type":"pq_transfer","wireHex":"00"}{"version":1}`,
	} {
		t.Run(input, func(t *testing.T) {
			original := []byte(input)
			copyBefore := bytes.Clone(original)
			frame, eligible, err := c.Pack(original)
			if err != nil || eligible || frame != nil || !bytes.Equal(original, copyBefore) {
				t.Fatalf("legacy input was rewritten: eligible=%v error=%v", eligible, err)
			}
		})
	}
}

func TestLosslessHexRejectsNoncanonicalHexBeforePacking(t *testing.T) {
	c := losslessTestCodec(t, 4096)
	for _, wire := range []string{"", "0", "000", "AA", "0A", "aF", "gg", "0 ", "\x00a", "é", "００"} {
		original := []byte(`{"version":1,"type":"pq_transfer","wireHex":"` + wire + `"}`)
		frame, eligible, err := c.Pack(original)
		if !errors.Is(err, ErrLosslessHexFormat) || eligible || frame != nil {
			t.Fatalf("noncanonical wire %q accepted: eligible=%v error=%v", wire, eligible, err)
		}
	}
}

func TestLosslessHexRejectsMalformedFramesBeforeRestore(t *testing.T) {
	c := losslessTestCodec(t, 4096)
	valid := losslessTestFrame(t, c, originalCForLosslessTest("pq_transfer", bytes.Repeat([]byte{0xab}, 64)))
	mutate := func(fn func([]byte)) []byte { out := bytes.Clone(valid); fn(out); return out }
	for _, tc := range []struct {
		name  string
		frame []byte
	}{
		{"empty", nil}, {"short-header", valid[:47]}, {"header-only", valid[:48]},
		{"magic", mutate(func(f []byte) { f[0] ^= 1 })},
		{"unknown-version", mutate(func(f []byte) { f[4] = 2 })},
		{"unknown-codec", mutate(func(f []byte) { f[5] = 2 })},
		{"zero-kind", mutate(func(f []byte) { f[6] = 0 })},
		{"unknown-kind", mutate(func(f []byte) { f[6] = 7 })},
		{"reserved", mutate(func(f []byte) { f[7] = 1 })},
		{"zero-original", mutate(func(f []byte) { binary.BigEndian.PutUint32(f[8:12], 0) })},
		{"overflow-original", mutate(func(f []byte) { binary.BigEndian.PutUint32(f[8:12], math.MaxUint32) })},
		{"mismatched-original", mutate(func(f []byte) { f[11]-- })},
		{"zero-raw", mutate(func(f []byte) { binary.BigEndian.PutUint32(f[12:16], 0) })},
		{"overflow-raw", mutate(func(f []byte) { binary.BigEndian.PutUint32(f[12:16], math.MaxUint32) })},
		{"mismatched-raw", mutate(func(f []byte) { f[15]-- })},
		{"truncated-raw", valid[:len(valid)-1]}, {"trailing-byte", append(bytes.Clone(valid), 0)},
		{"two-objects", append(bytes.Clone(valid), valid...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out, err := c.Restore(tc.frame)
			if err == nil || out != nil {
				t.Fatal("malformed frame produced an original transaction")
			}
		})
	}
}

func TestLosslessHexIntegrityIsOverOriginalBytes(t *testing.T) {
	c := losslessTestCodec(t, 4096)
	original := originalCForLosslessTest("account_migration", []byte{0, 1, 2, 3, 255})
	valid := losslessTestFrame(t, c, original)
	for _, index := range []int{16, 31, 47, 48, len(valid) - 1} {
		frame := bytes.Clone(valid)
		frame[index] ^= 1
		out, err := c.Restore(frame)
		if !errors.Is(err, ErrLosslessHexIntegrity) || out != nil {
			t.Fatalf("tamper at %d was not rejected: %v", index, err)
		}
	}
	// Changing to a same-length kind preserves all length checks but changes C.
	frame := bytes.Clone(valid)
	frame[6] = 5 // pq_ethereum_value and account_migration have the same length
	if out, err := c.Restore(frame); !errors.Is(err, ErrLosslessHexIntegrity) || out != nil {
		t.Fatalf("kind substitution escaped original-byte hash: %v", err)
	}
	frame = bytes.Clone(valid)
	rawDigest := sha256.Sum256(frame[48:])
	copy(frame[16:48], rawDigest[:])
	if out, err := c.Restore(frame); !errors.Is(err, ErrLosslessHexIntegrity) || out != nil {
		t.Fatalf("raw-only hash was accepted as original hash: %v", err)
	}
}

func TestLosslessHexLimitsAndConstructorBounds(t *testing.T) {
	for _, tc := range []struct {
		max    int
		limits LosslessHexLimits
	}{
		{0, LosslessHexLimits{}}, {-1, LosslessHexLimits{}}, {65 << 20, LosslessHexLimits{}},
		{1024, LosslessHexLimits{MaxFrameBytes: -1}}, {1024, LosslessHexLimits{MaxFrameBytes: 48}},
		{1024, LosslessHexLimits{MaxFrameBytes: 1024}},
		{1024, LosslessHexLimits{MaxWork: -1}}, {1024, LosslessHexLimits{MaxWork: time.Millisecond - 1}},
		{1024, LosslessHexLimits{MaxWork: time.Second + 1}},
	} {
		if c, err := NewLosslessHexCodec(tc.max, tc.limits); !errors.Is(err, ErrLosslessHexLimit) || c != nil {
			t.Fatalf("bad configuration accepted: max=%d limits=%+v error=%v", tc.max, tc.limits, err)
		}
	}
	c := losslessTestCodec(t, 64<<20)
	if c.MaxOriginalBytes() != 64<<20 || c.MaxFrameBytes() != (64<<20)/2+48 || c.maxWork != 100*time.Millisecond {
		t.Fatal("default bounds differ from the receive-capacity contract")
	}
	for _, work := range []time.Duration{time.Millisecond, time.Second} {
		if _, err := NewLosslessHexCodec(1024, LosslessHexLimits{MaxWork: work}); err != nil {
			t.Fatalf("inclusive work limit rejected: %v", err)
		}
	}
	original := originalCForLosslessTest("pq_whole", bytes.Repeat([]byte{0}, 64))
	full := losslessTestCodec(t, len(original))
	frame := losslessTestFrame(t, full, original)
	if out, err := full.Restore(frame); err != nil || !bytes.Equal(out, original) {
		t.Fatalf("exact original-byte limit rejected: %v", err)
	}
	small := losslessTestCodec(t, len(original)-1)
	if f, eligible, err := small.Pack(original); !errors.Is(err, ErrLosslessHexLimit) || f != nil || eligible {
		t.Fatal("Pack exceeded original-byte cap")
	}
	if out, err := small.Restore(frame); err == nil || out != nil {
		t.Fatal("Restore exceeded original-byte cap")
	}
	frameSmall, err := NewLosslessHexCodec(4096, LosslessHexLimits{MaxFrameBytes: len(frame) - 1})
	if err != nil {
		t.Fatal(err)
	}
	if f, eligible, err := frameSmall.Pack(original); !errors.Is(err, ErrLosslessHexLimit) || eligible || f != nil {
		t.Fatal("Pack exceeded frame-byte cap")
	}
	if out, err := frameSmall.Restore(frame); !errors.Is(err, ErrLosslessHexLimit) || out != nil {
		t.Fatal("Restore exceeded frame-byte cap")
	}
	for _, invalid := range []*LosslessHexCodec{nil, {}} {
		if f, eligible, err := invalid.Pack(original); err == nil || f != nil || eligible {
			t.Fatal("uninitialized Pack accepted")
		}
		if out, err := invalid.Restore(frame); err == nil || out != nil {
			t.Fatal("uninitialized Restore accepted")
		}
	}
}

func TestLosslessHexDeterministicDeadlineAtEveryWorkCheckpoint(t *testing.T) {
	original := originalCForLosslessTest("pq_transfer", bytes.Repeat([]byte{0x7f}, 4*losslessHexChunkBytes))
	base := time.Unix(1_000_000, 0)
	c := losslessTestCodec(t, 2<<20)
	c.maxWork = time.Millisecond
	calls := 0
	c.now = func() time.Time { calls++; return base }
	frame := losslessTestFrame(t, c, original)
	packCalls := calls
	calls = 0
	if _, err := c.Restore(frame); err != nil {
		t.Fatal(err)
	}
	restoreCalls := calls
	for _, tc := range []struct {
		name   string
		checks int
		pack   bool
	}{{"Pack", packCalls, true}, {"Restore", restoreCalls, false}} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.checks < 8 {
				t.Fatalf("large object did not exercise chunked deadline checks: %d", tc.checks)
			}
			for expireAt := 2; expireAt <= tc.checks; expireAt++ {
				calls = 0
				c.now = func() time.Time {
					calls++
					if calls >= expireAt {
						return base.Add(c.maxWork)
					}
					return base
				}
				if tc.pack {
					f, eligible, err := c.Pack(original)
					if !errors.Is(err, ErrLosslessHexWork) || eligible || f != nil {
						t.Fatalf("deadline checkpoint %d returned output: %v", expireAt, err)
					}
				} else {
					out, err := c.Restore(frame)
					if !errors.Is(err, ErrLosslessHexWork) || out != nil {
						t.Fatalf("deadline checkpoint %d returned original bytes: %v", expireAt, err)
					}
				}
			}
		})
	}
}

func TestLosslessHexConcurrentOperationsDoNotShareBuffers(t *testing.T) {
	c := losslessTestCodec(t, 1<<20)
	var wg sync.WaitGroup
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			original := originalCForLosslessTest("account_initial", bytes.Repeat([]byte{byte(n)}, 8193+n))
			frame, eligible, err := c.Pack(original)
			if err != nil || !eligible {
				t.Errorf("concurrent pack: %v", err)
				return
			}
			out, err := c.Restore(frame)
			if err != nil || !bytes.Equal(out, original) {
				t.Errorf("concurrent restore differs: %v", err)
			}
		}(n)
	}
	wg.Wait()
}

func FuzzLosslessHexOriginalRoundTrip(f *testing.F) {
	f.Add([]byte(`{"version":1,"type":"pq_transfer","wireHex":"0001feff"}`))
	f.Add([]byte(`{"version":1,"type":"account_initial","wireHex":"AA"}`))
	f.Add([]byte("legacy"))
	c, err := NewLosslessHexCodec(1<<20, LosslessHexLimits{})
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, original []byte) {
		frame, eligible, err := c.Pack(original)
		if err != nil || !eligible {
			if frame != nil {
				t.Fatal("ineligible/error result exposed a frame")
			}
			return
		}
		out, err := c.Restore(frame)
		if err != nil || !bytes.Equal(out, original) {
			t.Fatalf("eligible input failed exact-byte round trip: %v", err)
		}
		var object struct {
			Version int    `json:"version"`
			Type    string `json:"type"`
			WireHex string `json:"wireHex"`
		}
		if err := json.Unmarshal(out, &object); err != nil || object.Version != 1 {
			t.Fatalf("restored original is not version-one JSON: %v", err)
		}
		wire, err := hex.DecodeString(object.WireHex)
		if err != nil || !bytes.Equal(out, originalCForLosslessTest(object.Type, wire)) {
			t.Fatal("restored original did not preserve the canonical C template")
		}
	})
}
