package egressguard

import (
	"github.com/pion/transport/v4"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"
)

// Fields are deliberately private and no underlying interface is embedded/exported.
type packetConn struct {
	base     net.PacketConn
	policy   endpointPolicy
	network  string
	closed   atomic.Bool
	once     sync.Once
	closeErr error
	read     readDeadline
}

// Scope expiry must also bound an already pending read. Preserve a caller's shorter
// deadline; do not replace it with a later policy time or add a new timer/worker.
type readDeadline struct {
	mu        sync.Mutex
	requested time.Time
}

func earlier(a, b time.Time) time.Time {
	if a.IsZero() {
		return b
	}
	if b.IsZero() || a.Before(b) {
		return a
	}
	return b
}
func (r *readDeadline) set(t, scope time.Time) time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requested = t
	return earlier(t, scope)
}
func (r *readDeadline) bound(scope time.Time) time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return earlier(r.requested, scope)
}

func GuardSTUNPacketConn(base net.PacketConn, policy *STUNPolicy) (net.PacketConn, error) {
	if base == nil || policy == nil {
		return nil, ErrBlocked
	}
	return &packetConn{base: base, policy: policy, network: "udp4"}, nil
}
func (c *packetConn) Close() error {
	c.closed.Store(true)
	c.once.Do(func() { c.closeErr = c.base.Close() })
	return c.closeErr
}
func (c *packetConn) deny() error         { _ = c.Close(); return ErrBlocked }
func (c *packetConn) LocalAddr() net.Addr { return c.base.LocalAddr() }
func (c *packetConn) SetDeadline(t time.Time) error {
	return c.base.SetDeadline(c.read.set(t, c.policy.deadline()))
}
func (c *packetConn) SetReadDeadline(t time.Time) error {
	return c.base.SetReadDeadline(c.read.set(t, c.policy.deadline()))
}
func (c *packetConn) SetWriteDeadline(t time.Time) error {
	return c.base.SetWriteDeadline(earlier(t, c.policy.deadline()))
}
func (c *packetConn) WriteTo(b []byte, a net.Addr) (int, error) {
	copy, e := copyTarget(a, c.network)
	if c.closed.Load() || e != nil || c.policy.allow(copy) != nil {
		return 0, c.deny()
	}
	return c.base.WriteTo(b, copy)
}
func (c *packetConn) ReadFrom(b []byte) (int, net.Addr, error) {
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		return 0, nil, c.deny()
	}
	if e := c.base.SetReadDeadline(c.read.bound(c.policy.deadline())); e != nil {
		clear(b)
		return 0, nil, e
	}
	n, a, e := c.base.ReadFrom(b)
	// Close may happen while the owned read is suspended. A public source is not a
	// permission to deliver a late packet after this exact wrapper was revoked.
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		return 0, nil, c.deny()
	}
	if n == 0 && e != nil && a == nil {
		clear(b)
		return 0, nil, e
	}
	copy, f := copyTarget(a, c.network)
	if f != nil || c.policy.allow(copy) != nil {
		clear(b)
		return 0, nil, c.deny()
	}
	return n, copy, e
}

type udpConn struct {
	base     transport.UDPConn
	policy   endpointPolicy
	network  string
	expected *netip.AddrPort
	closed   atomic.Bool
	once     sync.Once
	closeErr error
	read     readDeadline
}

var _ transport.UDPConn = (*udpConn)(nil)

func newUDPConn(base transport.UDPConn, network string, expected *netip.AddrPort) (*udpConn, error) {
	if base == nil {
		return nil, ErrBlocked
	}
	c := &udpConn{base: base, policy: publicPeerPolicy{}, network: network}
	if expected != nil {
		p := *expected
		c.expected = &p
	}
	return c, nil
}
func copyTarget(a net.Addr, network string) (*net.UDPAddr, error) {
	u, ok := a.(*net.UDPAddr)
	if !ok || u == nil {
		return nil, ErrBlocked
	}
	copy := &net.UDPAddr{IP: append(net.IP(nil), u.IP...), Port: u.Port, Zone: u.Zone}
	p, e := udpEndpoint(copy)
	if e != nil || !familyEndpoint(network, p) {
		return nil, ErrBlocked
	}
	return &net.UDPAddr{IP: net.IP(p.Addr().AsSlice()), Port: int(p.Port())}, nil
}
func (c *udpConn) Close() error {
	c.closed.Store(true)
	c.once.Do(func() { c.closeErr = c.base.Close() })
	return c.closeErr
}
func (c *udpConn) deny() error          { _ = c.Close(); return ErrBlocked }
func (c *udpConn) LocalAddr() net.Addr  { return c.base.LocalAddr() }
func (c *udpConn) RemoteAddr() net.Addr { return c.base.RemoteAddr() }
func (c *udpConn) SetDeadline(t time.Time) error {
	return c.base.SetDeadline(c.read.set(t, c.policy.deadline()))
}
func (c *udpConn) SetReadDeadline(t time.Time) error {
	return c.base.SetReadDeadline(c.read.set(t, c.policy.deadline()))
}
func (c *udpConn) SetWriteDeadline(t time.Time) error {
	return c.base.SetWriteDeadline(earlier(t, c.policy.deadline()))
}
func (c *udpConn) SetReadBuffer(n int) error  { return c.base.SetReadBuffer(n) }
func (c *udpConn) SetWriteBuffer(n int) error { return c.base.SetWriteBuffer(n) }

