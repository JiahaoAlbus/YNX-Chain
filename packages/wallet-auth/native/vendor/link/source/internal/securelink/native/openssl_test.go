//go:build securelink_openssl && cgo

package native

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Keys and certificates are generated only inside t.TempDir and never leave
// this isolated loopback fixture. No production CA or service is accessed.
type credentials struct{ dir string }

func fixture(t *testing.T) credentials {
	t.Helper()
	f := credentials{t.TempDir()}
	f.run(t, "genpkey", "-algorithm", "ML-DSA-87", "-out", f.path("root.key"))
	f.run(t, "req", "-new", "-x509", "-key", f.path("root.key"), "-subj", "/CN=isolated-link-root", "-days", "1",
		"-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", f.path("root.pem"))
	f.issue(t, "server", "adapter.ynx.test", "serverAuth", "1")
	f.issue(t, "client", "pay.ynx.test", "clientAuth", "2")
	f.issue(t, "unrelated", "unrelated.ynx.test", "clientAuth", "3")
	f.issue(t, "wrongeku", "pay.ynx.test", "serverAuth", "4")
	return f
}
func (f credentials) path(name string) string { return filepath.Join(f.dir, name) }
func (f credentials) run(t *testing.T, args ...string) {
	t.Helper()
	cmd := exec.Command("openssl", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("isolated openssl %s: %v: %s", args[0], err, out)
	}
}
func (f credentials) issue(t *testing.T, name, san, eku, serial string) {
	t.Helper()
	f.run(t, "genpkey", "-algorithm", "ML-DSA-87", "-out", f.path(name+".key"))
	f.run(t, "req", "-new", "-key", f.path(name+".key"), "-subj", "/CN=ignored-common-name", "-out", f.path(name+".csr"))
	ext := "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=" + eku + "\nsubjectAltName=DNS:" + san + "\n"
	if err := os.WriteFile(f.path(name+".ext"), []byte(ext), 0600); err != nil {
		t.Fatal(err)
	}
	f.run(t, "x509", "-req", "-in", f.path(name+".csr"), "-CA", f.path("root.pem"), "-CAkey", f.path("root.key"), "-set_serial", serial, "-days", "1", "-extfile", f.path(name+".ext"), "-out", f.path(name+".pem"))
}
func (f credentials) config(name, peer string, server bool) Config {
	return Config{CertFile: f.path(name + ".pem"), KeyFile: f.path(name + ".key"), CAFile: f.path("root.pem"), PeerSAN: peer, Server: server}
}
func mustContext(t *testing.T, cfg Config) *Context {
	t.Helper()
	c, err := NewContext(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

type handshakeResult struct {
	conn *Conn
	err  error
}

func connect(t *testing.T, server, client *Context) (*Conn, *Conn, error, error) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result := make(chan handshakeResult, 1)
	go func() {
		c, e := listener.Accept()
		if e != nil {
			result <- handshakeResult{err: e}
			return
		}
		tls, e := server.Server(ctx, c)
		if e != nil {
			_ = c.Close()
		}
		result <- handshakeResult{tls, e}
	}()
	c, e := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if e != nil {
		t.Fatal(e)
	}
	cc, ce := client.Client(ctx, c)
	if ce != nil {
		_ = c.Close()
	}
	s := <-result
	if cc != nil {
		t.Cleanup(func() { _ = cc.Close() })
	}
	if s.conn != nil {
		t.Cleanup(func() { _ = s.conn.Close() })
	}
	return s.conn, cc, s.err, ce
}

func TestLINK01RealPQMutualHandshakeAndBidirectionalIO(t *testing.T) {
	f := fixture(t)
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	s, c, se, ce := connect(t, server, client)
	if se != nil || ce != nil {
		t.Fatalf("mutual handshake: server=%v client=%v", se, ce)
	}
	for _, conn := range []*Conn{s, c} {
		state := conn.Snapshot()
		if state.Protocol != "TLSv1.3" || state.Group != "SecP384r1MLKEM1024" || state.Cipher != "TLS_AES_256_GCM_SHA384" || state.PeerSignature != "mldsa87" || !state.Verified || !state.Mutual || state.Resumed || !state.AllChainMLDSA87 || len(state.RootFingerprint) != 64 || !state.NotAfter.After(time.Now()) {
			t.Fatalf("unexpected actual TLS state: %+v", state)
		}
		t.Logf("actual %s %s %s peer=%s local=%s signature=%s root=%s runtime=%s", state.Protocol, state.Group, state.Cipher, state.PeerSAN, state.LocalSAN, state.PeerSignature, state.RootFingerprint, state.RuntimeVersion)
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	}
	a, err := s.ExportKeyingMaterial("EXPORTER-Channel-Binding", nil, 32)
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.ExportKeyingMaterial("EXPORTER-Channel-Binding", nil, 32)
	if err != nil || !bytes.Equal(a, b) {
		t.Fatalf("TLS exporter differs: %v", err)
	}
	if _, err := c.ExportKeyingMaterial("arbitrary", nil, 32); err == nil {
		t.Fatal("nonstandard exporter accepted")
	}
	// Start a blocked read before a write on the same connection. This catches
	// fd read-lock deadlocks hidden by one-direction-only handshake tests.
	read := make(chan error, 1)
	go func() {
		p := make([]byte, 4)
		_, err := io.ReadFull(c, p)
		if err == nil && string(p) != "pong" {
			err = errors.New("wrong response")
		}
		read <- err
	}()
	if _, err := c.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	p := make([]byte, 4)
	if _, err := io.ReadFull(s, p); err != nil || string(p) != "ping" {
		t.Fatalf("request read: %q %v", p, err)
	}
	if _, err := s.Write([]byte("pong")); err != nil {
		t.Fatal(err)
	}
	if err := <-read; err != nil {
		t.Fatal(err)
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	if c.Snapshot().Verified {
		t.Fatal("closed connection retained authenticated snapshot")
	}
}

func TestLINK01SameCAWrongSANAndWrongExpectedServerRejected(t *testing.T) {
	f := fixture(t)
	for _, tc := range []struct{ name, client, expected string }{
		{"same-CA-unrelated-service", "unrelated", "adapter.ynx.test"},
		{"wrong-server-SAN", "client", "other-adapter.ynx.test"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := mustContext(t, f.config("server", "pay.ynx.test", true))
			client := mustContext(t, f.config(tc.client, tc.expected, false))
			_, _, se, ce := connect(t, server, client)
			if se == nil && ce == nil {
				t.Fatal("wrong service accepted by both endpoints")
			}
			if tc.client == "unrelated" && se == nil {
				t.Fatal("server accepted unrelated client issued by same CA")
			}
			if tc.expected != "adapter.ynx.test" && ce == nil {
				t.Fatal("client accepted wrong server SAN")
			}
		})
	}
}

func TestLINK01WrongEKUAndWildcardPolicyRejected(t *testing.T) {
	f := fixture(t)
	if c, err := NewContext(f.config("wrongeku", "adapter.ynx.test", false)); err == nil {
		_ = c.Close()
		t.Fatal("wrong local EKU accepted")
	}
	cfg := f.config("client", "*.ynx.test", false)
	if c, err := NewContext(cfg); err == nil {
		_ = c.Close()
		t.Fatal("wildcard peer policy accepted")
	}
}

func TestLINK01WrongRootRejected(t *testing.T) {
	f := fixture(t)
	other := fixture(t)
	cfg := f.config("client", "adapter.ynx.test", false)
	cfg.CAFile = other.path("root.pem")
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, cfg)
	_, _, _, ce := connect(t, server, client)
	if ce == nil {
		t.Fatal("wrong trust root accepted")
	}
}

