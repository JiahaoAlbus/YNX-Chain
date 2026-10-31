//go:build darwin || linux

package securelink

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"testing"
)

func TestLocalCallerClientDispatchCauseAndActualProgress(t *testing.T) {
	path, listener := localTestSocket(t)
	client, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: path, Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{localTestRoute()}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Call(context.Background(), "POST", "/unregistered", "application/json", []byte(`{}`))
	var phase *DispatchError
	if !errors.Is(err, ErrDenied) || !errors.As(err, &phase) || phase.DispatchPossible {
		t.Fatal("unregistered local route claimed a dispatch", err)
	}
	done := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		request, err := http.ReadRequest(bufio.NewReader(conn))
		if err == nil {
			_, err = io.Copy(io.Discard, request.Body)
			_ = request.Body.Close()
		}
		if err == nil {
			_, err = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{\"x\":")
		}
		done <- err
	}()
	_, err = client.Call(context.Background(), "POST", "/authority/prepare", "application/json", []byte(`{}`))
	phase = nil
	if !errors.Is(err, io.ErrUnexpectedEOF) || !errors.As(err, &phase) || !phase.DispatchPossible || phase.PartialResponseBytes != 5 {
		t.Fatal("actual local partial response/cause was lost", err, phase)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