func (c *udpConn) connected() (netipEndpoint string, err error) {
	if c.closed.Load() || c.expected == nil {
		return "", ErrBlocked
	}
	a := c.base.RemoteAddr()
	if e := c.policy.allow(a); e != nil {
		return "", e
	}
	p, _ := udpEndpoint(a)
	if p != *c.expected || !familyEndpoint(c.network, p) {
		return "", ErrBlocked
	}
	return p.String(), nil
}
func (c *udpConn) target(a net.Addr) error {
	if c.closed.Load() {
		return ErrBlocked
	}
	if e := c.policy.allow(a); e != nil {
		return e
	}
	if c.expected != nil {
		if _, e := c.connected(); e != nil {
			return e
		}
		y, f := udpEndpoint(a)
		if f != nil || y != *c.expected {
			return ErrBlocked
		}
	} else if c.base.RemoteAddr() != nil {
		return ErrBlocked
	}
	return nil
}
func (c *udpConn) Write(b []byte) (int, error) {
	if _, e := c.connected(); e != nil {
		return 0, c.deny()
	}
	return c.base.Write(b)
}
func (c *udpConn) WriteTo(b []byte, a net.Addr) (int, error) {
	copy, e := copyTarget(a, c.network)
	if e != nil || c.target(copy) != nil {
		return 0, c.deny()
	}
	return c.base.WriteTo(b, copy)
}
func (c *udpConn) WriteToUDP(b []byte, a *net.UDPAddr) (int, error) {
	copy, e := copyTarget(a, c.network)
	if e != nil || c.target(copy) != nil {
		return 0, c.deny()
	}
	return c.base.WriteToUDP(b, copy)
}
func (c *udpConn) WriteMsgUDP(b, oob []byte, a *net.UDPAddr) (int, int, error) {
	if len(oob) != 0 {
		return 0, 0, c.deny()
	}
	if a == nil {
		if _, e := c.connected(); e != nil {
			return 0, 0, c.deny()
		}
		return c.base.WriteMsgUDP(b, nil, nil)
	}
	copy, e := copyTarget(a, c.network)
	if e != nil || c.target(copy) != nil {
		return 0, 0, c.deny()
	}
	return c.base.WriteMsgUDP(b, nil, copy)
}
func (c *udpConn) Read(b []byte) (int, error) {
	before, e := c.connected()
	if e != nil {
		clear(b)
		return 0, c.deny()
	}
	if e := c.base.SetReadDeadline(c.read.bound(c.policy.deadline())); e != nil {
		clear(b)
		return 0, e
	}
	n, e := c.base.Read(b)
	after, f := c.connected()
	if f != nil || before != after {
		clear(b)
		return 0, c.deny()
	}
	return n, e
}
func (c *udpConn) ReadFrom(b []byte) (int, net.Addr, error) {
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		return 0, nil, c.deny()
	}
	if e := c.base.SetReadDeadline(c.read.bound(c.policy.deadline())); e != nil {
		clear(b)
		return 0, nil, e
	}
	n, a, e := c.base.ReadFrom(b)
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		return 0, nil, c.deny()
	}
	if n == 0 && e != nil && a == nil {
		clear(b)
		return 0, nil, e
	}
	copy, f := copyTarget(a, c.network)
	if f != nil || c.target(copy) != nil {
		clear(b)
		return 0, nil, c.deny()
	}
	return n, copy, e
}
func (c *udpConn) ReadFromUDP(b []byte) (int, *net.UDPAddr, error) {
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		return 0, nil, c.deny()
	}
	if e := c.base.SetReadDeadline(c.read.bound(c.policy.deadline())); e != nil {
		clear(b)
		return 0, nil, e
	}
	n, a, e := c.base.ReadFromUDP(b)
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		return 0, nil, c.deny()
	}
	if n == 0 && e != nil && a == nil {
		clear(b)
		return 0, nil, e
	}
	copy, f := copyTarget(a, c.network)
	if f != nil || c.target(copy) != nil {
		clear(b)
		return 0, nil, c.deny()
	}
	return n, copy, e
}
func (c *udpConn) ReadMsgUDP(b, oob []byte) (int, int, int, *net.UDPAddr, error) {
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		clear(oob)
		return 0, 0, 0, nil, c.deny()
	}
	if e := c.base.SetReadDeadline(c.read.bound(c.policy.deadline())); e != nil {
		clear(b)
		clear(oob)
		return 0, 0, 0, nil, e
	}
	n, oobn, flags, a, e := c.base.ReadMsgUDP(b, oob)
	if c.closed.Load() || !c.policy.live() {
		clear(b)
		clear(oob)
		return 0, 0, 0, nil, c.deny()
	}
	if n == 0 && oobn == 0 && e != nil && a == nil {
		clear(b)
		clear(oob)
		return 0, 0, 0, nil, e
	}
	copy, f := copyTarget(a, c.network)
	if f != nil || c.target(copy) != nil {
		clear(b)
		clear(oob)
		return 0, 0, 0, nil, c.deny()
	}
	return n, oobn, flags, copy, e
}
