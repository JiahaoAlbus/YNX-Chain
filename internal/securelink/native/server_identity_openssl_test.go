//go:build securelink_openssl && cgo

package native

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Only public certificates/public keys are read by these helpers. Private
// fixture keys stay inside the original OpenSSL fixture/held Context.
func serverIdentityPublicCommand(t *testing.T, args ...string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "openssl", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("PUBLIC server identity certificate command: %v: %s", err, stderr.String())
	}
	return out
}

func serverIdentityPublic(t *testing.T, f credentials, name string) (cert, spki []byte, before, after time.Time) {
	t.Helper()
	cert = serverIdentityPublicCommand(t, "x509", "-in", f.path(name+".pem"), "-outform", "DER")
	public := serverIdentityPublicCommand(t, "x509", "-in", f.path(name+".pem"), "-pubkey", "-noout")
	block, rest := pem.Decode(public)
	if block == nil || block.Type != "PUBLIC KEY" || len(bytes.TrimSpace(rest)) != 0 || len(block.Headers) != 0 {
		t.Fatal("fixture certificate did not supply one original public SPKI")
	}
	spki = bytes.Clone(block.Bytes)
	validity := serverIdentityPublicCommand(t, "x509", "-in", f.path(name+".pem"), "-noout", "-startdate", "-enddate")
	for _, line := range strings.Split(strings.TrimSpace(string(validity)), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			t.Fatal("fixture public certificate validity missing")
		}
		parsed, err := time.Parse("Jan _2 15:04:05 2006 MST", value)
		if err != nil {
			t.Fatal(err)
		}
		if key == "notBefore" {
			before = parsed
		} else if key == "notAfter" {
			after = parsed
		} else {
			t.Fatal("unexpected public certificate validity field")
		}
	}
	if len(cert) == 0 || len(cert) > 32<<10 || len(spki) == 0 || len(spki) > 16<<10 || before.IsZero() || after.IsZero() {
		t.Fatal("fixture public DER or validity outside identity bounds")
	}
	return
}

func serverIdentitySHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func serverIdentityExact(got ServerIdentity, err error, cert, spki []byte, dns []string) error {
	if err != nil {
		return err
	}
	if !bytes.Equal(got.CertificateDER, cert) || !bytes.Equal(got.SPKIDER, spki) ||
		len(got.CertificateDER) > 32<<10 || len(got.SPKIDER) > 16<<10 ||
		got.CertificateSHA256 != serverIdentitySHA(cert) || got.SPKISHA256 != serverIdentitySHA(spki) ||
		got.CertificateSHA256 == got.SPKISHA256 || !reflect.DeepEqual(got.DNSNames, dns) ||
		got.Protocol != "TLSv1.3" || got.Group != "SecP384r1MLKEM1024" ||
		got.Cipher != "TLS_AES_256_GCM_SHA384" || got.Signature != "mldsa87" ||
		!strings.HasPrefix(got.RuntimeVersion, "OpenSSL 3.6.4 ") || !got.ServerAuth || !got.Mutual || !got.TicketsOff ||
		!got.NotBefore.Before(time.Now()) || !got.NotAfter.After(time.Now()) {
		return errors.New("held original server PUBLIC identity/profile differs")
	}
	return nil
}

func serverIdentityReject(t *testing.T, ctx *Context, closed bool) {
	t.Helper()
	identity, err := ctx.ServerIdentity()
	if err == nil || !reflect.DeepEqual(identity, ServerIdentity{}) || (closed && !errors.Is(err, net.ErrClosed)) {
		t.Fatalf("unavailable original server identity returned DATA: err=%v", err)
	}
}

