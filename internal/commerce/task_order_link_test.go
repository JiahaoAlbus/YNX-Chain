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

func TestShopTaskOrderLINKMissingProfileNeverOpensStore(t *testing.T) {
	_, _, p, _, _, _ := publicShopTaskFixture(t)
	opens := 0
	server, err := p.OpenOriginalLINK(context.Background(), func() (*Store, error) { opens++; return Open("") }, ServerConfig{}, securelink.HTTPServerConfig{})
	if !errors.Is(err, ErrUnavailable) || server != nil || opens != 0 {
		t.Fatal("empty LINK profile opened original Store", err, opens)
	}
}
