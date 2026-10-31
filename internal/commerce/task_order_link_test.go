package commerce

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func TestShopTaskOrderLINKRejectsUnsealedRequestBeforeSDK(t *testing.T) {
	s, _, p, v, c, body := publicShopTaskFixture(t)
	cfg, err := p.configured(context.Background(), ServerConfig{})
	if err != nil {
		t.Fatal(err)
	}
	cfg.taskOrders = originalLINKTaskOrderReader{cfg.taskOrders}
	server := NewServer(s, cfg)
	for _, fake := range []bool{false, true} {
		r := httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(body))
		r.Header.Set("Content-Type", ShopOrderReadRequestContentType)
		if fake {
			r.TLS = &tls.ConnectionState{HandshakeComplete: true}
			r.Header.Set("X-Tool-Class", "read")
			r.Header.Set("X-Authenticated-Peer", "pretend-service")
			r = r.Clone(r.Context())
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		if w.Code != 503 || c.decodes != 0 || v.opens != 0 {
			t.Fatal("ordinary TLS/headers reached SDK/authority", fake, w.Code, c.decodes, v.opens)
		}
	}
}

func TestShopTaskOrderLINKExplicitMediaProfileAndBudgets(t *testing.T) {
	op, err := ShopOrderReadLINKOperation(64<<10, 512<<10)
	if err != nil || op.MediaProfile != securelink.MediaProfileShopOrderReadV1 || op.MaxRequestBytes != 64<<10 || op.MaxResponseBytes != 512<<10 || op.Method != "POST" || op.Path != shopOrderReadPath {
		t.Fatal(op, err)
	}
	for _, limits := range [][2]int64{{0, 1}, {1, 0}, {(1 << 20) + 1, 1}, {1, (1 << 20) + 1}} {
		if _, err := ShopOrderReadLINKOperation(limits[0], limits[1]); !errors.Is(err, ErrInvalidState) {
			t.Fatal("profile budget broadened", limits, err)
		}
	}
}

func TestShopTaskOrderE5MediaAndEnvelopeBudget(t *testing.T) {
	for _, media := range [][]string{{}, {"application/json"}, {"application/cbor"}, {ShopOrderReadRequestContentType + "; charset=utf-8"}, {"Application/vnd.ynx.shop-order-read.v1"}, {ShopOrderReadRequestContentType, ShopOrderReadRequestContentType}} {
		s, _, p, v, c, body := publicShopTaskFixture(t)
		server, err := p.OpenOriginal(context.Background(), func() (*Store, error) { return s, nil }, ServerConfig{})
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(body))
		for _, value := range media {
			r.Header.Add("Content-Type", value)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		if w.Code != 415 || c.decodes != 0 || v.opens != 0 {
			t.Fatal("media alias reached codec/Source", media, w.Code, c.decodes, v.opens)
		}
	}
	for _, size := range []int{40 << 10, (1 << 20) + 1} {
		s, _, p, _, c, _ := publicShopTaskFixture(t)
		server, err := p.OpenOriginal(context.Background(), func() (*Store, error) { return s, nil }, ServerConfig{})
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(bytes.Repeat([]byte(" "), size)))
		r.Header.Set("Content-Type", ShopOrderReadRequestContentType)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		if size > 1<<20 {
			if w.Code != 413 || c.decodes != 0 {
				t.Fatal("oversized E5 reached codec", w.Code, c.decodes)
			}
		} else if c.decodes != 1 || w.Code == 413 {
			t.Fatal("old 32KiB carrier cap still applied", w.Code, c.decodes)
		}
	}
}

func TestShopTaskOrderLINKMissingProfileNeverOpensStore(t *testing.T) {
	_, _, p, _, _, _ := publicShopTaskFixture(t)
	opens := 0
	server, err := p.OpenOriginalLINK(context.Background(), func() (*Store, error) { opens++; return Open("") }, ServerConfig{}, securelink.HTTPServerConfig{})
	if !errors.Is(err, ErrUnavailable) || server != nil || opens != 0 {
		t.Fatal("empty LINK profile opened original Store", err, opens)
	}
}
