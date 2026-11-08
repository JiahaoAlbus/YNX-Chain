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
	"net"
	"os/exec"
	"runtime"
	"testing"
	"time"
)

// Read only the isolated fixture's PUBLIC certificate. In particular these
// commands neither open a key file nor print or marshal private key material.
func peerSPKIPublicFixture(t *testing.T, f credentials, leaf string) ([]byte, string) {
	t.Helper()
	publicCommand := func(arguments ...string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, "openssl", arguments...)
		var stderr bytes.Buffer
		command.Stderr = &stderr
		out, err := command.Output()
		if err != nil {
			t.Fatalf("isolated public certificate command: %v: %s", err, stderr.String())
		}
		return out
	}
	publicPEM := publicCommand("x509", "-in", f.path(leaf+".pem"), "-pubkey", "-noout")
	block, rest := pem.Decode(publicPEM)
	if block == nil || block.Type != "PUBLIC KEY" || len(block.Headers) != 0 || len(bytes.TrimSpace(rest)) != 0 ||
		len(block.Bytes) == 0 || len(block.Bytes) > 16<<10 {
		t.Fatal("isolated certificate did not supply one bounded PUBLIC KEY SPKI")
	}
	certificateDER := publicCommand("x509", "-in", f.path(leaf+".pem"), "-outform", "DER")
	if len(certificateDER) == 0 {
		t.Fatal("isolated public certificate DER is empty")
	}
	certificateSHA := sha256.Sum256(certificateDER)
	return bytes.Clone(block.Bytes), hex.EncodeToString(certificateSHA[:])
}

func peerSPKIExact(got []byte, err error, expected []byte) error {
	if err != nil {
		return fmt.Errorf("held peer SPKI failed: %w", err)
	}
	if len(got) == 0 || len(got) > 16<<10 || !bytes.Equal(got, expected) {
		return fmt.Errorf("held peer SPKI is not the bounded original public DER (bytes=%d)", len(got))
	}
	return nil
}

func peerSPKIRejected(t *testing.T, conn *Conn, label string) {
	t.Helper()
	der, err := conn.PeerSPKIDER()
	if !errors.Is(err, net.ErrClosed) || der != nil {
		t.Fatalf("%s supplied public DER without a held SSL peer: bytes=%d err=%v", label, len(der), err)
	}
}

func TestPeerSPKIDERActualLeafAndOwnedCopies(t *testing.T) {
	f := fixture(t)
	serverDER, serverCertificateSHA := peerSPKIPublicFixture(t, f, "server")
	clientDER, clientCertificateSHA := peerSPKIPublicFixture(t, f, "client")
	if bytes.Equal(serverDER, clientDER) {
		t.Fatal("the original server/client fixture leaves did not use distinct public keys")
	}
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	s, c, serverError, clientError := connect(t, server, client)
	if serverError != nil || clientError != nil {
		t.Fatalf("actual mutual PQ handshake: server=%v client=%v", serverError, clientError)
	}
	for _, endpoint := range []struct {
		name           string
		conn           *Conn
		expected       []byte
		certificateSHA string
	}{
		{"server observes client leaf", s, clientDER, clientCertificateSHA},
		{"client observes server leaf", c, serverDER, serverCertificateSHA},
	} {
		got, err := endpoint.conn.PeerSPKIDER()
		if err := peerSPKIExact(got, err, endpoint.expected); err != nil {
			t.Fatalf("%s: %v", endpoint.name, err)
		}
		spkiSHA := sha256.Sum256(got)
		if endpoint.conn.Snapshot().PeerFingerprint != endpoint.certificateSHA ||
			hex.EncodeToString(spkiSHA[:]) == endpoint.certificateSHA {
			t.Fatalf("%s confused public-key SPKI SHA256 with the existing certificate fingerprint", endpoint.name)
		}
		second, err := endpoint.conn.PeerSPKIDER()
		if err := peerSPKIExact(second, err, endpoint.expected); err != nil {
			t.Fatal(err)
		}
		for i := range got {
			got[i] ^= 0xff
		}
		if !bytes.Equal(second, endpoint.expected) {
			t.Fatalf("%s returned slices share caller-mutable storage", endpoint.name)
		}
		third, err := endpoint.conn.PeerSPKIDER()
		if err := peerSPKIExact(third, err, endpoint.expected); err != nil {
			t.Fatalf("%s caller mutation polluted a later getter: %v", endpoint.name, err)
		}
		copied := *endpoint.conn
		if err := endpoint.conn.Close(); err != nil {
			t.Fatal(err)
		}
		peerSPKIRejected(t, endpoint.conn, "closed original")
		peerSPKIRejected(t, &copied, "value copy after original Close")
		if !bytes.Equal(second, endpoint.expected) || !bytes.Equal(third, endpoint.expected) {
			t.Fatal("closing native SSL invalidated an already returned owned DER copy")
		}
	}
	var nilConn *Conn
	peerSPKIRejected(t, nilConn, "nil connection")
	peerSPKIRejected(t, &Conn{}, "zero connection")
}

