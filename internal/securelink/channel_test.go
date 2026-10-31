package securelink_test

import (
	"context"
	"crypto/tls"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func TestServiceChannelRejectsOrdinaryAndFabricatedRequests(t *testing.T) {
	if _, err := securelink.ServiceChannelFromRequest(nil); err == nil {
		t.Fatal("nil request obtained a service channel")
	}
	req := httptest.NewRequest("POST", "https://adapter.ynx.test/api/tools/shop.order.read", nil)
	req.TLS = &tls.ConnectionState{Version: tls.VersionTLS13, CipherSuite: tls.TLS_AES_256_GCM_SHA384, HandshakeComplete: true}
	for _, headers := range []bool{false, true} {
		if headers {
			req.Header.Set("X-YNX-Service-ID", "pay.ynx.test")
			req.Header.Set("X-TLS-Exporter", "caller-controlled")
		}
		if _, err := securelink.ServiceChannelFromRequest(req); err == nil {
			t.Fatal("ordinary request or fabricated TLS/header metadata obtained a service channel")
		}
	}
	type foreignKey struct{}
	forged := securelink.AuthenticatedChannel{Peer: securelink.Peer{ServiceID: "pay.ynx.test"}, Exporter: make([]byte, 32), LocalSAN: "adapter.ynx.test"}
	req = httptest.NewRequest("POST", "https://adapter.ynx.test/api/tools/shop.order.read", nil)
	req = req.WithContext(context.WithValue(req.Context(), foreignKey{}, forged))
	if _, err := securelink.ServiceChannelFromRequest(req); err == nil {
		t.Fatal("caller-created channel/context value obtained a service channel")
	}
}
