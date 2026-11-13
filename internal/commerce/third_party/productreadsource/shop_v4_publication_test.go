package productreadsource

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func TestShopV4NoHoldPublishedAfterPhysicalAuthorityClose(t *testing.T) {
	socket := filepath.Join(ownedProtectedFixture(t), "sock")
	a := publicAuthority(socket)
	path := shopPath("order-001")
	routes := []securelink.LocalCallerRoute{{Method: http.MethodGet, Path: path, MaxBodyBytes: 0, Timeout: 4 * time.Second}}
	type outcome struct {
		err       error
		children  int64
		published bool
	}
	results := make(chan outcome, 1)
	server, err := securelink.NewProductSessionProofV4LocalCallerServer(securelink.LocalCallerServerConfig{
		Service: "ynx-shop-source", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: routes,
		MaxHeaderBytes: securelink.MaxProductSessionProofV4RequestHeaderBytes,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Model the continuation of a previously current Auth call after
			// its parent has completed close. Request is a real V4 LINK caller.
			if e := a.Close(); e != nil {
				results <- outcome{err: e}
				return
			}
			if e := a.AssertOriginalClosed(); e != nil {
				results <- outcome{err: e}
				return
			}
			h, e := a.openShopReadAtCurrent(r.Context(), r, "shop.order", "order-001")
			results <- outcome{e, a.children.Load(), h != nil}
			if h != nil {
				_ = h.Close()
			}
			w.WriteHeader(http.StatusNoContent)
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := securelink.ListenPrivate(socket, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	defer server.Close()
	go server.Serve(listener)
	// One PUBLIC test request on the actual bounded V4 listener; the lexical
	// header deliberately confers no proof, Root, session or Source approval.
	c, err := net.DialTimeout("unix", socket, 4*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err = c.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err = fmt.Fprintf(c, "GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%s: Aa\r\nConnection: close\r\n\r\n", path, securelink.ProductSessionProofV4Header); err != nil {
		t.Fatal(err)
	}
	original, err := http.ReadResponse(bufio.NewReader(c), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer original.Body.Close()
	if original.StatusCode != http.StatusNoContent {
		t.Fatal(original.StatusCode)
	}
	select {
	case got := <-results:
		if !errors.Is(got.err, ErrRetired) || got.published || got.children != 0 {
			t.Fatalf("physically closed Authority published a late Hold: %+v", got)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("no original LINK handler result")
	}
	if err := a.AssertOriginalClosed(); err != nil {
		t.Fatal(err)
	}
}

func TestShopV4NoProofPublishedAfterHoldRelease(t *testing.T) {
	ctx := context.Background()
	a := publicAuthority("/public/unused")
	h := &Hold{parent: a, ctx: ctx}
	a.children.Store(1)
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}
	if err := h.AssertOriginalClosed(); err != nil {
		t.Fatal(err)
	}
	v, err := h.VerifyOriginalShopGET(ctx)
	if !errors.Is(err, ErrRetired) || v != nil || h.v4.Load() != nil {
		t.Fatalf("released Hold published a late proof: owner=%t stored=%t err=%v", v != nil, h.v4.Load() != nil, err)
	}
	if err := h.AssertOriginalClosed(); err != nil || a.children.Load() != 0 {
		t.Fatal("late verify changed actual physical release", err)
	}
}

func TestShopV4PublishedProofAndConcurrentCloseKeepOriginalDebt(t *testing.T) {
	for i := 0; i < 64; i++ {
		ctx := context.Background()
		a := publicAuthority("/public/unused")
		h := &Hold{parent: a, ctx: ctx}
		a.children.Store(1)
		type result struct {
			owner *VerifiedShopGET
			err   error
		}
		out := make(chan result, 1)
		released := make(chan error, 1)
		start := make(chan struct{})
		go func() {
			<-start
			owner, err := h.VerifyOriginalShopGET(ctx)
			out <- result{owner, err}
		}()
		go func() {
			<-start
			released <- h.Close()
		}()
		close(start)
		got := <-out
		<-released
		if got.err == nil || got.owner != h.v4.Load() {
			t.Fatal("unqualified proof escaped or lost its original child", got.err)
		}
		// A partial selected before retirement is retained through close;
		// absence after retirement must not create or redispatch a proof.
		if got.owner != nil {
			if again, err := h.VerifyOriginalShopGET(ctx); again != got.owner || err != got.err {
				t.Fatal("original partial and first error were replaced", err)
			}
			if err := got.owner.AssertOriginalClosed(); err != nil {
				t.Fatal("original child still has outstanding local work", err)
			}
		}
		if err := h.AssertOriginalClosed(); err != nil || a.children.Load() != 0 {
			t.Fatal("parent did not drain exactly once", err)
		}
	}
}
