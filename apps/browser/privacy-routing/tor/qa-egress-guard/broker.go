package egressguard

import (
	"context"
	"net"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// BrokerDialer must be injected at the actual uTLS dialTLS private dialer, not merely
// the unused outer HTTP transport. It does not replace/modify TLS, SNI or RootCAs.
// The zero value is deliberately unusable.
type BrokerDialer struct {
	dns     *ApprovedDNS
	timeout time.Duration
}

func NewBrokerDialer(dns *ApprovedDNS, timeout time.Duration) (*BrokerDialer, error) {
	if dns == nil || timeout <= 0 || timeout > 30*time.Second {
		return nil, ErrBlocked
	}
	return &BrokerDialer{dns: dns, timeout: timeout}, nil
}
func (d *BrokerDialer) approvedAddress(network, address string) error {
	if d == nil || !d.dns.live() || (network != "tcp" && network != "tcp4" && network != "tcp6") {
		return ErrBlocked
	}
	host, port, e := net.SplitHostPort(address)
	if e != nil || port != "443" {
		return ErrBlocked
	}
	if _, ok := d.dns.fronts[host]; !ok {
		return ErrBlocked
	}
	return nil
}

// control is invoked by Go after socket creation and before connect. It is private:
// only DialContext binds it to the reviewed original host and exact numeric target.
// The original name check is separate, and every numeric family/fallback is checked.
func (d *BrokerDialer) control(ctx context.Context, network, address string, _ syscall.RawConn) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	if d == nil || !d.dns.live() || (network != "tcp4" && network != "tcp6") {
		return ErrBlocked
	}
	p, e := numericEndpoint(address)
	if e != nil || p.Port() != 443 || network == "tcp4" && !p.Addr().Is4() || network == "tcp6" && !p.Addr().Is6() {
		return ErrBlocked
	}
	return nil
}
func (d *BrokerDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if e := d.approvedAddress(network, address); e != nil {
		return nil, e
	}
	host, _, _ := net.SplitHostPort(address)
	// Preserve hostname at the original TLS caller; only this underlying TCP dial receives
	// a numeric binding. No system DNS, caller-supplied dialer, or proxy fallback is used.
	for _, ip := range d.dns.addresses[host] {
		if network == "tcp4" && !ip.Is4() || network == "tcp6" && !ip.Is6() {
			continue
		}
		family := "tcp6"
		if ip.Is4() {
			family = "tcp4"
		}
		target := net.JoinHostPort(ip.String(), "443")
		dialer := net.Dialer{Timeout: d.timeout, ControlContext: func(c context.Context, n, a string, r syscall.RawConn) error {
			if a != target || n != family {
				return ErrBlocked
			}
			return d.control(c, n, a, r)
		}}
		conn, e := dialer.DialContext(ctx, family, target)
		if e != nil {
			return nil, e
		}
		actual, e := numericEndpoint(conn.RemoteAddr().String())
		expected, _ := numericEndpoint(target)
		if e != nil || actual != expected || !d.dns.live() {
			conn.Close()
			return nil, ErrBlocked
		}
		return &brokerConn{base: conn, owner: d, expected: target}, nil
	}
	return nil, ErrResolution
}

// Private wrapper does not expose *TCPConn.File/SyscallConn. Expiry is checked on
// all payload I/O; the QA owner must still close connections on scope cancellation.
type brokerConn struct {
	base     net.Conn
	owner    *BrokerDialer
	expected string
	closed   atomic.Bool
	once     sync.Once
	closeErr error
	read     readDeadline
}

func (c *brokerConn) valid() bool {
	if c.closed.Load() || !c.owner.dns.live() {
		return false
	}
	p, e := numericEndpoint(c.base.RemoteAddr().String())
	return e == nil && p.String() == c.expected
}
func (c *brokerConn) Read(b []byte) (int, error) {
	if !c.valid() {
		clear(b)
		c.Close()
		return 0, ErrBlocked
	}
	if e := c.base.SetReadDeadline(c.read.bound(c.owner.dns.expires)); e != nil {
		clear(b)
		return 0, e
	}
	n, e := c.base.Read(b)
	if !c.valid() {
		clear(b)
		c.Close()
		return 0, ErrBlocked
	}
	return n, e
}
func (c *brokerConn) Write(b []byte) (int, error) {
	if !c.valid() {
		c.Close()
		return 0, ErrBlocked
	}
	return c.base.Write(b)
}
func (c *brokerConn) Close() error {
	c.closed.Store(true)
	c.once.Do(func() { c.closeErr = c.base.Close() })
	return c.closeErr
}
func (c *brokerConn) LocalAddr() net.Addr  { return c.base.LocalAddr() }
func (c *brokerConn) RemoteAddr() net.Addr { return c.base.RemoteAddr() }
func (c *brokerConn) SetDeadline(t time.Time) error {
	return c.base.SetDeadline(c.read.set(t, c.owner.dns.expires))
}
func (c *brokerConn) SetReadDeadline(t time.Time) error {
	return c.base.SetReadDeadline(c.read.set(t, c.owner.dns.expires))
}
func (c *brokerConn) SetWriteDeadline(t time.Time) error {
	return c.base.SetWriteDeadline(earlier(t, c.owner.dns.expires))
}