func TestPeerSPKIDERConcurrentGetterAndClose(t *testing.T) {
	f := fixture(t)
	serverDER, _ := peerSPKIPublicFixture(t, f, "server")
	clientDER, _ := peerSPKIPublicFixture(t, f, "client")
	server := mustContext(t, f.config("server", "pay.ynx.test", true))
	client := mustContext(t, f.config("client", "adapter.ynx.test", false))
	s, c, serverError, clientError := connect(t, server, client)
	if serverError != nil || clientError != nil {
		t.Fatalf("actual mutual PQ handshake: server=%v client=%v", serverError, clientError)
	}
	serverCopy, clientCopy := *s, *c
	const workers, attempts = 8, 64
	ready := make(chan struct{}, workers)
	start := make(chan struct{})
	results := make(chan error, workers)
	for worker := 0; worker < workers; worker++ {
		conn, expected := s, clientDER
		if worker%2 != 0 {
			conn, expected = c, serverDER
		}
		if worker%4 == 2 {
			conn = &serverCopy
		} else if worker%4 == 3 {
			conn = &clientCopy
		}
		go func(conn *Conn, expected []byte) {
			// Each participant performs a real successful native getter before
			// entering the bounded getter/Close race, rather than testing only
			// already-closed handles. Expected DER remains read-only throughout.
			got, err := conn.PeerSPKIDER()
			first := peerSPKIExact(got, err, expected)
			ready <- struct{}{}
			<-start
			if first != nil {
				results <- first
				return
			}
			for attempt := 0; attempt < attempts; attempt++ {
				got, err := conn.PeerSPKIDER()
				if err != nil {
					if got != nil || !errors.Is(err, net.ErrClosed) {
						results <- fmt.Errorf("concurrent getter did not return nil DER/ErrClosed: bytes=%d err=%v", len(got), err)
						return
					}
				} else {
					if err := peerSPKIExact(got, nil, expected); err != nil {
						results <- err
						return
					}
					// Different goroutines mutate only their returned owned copies.
					got[0] ^= 0xff
					got[len(got)-1] ^= 0xff
				}
				runtime.Gosched()
			}
			results <- nil
		}(conn, expected)
	}
	// This channel edge establishes completion of Close, not a fabricated
	// atomic transport/Source-liveness boundary before Close takes its SSL lock.
	closed := make(chan error, 1)
	go func() {
		for worker := 0; worker < workers; worker++ {
			<-ready
		}
		close(start)
		runtime.Gosched()
		err := c.Close()
		if other := s.Close(); err == nil {
			err = other
		}
		closed <- err
	}()
	timeout := time.NewTimer(10 * time.Second)
	defer timeout.Stop()
	for worker := 0; worker < workers; worker++ {
		select {
		case err := <-results:
			if err != nil {
				t.Error(err)
			}
		case <-timeout.C:
			t.Fatal("bounded peer SPKI getter/Close participants did not drain")
		}
	}
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-timeout.C:
		t.Fatal("native Close did not finish after bounded getter work")
	}
	for _, endpoint := range []*Conn{s, c, &serverCopy, &clientCopy} {
		peerSPKIRejected(t, endpoint, "getter invoked after Close returned")
	}
}
