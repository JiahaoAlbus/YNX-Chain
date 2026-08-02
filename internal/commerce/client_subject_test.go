package commerce

import (
	"net/http/httptest"
	"testing"
)

func TestClientSubjectUsesForwardedClientOnlyFromLoopbackProxy(t *testing.T) {
	req := httptest.NewRequest("GET", "/health", nil)
	req.RemoteAddr = "127.0.0.1:48120"
	req.Header.Set("X-Forwarded-For", "203.0.113.40, 10.0.0.2")
	if got := clientSubject(req); got != "203.0.113.40" {
		t.Fatalf("trusted proxy subject = %q", got)
	}
}

func TestClientSubjectRejectsSpoofedForwardedClientFromPublicPeer(t *testing.T) {
	req := httptest.NewRequest("GET", "/health", nil)
	req.RemoteAddr = "198.51.100.18:48120"
	req.Header.Set("X-Forwarded-For", "203.0.113.40")
	if got := clientSubject(req); got != "198.51.100.18" {
		t.Fatalf("public peer subject = %q", got)
	}
}

func TestClientSubjectNormalizesIPv6Peer(t *testing.T) {
	req := httptest.NewRequest("GET", "/health", nil)
	req.RemoteAddr = "[2001:db8::42]:48120"
	if got := clientSubject(req); got != "2001:db8::42" {
		t.Fatalf("IPv6 subject = %q", got)
	}
}
