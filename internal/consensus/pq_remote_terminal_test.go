//go:build unix

package consensus

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Only transport identities are synthetic. No consensus signing operation is
// admitted by these lifecycle tests, and no HRS or PQ key is created.
type remoteTerminalAuthority struct{ calls atomic.Int32 }

func (a *remoteTerminalAuthority) ConsensusAuthorityForSigning(string, int64, []byte) (cmttypes.ConsensusAuthority, error) {
	a.calls.Add(1)
	return nil, errors.New("unexpected authority use in terminal fixture")
}

type remoteTerminalValidator struct{ calls atomic.Int32 }

func (v *remoteTerminalValidator) GetPubKey() (crypto.PubKey, error) {
	v.calls.Add(1)
	return nil, errors.New("unexpected key request")
}
func (v *remoteTerminalValidator) GetPubKeyForHeight(string, int64) (crypto.PubKey, error) {
	return v.GetPubKey()
}
func (v *remoteTerminalValidator) SetConsensusSigningContext(string, int64, int32, *cmttypes.ValidatorSet) error {
	v.calls.Add(1)
	return errors.New("unexpected signing context")
}
func (v *remoteTerminalValidator) SignVote(string, *cmtproto.Vote) error {
	v.calls.Add(1)
	return errors.New("fixture must never sign")
}
func (v *remoteTerminalValidator) SignProposal(string, *cmtproto.Proposal) error {
	v.calls.Add(1)
	return errors.New("fixture must never sign")
}

type remoteTerminalConn struct {
	net.Conn
	closes       atomic.Int32
	closeErr     error
	writeFailure atomic.Bool
	writeErr     error
	onWrite      func()
	observeRead  atomic.Bool
	readOnce     sync.Once
	reading      chan struct{}
}

func (c *remoteTerminalConn) Read(p []byte) (int, error) {
	if c.observeRead.Load() {
		c.readOnce.Do(func() { close(c.reading) })
	}
	return c.Conn.Read(p)
}

func (c *remoteTerminalConn) Close() error {
	c.closes.Add(1)
	return errors.Join(c.Conn.Close(), c.closeErr)
}
func (c *remoteTerminalConn) Write(p []byte) (int, error) {
	if c.writeFailure.Load() {
		if c.onWrite != nil {
			c.onWrite()
		}
		return 0, c.writeErr
	}
	return c.Conn.Write(p)
}

func remoteTerminalPair(t *testing.T) (*p2pconn.SecretConnection, *p2pconn.SecretConnection, crypto.PubKey, *remoteTerminalConn) {
	t.Helper()
	a, b := remoteRuntimeConfigs(t)
	left, right := net.Pipe()
	wrapped := &remoteTerminalConn{Conn: right, reading: make(chan struct{})}
	type result struct {
		conn *p2pconn.SecretConnection
		pin  crypto.PubKey
		err  error
	}
	done := make(chan result, 1)
	go func() {
		conn, pin, err := AuthenticatePQRemoteConnection(context.Background(), wrapped, b)
		done <- result{conn, pin, err}
	}()
	client, _, err := AuthenticatePQRemoteConnection(context.Background(), left, a)
	server := <-done
	if err != nil || server.err != nil {
		t.Fatal("synthetic transport handshake failed", err, server.err)
	}
	t.Cleanup(func() { _ = client.Close(); _ = server.conn.Close() })
	wrapped.observeRead.Store(true)
	return client, server.conn, server.pin, wrapped
}

func remoteTerminalAwait(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("terminal did not return within fixture bound")
		return nil
	}
}

