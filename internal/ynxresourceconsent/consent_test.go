package ynxresourceconsent

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type consentFixture struct {
	scope, input []byte
	b            ynxbatch.NetworkResourceConsentBinding
	state        ynxauth.State
	current      CurrentDATA
	key          *ynxbatch.PrivateKey
}

func newConsentFixture(t *testing.T) consentFixture {
	t.Helper()
	raw, err := os.ReadFile("../ynxbatch/testdata/network-resource-consent-v1-public.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		ScopeOriginal, InputHex string
		NowMillis               int64
		Binding                 struct{ NetworkID, CanonicalSignerOwner, KeyEpoch, IssuedHeight string }
	}
	if json.Unmarshal(raw, &v) != nil {
		t.Fatal("vector")
	}
	input, _ := hex.DecodeString(v.InputHex)
	network, _ := hex.DecodeString(v.Binding.NetworkID)
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	b := ynxbatch.NetworkResourceConsentBinding{NetworkID: network, Owner: v.Binding.CanonicalSignerOwner, KeyEpoch: "1", IssuedHeight: "20", PKA: pub.PKA, PKB: pub.PKB}
	s := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: bytes.Clone(network), EnableAt: 1, Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: b.Owner, PKA: pub.PKA, PKB: pub.PKB, Revision: 1, RegisteredAt: 1, ActiveFrom: 2, LedgerNonce: 1}}}
	policy, err := ynxauth.EncodeWalletPolicyProjection(s, b.Owner)
	if err != nil {
		t.Fatal(err)
	}
	return consentFixture{[]byte(v.ScopeOriginal), input, b, s, CurrentDATA{SubjectOwner: b.Owner, PolicyOriginal: policy, ExecutionHeight: 20, NowMillis: v.NowMillis}, key}
}
func (f consentFixture) policy(t *testing.T, s ynxauth.State, h uint64) CurrentDATA {
	t.Helper()
	raw, err := ynxauth.EncodeWalletPolicyProjection(s, f.b.Owner)
	if err != nil {
		t.Fatal(err)
	}
	c := f.current
	c.PolicyOriginal = raw
	c.ExecutionHeight = h
	c.NowMillis++
	return c
}

func TestNetworkResourceConsentOriginalPolicyIssuedCurrentAndRevocation(t *testing.T) {
	f := newConsentFixture(t)
	for _, which := range []string{"owner", "network", "future-issued", "not-active-issued", "current-key", "current-epoch", "revoked", "noncanonical-policy"} {
		t.Run(which, func(t *testing.T) {
			b, c, s := f.b, f.current, f.state.Clone()
			switch which {
			case "owner":
				c.SubjectOwner = "0x" + strings.Repeat("22", 20)
			case "network":
				b.NetworkID = bytes.Repeat([]byte{2}, 32)
			case "future-issued":
				c.ExecutionHeight = 19
			case "not-active-issued":
				s.Records[0].ActiveFrom = 21
				c = f.policy(t, s, 22)
			case "current-key":
				s.Records[0].PKB = bytes.Repeat([]byte{3}, 64)
				c = f.policy(t, s, 20)
			case "current-epoch":
				s.Records = append(s.Records, ynxauth.Record{AlgorithmVersion: ynxbatch.Version, Owner: f.b.Owner, PKA: f.b.PKA, PKB: f.b.PKB, Revision: 2, RegisteredAt: 20, ActiveFrom: 21, LedgerNonce: 2})
				c = f.policy(t, s, 21)
			case "revoked":
				s.Version = ynxauth.PolicyRevocationVersion
				s.Revocations = []ynxauth.RevocationRecord{{Owner: f.b.Owner, AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 20, RevokedFrom: 21, LedgerNonce: 2}}
				c = f.policy(t, s, 21)
			case "noncanonical-policy":
				c.PolicyOriginal = append(bytes.Clone(c.PolicyOriginal), ' ')
			}
			if _, err := Prepare(f.scope, f.input, b, c); err == nil {
				t.Fatal("invalid independent policy data accepted")
			}
		})
	}
	a, err := Prepare(f.scope, f.input, f.b, f.current)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	out, err := a.SignOnce(f.key, f.current)
	if err != nil || !out.SignatureVerified || out.CurrentDataMatched {
		t.Fatal("original attempt result", err)
	}
	original := bytes.Clone(out.MemberOriginal)
	out.MemberOriginal[0] ^= 1
	if !bytes.Equal(a.OriginalOutcome().MemberOriginal, original) {
		t.Fatal("outcome alias changed original")
	}
	c := f.current
	c.ExecutionHeight = 21
	c.NowMillis++
	out, err = a.ConfirmCurrent(c)
	if err != nil || !out.CurrentDataMatched {
		t.Fatal("fresh same-pair current did not verify", err)
	}
	s := f.state.Clone()
	s.Version = ynxauth.PolicyRevocationVersion
	s.Revocations = []ynxauth.RevocationRecord{{Owner: f.b.Owner, AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 21, RevokedFrom: 22, LedgerNonce: 2}}
	out, err = a.ConfirmCurrent(f.policy(t, s, 22))
	if err == nil || !bytes.Equal(out.MemberOriginal, original) || out.CurrentDataMatched {
		t.Fatal("revocation lost original UNKNOWN or remained current")
	}
	if err = a.Current(c); err == nil {
		t.Fatal("terminal current failure was reset")
	}
	if out, err = a.SignOnce(f.key, c); !errors.Is(err, ErrAttempted) || !bytes.Equal(out.MemberOriginal, original) {
		t.Fatal("repeated attempt lost original", err)
	}
}

