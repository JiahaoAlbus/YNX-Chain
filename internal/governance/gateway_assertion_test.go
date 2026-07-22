package governance

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func assertionRequest(key []byte, now time.Time, nonce string, body []byte) *http.Request {
	id := SessionIdentity{Account: "ynx1delegate", DeviceID: "device-1", SessionID: "session-1"}
	r := httptest.NewRequest(http.MethodPost, "/governance/proposals", bytes.NewReader(body))
	r.Header.Set("X-YNX-Verified-Account", id.Account)
	r.Header.Set("X-YNX-Verified-Device-ID", id.DeviceID)
	r.Header.Set("X-YNX-Verified-Session-ID", id.SessionID)
	r.Header.Set("X-YNX-Verified-Product", "governance")
	r.Header.Set("X-YNX-Gateway-Timestamp", strconv64(now.Unix()))
	r.Header.Set("X-YNX-Gateway-Nonce", nonce)
	r.Header.Set("X-YNX-Gateway-Signature", SignGatewayAssertion(key, r.Method, r.URL.EscapedPath(), body, id, "governance", now, nonce))
	return r
}
func strconv64(v int64) string { return fmt.Sprintf("%d", v) }

func TestGatewayAssertionBindsBodyIdentityProductExpiryAndReplay(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	roles := func(account string, _ time.Time) Entitlements {
		return Entitlements{Roles: map[string]bool{"proposer": account == "ynx1delegate"}, Scopes: map[Scope]bool{ScopeBridge: true}}
	}
	a, err := NewGatewayAssertionAuthenticator(key, roles, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"scope":"bridge_provider_limits"}`)
	r := assertionRequest(key, now, "nonce-0000000001", body)
	p, err := a.Authenticate(r)
	if err != nil || p.Account != "ynx1delegate" {
		t.Fatalf("valid assertion: %+v %v", p, err)
	}
	restored, _ := io.ReadAll(r.Body)
	if !bytes.Equal(restored, body) {
		t.Fatal("body not restored")
	}
	if _, err = a.Authenticate(assertionRequest(key, now, "nonce-0000000001", body)); !errors.Is(err, ErrReplay) {
		t.Fatalf("replay: %v", err)
	}
	tampered := assertionRequest(key, now, "nonce-0000000002", body)
	tampered.Body = io.NopCloser(strings.NewReader(`{"scope":"treasury"}`))
	if _, err = a.Authenticate(tampered); err == nil {
		t.Fatal("tampered body accepted")
	}
	wrong := assertionRequest(key, now, "nonce-0000000003", body)
	wrong.Header.Set("X-YNX-Verified-Product", "wallet")
	if _, err = a.Authenticate(wrong); err == nil {
		t.Fatal("wrong product accepted")
	}
	now = now.Add(time.Minute)
	if _, err = a.Authenticate(assertionRequest(key, now.Add(-time.Minute), "nonce-0000000004", body)); err == nil {
		t.Fatal("expired assertion accepted")
	}
}
