package productreadsource

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestShopV4EmptyRootAndNoCallerCannotMint(t *testing.T) {
	if len(originalProductReleases) != 0 {
		t.Fatal("PUBLIC control expects normal empty Root release table")
	}
	if a, e := OpenOriginalProductReadAuthority(context.Background()); a != nil || !errors.Is(e, ErrNotSupplied) {
		t.Fatal("normal Root must reject before process", e)
	}
	ctx := context.Background()
	a := &Authority{parent: ctx, changed: make(chan struct{}, 1)}
	a.children.Store(1)
	a.state.Store(&epoch{observation: &semanticObservation{1}, until: time.Now().Add(time.Hour), wallStart: time.Now().UnixMilli()})
	r, _ := http.NewRequestWithContext(ctx, "GET", "http://PUBLIC.invalid/v5/shop/source/shop.order/invoice-intents/PUBLIC-order", nil)
	h := &Hold{parent: a, ctx: ctx, request: r, scope: ReadScopeDATA{ProductID: "shop.order", SourceOrder: "PUBLIC-order"}}
	v, e := h.VerifyOriginalShopGET(ctx)
	if v == nil || e == nil || v.verified.Load() {
		t.Fatal("missing genuine LocalCaller cannot turn Root-shaped DATA/flags into authority")
	}
	again, e2 := h.VerifyOriginalShopGET(ctx)
	if again != v || e2 != e {
		t.Fatal("same original failure must be retained without new attempt")
	}
	if e = h.Close(); e == nil {
		t.Fatal("close must preserve first failure while draining")
	}
	if a.children.Load() != 0 {
		t.Fatal("physically completed partial must release own child")
	}
}
func TestShopV4CloseWaitDebtAndFirstSeparate(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := &Authority{changed: make(chan struct{}, 1)}
	a.children.Store(1)
	h := &Hold{parent: a, ctx: ctx}
	v := &VerifiedShopGET{hold: h, ctx: ctx, cancel: cancel}
	v.active.Store(1)
	v.physical.Store(true)
	h.v4.Store(v)
	if e := h.Close(); !errors.Is(e, ErrPending) || a.children.Load() != 1 {
		t.Fatal("active call cannot be released using old physical flag", e)
	}
	if ctx.Err() == nil {
		t.Fatal("close must cancel original process context immediately")
	}
	v.active.Store(0)
	v.physical.Store(true)
	first := errors.New("PUBLIC first")
	v.remember(first)
	if e := h.Close(); e != first || a.children.Load() != 0 {
		t.Fatal("done plus first failure must release and retain first", e)
	}
	if e := h.Close(); e != first || a.children.Load() != 0 {
		t.Fatal("repeat close cannot release parent twice", e)
	}
}
func TestShopV4RequestSnapshotCannotSubstitute(t *testing.T) {
	r, _ := http.NewRequest("GET", "https://PUBLIC.invalid/v5/shop/source/shop.order/invoice-intents/PUBLIC-order", nil)
	r.Header.Set("x-ynx-product-session-proof-v4", "PUBLIC")
	first, e := requestOriginal(r)
	if e != nil {
		t.Fatal(e)
	}
	r.Header.Set("x-ynx-product-session-proof-v4", "OTHER")
	second, e := requestOriginal(r)
	if e != nil || rawDigest(first) == rawDigest(second) {
		t.Fatal("original V4 header must participate in immutable request binding")
	}
	for _, url := range []string{"https://PUBLIC.invalid/v5/shop/source/shop.order/invoice-intents/x?query=1", "https://PUBLIC.invalid/v5/shop/source/shop.order/invoice-intents/%78"} {
		q, _ := http.NewRequest("GET", url, nil)
		if _, e = requestOriginal(q); e == nil {
			t.Fatal("query/raw path alias accepted")
		}
	}
}
func TestShopV4NewCurrentCannotRenewOriginalLoan(t *testing.T) {
	now := time.Now()
	ctx := context.Background()
	owner := "0x1111111111111111111111111111111111111111"
	a := &Authority{}
	a.state.Store(&epoch{scope: ScopeDATA{NetworkID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Account: owner}})
	h := &Hold{parent: a, scope: ReadScopeDATA{Actor: owner, Role: "buyer"}, epoch: &epoch{until: now.Add(time.Minute)}}
	p := &shopV4Projection{Account: "PUBLIC-account", SessionBinding: "PUBLIC-session", Identity: shopV4Identity{NetworkID: a.state.Load().scope.NetworkID, CanonicalOwner: owner, Account: "PUBLIC-account", SessionBinding: "PUBLIC-session", ProductID: "shop"}, Role: "buyer", Scopes: []string{"account:read", "shop:orders:write", "shop:profile:write"}, SessionOriginal: "PUBLIC-session-original", IssuerExpires: now.Add(time.Hour).UnixMilli(), SessionExpires: now.Add(time.Minute).UnixMilli(), ProofExpires: now.Add(30 * time.Second).UnixMilli(), LoanUntil: now.Add(4 * time.Second).UnixMilli(), NonceConsumed: true, SignatureVerified: true, IdentityVerified: true, RequestDigest: "PUBLIC-request", DataOnly: true}
	p.SessionDigest = rawDigest([]byte(p.SessionOriginal))
	v := &VerifiedShopGET{hold: h, ctx: ctx, requestDigest: p.RequestDigest, wallStart: now.UnixMilli(), until: now.Add(5 * time.Second)}
	if e := v.acceptProjection(p, true); e != nil {
		t.Fatal(e)
	}
	originalUntil := v.until
	v.stable = stableShopV4(p)
	p.NonceConsumed = false
	p.LoanUntil = now.Add(20 * time.Second).UnixMilli()
	if e := v.acceptProjection(p, false); e != nil {
		t.Fatal(e)
	}
	if !v.until.Equal(originalUntil) {
		t.Fatal("fresh one-shot child renewed original loan")
	}
	p.SessionDigest = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if e := v.acceptProjection(p, false); e == nil {
		t.Fatal("changed stable session cannot be substituted")
	}
}
func publicProcessAuthority(t *testing.T, output string) (*Authority, context.Context) {
	t.Helper()
	home, e := os.UserHomeDir()
	if e != nil {
		t.Fatal(e)
	}
	dir, e := os.MkdirTemp(filepath.Join(home, ".codex"), "PUBLIC-shop-v4-pinned-process-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	script := filepath.Join(dir, "original-auth-identity-source-verifier.mjs")
	raw := []byte("cat >/dev/null\nprintf '%s' '" + output + "'\n")
	if e = os.WriteFile(script, raw, 0600); e != nil {
		t.Fatal(e)
	}
	manifest := filepath.Join(dir, "closure.json")
	files := []originalPin{}
	for _, name := range []string{"native/original-shop-v4-get-dispatch.mjs", "src/original-shop-v4-get-server.js", "src/product-pair-session-v4-source.js", "src/product-pair-session-v4-store.js", "src/original-product-device-v4-server-current.js"} {
		files = append(files, originalPin{Path: name})
	}
	m, _ := json.Marshal(struct {
		Version string        `json:"version"`
		Files   []originalPin `json:"files"`
	}{"YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1", files})
	if e = os.WriteFile(manifest, m, 0600); e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	a := &Authority{parent: ctx, files: originalFiles{uid: uint32(os.Geteuid())}, release: release{node: originalPin{Path: "/bin/sh"}, verifier: originalPin{Path: script}, manifest: originalPin{Path: manifest, Bytes: int64(len(m)), SHA256: rawDigest(m)}}}
	a.state.Store(&epoch{observation: &semanticObservation{1}, until: time.Now().Add(time.Minute), wallStart: time.Now().UnixMilli()})
	if _, e = a.load(a.release.manifest); e != nil {
		t.Fatal(e)
	}
	a.release.verifier.Bytes = int64(len(raw))
	a.release.verifier.SHA256 = rawDigest(raw)
	if _, e = a.load(a.release.verifier); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { a.files.close() })
	return a, ctx
}
func TestShopV4ActualOwnedProcessPairedZeroAndPinnedDrift(t *testing.T) {
	a, ctx := publicProcessAuthority(t, `{"version":1,"phase":"VERIFY","errorPresent":true,"failure":{"code":"PUBLIC_FAILURE","firstKind":"number","firstValue":0},"projection":null}`)
	p, e := a.shopV4Runtime(ctx, "VERIFY", []byte(`{}`))
	var failure *shopV4Failure
	if p != nil || !errors.As(e, &failure) || failure.FirstKind != "number" || string(failure.FirstValue) != "0" {
		t.Fatal("real process raw-zero failure lost", e)
	}
	if e = os.WriteFile(a.release.verifier.Path, []byte("PUBLIC changed"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = a.shopV4Runtime(ctx, "VERIFY", []byte(`{}`)); e == nil {
		t.Fatal("held verifier drift must deny before execution")
	}
}
func TestShopV4CurrentLocalDoesNotRunProcess(t *testing.T) {
	ctx := context.Background()
	a := &Authority{parent: ctx}
	h := &Hold{parent: a, ctx: ctx}
	v := &VerifiedShopGET{hold: h, ctx: ctx, cancel: func() {}, until: time.Now().Add(time.Second), wallStart: time.Now().UnixMilli()}
	v.verified.Store(true)
	// Missing actual LINK caller fails using only the original atomic/local
	// Source fence, never by launching or trusting any process output.
	if e := v.CurrentLocal(ctx); e == nil {
		t.Fatal("missing Source/caller cannot admit DATA")
	}
}

func TestShopV4NonComparableContextFailsWithoutPanic(t *testing.T) {
	ctx := struct {
		context.Context
		Bits []int
	}{context.Background(), []int{1}}
	h := &Hold{parent: &Authority{}, ctx: ctx}
	if v, err := h.VerifyOriginalShopGET(ctx); v != nil || !errors.Is(err, ErrDenied) {
		t.Fatal("unrecognized context must refuse without comparison panic", err)
	}
	v := &VerifiedShopGET{hold: h}
	if err := v.CurrentLocal(ctx); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
}

func TestShopV4SelectedCloseCompletesLocalDebtAfterOriginalWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := &Authority{changed: make(chan struct{}, 1)}
	a.children.Store(1)
	h := &Hold{parent: a, ctx: ctx}
	v := &VerifiedShopGET{hold: h, ctx: ctx, cancel: cancel}
	h.v4.Store(v)
	v.active.Store(1)
	if e := h.Close(); !errors.Is(e, ErrPending) {
		t.Fatal(e)
	}
	if a.children.Load() != 1 {
		t.Fatal("released before original process finished")
	}
	first := errors.New("PUBLIC original late process failure")
	v.remember(first)
	v.finishOriginalWork()
	if a.children.Load() != 0 || !v.physical.Load() {
		t.Fatal("completed original work must drain selected local parent debt")
	}
	if e := h.Close(); e != first {
		t.Fatal("cleanup completion must preserve original failure", e)
	}
}
