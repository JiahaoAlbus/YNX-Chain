package egressguard

import (
	"bytes"
	"context"
	"errors"
	"github.com/pion/transport/v4"
	"io"
	"net"
	"net/netip"
	"reflect"
	"syscall"
	"testing"
	"time"
)

func endpoint(s string) *net.UDPAddr {
	p := netip.MustParseAddrPort(s)
	return &net.UDPAddr{IP: net.IP(p.Addr().AsSlice()), Port: int(p.Port()), Zone: p.Addr().Zone()}
}

var good = "8.8.8.8:3478"

func dnsFixture(t *testing.T) *ApprovedDNS {
	t.Helper()
	fronts := []string{"front-a.example", "front-b.example"}
	stun := []string{"s1.example", "s2.example", "s3.example", "s4.example", "s5.example", "s6.example", "s7.example", "s8.example"}
	m := map[string][]netip.Addr{}
	for _, names := range [][]string{fronts, stun} {
		for _, name := range names {
			m[name] = []netip.Addr{netip.MustParseAddr("8.8.8.8")}
		}
	}
	d, e := NewApprovedDNS(fronts, stun, m, time.Now().Add(time.Minute))
	if e != nil {
		t.Fatal("fixture map rejected")
	}
	return d
}

// Only fake backends send/receive. They deliberately do not enforce Close themselves,
// so a post-denial underlying call is detected rather than hidden by the fake.
type fakeUDP struct {
	transport.UDPConn
	remote, source       net.Addr
	sends, reads, closes int
	last                 net.Addr
	onSend               func(net.Addr)
	onRead               func()
	readDeadline         time.Time
}

func (f *fakeUDP) RemoteAddr() net.Addr              { return f.remote }
func (f *fakeUDP) LocalAddr() net.Addr               { return &net.UDPAddr{IP: net.IPv4zero, Port: 12345} }
func (f *fakeUDP) Close() error                      { f.closes++; return nil }
func (f *fakeUDP) SetDeadline(time.Time) error       { return nil }
func (f *fakeUDP) SetReadDeadline(d time.Time) error { f.readDeadline = d; return nil }
func (f *fakeUDP) SetWriteDeadline(time.Time) error  { return nil }
func (f *fakeUDP) SetReadBuffer(int) error           { return nil }
func (f *fakeUDP) SetWriteBuffer(int) error          { return nil }
func (f *fakeUDP) sent(b []byte, a net.Addr) (int, error) {
	f.sends++
	f.last = a
	if f.onSend != nil {
		f.onSend(a)
	}
	return len(b), nil
}
func (f *fakeUDP) Write(b []byte) (int, error)                      { return f.sent(b, f.remote) }
func (f *fakeUDP) WriteTo(b []byte, a net.Addr) (int, error)        { return f.sent(b, a) }
func (f *fakeUDP) WriteToUDP(b []byte, a *net.UDPAddr) (int, error) { return f.sent(b, a) }
func (f *fakeUDP) WriteMsgUDP(b, oob []byte, a *net.UDPAddr) (int, int, error) {
	n, e := f.sent(b, a)
	return n, len(oob), e
}
func (f *fakeUDP) received(b []byte) (int, error) {
	f.reads++
	if f.onRead != nil {
		f.onRead()
	}
	copy(b, "synthetic-private-payload")
	return min(len(b), 25), io.EOF
}
func (f *fakeUDP) Read(b []byte) (int, error) { return f.received(b) }
func (f *fakeUDP) ReadFrom(b []byte) (int, net.Addr, error) {
	n, e := f.received(b)
	return n, f.source, e
}
func (f *fakeUDP) ReadFromUDP(b []byte) (int, *net.UDPAddr, error) {
	n, e := f.received(b)
	a, _ := f.source.(*net.UDPAddr)
	return n, a, e
}
func (f *fakeUDP) ReadMsgUDP(b, oob []byte) (int, int, int, *net.UDPAddr, error) {
	n, e := f.received(b)
	copy(oob, "private-oob")
	a, _ := f.source.(*net.UDPAddr)
	return n, min(len(oob), 11), 9, a, e
}
func (f *fakeUDP) SyscallConn() (syscall.RawConn, error) { panic("raw fake socket escaped") }

type fakeNet struct {
	transport.Net
	calls       int
	udp         *fakeUDP
	network     string
	wrongRemote bool
}

