//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"errors"
	"testing"
	"time"
)

// PUBLIC controls exercise the actual stable Core Node/App/reader and private
// Source clock. They are not two qualified C++ Source acquisitions or a broker.
func TestPQProtectedSourceParentStableHostScopesPUBLIC(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	originalNode, originalApp := f.node, f.app
	host, err := bindPQObserverAccountHost(originalNode, originalApp)
	if err != nil {
		t.Fatal(err)
	}
	process, processDone := context.WithCancel(context.Background())
	defer processDone()
	originalDeadline := time.UnixMilli(time.Now().Add(30 * time.Second).UnixMilli())
	selection := sourceParentSelection{generation: 1, deadlineMs: uint64(originalDeadline.UnixMilli()), minimumHeight: 10, canonicalOwner: f.expected.Owner, chainID: f.bootstrap.record.ChainID, sourceID: "PUBLIC-source-one", instanceID: "PUBLIC-instance-one"}
	firstCtx := publicSealedSourceClock(t, process, selection)
	defer firstCtx.cancel(context.Canceled, context.Canceled)
	// A public tuple/private clock with no original qualified capture cannot use
	// the production adapter, even if a caller copies the generation.
	forged := &pqOriginalSourceLaunch{generation: selection.generation}
	if scope, e := firstCtx.attachOriginalAccountScope(host, forged); scope != nil || !errors.Is(e, errSourceParent) || firstCtx.consumed {
		t.Fatal("public Source fields minted a protected account scope", e)
	}
	first, firstConn := publicObserverAccountLaunch(t, f, firstCtx)
	if err = host.attach(first); err != nil {
		t.Fatal("first actual scope", err)
	}
	firstWire := first.original.wire
	opened, _ := accountWireExchange(t, firstConn, pqAccountWireOpen, 1, [32]byte{})
	if opened.failure {
		t.Fatal("first actual original reader capture")
	}
	f.advance(t, 11)
	proof, _ := accountWireExchange(t, firstConn, pqAccountWireRead, 2, opened.reader)
	if proof.failure || proof.status != pqAccountWireOK || len(proof.payload) == 0 {
		t.Fatal("first original H10/H11 actual proof absent")
	}
	cause := sourceParentFailure{present: true, code: 0, reason: 1}
	firstCtx.cancel(context.Canceled, cause)
	failed, _ := accountWireExchange(t, firstConn, pqAccountWireRead, 3, opened.reader)
	if !failed.failure || failed.status != pqAccountWireFailed || failed.reader != opened.reader {
		t.Fatal("canceled scope remained productive or changed reader")
	}
	for i, op := range []uint32{pqAccountWireRetire, pqAccountWireJoin} {
		r, _ := accountWireExchange(t, firstConn, op, uint64(4+i), opened.reader)
		if r.reader != opened.reader {
			t.Fatal("cleanup changed original reader")
		}
	}
	closed, _ := accountWireExchange(t, firstConn, pqAccountWireClose, 6, opened.reader)
	if closed.status != pqAccountWireClosed || !closed.failure || closed.code != 0 || !accountWireHandler(t, firstWire).IsClosed() {
		t.Fatal("same Source canceled cleanup lost CLOSED/failure0")
	}
	_ = firstConn.Close()
	accountWireWait(t, firstWire)
	if err = host.sameOriginal(); err != nil || f.node != originalNode || f.app != originalApp || f.node.IsRunning() {
		t.Fatal("first scope canceled/stopped/replaced shared Node/App", err)
	}
	if d, ok := firstCtx.Deadline(); !ok || d != originalDeadline {
		t.Fatal("first original Source deadline renewed")
	}
	if err = host.attach(first); !errors.Is(err, errPQObserverAccountLaunch) {
		t.Fatal("old Source once handle resumed", err)
	}
	var preserved sourceParentFailure
	if !errors.As(firstCtx.cause(), &preserved) || !preserved.present || preserved.code != 0 {
		t.Fatal("first original Source cause0 lost")
	}
	// A separately acquired PUBLIC scope has an independent context/endpoint.
	// Production v3 cannot manufacture this second acquisition from its old FD.
	selection.generation = 2
	selection.sourceID = "PUBLIC-source-two"
	selection.instanceID = "PUBLIC-instance-two"
	selection.minimumHeight = 11
	selection.deadlineMs = uint64(originalDeadline.Add(5 * time.Second).UnixMilli())
	secondCtx := publicSealedSourceClock(t, process, selection)
	defer secondCtx.cancel(context.Canceled, context.Canceled)
	second, secondConn := publicObserverAccountLaunch(t, f, secondCtx)
	second.original.minimumHeight = 11
	if err = host.attach(second); err != nil {
		t.Fatal("new scope failed on same stable host", err)
	}
	if firstWire == second.original.wire || second.original.wire.app != originalApp || secondCtx.Err() != nil {
		t.Fatal("new Source inherited old scope/ctx/App")
	}
	secondOpened, _ := accountWireExchange(t, secondConn, pqAccountWireOpen, 1, [32]byte{})
	if secondOpened.failure || secondOpened.reader == opened.reader {
		t.Fatal("second Source reused first reader")
	}
	f.advance(t, 12)
	secondProof, _ := accountWireExchange(t, secondConn, pqAccountWireRead, 2, secondOpened.reader)
	if secondProof.failure || secondProof.status != pqAccountWireOK || len(secondProof.payload) == 0 {
		t.Fatal("second actual H11/H12 proof absent")
	}
	actual, err := accountWireHandler(t, second.original.wire).Read()
	if err != nil {
		t.Fatal(err)
	}
	view, err := actual.View()
	if err != nil || view.Proof.Height != 11 || view.CurrentCheckpoint.Height != 12 {
		t.Fatal("new scope returned old checkpoint", err)
	}
	secondClosed, _ := accountWireExchange(t, secondConn, pqAccountWireClose, 3, secondOpened.reader)
	if secondClosed.status != pqAccountWireClosed || secondClosed.failure {
		t.Fatal("second independent scope cleanup failed")
	}
	_ = secondConn.Close()
	accountWireWait(t, second.original.wire)
	if f.node != originalNode || f.app != originalApp || host.sameOriginal() != nil || f.node.IsRunning() {
		t.Fatal("scope continuity reconstructed or started/stopped observer")
	}
	if d, ok := secondCtx.Deadline(); !ok || d != originalDeadline.Add(5*time.Second) {
		t.Fatal("second Source deadline changed")
	}
	t.Log("PUBLIC stable original Node/App, distinct Source clocks and actual proof readers, canceled Source cleanup CLOSED+failure0; no qualified second acquisition/broker, no Node.Start, RootAdmission=false")
}
