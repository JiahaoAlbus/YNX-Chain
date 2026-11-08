package productreadsource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestReadUnchangedAndCloseUnknown(t *testing.T) {
	dir := ownedProtectedFixture(t)
	p := filepath.Join(dir, "original")
	body := []byte("PUBLIC immutable original")
	sum := sha256.Sum256(body)
	if e := os.WriteFile(p, body, 0600); e != nil {
		t.Fatal(e)
	}
	before, e := os.ReadDir(dir)
	if e != nil {
		t.Fatal(e)
	}
	names := func(ds []os.DirEntry) []string {
		out := []string{}
		for _, d := range ds {
			out = append(out, d.Name())
		}
		return out
	}
	a := publicAuthority("/public/none")
	a.files.uid = uint32(os.Geteuid())
	if _, e = a.files.hold(p, hex.EncodeToString(sum[:]), 1024); e != nil {
		t.Fatal(e)
	}
	if e = a.files.current(); e != nil {
		t.Fatal(e)
	}
	after, e := os.ReadDir(dir)
	if e != nil || !reflect.DeepEqual(names(before), names(after)) {
		t.Fatal("read changed list", e)
	}
	actual, e := os.ReadFile(p)
	if e != nil || sha256.Sum256(actual) != sum {
		t.Fatal("read changed bytes")
	}
	if e = a.files.files[0].file.Close(); e != nil {
		t.Fatal(e)
	}
	first := a.Close()
	if first == nil || !errors.Is(first, ErrUnknown) || a.Close() != first {
		t.Fatal("UNKNOWN close first cause not sticky", first)
	}
	if a.atomicCurrent(context.Background(), nil) == nil {
		t.Fatal("UNKNOWN revived")
	}
}

func TestAtomicObservedWindowNoRevival(t *testing.T) {
	for _, name := range []string{"expired", "rollback", "cancel", "retire", "epoch"} {
		t.Run(name, func(t *testing.T) {
			a := publicAuthority("/public/none")
			old := a.state.Load()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if a.atomicCurrent(ctx, old) != nil {
				t.Fatal("initial")
			}
			switch name {
			case "expired":
				old.until = time.Now().Add(-time.Second)
			case "rollback":
				old.wallStart = time.Now().Add(time.Hour).UnixMilli()
			case "cancel":
				cancel()
			case "retire":
				a.Retire()
			case "epoch":
				next := *old
				next.observation = &semanticObservation{1}
				a.state.Store(&next)
			}
			if a.atomicCurrent(ctx, old) == nil {
				t.Fatal("invalid current")
			}
			if a.children.Load() != 0 {
				t.Fatal("fabricated child")
			}
		})
	}
}
func TestRetireCloseDebtAndCancellation(t *testing.T) {
	a := publicAuthority("/public/none")
	old := a.state.Load()
	a.children.Add(1)
	if !errors.Is(a.Close(), ErrPending) || !a.retired.Load() {
		t.Fatal("early close")
	}
	if a.atomicCurrent(context.Background(), old) == nil {
		t.Fatal("retire failed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(a.Join(ctx), context.Canceled) {
		t.Fatal("join ignored cancellation")
	}
	a.children.Add(-1)
	if e := a.Join(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e := a.Close(); e != nil {
		t.Fatal(e)
	}
	a.Retire()
	if e := a.Close(); e != nil {
		t.Fatal(e)
	}
	if a.atomicCurrent(context.Background(), old) == nil {
		t.Fatal("close revival")
	}
}
func TestProtectedResourceCrossBinding(t *testing.T) {
	a := publicAuthority("/public/socket")
	s := a.state.Load()
	if e := validateResource(s.resource, s.scope); e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(s.resource)
	for _, edit := range []func(*resourceOriginal){func(r *resourceOriginal) { r.Account = "0x" + "0000000000000000000000000000000000000000" }, func(r *resourceOriginal) {
		r.NetworkID = "0000000000000000000000000000000000000000000000000000000000000000"
	}, func(r *resourceOriginal) { r.ProtectedResourceRef = "wrong.ref" }, func(r *resourceOriginal) { r.Epoch = 0 }, func(r *resourceOriginal) { r.Bindings[0].SourceOrder = "other-order" }, func(r *resourceOriginal) { r.Bindings[0].Role = "admin" }, func(r *resourceOriginal) { r.Bindings[0].StoreID = "" }, func(r *resourceOriginal) { r.Socket = "../unprotected" }, func(r *resourceOriginal) { r.Orders = append(r.Orders, r.Orders[0]) }} {
		var r resourceOriginal
		if e := decode(raw, &r); e != nil {
			t.Fatal(e)
		}
		edit(&r)
		if validateResource(r, s.scope) == nil {
			t.Fatal("wrong protected mapping accepted")
		}
	}
}
func TestActualSoleSDKScopeProjection(t *testing.T) {
	raw, e := os.ReadFile("testdata/sole-sdk-scope.json")
	if e != nil {
		t.Fatal("run normal supplier controls with actual sole SDK DATA fixture generator", e)
	}
	var v struct {
		Scope           ScopeDATA `json:"scope"`
		DataOnly        bool      `json:"dataOnly"`
		Authorized      bool      `json:"authorized"`
		SourceAdmission bool      `json:"SourceAdmission"`
	}
	if decode(raw, &v) != nil || !v.DataOnly || v.Authorized || v.SourceAdmission || validateScope(v.Scope) != nil {
		t.Fatal("sole SDK DATA mismatch")
	}
	if v.Scope.Products[0].ProductID != "shop.order" || v.Scope.Products[1].ProductID != "cloud.ide-usage" {
		t.Fatal("two products not preserved")
	}
	if a, e := OpenOriginalProductReadAuthority(context.Background()); a != nil || !errors.Is(e, ErrNotSupplied) {
		t.Fatal("DATA became admission")
	}
}
