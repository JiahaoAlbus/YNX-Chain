//go:build cgo && ynx_bridge_test

package main

import "testing"

func TestBridgeMissingFixedNativeStorageRefusesWithoutKeysOrFakePartial(t *testing.T) {
	for _, restore := range []bool{false, true} {
		code, partial, original := publicMissingStorage(restore)
		if code != bridgeUnavailable || partial || original != -7001 {
			t.Fatalf("missing fixed storage result %d partial=%v original=%d", code, partial, original)
		}
	}
}
func TestBridgeRealCapturedPartialRemainsReachableUntilOriginalLifecycleCleanup(t *testing.T) {
	c, e := publicCapturedPair(false)
	if e != nil {
		t.Fatal(e)
	}
	c.storageFailure()
	if code, _ := c.publicBytes(); code != bridgeUnavailable {
		t.Fatal("failed partial unexpectedly exposes ready public pair")
	}
	r, j, x := c.pairLifecycle()
	if r != 0 || j != 0 || x != 0 {
		t.Fatalf("partial cleanup %d/%d/%d", r, j, x)
	}
	if code, _ := c.publicBytes(); code != bridgeInvalid {
		t.Fatal("closed ref reused")
	}
	if r, _, _ := c.pairLifecycle(); r != bridgeInvalid {
		t.Fatal("closed ref retirement accepted")
	}
}
func TestBridgeMissingFixedAuthConsumesOperationWithoutSigningOrFallback(t *testing.T) {
	c, e := publicCapturedPair(true)
	if e != nil {
		t.Fatal(e)
	}
	defer c.pairLifecycle()
	if code, e := c.prepare(); e != nil || code != 0 {
		t.Fatalf("PUBLIC prepare %d %v", code, e)
	}
	code, original := c.signMissingAuth()
	if code != bridgeUnavailable || original != -7001 {
		t.Fatalf("missing Auth %d/%d", code, original)
	}
	status, entered, complete, captured, authCode := c.opStatus()
	if status != 0 || !entered || complete || captured || authCode != -7001 {
		t.Fatalf("invalid missing-Auth lifecycle status=%d entered=%v complete=%v captured=%v auth=%d", status, entered, complete, captured, authCode)
	}
	if again, _ := c.signMissingAuth(); again == 0 {
		t.Fatal("replayed unavailable authorization")
	}
	if code, _, _ := c.copyData(131072); code != bridgeUnavailable {
		t.Fatal("missing Auth produced signed data")
	}
	if c.closeOp() != 0 || c.closeOp() != bridgeClosed {
		t.Fatal("original once close not preserved")
	}
}
func TestBridgeCopyPublicAndJournalDataIsDetachedAndShortCapacityDoesNotConsume(t *testing.T) {
	c, e := publicCapturedPair(true)
	if e != nil {
		t.Fatal(e)
	}
	defer c.pairLifecycle()
	code, first := c.publicBytes()
	if code != 0 || len(first) != 2656 {
		t.Fatalf("public copy %d/%d", code, len(first))
	}
	first[0] ^= 1
	_, next := c.publicBytes()
	if first[0] == next[0] {
		t.Fatal("public copy aliases original key")
	}
	if code, e := c.prepare(); code != 0 || e != nil {
		t.Fatal(code, e)
	}
	c.injectPublicJournalData()
	if c.closeOp() != bridgePending {
		t.Fatal("uncaptured journal data discarded")
	}
	for _, capacity := range []int{0, 1} {
		code, n, _ := c.copyData(capacity)
		if code != bridgeCapacity || n != len("PUBLIC_NOT_A_SIGNATURE") {
			t.Fatal("short capacity did not report original size")
		}
		_, _, _, captured, _ := c.opStatus()
		if captured {
			t.Fatal("short copy consumed journal data")
		}
	}
	code, n, data := c.copyData(128)
	if code != 0 || n != len(data) || string(data) != "PUBLIC_NOT_A_SIGNATURE" {
		t.Fatal("journal DATA copy failed")
	}
	_, _, _, captured, _ := c.opStatus()
	if !captured {
		t.Fatal("successful capture not retained")
	}
	if c.closeOp() != 0 {
		t.Fatal("captured DATA owner failed cleanup")
	}
}
func TestBridgeUnknownForeignRefsNeverSelectNativeOwner(t *testing.T) {
	pair, op := publicForeignRefs()
	if pair != bridgeInvalid || op != bridgeInvalid {
		t.Fatal("foreign ref recognized")
	}
}
