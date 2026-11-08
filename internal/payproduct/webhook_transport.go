package payproduct

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"time"
)

const webhookDispatchTimeout = 10 * time.Second

// The ordinary merchant URL is untrusted. Resolve on every new dispatch and
// dial only the checked numeric address, never the hostname a second time.
// An original explicitly supplied client may instead pin a commissioned
// recipient (or the PUBLIC TLS integration fixture); no request selects it.
func newWebhookHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: webhookDispatchTimeout}
	return &http.Client{Timeout: webhookDispatchTimeout, Transport: &http.Transport{
		Proxy:                 nil,
		DialContext:           webhookPublicDial(net.DefaultResolver.LookupNetIP, dialer.DialContext),
		DisableKeepAlives:     true,
		TLSHandshakeTimeout:   webhookDispatchTimeout,
		ResponseHeaderTimeout: webhookDispatchTimeout,
		MaxConnsPerHost:       2,
	}}
}

var webhookNonPublicRanges = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func webhookPublicAddress(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.Zone() != "" || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, prefix := range webhookNonPublicRanges {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func webhookPublicDial(lookup func(context.Context, string, string) ([]netip.Addr, error), dial func(context.Context, string, string) (net.Conn, error)) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		var ips []netip.Addr
		if ip, err := netip.ParseAddr(host); err == nil {
			ips = []netip.Addr{ip}
		} else {
			ips, err = lookup(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
		}
		if len(ips) == 0 {
			return nil, errors.New("webhook target has no public address")
		}
		for _, ip := range ips {
			if !webhookPublicAddress(ip) {
				return nil, errors.New("webhook target address is not public")
			}
		}
		for _, ip := range ips {
			if err = ctx.Err(); err != nil {
				return nil, err
			}
			var conn net.Conn
			conn, err = dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
			if err == nil {
				return conn, nil
			}
		}
		return nil, err
	}
}
