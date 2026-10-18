package main

// PUBLIC ephemeral keys and synthetic current controls. Not an enrolled Source,
// real Android Keystore, physical zeroization, user consent or network effect.
import (
	"bytes"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"testing"
)

func fixture(t *testing.T) (*pairOwner, transferReview) {
	t.Helper()
	b := pairBinding{NativeChainID: 6423, Owner: "0x1234567890abcdef1234567890abcdef12345678", PairVersion: 1}
	for i := range b.NetworkHash {
		b.NetworkHash[i] = byte(i)
	}
	p, e := newPair(b)
	if e != nil {
		t.Fatal(e)
	}
	p.storageReady = true // PUBLIC storage seam only; no platform or Auth qualification.
	t.Cleanup(p.retire)
	return p, transferReview{RequestID: "PUBLIC-review", PolicyRevision: 1, ExecutionHeight: 9007199254740993, PairVersion: 1, Transfer: ynxauth.Transfer{ChainID: bytes.Clone(b.NetworkHash[:]), NativeChainID: 6423, From: b.Owner, To: "0xabcdef1234567890abcdef1234567890abcdef12", Amount: 1, Fee: 1, Nonce: 9007199254740993}}
}

type publicAuthorization struct {
	calls int
	check func(int, transferScope) error
}

func (a *publicAuthorization) assertOriginalCurrent(s transferScope) error {
	a.calls++
	if a.check != nil {
		return a.check(a.calls, s)
	}
	return nil
}
func TestNativeLifecycleAndFixedTransfer(t *testing.T) {
	p, r := fixture(t)
	o, e := prepareTransfer(p, r)
	if e != nil {
		t.Fatal(e)
	}
	a := &publicAuthorization{}
	if e = o.sign(a); e != nil {
		t.Fatal(e)
	}
	if a.calls != 2 {
		t.Fatal("both original current fences required")
	}
	if e = o.sign(a); !errors.Is(e, errOnce) {
		t.Fatal("re-sign permitted")
	}
	if e = o.close(); !errors.Is(e, errJoin) {
		t.Fatal("uncaptured result discarded")
	}
	raw, e := o.copyResultData()
	if e != nil {
		t.Fatal(e)
	}
	m, e := ynxbatch.DecodeMember(raw)
	if e != nil || m.Certificate.N != 1 || m.Index != 0 || m.Certificate.Purpose != ynxauth.TransactionPurpose || !bytes.Equal(m.Message, o.scope.SigningBytes) {
		t.Fatal("wrong fixed member")
	}
	raw[0] ^= 1
	raw2, e := o.copyResultData()
	if e != nil || bytes.Equal(raw, raw2) {
		t.Fatal("result aliases private retained bytes")
	}
	if e = o.close(); e != nil {
		t.Fatal(e)
	}
	p.retire()
	if e = p.join(); e != nil {
		t.Fatal(e)
	}
	if _, e = prepareTransfer(p, r); !errors.Is(e, errRetired) {
		t.Fatal("retired pair reused")
	}
}
func TestNativeLateCurrentFailureRetainsWireAndNoRetry(t *testing.T) {
	p, r := fixture(t)
	o, e := prepareTransfer(p, r)
	if e != nil {
		t.Fatal(e)
	}
	first := errors.New("PUBLIC-current-revoked")
	a := &publicAuthorization{check: func(call int, s transferScope) error {
		if call == 1 {
			s.SigningBytes[0] ^= 1
			s.Public.PKA[0] ^= 1
		}
		if call == 2 {
			if !o.status().ResultRetained {
				t.Fatal("wire not captured before foreign post-current")
			}
			return first
		}
		return nil
	}}
	if e = o.sign(a); e != first {
		t.Fatal("original first failure replaced")
	}
	s := o.status()
	if !s.Unknown || s.SigningComplete || !s.ResultRetained {
		t.Fatal("late signed result lost or authorized")
	}
	if e = o.sign(a); !errors.Is(e, errOnce) {
		t.Fatal("UNKNOWN re-signed")
	}
	raw, e := o.copyResultData()
	if e != nil {
		t.Fatal(e)
	}
	m, e := ynxbatch.DecodeMember(raw)
	if e != nil || !bytes.Equal(m.Message, o.scope.SigningBytes) {
		t.Fatal("foreign current mutated original message")
	}
}
func TestNativeLockAndCancelDuringSigningRetainLateData(t *testing.T) {
	for _, mode := range []string{"lock", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			p, r := fixture(t)
			o, e := prepareTransfer(p, r)
			if e != nil {
				t.Fatal(e)
			}
			a := &publicAuthorization{check: func(call int, _ transferScope) error {
				if call == 2 {
					if mode == "lock" {
						p.retire()
					} else {
						o.cancel()
					}
				}
				return nil
			}}
			if e = o.sign(a); e == nil {
				t.Fatal("late lock/cancel accepted")
			}
			if s := o.status(); !s.Unknown || !s.ResultRetained || s.SigningComplete {
				t.Fatal("late wire not preserved")
			}
			if mode == "lock" {
				if e = p.join(); e != nil {
					t.Fatal("borrow not drained", e)
				}
			}
		})
	}
}
func TestNativeMissingAuthorizationNeverEntersCrypto(t *testing.T) {
	p, r := fixture(t)
	o, e := prepareTransfer(p, r)
	if e != nil {
		t.Fatal(e)
	}
	if e = o.sign(nil); !errors.Is(e, errAuth) {
		t.Fatal(e)
	}
	if s := o.status(); s.ResultRetained || s.SigningComplete || !s.Entered {
		t.Fatal("missing authority manufactured a result")
	}
	if e = o.sign(&publicAuthorization{}); !errors.Is(e, errOnce) {
		t.Fatal("failed selected operation retried")
	}
	o2, e := prepareTransfer(p, r)
	if e != nil {
		t.Fatal(e)
	}
	o2.cancel()
	a := &publicAuthorization{}
	if e = o2.sign(a); !errors.Is(e, errCancelled) || a.calls != 0 {
		t.Fatal("cancel-before-sign reached auth/crypto")
	}
}
func TestNativePrepareRejectsInvalidBindingsAndUTF8(t *testing.T) {
	p, r := fixture(t)
	for _, change := range []func(*transferReview){func(x *transferReview) { x.Transfer.ChainID = []byte("6423") }, func(x *transferReview) { x.PairVersion = 2 }, func(x *transferReview) { x.Transfer.Fee = 0 }, func(x *transferReview) { x.PolicyRevision = 0 }, func(x *transferReview) { x.Transfer.From = x.Transfer.To }, func(x *transferReview) { x.RequestID = string([]byte{255}) }} {
		bad := r
		bad.Transfer.ChainID = bytes.Clone(r.Transfer.ChainID)
		change(&bad)
		if _, e := prepareTransfer(p, bad); e == nil {
			t.Fatal("invalid binding/UTF8 accepted")
		}
	}
}