func TestLINK01ClassicGroupOrMissingClientCertificateRejected(t *testing.T) {
	f := fixture(t)
	for _, tc := range []struct {
		name, group string
		cert        bool
	}{
		{"classic-group-only", "P-384", true}, {"missing-client-certificate", "SecP384r1MLKEM1024", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := mustContext(t, f.config("server", "pay.ynx.test", true))
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			result := make(chan error, 1)
			go func() {
				c, e := listener.Accept()
				if e != nil {
					result <- e
					return
				}
				defer c.Close()
				_, e = server.Server(ctx, c)
				result <- e
			}()
			args := []string{"s_client", "-connect", listener.Addr().String(), "-tls1_3", "-groups", tc.group, "-ciphersuites", "TLS_AES_256_GCM_SHA384", "-sigalgs", "mldsa87", "-CAfile", f.path("root.pem"), "-quiet"}
			if tc.cert {
				args = append(args, "-cert", f.path("client.pem"), "-key", f.path("client.key"))
			}
			cmd := exec.CommandContext(ctx, "openssl", args...)
			out, cmdErr := cmd.CombinedOutput()
			if err := <-result; err == nil {
				t.Fatalf("unapproved peer handshake accepted: %s", out)
			}
			if cmdErr == nil {
				t.Fatalf("negative client unexpectedly succeeded: %s", out)
			}
		})
	}
}

