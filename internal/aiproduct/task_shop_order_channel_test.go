package aiproduct

import (
	"context"
	"testing"
)

// PUBLIC caller ordering only. Actual TLS exporter/seal semantics are supplied
// by LINK and actual wire binding must come from the original SDK/Auth adapter.
func TestP08ShopOrderChannelBeforeEncoding(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	acquired, encoded := false, false
	f.caller.onAcquire = func() { acquired = true }
	f.codec.onEncode = func() {
		if !acquired {
			t.Error("product encoded before channel acquisition")
		}
		encoded = true
	}
	receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil || receipt.State != "COMMITTED" || !encoded || f.caller.calls.Load() != 1 {
		t.Fatalf("channel-prepared path failed: %+v %v", receipt, err)
	}
}

func TestP08ShopOrderChannelLateRevocationStopsSend(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	f.caller.onAcquire = func() { f.held.snapshot.Grant.Status = "revoked" }
	if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
		t.Fatal("handshake-period revocation admitted")
	}
	if f.caller.calls.Load() != 0 {
		t.Fatal("bytes sent after late Source revocation")
	}
}

func TestP08ShopOrderChannelMissingFinalFenceIsUnknown(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	f.caller.omitFence = true
	decoded := false
	f.codec.onDecode = func() { decoded = true }
	receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err == nil || receipt.State == "COMMITTED" || decoded {
		t.Fatal("caller omitted final Auth fence but returned a verified effect")
	}
	f.store.mu.Lock()
	record := f.store.state.Actions[f.step.ID]
	f.store.mu.Unlock()
	if record.Status != "UNKNOWN" || record.ToolStep.RemoteRef != "shop-original-ref" || record.ToolStep.ResultCipher != "" {
		t.Fatal("uncertain effect lost original locator or fabricated result")
	}
}

func TestP08ShopOrderChannelCannotReplaceCancelledContext(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.caller.onAcquire = cancel
	if _, err := f.server.dispatchApprovedStep(ctx, f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil || f.caller.calls.Load() != 0 {
		t.Fatalf("cancelled call emitted bytes: %v", err)
	}
}
