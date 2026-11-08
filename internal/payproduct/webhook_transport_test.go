package payproduct

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"reflect"
	"testing"
)

func TestWebhookPublicDialRejectsPrivateMixedAndRebinding(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "240.0.0.1", "198.18.0.1", "192.0.2.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1%en0", "64:ff9b::a00:1", "2001:db8::1", "2002:a00:1::", "3fff::1"} {
		t.Run(ip, func(t *testing.T) {
			called := false
			dial := webhookPublicDial(func(context.Context, string, string) ([]netip.Addr, error) {
				return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr(ip)}, nil
			}, func(context.Context, string, string) (net.Conn, error) {
				called = true
				return nil, errors.New("unexpected")
			})
			if _, err := dial(context.Background(), "tcp", "recipient.example:443"); err == nil || called {
				t.Fatal("mixed public/private DNS reached network", called, err)
			}
		})
	}
	var lookups int
	var destinations []string
	firstFailure := errors.New("first public address unavailable")
	dial := webhookPublicDial(func(context.Context, string, string) ([]netip.Addr, error) {
		lookups++
		if lookups == 1 {
			return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("2606:4700:4700::1111")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}, func(_ context.Context, _, address string) (net.Conn, error) {
		destinations = append(destinations, address)
		return nil, firstFailure
	})
	_, err := dial(context.Background(), "tcp", "recipient.example:443")
	if err != firstFailure || lookups != 1 || !reflect.DeepEqual(destinations, []string{"8.8.8.8:443", "[2606:4700:4700::1111]:443"}) {
		t.Fatal("hostname was re-resolved or checked IP changed", err, lookups, destinations)
	}
	_, err = dial(context.Background(), "tcp", "recipient.example:443")
	if err == nil || len(destinations) != 2 {
		t.Fatal("next dispatch accepted DNS rebinding", err, destinations)
	}
	client := newWebhookHTTPClient()
	transport := client.Transport.(*http.Transport)
	if transport.Proxy != nil || !transport.DisableKeepAlives || client.Timeout != webhookDispatchTimeout {
		t.Fatal("default transport allows proxy, connection reuse, or unbounded dispatch")
	}
}