func TestLINK01HandshakeCancellationAndBlockedReadClose(t *testing.T) {
	f := fixture(t)
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	socket, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := server.Server(ctx, socket); done <- err }()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel result=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("handshake cancellation blocked")
	}
	_ = socket.Close()
	peer := mustContext(t, f.config("client", "adapter.ynx.test", false))
	s, c, se, ce := connect(t, server, peer)
	if se != nil || ce != nil {
		t.Fatalf("handshake=%v %v", se, ce)
	}
	defer s.Close()
	readDone := make(chan error, 1)
	go func() { _, err := c.Read(make([]byte, 1)); readDone <- err }()
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-readDone:
		if err == nil {
			t.Fatal("closed read succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("Close deadlocked against Read")
	}
}

func TestLINK01PollableSocketRequired(t *testing.T) {
	f := fixture(t)
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	if _, err := client.Client(context.Background(), a); err == nil || !strings.Contains(err.Error(), "pollable OS socket") {
		t.Fatalf("non-native pipe result=%v", err)
	}
}

func TestLINK01CertificatePolicyRejections(t *testing.T) {
	f := fixture(t)
	t.Run("CN-without-SAN", func(t *testing.T) {
		ext := "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n"
		if err := os.WriteFile(f.path("cn.ext"), []byte(ext), 0600); err != nil {
			t.Fatal(err)
		}
		f.run(t, "x509", "-req", "-in", f.path("client.csr"), "-CA", f.path("root.pem"), "-CAkey", f.path("root.key"), "-set_serial", "5", "-days", "1", "-extfile", f.path("cn.ext"), "-out", f.path("cn.pem"))
		cfg := f.config("client", "adapter.ynx.test", false)
		cfg.CertFile = f.path("cn.pem")
		if c, err := NewContext(cfg); err == nil {
			_ = c.Close()
			t.Fatal("CN-only service certificate accepted")
		}
	})
	t.Run("wildcard-SAN", func(t *testing.T) {
		f.issue(t, "wildcard", "*.ynx.test", "clientAuth", "6")
		if c, err := NewContext(f.config("wildcard", "adapter.ynx.test", false)); err == nil {
			_ = c.Close()
			t.Fatal("wildcard certificate accepted")
		}
	})
	t.Run("expired-client", func(t *testing.T) {
		f.run(t, "x509", "-req", "-in", f.path("client.csr"), "-CA", f.path("root.pem"), "-CAkey", f.path("root.key"), "-set_serial", "7", "-not_before", "20000101000000Z", "-not_after", "20000102000000Z", "-extfile", f.path("client.ext"), "-out", f.path("expired.pem"))
		cfg := f.config("client", "adapter.ynx.test", false)
		cfg.CertFile = f.path("expired.pem")
		if c, err := NewContext(cfg); err == nil {
			_ = c.Close()
			t.Fatal("expired local service certificate accepted")
		}
	})
	t.Run("classical-service-signature", func(t *testing.T) {
		f.run(t, "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-384", "-out", f.path("classic.key"))
		f.run(t, "req", "-new", "-key", f.path("classic.key"), "-subj", "/CN=ignored", "-out", f.path("classic.csr"))
		f.run(t, "x509", "-req", "-in", f.path("classic.csr"), "-CA", f.path("root.pem"), "-CAkey", f.path("root.key"), "-set_serial", "8", "-days", "1", "-extfile", f.path("client.ext"), "-out", f.path("classic.pem"))
		if c, err := NewContext(f.config("classic", "adapter.ynx.test", false)); err == nil {
			_ = c.Close()
			t.Fatal("classical service public key accepted")
		}
	})
}