func (f *fakeNet) ListenUDP(n string, _ *net.UDPAddr) (transport.UDPConn, error) {
	f.calls++
	f.network = n
	return f.udp, nil
}
func (f *fakeNet) ListenPacket(n, _ string) (net.PacketConn, error) {
	f.calls++
	f.network = n
	return f.udp, nil
}
func (f *fakeNet) DialUDP(n string, _, r *net.UDPAddr) (transport.UDPConn, error) {
	f.calls++
	f.network = n
	f.udp.remote = r
	if f.wrongRemote {
		f.udp.remote = endpoint("127.0.0.1:9")
	}
	return f.udp, nil
}

type customAddr string

func (a customAddr) Network() string { return "udp" }
func (a customAddr) String() string  { return string(a) }

func TestConservativeNumericClasses(t *testing.T) {
	denied := []string{"0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "192.0.0.9", "192.0.2.1", "198.18.1.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "64:ff9b:1::1", "100::1", "2001::1", "2001:db8::1", "2002:7f00:1::1", "2620:4f:8000::1", "3fff::1", "5f00::1", "fc00::1", "fe80::1", "ff02::1", "2001:4860:4860::8888%en0"}
	for i, s := range denied {
		if publicIP(netip.MustParseAddr(s)) {
			t.Fatalf("denied class %d accepted", i)
		}
	}
	for _, s := range []string{"8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "::ffff:8.8.8.8"} {
		if !publicIP(netip.MustParseAddr(s)) {
			t.Fatal("ordinary public fake vector denied")
		}
	}
}

func TestAllSendPathsZeroInnerOnDenied(t *testing.T) {
	for method := 0; method < 4; method++ {
		for _, a := range []*net.UDPAddr{endpoint("127.0.0.1:443"), endpoint("10.1.2.3:9"), endpoint("[::ffff:192.168.1.1]:9"), endpoint("[fe80::1]:9"), endpoint("8.8.8.8:0"), {IP: net.ParseIP("8.8.8.8"), Port: 65536}, {IP: net.ParseIP("8.8.8.8"), Port: 3478, Zone: "en0"}, nil} {
			f := &fakeUDP{}
			var expected *netip.AddrPort
			if method == 0 {
				f.remote = a
				p := netip.MustParseAddrPort(good)
				expected = &p
			}
			c, _ := newUDPConn(f, "udp4", expected)
			var n int
			var e error
			switch method {
			case 0:
				n, e = c.Write([]byte("x"))
			case 1:
				n, e = c.WriteTo([]byte("x"), a)
			case 2:
				n, e = c.WriteToUDP([]byte("x"), a)
			case 3:
				n, _, e = c.WriteMsgUDP([]byte("x"), nil, a)
			}
			if n != 0 || !errors.Is(e, ErrBlocked) || !errors.Is(e, io.ErrClosedPipe) || f.sends != 0 || f.closes != 1 {
				t.Fatal("forbidden send escaped or wrong lifecycle")
			}
			_, _ = c.WriteTo([]byte("x"), endpoint(good))
			if f.sends != 0 || f.closes != 1 {
				t.Fatal("closed candidate reused")
			}
		}
	}
}

func TestPublicFakeSendCopyAndNoRawEscape(t *testing.T) {
	f := &fakeUDP{}
	c, _ := newUDPConn(f, "udp4", nil)
	original := endpoint(good)
	f.onSend = func(a net.Addr) {
		original.IP[0] = 127
		if a.(*net.UDPAddr).IP[0] == 127 {
			t.Fatal("caller mutation changed checked target")
		}
	}
	if n, e := c.WriteTo([]byte("synthetic"), original); e != nil || n != 9 || f.sends != 1 {
		t.Fatal("fake public path not reached")
	}
	if _, ok := any(c).(interface {
		SyscallConn() (syscall.RawConn, error)
	}); ok {
		t.Fatal("raw fd escape")
	}
	if _, ok := any(c).(interface{ File() (any, error) }); ok {
		t.Fatal("raw file escape")
	}
}

