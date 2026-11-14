// Package egressguard is a candidate PUBLIC Snowflake backend output guard.
// It is not wired into the frozen publisher binary and grants no browser authority.
package egressguard

import (
	"errors"
	"io"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Pion's pinned candidate_base.WriteTo propagates io.ErrClosedPipe but swallows
// other write errors. The policy cause must retain that mature failure semantic.
type PolicyRejection struct{}

func (PolicyRejection) Error() string { return "public entry endpoint rejected" }
func (PolicyRejection) Unwrap() error { return io.ErrClosedPipe }

var (
	ErrBlocked    error = PolicyRejection{}
	ErrResolution       = errors.New("approved entry DNS resolution failed")
)

// Conservative policy, not an assertion of physical routability. All special-purpose
// prefixes are rejected, including some globally reachable exceptions. Source snapshot:
// IANA IPv4/IPv6 Special-Purpose registries, last updated 2025-10-09, read 2026-11-07.
var special = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.31.196.0/24"), netip.MustParsePrefix("192.52.193.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("192.175.48.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("2620:4f:8000::/48"),
	netip.MustParsePrefix("3fff::/20"),
}

var ipv6Global = netip.MustParsePrefix("2000::/3")

func publicIP(ip netip.Addr) bool {
	if !ip.IsValid() || ip.Zone() != "" {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false
	}
	if ip.Is6() && !ipv6Global.Contains(ip) {
		return false
	}
	for _, prefix := range special {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func numericEndpoint(address string) (netip.AddrPort, error) {
	p, err := netip.ParseAddrPort(address)
	if err != nil || p.Port() == 0 || !publicIP(p.Addr()) {
		return netip.AddrPort{}, ErrBlocked
	}
	return netip.AddrPortFrom(p.Addr().Unmap(), p.Port()), nil
}

func udpEndpoint(addr net.Addr) (netip.AddrPort, error) {
	u, ok := addr.(*net.UDPAddr)
	if !ok || u == nil || u.Port < 1 || u.Port > 65535 || u.Zone != "" {
		return netip.AddrPort{}, ErrBlocked
	}
	ip, ok := netip.AddrFromSlice(u.IP)
	if !ok || !publicIP(ip) {
		return netip.AddrPort{}, ErrBlocked
	}
	return netip.AddrPortFrom(ip.Unmap(), uint16(u.Port)), nil
}

type endpointPolicy interface {
	allow(net.Addr) error
	live() bool
	deadline() time.Time
}
type publicPeerPolicy struct{ dns *ApprovedDNS }

func (p publicPeerPolicy) live() bool { return p.dns == nil || p.dns.live() }
func (p publicPeerPolicy) deadline() time.Time {
	if p.dns == nil {
		return time.Time{}
	}
	return p.dns.expires
}

func (p publicPeerPolicy) allow(addr net.Addr) error {
	if p.dns != nil && !p.dns.live() {
		return ErrBlocked
	}
	_, err := udpEndpoint(addr)
	return err
}

// STUNPolicy is an immutable exact numeric tuple set prepared from reviewed sources.
// A server's RFC5780 OTHER-ADDRESS response never adds an endpoint to this set.
type STUNPolicy struct {
	peers   map[netip.AddrPort]struct{}
	expires time.Time
	clock   *boundedLifetime
}
type boundedLifetime struct {
	wallExpiry time.Time
	duration   time.Duration
	now        func() time.Time
	elapsed    func() time.Duration
	expired    atomic.Bool
}

func newLifetime(expires time.Time) (*boundedLifetime, time.Time, error) {
	start := time.Now()
	duration := expires.Sub(start)
	if duration <= 0 || duration > 15*time.Minute {
		return nil, time.Time{}, ErrBlocked
	}
	deadline := start.Add(duration)
	return &boundedLifetime{wallExpiry: expires.Round(0), duration: duration, now: time.Now, elapsed: func() time.Duration { return time.Since(start) }}, deadline, nil
}
func (c *boundedLifetime) live() bool {
	if c == nil || c.expired.Load() {
		return false
	}
	elapsed := c.elapsed()
	valid := elapsed >= 0 && elapsed < c.duration && c.now().Round(0).Before(c.wallExpiry)
	if !valid {
		c.expired.Store(true)
	}
	return valid
}

func NewSTUNPolicy(peers []netip.AddrPort, expires time.Time) (*STUNPolicy, error) {
	clock, deadline, e := newLifetime(expires)
	if len(peers) == 0 || len(peers) > 64 || e != nil {
		return nil, ErrBlocked
	}
	p := &STUNPolicy{peers: make(map[netip.AddrPort]struct{}, len(peers)), expires: deadline, clock: clock}
	for _, peer := range peers {
		canonical, err := numericEndpoint(peer.String())
		if err != nil {
			return nil, err
		}
		p.peers[canonical] = struct{}{}
	}
	return p, nil
}
func (p *STUNPolicy) allow(addr net.Addr) error {
	peer, err := udpEndpoint(addr)
	if err != nil || !p.live() {
		return ErrBlocked
	}
	if _, ok := p.peers[peer]; !ok {
		return ErrBlocked
	}
	return nil
}
func (p *STUNPolicy) live() bool { return p != nil && p.clock.live() }
func (p *STUNPolicy) deadline() time.Time {
	if p == nil {
		return time.Time{}
	}
	return p.expires
}

// ApprovedDNS is a closed, expiring numeric map, not a resolver or an authority.
// An external, separately reviewed preparation step must supply these bindings.
// There is no default resolver fallback, so this library emits no DNS request.
type ApprovedDNS struct {
	fronts, stun map[string]struct{}
	addresses    map[string][]netip.Addr
	expires      time.Time
	clock        *boundedLifetime
}

func validName(name string) bool {
	if len(name) < 3 || len(name) > 253 || name != strings.ToLower(name) || strings.HasSuffix(name, ".") {
		return false
	}
	if _, e := netip.ParseAddr(name); e == nil {
		return false
	}
	labels := strings.Split(name, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return !strings.HasSuffix(name, ".local") && !strings.HasSuffix(name, ".localhost")
}

// Names are explicit reviewed inputs; this constructor is not an authorization source.
func NewApprovedDNS(fronts, stun []string, addresses map[string][]netip.Addr, expires time.Time) (*ApprovedDNS, error) {
	clock, deadline, e := newLifetime(expires)
	if len(fronts) != 2 || len(stun) != 8 || e != nil {
		return nil, ErrBlocked
	}
	p := &ApprovedDNS{fronts: map[string]struct{}{}, stun: map[string]struct{}{}, addresses: map[string][]netip.Addr{}, expires: deadline, clock: clock}
	for _, pair := range []struct {
		names []string
		dst   map[string]struct{}
	}{{fronts, p.fronts}, {stun, p.stun}} {
		for _, name := range pair.names {
			if !validName(name) {
				return nil, ErrBlocked
			}
			if _, exists := pair.dst[name]; exists {
				return nil, ErrBlocked
			}
			pair.dst[name] = struct{}{}
			ips := addresses[name]
			if len(ips) == 0 || len(ips) > 64 {
				return nil, ErrResolution
			}
			for _, ip := range ips {
				if !publicIP(ip) {
					return nil, ErrBlocked
				}
				p.addresses[name] = append(p.addresses[name], ip.Unmap())
			}
		}
	}
	for name := range addresses {
		if _, ok := p.addresses[name]; !ok {
			return nil, ErrBlocked
		}
	}
	return p, nil
}

func (p *ApprovedDNS) live() bool { return p != nil && p.clock.live() }
func (p *ApprovedDNS) resolveSTUN(network, address string) (*net.UDPAddr, error) {
	host, port, e := net.SplitHostPort(address)
	if !p.live() || e != nil || port != "3478" {
		return nil, ErrBlocked
	}
	if _, ok := p.stun[host]; !ok {
		return nil, ErrBlocked
	}
	ips := p.addresses[host]
	if len(ips) == 0 {
		return nil, ErrResolution
	}
	for _, ip := range ips {
		ip = ip.Unmap()
		if network == "udp4" && !ip.Is4() || network == "udp6" && !ip.Is6() {
			continue
		}
		return &net.UDPAddr{IP: net.IP(ip.AsSlice()), Port: 3478}, nil
	}
	return nil, ErrResolution
}

func udpNetwork(network string) bool {
	return network == "udp" || network == "udp4" || network == "udp6"
}
func familyEndpoint(network string, endpoint netip.AddrPort) bool {
	return udpNetwork(network) && (network != "udp4" || endpoint.Addr().Is4()) && (network != "udp6" || endpoint.Addr().Is6())
}
func localAddress(address string) bool {
	host, port, e := net.SplitHostPort(address)
	if e != nil {
		return false
	}
	n, e := strconv.Atoi(port)
	if e != nil || n < 0 || n > 65535 {
		return false
	}
	if host == "" {
		return true
	}
	ip, e := netip.ParseAddr(host)
	return e == nil && ip.Zone() == "" && !ip.IsMulticast()
}
