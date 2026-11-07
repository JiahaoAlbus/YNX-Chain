// PUBLIC transport peer only. It owns a real AF_UNIX listener and exact HTTP
// bytes, but implements no P08 Store, Source, Root, Grant, nonce or permission.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

var output sync.Mutex

func event(value any) {
	output.Lock()
	defer output.Unlock()
	_ = json.NewEncoder(os.Stdout).Encode(value)
}

// Normal mode proves the existing Go private caller boundary, including the
// original request pointer, caller/current and independently read opaque body.
// Raw modes below deliberately inject HTTP/EOF failures and claim no caller.
func normal(socket, mode string, uid uint32, pid int) {
	listener, err := securelink.ListenPrivate(socket, uint32(os.Geteuid()))
	if err != nil {
		panic(err)
	}
	commands := make(chan string, 8)
	done := make(chan struct{})
	routes := make([]securelink.LocalCallerRoute, 0, 3)
	for _, id := range []string{"input", "execute", "query"} {
		routes = append(routes, securelink.LocalCallerRoute{Method: "POST", Path: "/internal/ai/original-task-read/" + id, MaxBodyBytes: 1 << 20, Timeout: 8 * time.Second})
	}
	server, err := securelink.NewLocalCallerServer(securelink.LocalCallerServerConfig{
		Service: "ynx-ai-original-task-read-v1", PeerUID: uid, PeerPID: pid, Routes: routes,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			caller, currentErr := securelink.LocalCallerFromRequest(r)
			if currentErr != nil {
				http.Error(w, "PUBLIC caller refused", 503)
				return
			}
			fromContext, currentErr := securelink.LocalCallerFromContext(r.Context())
			if currentErr != nil || fromContext != caller {
				http.Error(w, "PUBLIC context refused", 503)
				return
			}
			actual, currentErr := caller.Current(r.Context())
			if currentErr != nil {
				http.Error(w, "PUBLIC current refused", 503)
				return
			}
			raw, currentErr := io.ReadAll(r.Body)
			if currentErr != nil || !bytes.Equal(raw, actual.RequestBody) {
				http.Error(w, "PUBLIC body refused", 503)
				return
			}
			_, cloneErr := securelink.LocalCallerFromRequest(r.Clone(r.Context()))
			if cloneErr == nil {
				http.Error(w, "PUBLIC clone admitted", 503)
				return
			}
			event(map[string]any{"event": "request", "method": actual.Method, "path": actual.Path, "host": actual.Service,
				"body": base64.StdEncoding.EncodeToString(raw), "length": actual.ContentLength, "contentType": actual.ContentType,
				"peerUID": actual.PeerUID, "peerPID": actual.PeerPID, "sameContextCaller": true, "cloneDenied": true, "originalCurrent": true})
			if mode == "normal-hold" {
				select {
				case <-commands:
				case <-done:
					return
				}
			}
			if _, currentErr = caller.Current(r.Context()); currentErr != nil {
				http.Error(w, "PUBLIC late current refused", 503)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Add("X-Public-Multi", "first")
			w.Header().Add("X-Public-Multi", "second")
			_, _ = w.Write(raw)
		}),
	})
	if err != nil {
		panic(err)
	}
	go func() {
		s := bufio.NewScanner(os.Stdin)
		for s.Scan() {
			if s.Text() == "stop" {
				break
			}
			commands <- s.Text()
		}
		close(done)
		_ = server.Retire()
	}()
	event(map[string]any{"event": "ready", "pid": os.Getpid(), "uid": os.Geteuid(), "PUBLIC": true, "actualLocalCallerServer": true})
	err = server.Serve(listener)
	_ = server.Retire()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	joinErr := server.Join(ctx)
	closeErr := server.Close()
	event(map[string]any{"event": "drained", "serveError": fmt.Sprint(err), "joinError": fmt.Sprint(joinErr), "closeError": fmt.Sprint(closeErr)})
}

func main() {
	if len(os.Args) != 5 {
		panic("usage: PUBLIC-peer socket mode clientUID clientPID")
	}
	uid, err := strconv.ParseUint(os.Args[3], 10, 32)
	if err != nil {
		panic(err)
	}
	pid, err := strconv.Atoi(os.Args[4])
	if err != nil {
		panic(err)
	}
	if os.Args[2] == "normal" || os.Args[2] == "normal-hold" {
		normal(os.Args[1], os.Args[2], uint32(uid), pid)
		return
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: os.Args[1], Net: "unix"})
	if err != nil {
		panic(err)
	}
	listener.SetUnlinkOnClose(false)
	if err = os.Chmod(os.Args[1], 0600); err != nil {
		panic(err)
	}
	commands := make(chan string, 16)
	done := make(chan struct{})
	var owned sync.Map
	var workers sync.WaitGroup
	go func() {
		scan := bufio.NewScanner(os.Stdin)
		for scan.Scan() {
			if scan.Text() == "stop" {
				break
			}
			commands <- scan.Text()
		}
		close(done)
		_ = listener.Close()
		owned.Range(func(key, _ any) bool { _ = key.(*net.UnixConn).Close(); return true })
	}()
	var connections atomic.Int32
	event(map[string]any{"event": "ready", "pid": os.Getpid(), "uid": os.Geteuid(), "PUBLIC": true})
	for {
		conn, acceptErr := listener.AcceptUnix()
		if acceptErr != nil {
			break
		}
		id := connections.Add(1)
		owned.Store(conn, true)
		event(map[string]any{"event": "connection", "id": id})
		workers.Add(1)
		go func() {
			defer workers.Done()
			defer owned.Delete(conn)
			defer conn.Close()
			defer event(map[string]any{"event": "closed", "id": id})
			_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
			request, readErr := http.ReadRequest(bufio.NewReader(conn))
			if readErr != nil {
				event(map[string]any{"event": "read-error", "id": id, "error": readErr.Error()})
				return
			}
			body, readErr := io.ReadAll(io.LimitReader(request.Body, (1<<20)+1))
			_ = request.Body.Close()
			event(map[string]any{"event": "request", "id": id, "method": request.Method, "path": request.RequestURI,
				"host": request.Host, "contentType": request.Header.Get("Content-Type"), "length": request.ContentLength,
				"body": base64.StdEncoding.EncodeToString(body), "headers": request.Header})
			if readErr != nil {
				return
			}
			mode := os.Args[2]
			if mode == "hold" || mode == "partial-hold" {
				if mode == "partial-hold" {
					_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 30\r\nConnection: close\r\n\r\n{\"PUBLIC\":")
					event(map[string]any{"event": "prefix", "id": id})
				}
				select {
				case command := <-commands:
					if command != "respond" {
						return
					}
				case <-done:
					return
				}
			}
			switch mode {
			case "drop":
				return
			case "partial", "partial-hold":
				if mode == "partial" {
					_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 30\r\nConnection: close\r\n\r\n{\"PUBLIC\":")
				}
				return
			case "bad-mime":
				_, _ = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(body), body)
			case "oversize":
				_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1048577\r\nConnection: close\r\n\r\n")
			case "redirect":
				_, _ = io.WriteString(conn, "HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:1/no-retry\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
			default:
				_, _ = io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Public-Multi: first\r\nX-Public-Multi: second\r\nContent-Length: "+strconv.Itoa(len(body))+"\r\nConnection: close\r\n\r\n")
				_, _ = conn.Write(body)
			}
		}()
	}
	workers.Wait()
	event(map[string]any{"event": "drained", "connections": connections.Load()})
}