func TestAddressTypeFamilyAndOOBDenied(t *testing.T) {
	for _, a := range []net.Addr{customAddr(good), &net.TCPAddr{IP: net.ParseIP("8.8.8.8"), Port: 3478}, endpoint("[2001:4860:4860::8888]:3478")} {
		f := &fakeUDP{}
		c, _ := newUDPConn(f, "udp4", nil)
		if _, e := c.WriteTo([]byte("x"), a); !errors.Is(e, ErrBlocked) || f.sends != 0 {
			t.Fatal("type/family bypass")
		}
	}
	f := &fakeUDP{}
	c, _ := newUDPConn(f, "udp6", nil)
	if _, e := c.WriteTo([]byte("x"), endpoint("[::ffff:8.8.8.8]:9")); !errors.Is(e, ErrBlocked) {
		t.Fatal("mapped UDP6 ambiguity")
	}
	f = &fakeUDP{}
	c, _ = newUDPConn(f, "udp4", nil)
	if n, o, e := c.WriteMsgUDP([]byte("x"), []byte("ancillary"), endpoint(good)); n != 0 || o != 0 || !errors.Is(e, ErrBlocked) || f.sends != 0 {
		t.Fatal("OOB bypass")
	}
}

func TestReceiveBeforePeerReflexiveDelivery(t *testing.T) {
	for method := 0; method < 3; method++ {
		f := &fakeUDP{source: endpoint("192.168.1.1:9")}
		c, _ := newUDPConn(f, "udp4", nil)
		b, oob := make([]byte, 32), make([]byte, 32)
		var n, flags, o int
		var a net.Addr
		var e error
		switch method {
		case 0:
			n, a, e = c.ReadFrom(b)
		case 1:
			var u *net.UDPAddr
			n, u, e = c.ReadFromUDP(b)
			if u != nil {
				a = u
			}
		case 2:
			var u *net.UDPAddr
			n, o, flags, u, e = c.ReadMsgUDP(b, oob)
			if u != nil {
				a = u
			}
		}
		if n != 0 || o != 0 || flags != 0 || a != nil || !errors.Is(e, ErrBlocked) || !bytes.Equal(b, make([]byte, 32)) || !bytes.Equal(oob, make([]byte, 32)) || f.closes != 1 {
			t.Fatal("private read source/payload would reach prflx callback")
		}
	}
	f := &fakeUDP{source: endpoint(good)}
	c, _ := newUDPConn(f, "udp4", nil)
	if n, a, _ := c.ReadFrom(make([]byte, 32)); n == 0 || a == nil {
		t.Fatal("public fake receive not reached")
	}
}

func TestConnectedBindingAndReadMutation(t *testing.T) {
	p := netip.MustParseAddrPort(good)
	f := &fakeUDP{remote: endpoint(good)}
	c, _ := newUDPConn(f, "udp4", &p)
	if _, e := c.Write([]byte("x")); e != nil {
		t.Fatal("pinned fake remote denied")
	}
	if _, _, e := c.WriteMsgUDP([]byte("x"), nil, nil); e != nil {
		t.Fatal("pinned nil destination denied")
	}
	f.onRead = func() { f.remote = endpoint("127.0.0.1:9") }
	b := make([]byte, 32)
	if n, e := c.Read(b); n != 0 || !errors.Is(e, ErrBlocked) || !bytes.Equal(b, make([]byte, 32)) {
		t.Fatal("late remote replacement leaked bytes")
	}
	f = &fakeUDP{remote: endpoint(good)}
	c, _ = newUDPConn(f, "udp4", nil)
	if _, e := c.Write([]byte("x")); !errors.Is(e, ErrBlocked) || f.sends != 0 {
		t.Fatal("unproven connected peer self-authorized")
	}
}

func TestNetCapabilitiesDeniedWithoutInnerCalls(t *testing.T) {
	f := &fakeNet{udp: &fakeUDP{}}
	n, _ := NewPeerNet(f, dnsFixture(t))
	_, e1 := n.Dial("tcp", good)
	_, e2 := n.ListenTCP("tcp", nil)
	_, e3 := n.DialTCP("tcp", nil, nil)
	_, e4 := n.ResolveTCPAddr("tcp", good)
	_, e5 := n.CreateDialer(&net.Dialer{}).Dial("unix", "/tmp/not-used")
	_, e6 := n.CreateListenConfig(&net.ListenConfig{}).Listen(context.Background(), "tcp", ":0")
	_, e7 := n.ListenPacket("ip4:icmp", ":0")
	_, e8 := n.ListenPacket("udp", "0.0.0.0:0")
	_, e9 := n.ListenUDP("udp4", endpoint("224.0.0.1:9"))
	for _, e := range []error{e1, e2, e3, e4, e5, e6, e7, e8, e9} {
		if !errors.Is(e, ErrBlocked) {
			t.Fatal("unsupported capability allowed")
		}
	}
	if f.calls != 0 {
		t.Fatal("raw capability reached inner network")
	}
	if _, e := n.DialUDP("udp4", nil, endpoint("10.0.0.1:9")); !errors.Is(e, ErrBlocked) || f.calls != 0 {
		t.Fatal("private dial happened")
	}
}

