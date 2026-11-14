package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
)

func TestShopTaskOrderStartupWithoutPublisherDoesNotAdmitPublicRoute(t *testing.T) {
	store, err := commerce.Open("")
	if err != nil {
		t.Fatal(err)
	}
	cfg := commerce.ServerConfig{}
	listens := 0
	partial := &shopTaskOrderPublisher{listen: func(_ context.Context) (net.Listener, error) {
		listens++
		return nil, errors.New("must not listen")
	}}
	for _, publisher := range []*shopTaskOrderPublisher{nil, partial} {
		runtime, err := openShopTaskOrderRuntime(t.Context(), store, cfg, publisher)
		if !errors.Is(err, errShopTaskOrderPublisherNotSupplied) || runtime != nil || listens != 0 {
			t.Fatalf("incomplete publisher reached startup: %v, listens=%d", err, listens)
		}
		// The ordinary native host keeps its denial even with a caller hint.
		server := commerce.NewServer(store, cfg)
		handler := composeOriginalNativeShopAPI(server.Handler(), server.Handler(), nil)
		req := httptest.NewRequest(http.MethodPost, "https://shop-api.ynxweb4.com/api/tools/shop.order.read", strings.NewReader("{}"))
		req.Header.Set("Content-Type", commerce.ShopOrderReadRequestContentType)
		req.Header.Set("X-Authenticated-Peer", "wrong-borrower")
		reply := httptest.NewRecorder()
		handler.ServeHTTP(reply, req)
		if reply.Code != 503 || !strings.Contains(reply.Body.String(), "SHOP_TASK_ORDER_READ_NOT_ADMITTED") {
			t.Fatalf("ordinary route did not deny: %d %s", reply.Code, reply.Body.String())
		}
	}
}

type uncertainTaskOrderListener struct {
	net.Listener
	calls int
	cause error
}

func (l *uncertainTaskOrderListener) Close() error {
	l.calls++
	return l.cause
}

func TestShopTaskOrderStartupRetainsUncertainOriginalListener(t *testing.T) {
	original := &uncertainTaskOrderListener{cause: errors.New("original close outcome unknown")}
	runtime := &shopTaskOrderRuntime{listener: original}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	for range 2 {
		if err := runtime.close(ctx); !errors.Is(err, original.cause) {
			t.Fatalf("lost original close cause: %v", err)
		}
	}
	if runtime.closed || runtime.listener != original || original.calls != 1 {
		t.Fatal("uncertain close released or retried the original listener")
	}
	if err := runtime.serve(); !errors.Is(err, net.ErrClosed) {
		t.Fatal("partial with cleanup debt could serve", err)
	}
}

func TestShopTaskOrderStartupCannotServePartialRuntime(t *testing.T) {
	original := &uncertainTaskOrderListener{}
	runtime := &shopTaskOrderRuntime{listener: original}
	if err := runtime.serve(); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("partial runtime should refuse serve: %v", err)
	}
	if runtime.served || original.calls != 0 {
		t.Fatal("serve took ownership of a partial runtime listener")
	}
}