func TestServerIdentityActualPublicCopiesAndHeldContext(t *testing.T) {
	f := fixture(t)
	cert, spki, leafBefore, leafAfter := serverIdentityPublic(t, f, "server")
	_, _, rootBefore, rootAfter := serverIdentityPublic(t, f, "root")
	leafPEM, err := os.ReadFile(f.path("server.pem"))
	if err != nil {
		t.Fatal(err)
	}
	rootPEM, err := os.ReadFile(f.path("root.pem"))
	if err != nil {
		t.Fatal(err)
	}
	// Exercise the actual configured local chain as well as its existing store.
	if err := os.WriteFile(f.path("server.pem"), append(append([]byte(nil), leafPEM...), rootPEM...), 0600); err != nil {
		t.Fatal(err)
	}
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	got, err := server.ServerIdentity()
	if err := serverIdentityExact(got, err, cert, spki, []string{"adapter.ynx.test"}); err != nil {
		t.Fatal(err)
	}
	wantBefore, wantAfter := leafBefore, leafAfter
	if rootBefore.After(wantBefore) {
		wantBefore = rootBefore
	}
	if rootAfter.Before(wantAfter) {
		wantAfter = rootAfter
	}
	if !got.NotBefore.Equal(wantBefore) || !got.NotAfter.Equal(wantAfter) {
		t.Fatal("server validity did not include latest start/earliest end of its original local chain")
	}
	// One actual new-delta PQ handshake checks that the copied local profile
	// still belongs to the same original Context, without turning DATA into a
	// Root/Source grant or executing the old Native/49 control suite.
	s, c, se, ce := connect(t, server, client)
	if se != nil || ce != nil {
		t.Fatalf("same original server PQ context: server=%v client=%v", se, ce)
	}
	if s.Snapshot().Protocol != got.Protocol || s.Snapshot().Group != got.Group ||
		s.Snapshot().Cipher != got.Cipher || c.Snapshot().PeerFingerprint != got.CertificateSHA256 {
		t.Fatal("server identity DATA did not correspond to the same native TLS context")
	}
	second, err := server.ServerIdentity()
	if err := serverIdentityExact(second, err, cert, spki, []string{"adapter.ynx.test"}); err != nil {
		t.Fatal(err)
	}
	got.CertificateDER[0] ^= 0xff
	got.SPKIDER[len(got.SPKIDER)-1] ^= 0xff
	got.DNSNames[0] = "caller-mutation.invalid"
	if err := serverIdentityExact(second, nil, cert, spki, []string{"adapter.ynx.test"}); err != nil {
		t.Fatal("returned identities share mutable caller storage", err)
	}
	// Only PUBLIC certificate files are changed. The existing Context must use
	// its held parsed certificate/store, never re-read these original paths.
	unrelatedPublic, err := os.ReadFile(f.path("client.pem"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{f.path("server.pem"), f.path("root.pem")} {
		if err := os.WriteFile(path, unrelatedPublic, 0600); err != nil {
			t.Fatal(err)
		}
	}
	third, err := server.ServerIdentity()
	if err := serverIdentityExact(third, err, cert, spki, []string{"adapter.ynx.test"}); err != nil {
		t.Fatal("identity re-read a pathname instead of its original held context", err)
	}
	serverIdentityReject(t, client, false)
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	serverIdentityReject(t, server, true)
	serverIdentityReject(t, (*Context)(nil), true)
	serverIdentityReject(t, &Context{}, true)
	if !bytes.Equal(second.CertificateDER, cert) || !bytes.Equal(third.SPKIDER, spki) {
		t.Fatal("Close invalidated independently owned public identity copies")
	}
}

func TestServerIdentityBoundedExactDNSAndLocalChain(t *testing.T) {
	f := fixture(t)
	for _, tc := range []struct {
		name string
		dns  []string
		ok   bool
	}{
		{"two-exact-names", []string{"adapter.ynx.test", "Second.ynx.test"}, true},
		{"wildcard-alongside-exact", []string{"adapter.ynx.test", "*.ynx.test"}, false},
		{"duplicate-exact", []string{"adapter.ynx.test", "adapter.ynx.test"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f.issue(t, tc.name, strings.Join(tc.dns, ",DNS:"), "serverAuth", "10")
			ctx := mustContext(t, f.config(tc.name, "pay.ynx.test", true))
			identity, err := ctx.ServerIdentity()
			if !tc.ok {
				if err == nil || !reflect.DeepEqual(identity, ServerIdentity{}) {
					t.Fatal("ambiguous/wildcard DNS inventory accepted")
				}
				return
			}
			cert, spki, _, _ := serverIdentityPublic(t, f, tc.name)
			if err := serverIdentityExact(identity, err, cert, spki, tc.dns); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, count := range []int{32, 33} {
		t.Run(fmt.Sprintf("dns-cap-%d", count), func(t *testing.T) {
			dns := make([]string, count)
			for i := range dns {
				dns[i] = fmt.Sprintf("%02d", i) + strings.Repeat("a", 61) + "." + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 61)
				if len(dns[i]) != 253 {
					t.Fatal("PUBLIC exact DNS boundary fixture changed")
				}
			}
			name := fmt.Sprintf("many-%d", count)
			f.issue(t, name, strings.Join(dns, ",DNS:"), "serverAuth", "11")
			ctx := mustContext(t, f.config(name, "pay.ynx.test", true))
			identity, err := ctx.ServerIdentity()
			if count == 33 {
				if err == nil || !reflect.DeepEqual(identity, ServerIdentity{}) {
					t.Fatal("DNS count exceeded fixed 32-name capacity")
				}
				return
			}
			cert, spki, _, _ := serverIdentityPublic(t, f, name)
			if err := serverIdentityExact(identity, err, cert, spki, dns); err != nil {
				t.Fatal(err)
			}
		})
	}
	// A valid original leaf with an unrelated local trust store cannot yield a
	// chain-verified identity. This is a PUBLIC negative, never a Root producer.
	f.run(t, "genpkey", "-algorithm", "ML-DSA-87", "-out", f.path("other-root.key"))
	f.run(t, "req", "-new", "-x509", "-key", f.path("other-root.key"), "-subj", "/CN=PUBLIC-unrelated-root", "-days", "1",
		"-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", f.path("other-root.pem"))
	cfg := f.config("server", "pay.ynx.test", true)
	cfg.CAFile = f.path("other-root.pem")
	serverIdentityReject(t, mustContext(t, cfg), false)
}

func TestServerIdentityConcurrentGetterAndClose(t *testing.T) {
	f := fixture(t)
	cert, spki, _, _ := serverIdentityPublic(t, f, "server")
	ctx := mustContext(t, f.config("server", "pay.ynx.test", true))
	const workers, attempts = 4, 24
	ready := make(chan struct{}, workers)
	start := make(chan struct{})
	results := make(chan error, workers)
	for i := 0; i < workers; i++ {
		go func() {
			identity, err := ctx.ServerIdentity()
			first := serverIdentityExact(identity, err, cert, spki, []string{"adapter.ynx.test"})
			ready <- struct{}{}
			<-start
			if first != nil {
				results <- first
				return
			}
			for i := 0; i < attempts; i++ {
				identity, err := ctx.ServerIdentity()
				if err != nil {
					if !errors.Is(err, net.ErrClosed) || !reflect.DeepEqual(identity, ServerIdentity{}) {
						results <- errors.New("closing context returned partial identity or wrong error")
						return
					}
				} else if err := serverIdentityExact(identity, nil, cert, spki, []string{"adapter.ynx.test"}); err != nil {
					results <- err
					return
				} else {
					identity.CertificateDER[0] ^= 0xff
					identity.SPKIDER[0] ^= 0xff
					identity.DNSNames[0] = "caller-owned.invalid"
				}
				runtime.Gosched()
			}
			results <- nil
		}()
	}
	closed := make(chan error, 1)
	go func() {
		for i := 0; i < workers; i++ {
			<-ready
		}
		close(start)
		runtime.Gosched()
		closed <- ctx.Close()
	}()
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	for i := 0; i < workers; i++ {
		select {
		case err := <-results:
			if err != nil {
				t.Error(err)
			}
		case <-timer.C:
			t.Fatal("bounded server identity getter work did not drain")
		}
	}
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-timer.C:
		t.Fatal("Close did not drain actual server identity copies")
	}
	serverIdentityReject(t, ctx, true)
}

func TestServerIdentityFromOriginalFDs(t *testing.T) {
	f := fixture(t)
	cert, spki, _, _ := serverIdentityPublic(t, f, "server")
	var borrowed []*os.File
	for _, name := range []string{"server.pem", "server.key", "root.pem"} {
		file, err := os.Open(f.path(name))
		if err != nil {
			t.Fatal(err)
		}
		borrowed = append(borrowed, file)
		t.Cleanup(func() { _ = file.Close() })
	}
	offsets := []int64{17, 23, 11}
	for i, file := range borrowed {
		if _, err := file.Seek(offsets[i], io.SeekStart); err != nil {
			t.Fatal(err)
		}
	}
	intact := func() {
		t.Helper()
		for i, file := range borrowed {
			if _, err := file.Stat(); err != nil {
				t.Fatal("constructor closed an original borrowed fd", err)
			}
			at, err := file.Seek(0, io.SeekCurrent)
			if err != nil || at != offsets[i] {
				t.Fatal("constructor changed an original borrowed offset", err)
			}
		}
	}
	construct := func(sha string) (*Context, error) {
		return NewServerContextFromFDs(int(borrowed[0].Fd()), int(borrowed[1].Fd()), int(borrowed[2].Fd()), "pay.ynx.test", sha)
	}
	ctx, err := construct(serverIdentitySHA(cert))
	if err != nil || ctx == nil {
		t.Fatal("original FD server context constructor", err)
	}
	t.Cleanup(func() { _ = ctx.Close() })
	intact()
	identity, err := ctx.ServerIdentity()
	if err := serverIdentityExact(identity, err, cert, spki, []string{"adapter.ynx.test"}); err != nil {
		t.Fatal(err)
	}
	if bad, err := construct(strings.Repeat("0", 64)); bad != nil || err == nil {
		if bad != nil {
			_ = bad.Close()
		}
		t.Fatal("different original public certificate identity accepted")
	}
	intact()
	if bad, err := NewServerContextFromFDs(-1, int(borrowed[1].Fd()), int(borrowed[2].Fd()), "pay.ynx.test", serverIdentitySHA(cert)); bad != nil || err == nil {
		t.Fatal("invalid borrowed descriptor accepted")
	}
	if bad, err := NewServerContextFromFDs(int(borrowed[0].Fd()), int(borrowed[0].Fd()), int(borrowed[2].Fd()), "pay.ynx.test", serverIdentitySHA(cert)); bad != nil || err == nil {
		t.Fatal("same certificate/key descriptor accepted")
	}
	writableCA, err := os.OpenFile(f.path("root.pem"), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer writableCA.Close()
	if bad, err := NewServerContextFromFDs(int(borrowed[0].Fd()), int(borrowed[1].Fd()), int(writableCA.Fd()), "pay.ynx.test", serverIdentitySHA(cert)); bad != nil || err == nil {
		t.Fatal("writable original CA descriptor accepted")
	}
	if _, err := writableCA.Stat(); err != nil {
		t.Fatal("refused borrowed CA descriptor was closed", err)
	}
	if err := os.Chmod(f.path("root.pem"), 0666); err != nil {
		t.Fatal(err)
	}
	if bad, err := construct(serverIdentitySHA(cert)); bad != nil || err == nil {
		t.Fatal("broadly writable original CA accepted")
	}
	if err := os.Chmod(f.path("root.pem"), 0600); err != nil {
		t.Fatal(err)
	}
	intact()
	if err := ctx.Close(); err != nil {
		t.Fatal(err)
	}
	intact()
	serverIdentityReject(t, ctx, true)
	for _, size := range []int{1 << 20, 1<<20 + 1} {
		t.Run(fmt.Sprintf("public-ca-byte-cap-%d", size), func(t *testing.T) {
			// Reader-only PUBLIC DATA: this is deliberately not a certificate,
			// credential constructor, fabricated Root or successful TLS context.
			want := bytes.Repeat([]byte{'A'}, size)
			path := f.path(fmt.Sprintf("public-ca-data-%d", size))
			if err := os.WriteFile(path, want, 0600); err != nil {
				t.Fatal(err)
			}
			file, err := os.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			if _, err := file.Seek(11, io.SeekStart); err != nil {
				t.Fatal(err)
			}
			got, err := serverPublicCAFromFD(int(file.Fd()))
			if size > 1<<20 {
				if err == nil || got != nil {
					t.Fatal("public CA fd reader exceeded 1MiB bound")
				}
			} else if err != nil || !bytes.Equal(got, want) {
				t.Fatal("public CA fd inclusive bound/owned original bytes", err)
			}
			if at, err := file.Seek(0, io.SeekCurrent); err != nil || at != 11 {
				t.Fatal("public CA bound check changed borrowed offset", err)
			}
		})
	}
}