func TestNetApprovedFakeAndActualRemoteValidation(t *testing.T) {
	f := &fakeNet{udp: &fakeUDP{}}
	n, _ := NewPeerNet(f, dnsFixture(t))
	if c, e := n.CreateDialer(&net.Dialer{}).Dial("udp", good); e != nil || c == nil || f.network != "udp4" {
		t.Fatal("generic UDP not canonicalized to explicit family")
	}
	f = &fakeNet{udp: &fakeUDP{}, wrongRemote: true}
	n, _ = NewPeerNet(f, dnsFixture(t))
	if _, e := n.DialUDP("udp4", nil, endpoint(good)); !errors.Is(e, ErrBlocked) || f.udp.closes != 1 {
		t.Fatal("wrong actual remote was adopted")
	}
	f = &fakeNet{udp: &fakeUDP{}}
	n, _ = NewPeerNet(f, dnsFixture(t))
	c, e := n.CreateListenConfig(&net.ListenConfig{}).ListenPacket(context.Background(), "udp4", "192.168.1.2:0")
	if e != nil {
		t.Fatal("local private bind incorrectly treated as remote")
	}
	if _, e = c.WriteTo([]byte("x"), endpoint("127.0.0.1:9")); !errors.Is(e, ErrBlocked) || f.udp.sends != 0 {
		t.Fatal("ListenConfig packet escaped")
	}
}

func TestNATOtherAddressCannotExpandScope(t *testing.T) {
	p, e := NewSTUNPolicy([]netip.AddrPort{netip.MustParseAddrPort(good)}, time.Now().Add(time.Minute))
	if e != nil {
		t.Fatal(e)
	}
	for _, target := range []string{"127.0.0.1:3478", "8.8.8.8:3479", "1.1.1.1:3478"} {
		f := &fakeUDP{}
		c, _ := GuardSTUNPacketConn(f, p)
		if n, e := c.WriteTo([]byte("synthetic-STUN"), endpoint(target)); n != 0 || !errors.Is(e, ErrBlocked) || f.sends != 0 || f.closes != 1 {
			t.Fatal("unreviewed OTHER-ADDRESS added itself")
		}
	}
	f := &fakeUDP{}
	c, _ := GuardSTUNPacketConn(f, p)
	if _, e := c.WriteTo([]byte("fake"), endpoint(good)); e != nil || f.sends != 1 {
		t.Fatal("fixed STUN fake target failed")
	}
	f = &fakeUDP{source: endpoint("10.0.0.1:3478")}
	c, _ = GuardSTUNPacketConn(f, p)
	b := make([]byte, 32)
	if n, a, e := c.ReadFrom(b); n != 0 || a != nil || !errors.Is(e, ErrBlocked) || !bytes.Equal(b, make([]byte, 32)) {
		t.Fatal("bad STUN response source delivered")
	}
}

func TestClosedDNSMapMissingExpiredAndNoFallback(t *testing.T) {
	d := dnsFixture(t)
	f := &fakeNet{udp: &fakeUDP{}}
	n, _ := NewPeerNet(f, d)
	if a, e := n.ResolveUDPAddr("udp4", "s1.example:3478"); e != nil || a.String() != good {
		t.Fatal("approved closed mapping missing")
	}
	for _, s := range []string{"private.local:3478", "front-a.example:3478", "s1.example:3479", "s1.example:stun", "127.0.0.1:3478", "[::ffff:127.0.0.1]:3478"} {
		if _, e := n.ResolveUDPAddr("udp4", s); e == nil {
			t.Fatal("unapproved mapping fell back")
		}
	}
	d.clock.now = func() time.Time { return d.expires }
	if _, e := n.ResolveUDPAddr("udp4", "s1.example:3478"); e == nil {
		t.Fatal("expired DNS mapping used")
	}
	if f.calls != 0 {
		t.Fatal("DNS fallback invoked inner Net")
	}
}

