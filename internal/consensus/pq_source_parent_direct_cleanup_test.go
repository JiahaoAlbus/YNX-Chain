//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"testing"
	"time"
)

// A real successful OPEN must not need a subsequent failed READ to remember
// Source retirement. Cleanup success and the original failure remain distinct.
func TestPQSourceParentPUBLICDirectCleanupRetainsFirstCause(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	for _, mode := range []string{"cancel-present-code-zero", "source-deadline"} {
		t.Run(mode, func(t *testing.T) {
			process, cancel := context.WithCancel(context.Background())
			defer cancel()
			p := publicSealedSourceClock(t, process, sourceParentSelection{generation: 1, deadlineMs: uint64(time.Now().Add(30 * time.Second).UnixMilli())})
			w, conn := accountWireAttach(t, f, f.expected.Owner, p)
			opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
			if opened.failure {
				t.Fatal("actual OPEN failed")
			}
			var cause error = sourceParentFailure{present: true, code: 0, reason: 1}
			ctxErr := context.Canceled
			if mode == "source-deadline" {
				cause, ctxErr = context.DeadlineExceeded, context.DeadlineExceeded
			}
			p.cancel(ctxErr, cause)
			for i, op := range []uint32{pqAccountWireRetire, pqAccountWireJoin} {
				r, _ := accountWireExchange(t, conn, op, uint64(i+2), opened.reader)
				if !r.failure || r.code != 0 || r.reader != opened.reader {
					t.Errorf("Source failure disappeared from direct cleanup: mode=%s op=%d failure=%v code=%d", mode, op, r.failure, r.code)
				}
			}
			closed, _ := accountWireExchange(t, conn, pqAccountWireClose, 4, opened.reader)
			if closed.status != pqAccountWireClosed || !closed.failure || closed.code != 0 || closed.reader != opened.reader || !accountWireHandler(t, w).IsClosed() {
				t.Error("Source failure disappeared from direct cleanup CLOSED; physical closure must not erase its first cause")
			}
			if !errors.Is(w.cause(), cause) {
				t.Errorf("original Source first cause not preserved: %v", w.cause())
			}
			_ = conn.Close()
			accountWireWait(t, w)
		})
	}
	t.Run("source-cancel-during-output", func(t *testing.T) {
		process, cancel := context.WithCancel(context.Background())
		defer cancel()
		p := publicSealedSourceClock(t, process, sourceParentSelection{generation: 1, deadlineMs: uint64(time.Now().Add(30 * time.Second).UnixMilli())})
		w, conn := accountWireAttach(t, f, f.expected.Owner, p)
		opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
		if opened.failure {
			t.Fatal("actual OPEN failed")
		}
		f.advance(t, 11)
		if err := w.conn.SetWriteBuffer(1024); err != nil {
			t.Fatal(err)
		}
		if err := writePQAccountWire(conn, accountWireRequest(pqAccountWireRead, 2, opened.reader)); err != nil {
			t.Fatal(err)
		}
		// The actual proof was produced. Leave its large payload unread so the
		// original worker is sending when the Source retires and its peer leaves.
		var header [97]byte
		if _, err := io.ReadFull(conn, header[:]); err != nil {
			t.Fatal(err)
		}
		if binary.BigEndian.Uint32(header[41:45]) != pqAccountWireOK || binary.BigEndian.Uint32(header[85:89]) != 0 || binary.BigEndian.Uint32(header[93:97]) < 64<<10 {
			t.Fatal("actual large original account proof absent")
		}
		cause := sourceParentFailure{present: true, code: 0, reason: 1}
		p.cancel(context.Canceled, cause)
		_ = conn.Close()
		accountWireWait(t, w)
		if !errors.Is(w.cause(), cause) || !accountWireHandler(t, w).IsClosed() {
			t.Fatal("secondary output failure replaced original Source failure or retained debt", w.cause())
		}
	})
}
