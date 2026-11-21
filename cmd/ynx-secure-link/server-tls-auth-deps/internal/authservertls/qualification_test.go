//go:build darwin || linux

package authservertls

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNormalRootEmptyBeforeListenAndCleanup(t *testing.T) {
	q, e := AcquireOriginalServerTLSQualification(context.Background())
	if q == nil || !errors.Is(e, ErrSourceNotSupplied) {
		t.Fatal(q, e)
	}
	if done, err := q.Close(); !done || err != e {
		t.Fatal(done, err)
	}
	l, e := OpenOriginalServerTLSLease(context.Background())
	if l == nil || !errors.Is(e, ErrNotSupplied) || !errors.Is(e, ErrSourceNotSupplied) || l.state.listener != nil {
		t.Fatal(l, e)
	}
	if !errors.Is(l.state.first, ErrSourceNotSupplied) || errors.Is(l.state.first, ErrNotSupplied) {
		t.Fatal("Source first cause was replaced", l.state.first)
	}
	if _, e = l.BorrowOriginal(context.Background()); e == nil {
		t.Fatal("empty Source borrowed")
	}
	if done, closeErr := l.Close(); !done || !errors.Is(closeErr, ErrSourceNotSupplied) || errors.Is(closeErr, ErrNotSupplied) {
		t.Fatal("partial drain or original Source first cause", done, closeErr)
	}
}