func TestNetworkResourceConsentAttemptCurrentHistoryAndOriginalOwnership(t *testing.T) {
	f := newConsentFixture(t)
	a, err := Prepare(f.scope, f.input, f.b, f.current)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	// Detached original bytes and keys cannot be rewritten through the caller.
	f.scope[0] = ' '
	f.input[0] = ' '
	f.b.PKA[0] ^= 1
	out, err := a.SignOnce(f.key, f.current)
	if err != nil || !out.SignatureVerified {
		t.Fatal("caller alias contaminated prepared original", err)
	}
	s := f.state.Clone()
	s.Records[0].PKA = bytes.Clone(a.binding.PKA)
	s.Records[0].ActiveFrom = 3
	c := f.policy(t, s, 21)
	if _, err = a.ConfirmCurrent(c); err == nil {
		t.Fatal("rewritten prior registration accepted")
	}
	if len(a.OriginalOutcome().MemberOriginal) == 0 {
		t.Fatal("first cause erased original outcome")
	}
}

func TestNetworkResourceConsentPartialOutcomeRetireDrainClose(t *testing.T) {
	f := newConsentFixture(t)
	a, err := Prepare(f.scope, f.input, f.b, f.current)
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	a.sign = func(k *ynxbatch.PrivateKey, s, i []byte, n int64, b ynxbatch.NetworkResourceConsentBinding) (ynxbatch.NetworkResourceConsentOutcome, error) {
		close(entered)
		<-release
		out, err := ynxbatch.SignNetworkResourceConsentDATA(k, s, i, n, b)
		if err != nil {
			return out, err
		}
		return out, errors.New("synthetic late owner completion failure")
	}
	type result struct {
		out Outcome
		err error
	}
	done := make(chan result, 1)
	go func() { out, err := a.SignOnce(f.key, f.current); done <- result{out, err} }()
	<-entered
	if _, err = a.SignOnce(f.key, f.current); !errors.Is(err, ErrAttempted) {
		t.Fatal("concurrent attempt selected twice")
	}
	a.Retire()
	if a.Drain() || a.Close() {
		t.Fatal("in-flight physical math debt reported drained")
	}
	close(release)
	r := <-done
	if r.err == nil || len(r.out.MemberOriginal) == 0 || !r.out.SignatureVerified || r.out.CurrentDataMatched {
		t.Fatal("late error discarded original partial result", r.err)
	}
	if !a.Drain() || !a.Close() {
		t.Fatal("completed fixed signer failed to drain")
	}
	if !bytes.Equal(a.OriginalOutcome().MemberOriginal, r.out.MemberOriginal) {
		t.Fatal("close lost original UNKNOWN")
	}
	if _, err = a.ConfirmCurrent(f.current); err == nil {
		t.Fatal("closed operation accepted current")
	}
}

func TestNetworkResourceConsentDestroyedBorrowHasNoRetry(t *testing.T) {
	f := newConsentFixture(t)
	a, err := Prepare(f.scope, f.input, f.b, f.current)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	f.key.Destroy()
	out, err := a.SignOnce(f.key, f.current)
	if err == nil || !out.AttemptSelected || len(out.MemberOriginal) != 0 {
		t.Fatal("destroyed borrow passed")
	}
	if _, err = a.SignOnce(f.key, f.current); !errors.Is(err, ErrAttempted) {
		t.Fatal("failed attempt silently retried")
	}
}