func TestDNSInputCopyAndPoisonedAnswerRejected(t *testing.T) {
	d := dnsFixture(t)
	fronts := []string{"front-a.example", "front-b.example"}
	stun := []string{"s1.example", "s2.example", "s3.example", "s4.example", "s5.example", "s6.example", "s7.example", "s8.example"}
	m := map[string][]netip.Addr{}
	for k, v := range d.addresses {
		m[k] = append([]netip.Addr(nil), v...)
	}
	copy, e := NewApprovedDNS(fronts, stun, m, time.Now().Add(time.Minute))
	if e != nil {
		t.Fatal(e)
	}
	m["s1.example"][0] = netip.MustParseAddr("127.0.0.1")
	if a, e := copy.resolveSTUN("udp4", "s1.example:3478"); e != nil || a.String() != good {
		t.Fatal("caller mutated closed mapping")
	}
	if _, e := NewApprovedDNS(fronts, stun, m, time.Now().Add(time.Minute)); !errors.Is(e, ErrBlocked) {
		t.Fatal("poisoned mixed DNS answer accepted")
	}
	delete(m, "s1.example")
	if _, e := NewApprovedDNS(fronts, stun, m, time.Now().Add(time.Minute)); !errors.Is(e, ErrResolution) {
		t.Fatal("missing map accepted")
	}
}

func TestBrokerNameAndResolvedNumericControl(t *testing.T) {
	d, _ := NewBrokerDialer(dnsFixture(t), time.Second)
	for _, a := range []string{"127.0.0.1:443", "front-a.example:80", "unknown.example:443", "front-a.example.:443", "FRONT-a.example:443"} {
		if _, e := d.DialContext(context.Background(), "tcp", a); !errors.Is(e, ErrBlocked) {
			t.Fatal("original broker target not rejected before network")
		}
	}
	for _, a := range []string{"127.0.0.1:443", "10.0.0.1:443", "[::ffff:127.0.0.1]:443", "8.8.8.8:80"} {
		if e := d.control(context.Background(), "tcp4", a, nil); !errors.Is(e, ErrBlocked) {
			t.Fatal("resolved private sockaddr not rejected")
		}
	}
	if e := d.control(context.Background(), "tcp4", "8.8.8.8:443", nil); e != nil {
		t.Fatal("public fake numeric control denied")
	}
	// Actual standard-library path: numeric loopback avoids DNS. Control rejects after
	// socket creation but before connect. No listener is started and no payload is sent.
	calls := 0
	dialer := net.Dialer{Timeout: time.Second, ControlContext: func(c context.Context, n, a string, r syscall.RawConn) error { calls++; return d.control(c, n, a, r) }}
	c, e := dialer.DialContext(context.Background(), "tcp4", "127.0.0.1:443")
	if c != nil {
		c.Close()
		t.Fatal("private connect unexpectedly succeeded")
	}
	if calls != 1 || !errors.Is(e, ErrBlocked) {
		t.Fatal("actual pre-connect control not reached/rejected")
	}
}

type fakeBroker struct {
	net.Conn
	writes, reads, closes int
	remote                net.Addr
}

func (f *fakeBroker) RemoteAddr() net.Addr        { return f.remote }
func (f *fakeBroker) Write(b []byte) (int, error) { f.writes++; return len(b), nil }
func (f *fakeBroker) Read(b []byte) (int, error)  { f.reads++; copy(b, "private"); return 7, nil }
func (f *fakeBroker) Close() error                { f.closes++; return nil }
func TestBrokerPayloadExpiryAndRemoteChange(t *testing.T) {
	d, _ := NewBrokerDialer(dnsFixture(t), time.Second)
	f := &fakeBroker{remote: &net.TCPAddr{IP: net.ParseIP("8.8.8.8"), Port: 443}}
	c := &brokerConn{base: f, owner: d, expected: "8.8.8.8:443"}
	if _, e := c.Write([]byte("fake-TLS")); e != nil || f.writes != 1 {
		t.Fatal("public fake TCP vector denied")
	}
	f.remote = &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 443}
	if _, e := c.Write([]byte("x")); !errors.Is(e, ErrBlocked) || f.writes != 1 {
		t.Fatal("remote change wrote payload")
	}
	f.remote = &net.TCPAddr{IP: net.ParseIP("8.8.8.8"), Port: 443}
	d.dns.clock.now = func() time.Time { return d.dns.expires }
	b := make([]byte, 32)
	if n, e := c.Read(b); n != 0 || !errors.Is(e, ErrBlocked) || f.reads != 0 {
		t.Fatal("expired binding read payload")
	}
}