func TestOriginalLeaseMissingClassificationDoesNotMaskOtherFailures(t *testing.T) {
	for _, tc := range []struct {
		first    error
		releases int
		legacy   bool
	}{
		{ErrSourceNotSupplied, 0, true}, {ErrSourceNotSupplied, 2, true},
		{ErrSourceNotSupplied, 1, false}, {ErrSourceDenied, 0, false},
		{context.Canceled, 0, false}, {ErrUnknown, 0, false},
	} {
		got := originalLeaseOpenError(tc.first, tc.releases)
		if !errors.Is(got, tc.first) || errors.Is(got, ErrNotSupplied) != tc.legacy {
			t.Fatalf("first=%v releases=%d got=%v", tc.first, tc.releases, got)
		}
	}
}
func publicSourceFile(t *testing.T) (reviewedFile, *heldFile) {
	t.Helper()
	home, e := os.UserHomeDir()
	if e != nil {
		t.Fatal(e)
	}
	dir, e := os.MkdirTemp(home, "PUBLIC-TLS-SOURCE-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	p := filepath.Join(dir, "root.original")
	raw := []byte("PUBLIC Source original only, not authority")
	if e = os.WriteFile(p, raw, 0600); e != nil {
		t.Fatal(e)
	}
	info, e := os.Lstat(p)
	if e != nil {
		t.Fatal(e)
	}
	identity, ok := id(info)
	if !ok {
		t.Fatal("stat")
	}
	sum := sha256.Sum256(raw)
	pin := reviewedFile{Path: p, Identity: identity, SHA256: hex.EncodeToString(sum[:])}
	h, e := holdReviewedFileBounded(pin, uint32(os.Getuid()), 393216)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = h.closeOriginal() })
	return pin, h
}
func TestActualPublicHeldOriginalReplacementAndUnknownClose(t *testing.T) {
	pin, h := publicSourceFile(t)
	if e := h.current(); e != nil {
		t.Fatal(e)
	}
	replacement := pin.Path + ".foreign"
	if e := os.WriteFile(replacement, []byte("PUBLIC foreign"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.Rename(replacement, pin.Path); e != nil {
		t.Fatal(e)
	}
	if h.current() == nil {
		t.Fatal("replacement admitted")
	}
	if e := h.file.Close(); e != nil {
		t.Fatal(e)
	}
	if h.closeOriginal() == nil || !h.ambiguous {
		t.Fatal("unknown close lost")
	}
	for _, p := range h.parents {
		if p.file == nil {
			t.Fatal("parent closed past ambiguous child")
		}
	}
	if h.closeOriginal() != ErrUnknown {
		t.Fatal("retried ambiguous close")
	}
}
func TestCancellationDoesNotRevokeSource(t *testing.T) {
	s := &tlsSourceState{expires: time.Now().Add(time.Second), changed: make(chan struct{})}
	q := &QualifiedServerTLSSource{s}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(q.Current(ctx), context.Canceled) || s.retired || s.first != nil {
		t.Fatal("request cancellation mutated Source")
	}
}
func TestBusyAndRetireDoNotCloseParent(t *testing.T) {
	s := &tlsSourceState{busy: true, expires: time.Now().Add(time.Second), changed: make(chan struct{})}
	q := &QualifiedServerTLSSource{s}
	if !errors.Is(q.Current(context.Background()), ErrPending) {
		t.Fatal("busy not pending")
	}
	q.Retire()
	if done, e := q.Close(); done || !errors.Is(e, ErrPending) {
		t.Fatal(done, e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if q.Join(ctx) == nil {
		t.Fatal("pending join passed")
	}
	s.mu.Lock()
	s.busy = false
	s.wake()
	s.mu.Unlock()
	if e := q.Join(context.Background()); e != nil {
		t.Fatal(e)
	}
	if done, _ := q.Close(); !done {
		t.Fatal("drain incomplete")
	}
}
func TestActualDecodeClosedAndNoAdmission(t *testing.T) {
	p := sourceProjection{Status: "active", Sequence: 1, Generation: 1, ProfileDigest: "public", ExecutionHeight: "3", SourceID: "public-source", InstanceID: "public-instance", TimeFloor: 1, ExpiresAtMS: 2, DataOnly: true}
	raw, _ := json.Marshal(sourceResult{p, "PUBLIC signed current"})
	if _, e := decodeSourceResult(raw); e != nil {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{append(raw, []byte(" {}")...), []byte(`{"projection":{},"currentRaw":"x","approved":true}`)} {
		if _, e := decodeSourceResult(bad); e == nil {
			t.Fatal("schema admitted")
		}
	}
	p.NativeAdmission = true
	raw, _ = json.Marshal(sourceResult{p, "x"})
	if _, e := decodeSourceResult(raw); e == nil {
		t.Fatal("claimed Native admitted")
	}
}
func TestBoundedOutputRetainsPrefix(t *testing.T) {
	b := &boundedOutput{cap: 4}
	if _, e := b.Write([]byte("abcdef")); e == nil || !b.overflow || !bytes.Equal(b.Bytes(), []byte("abcd")) {
		t.Fatal("partial lost")
	}
	first := errors.New("first")
	q := &QualifiedServerTLSSource{&tlsSourceState{currentOriginal: b.Bytes(), first: first}}
	out, e := q.CopyOriginalQualificationOutcome()
	out[0] = 0
	again, _ := q.CopyOriginalQualificationOutcome()
	if e != first || string(again) != "abcd" {
		t.Fatal("original mutated")
	}
}
func TestSourceParentBlockedByResourceBorrow(t *testing.T) {
	first := errors.New("first")
	q := &QualifiedServerTLSSource{&tlsSourceState{first: first, changed: make(chan struct{})}}
	l := &ReviewedServerTLSLease{&leaseState{qualification: q, borrows: 1, changed: make(chan struct{})}}
	if done, e := l.Close(); done || !errors.Is(e, ErrPending) || q.state.closed {
		t.Fatal("parent released with child")
	}
	l.state.borrows = 0
	if done, e := l.Close(); !done || e != first || !q.state.closed {
		t.Fatal(done, e)
	}
}
func TestResourceCannotAliasCredentialEpochAndSourceGeneration(t *testing.T) {
	r := reviewedServerRelease{SourceID: "s", InstanceID: "i", CredentialRef: "c", CredentialEpoch: "17", IssuerRef: "issuer", ServerName: "n", PeerSAN: "san", ListenAddress: "127.0.0.1:18443", TargetOrigin: "https://n", CertificateSHA256: "cert", SPKISHA256: "spki", NotBeforeMS: 1, ExpiresMS: 2, CA: reviewedFile{SHA256: "ca"}}
	x := tlsIdentityScope{SourceID: "s", InstanceID: "i", CredentialRef: "c", CredentialEpoch: "17", IssuerRef: "issuer", ServerName: "n", PeerSAN: "san", ListenAddress: r.ListenAddress, TargetOrigin: r.TargetOrigin, CertificateSHA256: "cert", SPKISHA256: "spki", CASHA256: "ca", NotBeforeMS: 1, ExpiresMS: 2}
	q := &QualifiedServerTLSSource{&tlsSourceState{scope: x, expires: time.Now().Add(time.Second)}}
	r.ServerID = "server"
	q.state.scope.ServerID = "server"
	if e := q.matchResource(r); e != nil {
		t.Fatal(e)
	}
	r.CredentialEpoch = "7"
	if q.matchResource(r) == nil {
		t.Fatal("generation alias passed")
	}
}
