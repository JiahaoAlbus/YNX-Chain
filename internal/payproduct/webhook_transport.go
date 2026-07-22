package payproduct

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type WebhookResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type defaultWebhookResolver struct{}

var blockedWebhookNetworks = []*net.IPNet{
	mustCIDR("0.0.0.0/8"),
	mustCIDR("100.64.0.0/10"),
	mustCIDR("192.0.0.0/24"),
	mustCIDR("192.0.2.0/24"),
	mustCIDR("198.18.0.0/15"),
	mustCIDR("198.51.100.0/24"),
	mustCIDR("203.0.113.0/24"),
	mustCIDR("240.0.0.0/4"),
	mustCIDR("2001:db8::/32"),
}

func (defaultWebhookResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

func newWebhookHTTPClient(provided *http.Client, resolver WebhookResolver) *http.Client {
	if provided != nil {
		copy := *provided
		copy.CheckRedirect = rejectWebhookRedirect
		return &copy
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = webhookDialContext(resolver)
	return &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: rejectWebhookRedirect}
}

func rejectWebhookRedirect(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}

func webhookDialContext(resolver WebhookResolver) func(context.Context, string, string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, errors.New("webhook destination address is invalid")
		}
		addresses, err := resolvePublicWebhookHost(ctx, host, resolver)
		if err != nil {
			return nil, err
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].IP.String(), port))
	}
}

func validateWebhookDestination(ctx context.Context, endpoint string, resolver WebhookResolver) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return errors.New("webhook destination is invalid")
	}
	_, err = resolvePublicWebhookHost(ctx, u.Hostname(), resolver)
	return err
}

func resolvePublicWebhookHost(ctx context.Context, host string, resolver WebhookResolver) ([]net.IPAddr, error) {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".home.arpa") {
		return nil, errors.New("webhook destination must use a public DNS host")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !publicWebhookIP(ip) {
			return nil, errors.New("webhook destination resolved to a non-public address")
		}
		return []net.IPAddr{{IP: ip}}, nil
	}
	addresses, err := resolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("webhook destination DNS resolution failed")
	}
	for _, address := range addresses {
		if !publicWebhookIP(address.IP) {
			return nil, errors.New("webhook destination resolved to a non-public address")
		}
	}
	return addresses, nil
}

func webhookHostSyntaxAllowed(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	return host != "" && net.ParseIP(host) == nil && host != "localhost" && !strings.HasSuffix(host, ".localhost") && !strings.HasSuffix(host, ".local") && !strings.HasSuffix(host, ".internal") && !strings.HasSuffix(host, ".home.arpa")
}

func publicWebhookIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return false
	}
	for _, blocked := range blockedWebhookNetworks {
		if blocked.Contains(ip) {
			return false
		}
	}
	return true
}

func mustCIDR(value string) *net.IPNet {
	_, network, err := net.ParseCIDR(value)
	if err != nil {
		panic(err)
	}
	return network
}