func TestPolicyErrorPropagatesPinnedPionBranch(t *testing.T) {
	// Source-checked branch, not execution of a private Pion method. The driver pins
	// actual candidate_base.go and checks this exact io.ErrClosedPipe contract.
	propagates := func(e error) bool { return errors.Is(e, io.ErrClosedPipe) }
	if propagates(errors.New("old ordinary policy error")) {
		t.Fatal("legacy negative control invalid")
	}
	if !propagates(ErrBlocked) {
		t.Fatal("guard denial would be swallowed by pinned Pion")
	}
	var typed PolicyRejection
	if !errors.As(ErrBlocked, &typed) {
		t.Fatal("typed policy cause lost")
	}
}

type zeroEOF struct{ fakeUDP }

func (f *zeroEOF) ReadFrom([]byte) (int, net.Addr, error)        { return 0, nil, io.EOF }
func (f *zeroEOF) ReadFromUDP([]byte) (int, *net.UDPAddr, error) { return 0, nil, io.EOF }
func (f *zeroEOF) ReadMsgUDP([]byte, []byte) (int, int, int, *net.UDPAddr, error) {
	return 0, 0, 0, nil, io.EOF
}
func TestZeroByteEOFPreservesNetworkFirstCause(t *testing.T) {
	f := &zeroEOF{}
	u, _ := newUDPConn(f, "udp4", nil)
	b := make([]byte, 16)
	if n, a, e := u.ReadFrom(b); n != 0 || a != nil || !errors.Is(e, io.EOF) || errors.Is(e, ErrBlocked) {
		t.Fatal("EOF misclassified as policy rejection")
	}
	if n, a, e := u.ReadFromUDP(b); n != 0 || a != nil || !errors.Is(e, io.EOF) {
		t.Fatal("UDP EOF lost")
	}
	if n, o, flags, a, e := u.ReadMsgUDP(b, b); n != 0 || o != 0 || flags != 0 || a != nil || !errors.Is(e, io.EOF) {
		t.Fatal("msg EOF lost")
	}
	p := &packetConn{base: f, policy: publicPeerPolicy{}, network: "udp4"}
	if _, _, e := p.ReadFrom(b); !errors.Is(e, io.EOF) || f.closes != 0 {
		t.Fatal("packet EOF lost or mis-revoked")
	}
}

func TestExpiryStopsPeerNATAndStickyBroker(t *testing.T) {
	d := dnsFixture(t)
	f := &fakeNet{udp: &fakeUDP{}}
	n, _ := NewPeerNet(f, d)
	c, e := n.ListenUDP("udp4", nil)
	if e != nil {
		t.Fatal(e)
	}
	d.clock.now = func() time.Time { return d.expires }
	if _, e = c.WriteTo([]byte("x"), endpoint(good)); !errors.Is(e, ErrBlocked) || f.udp.sends != 0 || f.udp.closes != 1 {
		t.Fatal("expired peer scope sent")
	}
	prior := f.calls
	if _, e = n.DialUDP("udp4", nil, endpoint(good)); !errors.Is(e, ErrBlocked) || f.calls != prior {
		t.Fatal("expired scope dialled")
	}
	policy, _ := NewSTUNPolicy([]netip.AddrPort{netip.MustParseAddrPort(good)}, time.Now().Add(time.Minute))
	policy.clock.now = func() time.Time { return policy.expires }
	nat := &fakeUDP{}
	pc, _ := GuardSTUNPacketConn(nat, policy)
	if _, e = pc.WriteTo([]byte("x"), endpoint(good)); !errors.Is(e, ErrBlocked) || nat.sends != 0 || nat.closes != 1 {
		t.Fatal("expired STUN tuple sent")
	}
	b, _ := NewBrokerDialer(dnsFixture(t), time.Second)
	raw := &fakeBroker{remote: &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 443}}
	stream := &brokerConn{base: raw, owner: b, expected: "8.8.8.8:443"}
	_, _ = stream.Write([]byte("x"))
	raw.remote = &net.TCPAddr{IP: net.ParseIP("8.8.8.8"), Port: 443}
	if _, e = stream.Write([]byte("x")); !errors.Is(e, ErrBlocked) || raw.writes != 0 || raw.closes != 1 {
		t.Fatal("denied TCP stream revived")
	}
}

