package privval

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"testing"
	"time"

	"github.com/cometbft/cometbft/crypto/ed25519"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
)

func terminalContextPair(t *testing.T) (*p2pconn.SecretConnection, *contextConnection) {
	t.Helper()
	left, right := net.Pipe()
	t.Cleanup(func() { _ = left.Close(); _ = right.Close() })
	a, b := ed25519.GenPrivKey(), ed25519.GenPrivKey()
	type reply struct {
		conn *p2pconn.SecretConnection
		err  error
	}
	done := make(chan reply, 1)
	go func() { conn, err := p2pconn.MakeSecretConnection(left, a); done <- reply{conn, err} }()
	server, err := p2pconn.MakeSecretConnection(right, b)
	client := <-done
	if err != nil || client.err != nil {
		t.Fatal(err, client.err)
	}
	reader, err := pinnedContextConnection(server, a.PubKey(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return client.conn, reader
}

func TestYNXRemoteSessionTerminalReadBoundaries(t *testing.T) {
	for _, kind := range []string{"idle-eof", "partial-prefix", "body-eof", "partial-body", "idle-timeout", "deadline-setup-closed", "complete-frame"} {
		t.Run(kind, func(t *testing.T) {
			client, reader := terminalContextPair(t)
			if kind == "idle-timeout" {
				reader.timeout = 20 * time.Millisecond
			}
			if kind == "deadline-setup-closed" {
				_ = reader.conn.Close()
			}
			written := make(chan struct{})
			go func() {
				defer close(written)
				switch kind {
				case "idle-eof":
					_ = client.Close()
				case "partial-prefix":
					_, _ = client.Write([]byte{0, 0})
					_ = client.Close()
				case "body-eof":
					_, _ = client.Write(binary.BigEndian.AppendUint32(nil, 2))
					_ = client.Close()
				case "partial-body":
					_, _ = client.Write(append(binary.BigEndian.AppendUint32(nil, 2), 'x'))
					_ = client.Close()
				case "complete-frame":
					_, _ = client.Write(append(binary.BigEndian.AppendUint32(nil, 1), 'x'))
				}
			}()
			wire, boundary, err := reader.readFrame()
			<-written
			if kind == "complete-frame" {
				if err != nil || boundary != contextReadStarted || string(wire) != "x" {
					t.Fatal("original complete frame changed")
				}
				return
			}
			if err == nil {
				t.Fatal("incomplete frame succeeded")
			}
			terminal := &contextSignerReadError{cause: err, boundary: boundary}
			if IsContextSignerIdleEOF(terminal) != (kind == "idle-eof") {
				t.Fatal("EOF terminal lost original read boundary")
			}
			if kind == "body-eof" && (!errors.Is(err, io.EOF) || boundary != contextReadStarted) {
				t.Fatal("body EOF was converted to no request")
			}
			if (kind == "partial-body" || kind == "partial-prefix") && boundary != contextReadStarted {
				t.Fatal("partial frame became idle")
			}
			if kind == "idle-timeout" && IsContextSignerIdleReadClosed(terminal) {
				t.Fatal("timeout became owner close")
			}
			if IsContextSignerIdleEOF(io.EOF) || IsContextSignerIdleEOF(errors.Join(terminal, errors.New("cleanup failed"))) || IsContextSignerIdleReadClosed(net.ErrClosed) {
				t.Fatal("unqualified raw/joined error became clean terminal")
			}
		})
	}
}
