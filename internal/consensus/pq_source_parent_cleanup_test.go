//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"errors"
	"testing"
	"time"
)

// New actual-App regression only. Its explicit PUBLIC selection exercises this
// private fixed Source clock and the real handler, not genuine Auth admission.
// The real C++ Source -> qualified Go receiver is independently exercised.
func TestPQAccountSourceCancelPreservesOriginalCleanupPUBLIC(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	process, processDone := context.WithCancel(context.Background())
	defer processDone()
	originalDeadline := time.UnixMilli(time.Now().Add(20 * time.Second).UnixMilli())
	originalCause := sourceParentFailure{present: true, code: 0, reason: 1}
	source := publicSealedSourceClock(t, process, sourceParentSelection{generation: 1, deadlineMs: uint64(originalDeadline.UnixMilli())})
	defer source.cancel(context.Canceled, context.Canceled)
	w, conn := accountWireAttach(t, f, f.expected.Owner, source)
	opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
	if opened.failure || opened.reader == ([32]byte{}) {
		t.Fatal("original capture failed")
	}
	source.cancel(context.Canceled, originalCause)
	// Productive operation must fail on this SAME Source and original reader.
	failed, _ := accountWireExchange(t, conn, pqAccountWireRead, 2, opened.reader)
	if !failed.failure || failed.status != pqAccountWireFailed || failed.reader != opened.reader {
		t.Fatal("canceled source remained productive")
	}
	for i, op := range []uint32{pqAccountWireRetire, pqAccountWireJoin} {
		r, _ := accountWireExchange(t, conn, op, uint64(i+3), opened.reader)
		if r.reader != opened.reader {
			t.Fatal("cleanup replaced original reader")
		}
	}
	closed, _ := accountWireExchange(t, conn, pqAccountWireClose, 5, opened.reader)
	if closed.status != pqAccountWireClosed || !closed.failure || closed.code != 0 || closed.reader != opened.reader || !accountWireHandler(t, w).IsClosed() {
		t.Fatal("Source cancellation lost actual CLOSED+firstfailure0")
	}
	if d, ok := w.ctx.Deadline(); !ok || d != originalDeadline || source.originalSourceDeadlineMs() != uint64(originalDeadline.UnixMilli()) {
		t.Fatal("cleanup renewed original Source window")
	}
	var preserved sourceParentFailure
	if !errors.As(source.cause(), &preserved) || !preserved.present || preserved.code != 0 {
		t.Fatal("original failure presence/code0 lost")
	}
	// Only explicit Node/transport owner close tears down this serving worker.
	_ = w.closeWalletPolicyAccountProofChild()
	accountWireWait(t, w)
}