func TestPQRemoteRuntimeTerminalCleanEOFAndOwnerCancel(t *testing.T) {
	for _, cancelOwner := range []bool{false, true} {
		name := "clean-authenticated-idle-eof"
		if cancelOwner {
			name = "owner-cancel-idle"
		}
		t.Run(name, func(t *testing.T) {
			client, server, pin, conn := remoteTerminalPair(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			source, pv := &remoteTerminalAuthority{}, &remoteTerminalValidator{}
			done := make(chan error, 1)
			go func() { done <- servePQRemoteConnection(ctx, server, pin, time.Second, "terminal-chain", source, pv) }()
			// net.Pipe's deadline setter also fails after its peer closes. Wait
			// for the actual idle read; do not relabel a setup error as EOF.
			select {
			case <-conn.reading:
			case <-time.After(time.Second):
				t.Fatal("authenticated idle read was not entered")
			}
			if cancelOwner {
				cancel()
			} else {
				_ = client.Close()
			}
			if err := remoteTerminalAwait(t, done); err != nil {
				t.Fatalf("normal idle session terminal returned failure: %v", err)
			}
			if conn.closes.Load() != 1 || source.calls.Load() != 0 || pv.calls.Load() != 0 {
				t.Fatal("terminal failed exact close/no-sign ownership")
			}
		})
	}
}

func TestPQRemoteRuntimeTerminalPreservesIncompleteAndLostResponse(t *testing.T) {
	for _, kind := range []string{"partial-prefix", "cancel-partial-prefix", "body-eof", "idle-timeout", "lost-response-eof", "cancel-during-response", "close-error"} {
		t.Run(kind, func(t *testing.T) {
			client, server, pin, conn := remoteTerminalPair(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			source, pv := &remoteTerminalAuthority{}, &remoteTerminalValidator{}
			closeCause := errors.New("fixture close failure")
			if kind == "close-error" {
				conn.closeErr = closeCause
			}
			if kind == "lost-response-eof" || kind == "cancel-during-response" {
				conn.writeErr = io.EOF
				conn.writeFailure.Store(true)
				if kind == "cancel-during-response" {
					conn.onWrite = cancel
				}
			}
			timeout := time.Second
			if kind == "idle-timeout" {
				timeout = 20 * time.Millisecond
			}
			done := make(chan error, 1)
			go func() { done <- servePQRemoteConnection(ctx, server, pin, timeout, "terminal-chain", source, pv) }()
			switch kind {
			case "partial-prefix":
				_, _ = client.Write([]byte{0, 0})
				_ = client.Close()
			case "cancel-partial-prefix":
				_, _ = client.Write([]byte{0, 0})
				cancel()
			case "body-eof":
				_, _ = client.Write(binary.BigEndian.AppendUint32(nil, 4))
				_ = client.Close()
			case "lost-response-eof", "cancel-during-response":
				_, _ = client.Write(append(binary.BigEndian.AppendUint32(nil, 1), 'x'))
			case "close-error":
				cancel()
			}
			err := remoteTerminalAwait(t, done)
			if err == nil {
				t.Fatal("incomplete/failed session was reported clean")
			}
			if kind == "close-error" && !errors.Is(err, closeCause) {
				t.Fatal("close first cause was discarded")
			}
			if (kind == "lost-response-eof" || kind == "cancel-during-response") && !errors.Is(err, io.EOF) {
				t.Fatal("original response loss was replaced by cancellation")
			}
			if source.calls.Load() != 0 || pv.calls.Load() != 0 {
				t.Fatal("terminal fixture unexpectedly reached authority/signing")
			}
		})
	}
}

func TestPQRemoteRuntimeTerminalCloseJoinsPhysicalAttempt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	entered, release := make(chan struct{}), make(chan struct{})
	cause := errors.New("original physical close error")
	var calls atomic.Int32
	owner := newPQRemoteCloseOwner(ctx, func() error { calls.Add(1); close(entered); <-release; return cause })
	cancel()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("cancellation close not entered")
	}
	done := make(chan error, 1)
	go func() { done <- owner.finish() }()
	select {
	case <-done:
		t.Fatal("finished before original Close returned")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := remoteTerminalAwait(t, done); !errors.Is(err, cause) {
		t.Fatal("physical close cause lost")
	}
	if err := owner.finish(); !errors.Is(err, cause) || calls.Load() != 1 {
		t.Fatal("close was retried or first result changed")
	}
}

func TestPQRemoteRuntimeTerminalListenerOwnerCancel(t *testing.T) {
	_, config := remoteRuntimeConfigs(t)
	reserved, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	config.Address = "tcp://" + reserved.Addr().String()
	if err = reserved.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan struct{})
	done := make(chan error, 1)
	source, pv := &remoteTerminalAuthority{}, &remoteTerminalValidator{}
	go func() {
		done <- ListenPQRemoteSignerReady(ctx, config, "terminal-chain", source, pv, time.Second, func() error { close(ready); return nil })
	}()
	select {
	case <-ready:
	case err := <-done:
		t.Fatal("listener did not become ready", err)
	case <-time.After(2 * time.Second):
		t.Fatal("listener readiness deadline")
	}
	cancel()
	if err = remoteTerminalAwait(t, done); err != nil {
		t.Fatalf("owner-canceled idle listener returned failure: %v", err)
	}
	if source.calls.Load() != 0 || pv.calls.Load() != 0 {
		t.Fatal("listener cancellation reached signer")
	}
}
