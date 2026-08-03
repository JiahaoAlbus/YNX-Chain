package social

import (
	"bytes"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

func TestResolveDiscoveryRejectsUnconfiguredContactsAndResolvesInvite(t *testing.T) {
	now := time.Date(2026, 8, 4, 0, 0, 0, 0, time.UTC)
	service, err := New(Config{StatePath: filepath.Join(t.TempDir(), "social.json"), TokenKey: bytes.Repeat([]byte{11}, 32), Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	actor := Session{ID: "session-discovery", Account: "ynx1x5yl8yfkg7tf2d5epe0nz26krqvzqlffan26wz", DeviceID: "device-discovery", Scopes: []string{"social.contacts"}, ExpiresAt: now.Add(time.Hour)}
	_, token, err := service.CreateInvite(actor, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	account, err := service.ResolveDiscovery("invite", token)
	if err != nil || account != actor.Account {
		t.Fatalf("invite resolution account=%q err=%v", account, err)
	}
	if _, err := service.ResolveDiscovery("contacts", "f9d6d31c410b6518732483377fc7d7f6b16b97f50dbd6d80e7ebf0f2a57dfc52"); err == nil {
		t.Fatal("contacts matching must fail closed without an approved matcher")
	}
}

func TestResolveDiscoveryByHandleAndQR(t *testing.T) {
	now := time.Date(2026, 8, 4, 0, 0, 0, 0, time.UTC)
	dir := t.TempDir()
	squareService, err := square.New(square.Config{StatePath: filepath.Join(dir, "square.json"), APIKey: "discovery-square-key", MaxBodyBytes: 16 * 1024, RateLimitWindow: time.Minute, RateLimitMax: 100, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(Config{StatePath: filepath.Join(dir, "social.json"), TokenKey: bytes.Repeat([]byte{12}, 32), Now: func() time.Time { return now }, Square: squareService})
	if err != nil {
		t.Fatal(err)
	}
	// Unknown handles and malformed QR values fail closed; successful handle
	// resolution is covered by the signed Square profile integration tests.
	if _, err := service.ResolveDiscovery("handle", "missing_handle"); err == nil {
		t.Fatal("unknown handle must not resolve")
	}
	if _, err := service.ResolveDiscovery("qr", "https://example.invalid/profile"); err == nil {
		t.Fatal("foreign QR payload must not resolve")
	}
}