func TestPacketConcurrentCloseDropsLatePublicRead(t *testing.T) {
	// Exact former control flow: pre-read closed check then public source validation
	// lacked a second closed check. Reproduce that counterexample without a socket.
	legacyClosed := false
	old := &fakeUDP{source: endpoint(good)}
	old.onRead = func() { legacyClosed = true }
	b := make([]byte, 32)
	n, a, _ := old.ReadFrom(b)
	if !legacyClosed || n == 0 || (publicPeerPolicy{}).allow(a) != nil {
		t.Fatal("legacy late-close counterexample not reproduced")
	}
	current := &fakeUDP{source: endpoint(good)}
	c := &packetConn{base: current, policy: publicPeerPolicy{}, network: "udp4"}
	current.onRead = func() { _ = c.Close() }
	b = make([]byte, 32)
	if n, a, e := c.ReadFrom(b); n != 0 || a != nil || !errors.Is(e, ErrBlocked) || !bytes.Equal(b, make([]byte, 32)) || current.closes != 1 {
		t.Fatal("late public packet survived exact wrapper Close")
	}
	if _, _, e := c.ReadFrom(b); !errors.Is(e, ErrBlocked) || current.reads != 1 {
		t.Fatal("closed packet wrapper issued a replacement read")
	}
}

func TestGuardReviewBoundaries(t *testing.T) {
	d := dnsFixture(t)
	broker, _ := NewBrokerDialer(d, time.Second)
	if _, ok := reflect.TypeOf(broker).MethodByName("Control"); ok {
		t.Fatal("unbound partial hook still public")
	}
	if _, ok := reflect.TypeOf(broker).MethodByName("DialContext"); !ok {
		t.Fatal("complete bound dialer missing")
	}
	for method := 0; method < 4; method++ {
		mapScope := dnsFixture(t)
		mapScope.clock.elapsed = func() time.Duration { return mapScope.clock.duration }
		raw := &fakeUDP{source: endpoint(good)}
		raw.onRead = func() { t.Fatal("expired scope entered blocking read") }
		b := make([]byte, 32)
		oob := make([]byte, 32)
		var e error
		if method == 0 {
			c := &packetConn{base: raw, policy: publicPeerPolicy{dns: mapScope}, network: "udp4"}
			_, _, e = c.ReadFrom(b)
		} else {
			c, _ := newUDPConn(raw, "udp4", nil)
			c.policy = publicPeerPolicy{dns: mapScope}
			switch method {
			case 1:
				_, _, e = c.ReadFrom(b)
			case 2:
				_, _, e = c.ReadFromUDP(b)
			case 3:
				_, _, _, _, e = c.ReadMsgUDP(b, oob)
			}
		}
		if !errors.Is(e, ErrBlocked) || raw.reads != 0 || raw.closes != 1 || !bytes.Equal(b, make([]byte, 32)) || !bytes.Equal(oob, make([]byte, 32)) {
			t.Fatal("expired read preflight failed")
		}
	}
	mapScope := dnsFixture(t)
	raw := &fakeUDP{source: endpoint(good)}
	c := &packetConn{base: raw, policy: publicPeerPolicy{dns: mapScope}, network: "udp4"}
	earlierDeadline := time.Now().Add(time.Second)
	_ = c.SetReadDeadline(earlierDeadline)
	_, _, _ = c.ReadFrom(make([]byte, 32))
	if !raw.readDeadline.Equal(earlierDeadline) {
		t.Fatal("shorter caller read deadline extended")
	}
	_ = c.SetReadDeadline(time.Time{})
	_, _, _ = c.ReadFrom(make([]byte, 32))
	if !raw.readDeadline.Equal(mapScope.expires) {
		t.Fatal("scope expiry missing from pending read")
	}
	clock, _, e := newLifetime(time.Unix(0, time.Now().Add(time.Minute).UnixNano()))
	if e != nil {
		t.Fatal(e)
	}
	clock.now = func() time.Time { return clock.wallExpiry.Add(-time.Hour) }
	clock.elapsed = func() time.Duration { return time.Second }
	if !clock.live() {
		t.Fatal("valid monotonic window rejected")
	}
	clock.elapsed = func() time.Duration { return clock.duration }
	if clock.live() {
		t.Fatal("wall rollback extended monotonic deadline")
	}
	clock.elapsed = func() time.Duration { return 0 }
	if clock.live() {
		t.Fatal("observed expiry revived")
	}
}
