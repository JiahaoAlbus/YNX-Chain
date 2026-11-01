package ynxresourceconsent

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func TestNetworkResourceMaterialPUBLICCurrentAndBorrowLifecycle(t *testing.T) {
	f := newConsentFixture(t)
	material, err := ynxbatch.ExportKeyMaterial(f.key)
	if err != nil {
		t.Fatal("synthetic material export")
	}
	defer material.Clear()
	prepare := func() *MaterialAttempt {
		a, e := PrepareMaterial(f.scope, f.input, f.b, f.current)
		if e != nil {
			t.Fatal("prepare", e)
		}
		t.Cleanup(func() { a.Close() })
		return a
	}
	t.Run("actual-principal-current9-is-not-policy", func(t *testing.T) {
		// Exact nine-field grammar of soleSDK inspectOriginalNetworkResourcePrincipalCurrentV1DATA.
		// This is PUBLIC request/status/window DATA, not a registered-account policy.
		var scope ynxbatch.NetworkResourceScope
		if json.Unmarshal(f.scope, &scope) != nil {
			t.Fatal("scope")
		}
		r := scope.Request
		raw, e := json.Marshal(map[string]any{"principal": r.Principal, "principalKeyEpoch": r.PrincipalKeyEpoch, "originalCallerRef": r.OriginalCallerRef, "requestId": r.RequestID, "lifecycleRef": r.LifecycleRef, "principalCurrentSelector": r.PrincipalCurrentSelector, "status": "active", "observedAtMs": f.current.NowMillis, "expiresAtMs": f.current.NowMillis + 20000})
		if e != nil {
			t.Fatal(e)
		}
		c := f.current
		c.PolicyOriginal = raw
		if a, e := PrepareMaterial(f.scope, f.input, f.b, c); a != nil || !errors.Is(e, ErrCurrent) {
			t.Fatal("Current9 was promoted to account policy")
		}
	})
	t.Run("failed-import-is-selected-and-copy-safe", func(t *testing.T) {
		a := prepare()
		alias := *a
		bad := material
		bad.PKCS8A = bytes.Clone(material.PKCS8A)
		defer clear(bad.PKCS8A)
		bad.PKCS8A[0] ^= 1
		out, e := a.SignOnce(bad, f.current)
		if !errors.Is(e, ErrMaterial) || !out.AttemptSelected || !out.KeyCleanupComplete || out.Running || len(out.MemberOriginal) != 0 {
			t.Fatal("failed import not retained")
		}
		if _, e = alias.SignOnce(material, f.current); !errors.Is(e, ErrAttempted) {
			t.Fatal("copy reset selected")
		}
		alias.Close()
		if e = a.Current(f.current); !errors.Is(e, ErrRetired) {
			t.Fatal("copy did not share close")
		}
	})
	t.Run("fullpair-rejected-before-private-entry", func(t *testing.T) {
		a := prepare()
		bad := material
		bad.PKB = bytes.Clone(material.PKB)
		bad.PKB[0] ^= 1
		out, e := a.SignOnce(bad, f.current)
		if !errors.Is(e, ErrMaterial) || out.AttemptSelected || out.KeyCleanupComplete {
			t.Fatal("full pair preflight")
		}
	})
	t.Run("inflight-retire-close-retains-real-AND-partial", func(t *testing.T) {
		a := prepare()
		started, finish := make(chan struct{}), make(chan struct{})
		actual := a.state.attempt.sign
		a.state.attempt.sign = func(k *ynxbatch.PrivateKey, s, i []byte, n int64, b ynxbatch.NetworkResourceConsentBinding) (ynxbatch.NetworkResourceConsentOutcome, error) {
			close(started)
			<-finish
			return actual(k, s, i, n, b)
		}
		done := make(chan MaterialOutcome, 1)
		go func() { out, _ := a.SignOnce(material, f.current); done <- out }()
		<-started
		a.Retire()
		if a.Drain() || a.Close() {
			t.Fatal("active sign claimed drained/closed")
		}
		if _, e := a.SignOnce(material, f.current); !errors.Is(e, ErrAttempted) {
			t.Fatal("second signing attempt")
		}
		close(finish)
		out := <-done
		if !out.SignatureVerified || !out.BatchCleanupComplete || !out.KeyCleanupComplete || !out.AttemptSelected || out.Running || out.CurrentDataMatched || !errors.Is(out.FirstCause, ErrRetired) || len(out.MemberOriginal) == 0 {
			t.Fatal("late retire lost original partial")
		}
		if _, e := ynxbatch.InspectNetworkResourceConsentMember(out.MemberOriginal, f.scope, f.input, f.current.NowMillis, f.b); e != nil {
			t.Fatal("actual retained dual signature", e)
		}
		first := bytes.Clone(out.MemberOriginal)
		out.MemberOriginal[0] ^= 1
		if !bytes.Equal(first, a.OriginalOutcome().MemberOriginal) || !a.Drain() || !a.Close() || !bytes.Equal(first, a.OriginalOutcome().MemberOriginal) {
			t.Fatal("close destroyed public reconciliation")
		}
		// Caller-owned material was borrowed, never cleared or retained by the call.
		if len(material.PKCS8A) != 54 || material.PKCS8A[0] != 0x30 {
			t.Fatal("borrow modified")
		}
	})
}