func TestNativePhase2DrainsAfterMathFailureAndKeepsMathFirst(t *testing.T) {
	p, r := fixture(t)
	o, e := prepareTransfer(p, r)
	if e != nil {
		t.Fatal(e)
	}
	postFailure := errors.New("PUBLIC-after-close-unknown")
	a := &publicAuthorization{check: func(call int, _ transferScope) error {
		if call == 1 {
			p.key.Destroy()
		}
		if call == 2 {
			return postFailure
		}
		return nil
	}}
	first := o.sign(a)
	if first == nil || first == postFailure || a.calls != 2 {
		t.Fatal("phase2 missing or replaced actual math first error", first, a.calls)
	}
	if o.status().First != first || o.status().ResultRetained {
		t.Fatal("math error invented signed result")
	}
}
func TestNativePhase2DrainsLoanWhenLockWinsBeforeMath(t *testing.T) {
	p, r := fixture(t)
	o, e := prepareTransfer(p, r)
	if e != nil {
		t.Fatal(e)
	}
	a := &publicAuthorization{check: func(call int, _ transferScope) error {
		if call == 1 {
			p.retire()
		}
		return nil
	}}
	if e = o.sign(a); !errors.Is(e, errRetired) || a.calls != 2 {
		t.Fatal("borrowed Auth loan not drained after pre-math lock", e, a.calls)
	}
}

func TestNativeRestoreUsesWholeExpectedPairAndNoPlainExportAfterStorage(t *testing.T) {
	p, r := fixture(t)
	p.storageReady = false
	m, e := p.exportNewMaterialForStorage()
	if e != nil {
		t.Fatal(e)
	}
	defer m.Clear()
	if _, e = p.exportNewMaterialForStorage(); !errors.Is(e, errOnce) {
		t.Fatal("storage export replay")
	}
	pub := p.publicCopy()
	restored, e := restorePair(p.binding, m, pub)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.retire()
	if !bytes.Equal(restored.publicCopy().PKA, pub.PKA) || !bytes.Equal(restored.publicCopy().PKB, pub.PKB) {
		t.Fatal("restored public mismatch")
	}
	other := ynxbatch.PublicKey{PKA: bytes.Clone(pub.PKA), PKB: bytes.Clone(pub.PKB)}
	other.PKB[0] ^= 1
	if q, e := restorePair(p.binding, m, other); e == nil || q != nil {
		t.Fatal("mixed expected pair accepted")
	}
	if _, e = prepareTransfer(p, r); !errors.Is(e, errStorage) {
		t.Fatal("unpersisted pair can prepare a sign")
	}
}