func TestLINK01ClassicalRootCannotHideBehindPQIntermediate(t *testing.T) {
	f := fixture(t)
	f.run(t, "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-384", "-out", f.path("classic-root.key"))
	f.run(t, "req", "-new", "-x509", "-key", f.path("classic-root.key"), "-subj", "/CN=isolated-classic-root", "-days", "1", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", f.path("classic-root.pem"))
	f.run(t, "genpkey", "-algorithm", "ML-DSA-87", "-out", f.path("intermediate.key"))
	f.run(t, "req", "-new", "-key", f.path("intermediate.key"), "-subj", "/CN=isolated-PQ-intermediate", "-out", f.path("intermediate.csr"))
	if err := os.WriteFile(f.path("intermediate.ext"), []byte("basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n"), 0600); err != nil {
		t.Fatal(err)
	}
	f.run(t, "x509", "-req", "-in", f.path("intermediate.csr"), "-CA", f.path("classic-root.pem"), "-CAkey", f.path("classic-root.key"), "-set_serial", "9", "-days", "1", "-extfile", f.path("intermediate.ext"), "-out", f.path("intermediate.pem"))
	f.run(t, "x509", "-req", "-in", f.path("client.csr"), "-CA", f.path("intermediate.pem"), "-CAkey", f.path("intermediate.key"), "-set_serial", "10", "-days", "1", "-extfile", f.path("client.ext"), "-out", f.path("leaf.pem"))
	leaf, err := os.ReadFile(f.path("leaf.pem"))
	if err != nil {
		t.Fatal(err)
	}
	intermediate, err := os.ReadFile(f.path("intermediate.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.path("mixed-chain.pem"), append(leaf, intermediate...), 0600); err != nil {
		t.Fatal(err)
	}
	serverCfg := f.config("server", "pay.ynx.test", true)
	serverCfg.CAFile = f.path("classic-root.pem")
	clientCfg := f.config("client", "adapter.ynx.test", false)
	clientCfg.CertFile = f.path("mixed-chain.pem")
	server := mustContext(t, serverCfg)
	client := mustContext(t, clientCfg)
	_, _, se, _ := connect(t, server, client)
	if se == nil {
		t.Fatal("classical root/intermediate signature accepted behind PQ leaf")
	}
}

func TestLINK01ServerAuthenticationAloneCannotClaimMutual(t *testing.T) {
	f := fixture(t)
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	reservation, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reservation.Addr().String()
	_ = reservation.Close()
	// An isolated OpenSSL test peer intentionally omits CertificateRequest.
	// The production endpoint must prove it actually signed CertificateVerify,
	// rather than infer mutual authentication from its configured certificate.
	cmd := exec.CommandContext(ctx, "openssl", "s_server", "-accept", address, "-tls1_3", "-groups", "SecP384r1MLKEM1024", "-ciphersuites", "TLS_AES_256_GCM_SHA384", "-sigalgs", "mldsa87", "-cert", f.path("server.pem"), "-key", f.path("server.key"), "-quiet", "-ign_eof", "-naccept", "1")
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	commandDone := make(chan struct{})
	var commandErr error
	go func() { commandErr = cmd.Wait(); close(commandDone) }()
	defer func() { cancel(); <-commandDone }()
	var socket net.Conn
	for ctx.Err() == nil {
		select {
		case <-commandDone:
			t.Fatalf("isolated server peer exited: %v %s", commandErr, output.String())
		default:
		}
		socket, err = net.Dial("tcp", address)
		if err == nil {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if socket == nil {
		t.Fatalf("isolated server-only peer unavailable: %v", err)
	}
	defer socket.Close()
	if conn, err := client.Client(ctx, socket); err == nil {
		_ = conn.Close()
		t.Fatal("server-only authentication was reported as mutual")
	}
}

func TestLINK01DeadlinesAndIncompleteWriteDestroyNativeState(t *testing.T) {
	f := fixture(t)
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	for _, mode := range []string{"expired-write", "expired-read", "pending-write"} {
		t.Run(mode, func(t *testing.T) {
			_, c, se, ce := connect(t, server, client)
			if se != nil || ce != nil {
				t.Fatalf("handshake=%v %v", se, ce)
			}
			var err error
			switch mode {
			case "expired-write":
				_ = c.SetWriteDeadline(time.Now().Add(-time.Second))
				var n int
				n, err = c.Write([]byte("must not be emitted"))
				if n != 0 {
					t.Fatalf("expired deadline wrote %d bytes", n)
				}
			case "expired-read":
				_ = c.SetReadDeadline(time.Now().Add(-time.Second))
				_, err = c.Read(make([]byte, 1))
			case "pending-write":
				if err := c.transport.(*net.TCPConn).SetWriteBuffer(1024); err != nil {
					t.Fatal(err)
				}
				_ = c.SetWriteDeadline(time.Now().Add(20 * time.Millisecond))
				_, err = c.Write(make([]byte, 8<<20))
			}
			var timeout net.Error
			if !errors.As(err, &timeout) || !timeout.Timeout() {
				t.Fatalf("expected deadline, got %v", err)
			}
			if mode == "expired-read" {
				if !c.Snapshot().Verified {
					t.Fatal("recoverable read deadline destroyed TLS connection")
				}
				_ = c.SetReadDeadline(time.Time{})
			} else if c.Snapshot().Verified {
				t.Fatal("incomplete native write retained live authenticated state")
			}
		})
	}
}

func TestLINK01ContextLifetimeAndHandleCopies(t *testing.T) {
	f := fixture(t)
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	s, c, se, ce := connect(t, server, client)
	if se != nil || ce != nil {
		t.Fatalf("handshake=%v %v", se, ce)
	}
	_ = server.Close()
	_ = client.Close()
	_ = s.SetDeadline(time.Now().Add(time.Second))
	_ = c.SetDeadline(time.Now().Add(time.Second))
	if _, err := c.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(s, make([]byte, 1)); err != nil {
		t.Fatal(err)
	}
	copy := *c
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	if copy.Snapshot().Verified {
		t.Fatal("copied handle retained authentication after original closed")
	}
	if err := copy.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestLINK01ServiceKeyOSBoundaryAndNoInteractivePassword(t *testing.T) {
	f := fixture(t)
	key, err := os.ReadFile(f.path("client.key"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.path("broad.key"), key, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(f.path("broad.key"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(f.path("client.key"), f.path("symlink.key")); err != nil {
		t.Fatal(err)
	}
	f.run(t, "pkey", "-in", f.path("client.key"), "-aes-256-cbc", "-passout", "pass:isolated-test-only", "-out", f.path("encrypted.key"))
	for _, name := range []string{"broad.key", "symlink.key", "encrypted.key"} {
		t.Run(name, func(t *testing.T) {
			cfg := f.config("client", "adapter.ynx.test", false)
			cfg.KeyFile = f.path(name)
			if c, err := NewContext(cfg); err == nil {
				_ = c.Close()
				t.Fatal("unsafe or interactive service key accepted")
			}
		})
	}
	cfg := f.config("client", "adapter.ynx.test", false)
	cfg.KeyFile += "\x00ignored"
	if c, err := NewContext(cfg); err == nil {
		_ = c.Close()
		t.Fatal("NUL credential path accepted")
	}
}

func TestLINK01LiveConnectionExpiryIncludesRootAndLocalCertificate(t *testing.T) {
	f := fixture(t)
	expires := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	f.run(t, "x509", "-in", f.path("root.pem"), "-key", f.path("root.key"), "-not_before", "20000101000000Z", "-not_after", expires.Format("20060102150405Z"), "-out", f.path("short-root.pem"))
	scfg := f.config("server", "pay.ynx.test", true)
	scfg.CAFile = f.path("short-root.pem")
	ccfg := f.config("client", "adapter.ynx.test", false)
	ccfg.CAFile = f.path("short-root.pem")
	server := mustContext(t, scfg)
	client := mustContext(t, ccfg)
	s, c, se, ce := connect(t, server, client)
	if se != nil || ce != nil {
		t.Fatalf("handshake=%v %v", se, ce)
	}
	for _, conn := range []*Conn{s, c} {
		if got := conn.Snapshot().NotAfter; !got.Equal(expires) {
			t.Fatalf("live expiry=%s want root expiry=%s", got, expires)
		}
	}
}

func TestLINK01ConnectionIDStableAcrossCopiesAndClose(t *testing.T) {
	f := fixture(t)
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	s1, c1, se, ce := connect(t, server, client)
	if se != nil || ce != nil {
		t.Fatalf("first handshake=%v %v", se, ce)
	}
	s2, c2, se, ce := connect(t, server, client)
	if se != nil || ce != nil {
		t.Fatalf("second handshake=%v %v", se, ce)
	}
	ids := map[ConnectionID]bool{}
	for _, conn := range []*Conn{s1, c1, s2, c2} {
		id := conn.ID()
		if id == (ConnectionID{}) || ids[id] {
			t.Fatal("real TLS endpoints received zero or reused connection ID")
		}
		ids[id] = true
	}
	copy := *c1
	id := c1.ID()
	if copy.ID() != id {
		t.Fatal("value-copy changed native connection identity")
	}
	if err := copy.Close(); err != nil {
		t.Fatal(err)
	}
	if c1.ID() != id || copy.ID() != id {
		t.Fatal("Close changed native connection identity")
	}
	if c1.Snapshot().Verified {
		t.Fatal("copy Close did not close the shared native endpoint")
	}
	if (&Conn{}).ID() != (ConnectionID{}) {
		t.Fatal("uninitialized connection has a valid identity")
	}
}
