package egressguard

import (
	"context"
	"github.com/pion/transport/v4"
	"net"
	"net/netip"
)

// PeerNet implements every method of the pinned transport.Net interface explicitly.
// ICE uses UDP only; TCP/raw IP/unix and implicit arbitrary DNS are rejected.
type PeerNet struct {
	base transport.Net
	dns  *ApprovedDNS
}

var _ transport.Net = (*PeerNet)(nil)

func NewPeerNet(base transport.Net, dns *ApprovedDNS) (*PeerNet, error) {
	if base == nil || dns == nil {
		return nil, ErrBlocked
	}
	return &PeerNet{base: base, dns: dns}, nil
}
func (n *PeerNet) ListenPacket(network, address string) (net.PacketConn, error) {
	if !n.dns.live() || (network != "udp4" && network != "udp6") || !localAddress(address) {
		return nil, ErrBlocked
	}
	c, e := n.base.ListenPacket(network, address)
	if e != nil {
		return nil, e
	}
	return &packetConn{base: c, policy: publicPeerPolicy{dns: n.dns}, network: network}, nil
}
func (n *PeerNet) ListenUDP(network string, a *net.UDPAddr) (transport.UDPConn, error) {
	if !n.dns.live() || (network != "udp4" && network != "udp6") || (a != nil && !localAddress(a.String())) {
		return nil, ErrBlocked
	}
	c, e := n.base.ListenUDP(network, a)
	if e != nil {
		return nil, e
	}
	wrapped, e := newUDPConn(c, network, nil)
	if e == nil {
		wrapped.policy = publicPeerPolicy{dns: n.dns}
	}
	return wrapped, e
}
func (n *PeerNet) ListenTCP(string, *net.TCPAddr) (transport.TCPListener, error) {
	return nil, ErrBlocked
}
func (n *PeerNet) DialTCP(string, *net.TCPAddr, *net.TCPAddr) (transport.TCPConn, error) {
	return nil, ErrBlocked
}
func (n *PeerNet) ResolveTCPAddr(string, string) (*net.TCPAddr, error) { return nil, ErrBlocked }
func (n *PeerNet) Dial(network, address string) (net.Conn, error) {
	p, e := numericEndpoint(address)
	if e != nil || !familyEndpoint(network, p) {
		return nil, ErrBlocked
	}
	return n.DialUDP(network, nil, &net.UDPAddr{IP: net.IP(p.Addr().AsSlice()), Port: int(p.Port())})
}
func (n *PeerNet) DialUDP(network string, local, remote *net.UDPAddr) (transport.UDPConn, error) {
	p, e := udpEndpoint(remote)
	if !n.dns.live() || e != nil || !familyEndpoint(network, p) || (local != nil && !localAddress(local.String())) {
		return nil, ErrBlocked
	}
	if network == "udp" {
		network = "udp6"
		if p.Addr().Is4() {
			network = "udp4"
		}
	}
	// Canonical copy prevents a caller's later IP-slice mutation from changing the dial target.
	a := &net.UDPAddr{IP: append(net.IP(nil), p.Addr().AsSlice()...), Port: int(p.Port())}
	c, e := n.base.DialUDP(network, local, a)
	if e != nil {
		return nil, e
	}
	actual, f := udpEndpoint(c.RemoteAddr())
	if f != nil || actual != p {
		c.Close()
		return nil, ErrBlocked
	}
	wrapped, e := newUDPConn(c, network, &p)
	if e == nil {
		wrapped.policy = publicPeerPolicy{dns: n.dns}
	}
	return wrapped, e
}
func (n *PeerNet) ResolveUDPAddr(network, address string) (*net.UDPAddr, error) {
	if !n.dns.live() || !udpNetwork(network) {
		return nil, ErrBlocked
	}
	if p, e := numericEndpoint(address); e == nil {
		if !familyEndpoint(network, p) {
			return nil, ErrBlocked
		}
		return &net.UDPAddr{IP: net.IP(p.Addr().AsSlice()), Port: int(p.Port())}, nil
	}
	return n.dns.resolveSTUN(network, address)
}
func (n *PeerNet) ResolveIPAddr(network, address string) (*net.IPAddr, error) {
	ip, e := netip.ParseAddr(address)
	if !n.dns.live() || e != nil || !publicIP(ip) {
		return nil, ErrBlocked
	}
	ip = ip.Unmap()
	if network != "ip" && network != "ip4" && network != "ip6" || network == "ip4" && !ip.Is4() || network == "ip6" && !ip.Is6() {
		return nil, ErrBlocked
	}
	return &net.IPAddr{IP: net.IP(ip.AsSlice())}, nil
}
func (n *PeerNet) Interfaces() ([]*transport.Interface, error) { return n.base.Interfaces() }
func (n *PeerNet) InterfaceByIndex(i int) (*transport.Interface, error) {
	return n.base.InterfaceByIndex(i)
}
func (n *PeerNet) InterfaceByName(name string) (*transport.Interface, error) {
	return n.base.InterfaceByName(name)
}

type peerDialer struct{ owner *PeerNet }

func (d *peerDialer) Dial(network, address string) (net.Conn, error) {
	return d.owner.Dial(network, address)
}
func (n *PeerNet) CreateDialer(*net.Dialer) transport.Dialer { return &peerDialer{owner: n} }

type listenConfig struct{ owner *PeerNet }

func (c *listenConfig) Listen(context.Context, string, string) (net.Listener, error) {
	return nil, ErrBlocked
}
func (c *listenConfig) ListenPacket(ctx context.Context, network, address string) (net.PacketConn, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	return c.owner.ListenPacket(network, address)
}
func (n *PeerNet) CreateListenConfig(*net.ListenConfig) transport.ListenConfig {
	return &listenConfig{owner: n}
}
