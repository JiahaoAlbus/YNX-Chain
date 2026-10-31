//go:build securelink_openssl && cgo

package native

/*
#cgo pkg-config: openssl
#include <stdlib.h>
#include "bridge.h"
*/
import "C"

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type Context struct {
	mu  sync.Mutex
	ptr *C.SSL_CTX
	cfg Config
}

type Conn struct {
	*connection
}

// Keeping all mutable/native state behind this private pointer also makes an
// accidental copy of the exported handle share its close/revocation state.
type connection struct {
	id              ConnectionID // assigned once; survives Close
	transport       net.Conn
	raw             syscall.RawConn
	mu              sync.Mutex // protects each nonblocking call into this SSL instance
	readMu, writeMu sync.Mutex
	ptr             *C.SSL
	readBuffer      unsafe.Pointer
	readStash       []byte
	state           State
	closed          bool
}

func NewContext(cfg Config) (*Context, error) {
	if cfg.CertFile == "" || cfg.KeyFile == "" || cfg.CAFile == "" || cfg.PeerSAN == "" ||
		strings.ContainsAny(cfg.PeerSAN, "\x00*/ :\\\t\r\n") || strings.ContainsRune(cfg.CertFile+cfg.KeyFile+cfg.CAFile, 0) {
		return nil, errors.New("securelink: exact peer DNS SAN and service credential paths required")
	}
	cert, key, ca := C.CString(cfg.CertFile), C.CString(cfg.KeyFile), C.CString(cfg.CAFile)
	defer C.free(unsafe.Pointer(cert))
	defer C.free(unsafe.Pointer(key))
	defer C.free(unsafe.Pointer(ca))
	var message [256]C.char
	server := C.int(0)
	if cfg.Server {
		server = 1
	}
	ptr := C.ynx_ctx_new(cert, key, ca, server, &message[0], C.size_t(len(message)))
	if ptr == nil {
		return nil, fmt.Errorf("securelink: %s", C.GoString(&message[0]))
	}
	c := &Context{ptr: ptr, cfg: cfg}
	runtime.SetFinalizer(c, func(c *Context) { _ = c.Close() })
	return c, nil
}

func (c *Context) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ptr != nil {
		C.SSL_CTX_free(c.ptr)
		c.ptr = nil
	}
	return nil
}

func (c *Context) Client(ctx context.Context, transport net.Conn) (*Conn, error) {
	if c.cfg.Server {
		return nil, errors.New("securelink: server context cannot dial as client")
	}
	return c.handshake(ctx, transport)
}
func (c *Context) Server(ctx context.Context, transport net.Conn) (*Conn, error) {
	if !c.cfg.Server {
		return nil, errors.New("securelink: client context cannot accept as server")
	}
	return c.handshake(ctx, transport)
}

func (c *Context) handshake(ctx context.Context, transport net.Conn) (*Conn, error) {
	if transport == nil {
		return nil, errors.New("securelink: missing socket")
	}
	socket, ok := transport.(syscall.Conn)
	if !ok {
		return nil, errors.New("securelink: native TLS requires a pollable OS socket")
	}
	raw, err := socket.SyscallConn()
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	peer := C.CString(c.cfg.PeerSAN)
	defer C.free(unsafe.Pointer(peer))
	c.mu.Lock()
	if c.ptr == nil {
		c.mu.Unlock()
		return nil, net.ErrClosed
	}
	var ptr *C.SSL
	server := C.int(0)
	if c.cfg.Server {
		server = 1
	}
	err = raw.Control(func(fd uintptr) { ptr = C.ynx_ssl_new(c.ptr, C.int(fd), server, peer) })
	c.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if ptr == nil {
		return nil, errors.New("securelink: native TLS socket unavailable")
	}
	id, err := newConnectionID()
	if err != nil {
		C.SSL_free(ptr)
		return nil, err
	}
	conn := &Conn{connection: &connection{id: id, transport: transport, raw: raw, ptr: ptr}}
	conn.readBuffer = C.malloc(16 << 10)
	if conn.readBuffer == nil {
		_ = conn.Close()
		return nil, errors.New("securelink: native read buffer unavailable")
	}
	runtime.SetFinalizer(conn.connection, func(state *connection) { _ = (&Conn{connection: state}).Close() })
	deadline := time.Now().Add(30 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err = transport.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	err = conn.perform(2, func() (int, int, error) {
		var message [256]C.char
		status := C.ynx_handshake(ptr, &message[0], C.size_t(len(message)))
		if status < 0 {
			return int(status), 0, errors.New(C.GoString(&message[0]))
		}
		return int(status), 0, nil
	})
	if err != nil {
		_ = conn.Close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	conn.mu.Lock()
	var snapshot C.ynx_tls_state
	var message [256]C.char
	valid := !conn.closed && C.ynx_snapshot(ptr, peer, server, &snapshot, &message[0], C.size_t(len(message))) == 1
	if valid {
		peerEKU, localEKU := "serverAuth", "clientAuth"
		if c.cfg.Server {
			peerEKU, localEKU = localEKU, peerEKU
		}
		conn.state = State{
			Protocol: C.GoString(&snapshot.protocol[0]), Group: C.GoString(&snapshot.group[0]), Cipher: C.GoString(&snapshot.cipher[0]),
			PeerSAN: C.GoString(&snapshot.peer_san[0]), LocalSAN: C.GoString(&snapshot.local_san[0]),
			PeerFingerprint: C.GoString(&snapshot.peer_fingerprint[0]), RootFingerprint: C.GoString(&snapshot.root_fingerprint[0]),
			PeerEKU: peerEKU, LocalEKU: localEKU, PeerSignature: C.GoString(&snapshot.signature[0]),
			RuntimeVersion: C.GoString(C.ynx_runtime_version()), NotAfter: time.Unix(int64(snapshot.not_after), 0),
			Verified: snapshot.verified == 1, Mutual: snapshot.mutual == 1, Resumed: snapshot.resumed == 1, AllChainMLDSA87: snapshot.chain_pq == 1,
		}
	}
	conn.mu.Unlock()
	if !valid {
		_ = conn.Close()
		return nil, fmt.Errorf("securelink: %s", C.GoString(&message[0]))
	}
	if !stop() && ctx.Err() != nil {
		_ = conn.Close()
		return nil, ctx.Err()
	}
	if err = transport.SetDeadline(time.Time{}); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

// perform runs nonblocking libssl calls under the SSL mutex, but leaves waiting
// to Go's network poller with that mutex released. Close first wakes the poller.
func (c *Conn) perform(direction int, step func() (status int, count int, err error)) error {
	status := direction
	var operationErr error
	run := func(uintptr) {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.closed {
			status = -1
			operationErr = net.ErrClosed
			return
		}
		status, _, operationErr = step()
		if status == 0 {
			operationErr = io.EOF
		}
	}
	// The first call uses the operation's own poll direction, so deadlines are
	// honored and a concurrent blocked Read does not prevent an initial Write.
	for status == 2 || status == 3 {
		ready := func(uintptr) bool {
			run(0)
			return status != 2
		}
		var err error
		if status == 2 {
			err = c.raw.Read(ready)
		} else {
			err = c.raw.Write(func(fd uintptr) bool {
				ready(fd)
				return status != 3
			})
		}
		if err != nil {
			return err
		}
	}
	return operationErr
}

func (c *Conn) Read(p []byte) (int, error) {
	if c == nil || c.connection == nil {
		return 0, net.ErrClosed
	}
	if len(p) == 0 {
		return 0, nil
	}
	c.readMu.Lock()
	defer c.readMu.Unlock()
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return 0, net.ErrClosed
	}
	if len(c.readStash) != 0 {
		n := copy(p, c.readStash)
		c.readStash = c.readStash[n:]
		c.mu.Unlock()
		return n, nil
	}
	c.mu.Unlock()
	var count C.size_t
	err := c.perform(2, func() (int, int, error) {
		var message [256]C.char
		r := C.ynx_read(c.ptr, c.readBuffer, 16<<10, &count, &message[0], C.size_t(len(message)))
		if r < 0 {
			return int(r), int(count), errors.New(C.GoString(&message[0]))
		}
		return int(r), int(count), nil
	})
	if err != nil {
		// net/http deliberately interrupts an idle Read with a temporary read
		// deadline. Keep the same C-owned buffer alive for the next SSL retry;
		// libssl never retains a pointer to the caller's Go buffer.
		var timeout net.Error
		if !errors.As(err, &timeout) || !timeout.Timeout() {
			_ = c.Close()
		}
		return 0, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return 0, net.ErrClosed
	}
	data := C.GoBytes(c.readBuffer, C.int(count))
	n := copy(p, data)
	c.readStash = data[n:]
	return n, nil
}
func (c *Conn) Write(p []byte) (int, error) {
	if c == nil || c.connection == nil {
		return 0, net.ErrClosed
	}
	if len(p) == 0 {
		return 0, nil
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	var pinned runtime.Pinner
	pinned.Pin(&p[0])
	defer pinned.Unpin()
	var count C.size_t
	err := c.perform(3, func() (int, int, error) {
		var message [256]C.char
		r := C.ynx_write(c.ptr, unsafe.Pointer(&p[0]), C.size_t(len(p)), &count, &message[0], C.size_t(len(message)))
		if r < 0 {
			return int(r), int(count), errors.New(C.GoString(&message[0]))
		}
		return int(r), int(count), nil
	})
	// OpenSSL may retain the original buffer across WANT_* retries. Destroy the
	// SSL instance on an incomplete operation before its Go buffer is unpinned.
	if err != nil {
		_ = c.Close()
	}
	runtime.KeepAlive(p)
	return int(count), err
}
func (c *Conn) Close() error {
	if c == nil || c.connection == nil {
		return nil
	}
	// Wake Go's fd poller before taking the SSL mutex. SSL calls are nonblocking;
	// this mutex only excludes a call that is currently using the SSL object.
	err := c.transport.Close()
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	runtime.SetFinalizer(c.connection, nil)
	if c.ptr != nil {
		C.SSL_free(c.ptr)
		c.ptr = nil
	}
	if c.readBuffer != nil {
		C.free(c.readBuffer)
		c.readBuffer = nil
	}
	c.mu.Unlock()
	return err
}
func (c *Conn) LocalAddr() net.Addr                { return c.transport.LocalAddr() }
func (c *Conn) RemoteAddr() net.Addr               { return c.transport.RemoteAddr() }
func (c *Conn) SetDeadline(t time.Time) error      { return c.transport.SetDeadline(t) }
func (c *Conn) SetReadDeadline(t time.Time) error  { return c.transport.SetReadDeadline(t) }
func (c *Conn) SetWriteDeadline(t time.Time) error { return c.transport.SetWriteDeadline(t) }
func (c *Conn) ID() ConnectionID {
	if c == nil || c.connection == nil {
		return ConnectionID{}
	}
	return c.id
}

func (c *Conn) Snapshot() State {
	if c == nil || c.connection == nil {
		return State{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return State{}
	}
	return c.state
}
func (c *Conn) ExportKeyingMaterial(label string, context []byte, length int) ([]byte, error) {
	if label != "EXPORTER-Channel-Binding" || len(context) != 0 || length != 32 {
		return nil, errors.New("securelink: exporter restricted to RFC 9266 tls-exporter binding")
	}
	if c == nil || c.connection == nil {
		return nil, net.ErrClosed
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || !c.state.Verified {
		return nil, net.ErrClosed
	}
	out := make([]byte, length)
	l := C.CString(label)
	defer C.free(unsafe.Pointer(l))
	if C.ynx_export(c.ptr, l, C.size_t(len(label)), nil, 0, (*C.uchar)(unsafe.Pointer(&out[0])), C.size_t(length)) != 1 {
		return nil, errors.New("securelink: TLS exporter unavailable")
	}
	return out, nil
}
