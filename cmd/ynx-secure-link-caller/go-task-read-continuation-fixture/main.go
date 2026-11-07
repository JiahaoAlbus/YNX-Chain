// PUBLIC mechanism peer. Real Unix/SCM and Go caller; no Auth Source, Native
// capability, reservation verifier, resource Store, receipt or Root admission.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
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
	"golang.org/x/sys/unix"
)

var output sync.Mutex

func event(v any) { output.Lock(); defer output.Unlock(); _ = json.NewEncoder(os.Stdout).Encode(v) }

func raw(listener net.Listener, mode string, stop <-chan struct{}) {
	var workers sync.WaitGroup
	var active sync.Map
	go func() {
		<-stop
		_ = listener.Close()
		active.Range(func(k, _ any) bool { _ = k.(net.Conn).Close(); return true })
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			break
		}
		active.Store(conn, true)
		workers.Add(1)
		go func() {
			defer workers.Done()
			defer active.Delete(conn)
			defer conn.Close()
			u := conn.(*net.UnixConn)
			_ = u.SetDeadline(time.Now().Add(5 * time.Second))
			var marker [1]byte
			oob := make([]byte, unix.CmsgSpace(16*4))
			n, on, flags, _, err := u.ReadMsgUnix(marker[:], oob)
			var fds []int
			messages, _ := unix.ParseSocketControlMessage(oob[:on])
			for _, m := range messages {
				got, e := unix.ParseUnixRights(&m)
				if e == nil {
					fds = append(fds, got...)
				}
			}
			if err != nil || n != 1 || marker[0] != 'R' || len(fds) != 1 || flags&unix.MSG_CTRUNC != 0 {
				for _, fd := range fds {
					_ = unix.Close(fd)
				}
				return
			}
			f := os.NewFile(uintptr(fds[0]), "PUBLIC-raw-control")
			c, e := net.FileConn(f)
			_ = f.Close()
			if e != nil {
				return
			}
			defer c.Close()
			_ = c.SetDeadline(time.Now().Add(5 * time.Second))
			request, e := http.ReadRequest(bufio.NewReader(u))
			if e != nil {
				return
			}
			body, e := io.ReadAll(io.LimitReader(request.Body, (1<<20)+1))
			_ = request.Body.Close()
			if e != nil {
				return
			}
			event(map[string]any{"event": "request", "path": request.RequestURI, "body": base64.StdEncoding.EncodeToString(body), "genuineLocalCaller": false, "PUBLIC": true})
			digest := sha256.Sum256(body)
			var command [41]byte
			binary.BigEndian.PutUint32(command[:4], 37)
			command[4] = 'C'
			binary.BigEndian.PutUint32(command[5:9], 1)
			copy(command[9:], digest[:])
			if mode == "bad-hash" {
				command[9] ^= 1
			}
			if mode == "bad-seq" {
				binary.BigEndian.PutUint32(command[5:9], 2)
			}
			if mode == "claim-lost-ack" {
				command[4] = 'F'
			}
			if _, e = c.Write(command[:]); e != nil {
				return
			}
			if mode == "claim-lost-ack" {
				var prefix [1]byte
				n, e := io.ReadFull(c, prefix[:])
				event(map[string]any{"event": "control", "command": "F", "ackPrefixBytes": n, "ackFrameValidated": false, "error": fmt.Sprint(e), "PUBLIC": true})
				return
			}
			var reply [4]byte
			_, e = io.ReadFull(c, reply[:])
			event(map[string]any{"event": "control", "command": "C", "protocolFault": mode, "error": fmt.Sprint(e), "PUBLIC": true})
		}()
	}
	workers.Wait()
	event(map[string]any{"event": "drained", "joinError": "<nil>", "closeError": "<nil>", "activeHandlers": 0, "genuineLocalCaller": false, "PUBLIC": true})
}

func main() {
	if len(os.Args) != 5 {
		panic("usage: PUBLIC-continuation-peer socket mode clientUID clientPID")
	}
	uid, err := strconv.ParseUint(os.Args[3], 10, 32)
	if err != nil {
		panic(err)
	}
	pid, err := strconv.Atoi(os.Args[4])
	if err != nil {
		panic(err)
	}
	mode := os.Args[2]
	if mode != "normal" && mode != "partial" && mode != "old-server" && mode != "claim-lost-ack" && mode != "bad-hash" && mode != "bad-seq" {
		panic("unknown PUBLIC fixture mode")
	}
	listener, err := securelink.ListenPrivate(os.Args[1], uint32(os.Geteuid()))
	if err != nil {
		panic(err)
	}
	stop := make(chan struct{})
	go func() {
		s := bufio.NewScanner(os.Stdin)
		for s.Scan() {
			if s.Text() == "stop" {
				break
			}
		}
		close(stop)
	}()
	if mode == "claim-lost-ack" || mode == "bad-hash" || mode == "bad-seq" {
		event(map[string]any{"event": "ready", "pid": os.Getpid(), "uid": os.Geteuid(), "PUBLIC": true, "mode": mode, "genuineLocalCaller": false})
		raw(listener, mode, stop)
		return
	}
	var handlers, completed atomic.Int32
	cfg := securelink.LocalCallerServerConfig{Service: "ynx-ai-original-task-read-v1", PeerUID: uint32(uid), PeerPID: pid, ReadTimeout: 4 * time.Second, ReadHeaderTimeout: 2 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlers.Add(1)
		defer handlers.Add(-1)
		defer completed.Add(1)
		caller, e := securelink.LocalCallerFromRequest(r)
		if e != nil {
			http.Error(w, "PUBLIC genuine caller denied", 503)
			return
		}
		same, e := securelink.LocalCallerFromContext(r.Context())
		if e != nil || same != caller {
			http.Error(w, "PUBLIC context denied", 503)
			return
		}
		material, e := caller.Current(r.Context())
		if e != nil {
			http.Error(w, "PUBLIC current denied", 503)
			return
		}
		body, e := io.ReadAll(r.Body)
		if e != nil || !bytes.Equal(body, material.RequestBody) {
			http.Error(w, "PUBLIC original body denied", 503)
			return
		}
		_, cloneErr := securelink.LocalCallerFromRequest(r.Clone(r.Context()))
		if cloneErr == nil {
			http.Error(w, "PUBLIC clone unexpectedly accepted", 503)
			return
		}
		cap, capErr := securelink.OriginalTaskReadContinuationFromOriginalRequest(r)
		event(map[string]any{"event": "request", "path": material.Path, "body": base64.StdEncoding.EncodeToString(body), "originalCurrent": true, "sameContextCaller": true, "cloneDenied": true, "continuationPresent": cap != nil && capErr == nil, "getterDenied": capErr != nil, "genuineLocalCaller": true, "PUBLIC": true})
		if r.URL.Path == "/internal/ai/original-task-read/execute" {
			if capErr != nil || cap == nil {
				http.Error(w, "PUBLIC continuation missing", 503)
				return
			}
			defer func() {
				_ = cap.Retire()
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				joinErr := cap.Join(ctx)
				closeErr := cap.Close()
				event(map[string]any{"event": "control-drained", "joinError": fmt.Sprint(joinErr), "closeError": fmt.Sprint(closeErr), "lifetime": cap.Lifetime(), "PUBLIC": true})
			}()
			if e = cap.Current(r.Context()); e != nil {
				event(map[string]any{"event": "control", "phase": "C", "error": e.Error(), "PUBLIC": true})
				http.Error(w, "PUBLIC Current refused", 503)
				return
			}
			data, e := cap.ReadOriginalRequestDATA(r.Context())
			if e != nil {
				http.Error(w, "PUBLIC DATA refused", 503)
				return
			}
			if e = cap.ClaimAtOriginalResourceFence(r.Context()); e != nil {
				event(map[string]any{"event": "control", "phase": "F", "error": e.Error(), "PUBLIC": true})
				http.Error(w, "PUBLIC claim refused", 503)
				return
			}
			if cap.ClaimAtOriginalResourceFence(r.Context()) == nil {
				http.Error(w, "PUBLIC duplicate claim admitted", 503)
				return
			}
			event(map[string]any{"event": "control", "currentCount": 1, "requestDATA": base64.StdEncoding.EncodeToString(data), "claimSelected": cap.Lifetime().ClaimSelected, "claimAck": true, "secondClaimDenied": true, "PUBLIC": true})
		} else if capErr == nil || cap != nil {
			http.Error(w, "PUBLIC plain purpose acquired continuation", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if mode == "partial" {
			w.Header().Set("Content-Length", strconv.Itoa(len(body)+5))
			prefix := body
			if len(prefix) > 7 {
				prefix = prefix[:7]
			}
			_, _ = w.Write(prefix)
			return
		}
		_, _ = w.Write(body)
	})}
	for _, id := range []string{"input", "execute", "query"} {
		cfg.Routes = append(cfg.Routes, securelink.LocalCallerRoute{Method: "POST", Path: "/internal/ai/original-task-read/" + id, MaxBodyBytes: 1 << 20, Timeout: 5 * time.Second})
	}
	var server *securelink.LocalCallerServer
	if mode == "old-server" {
		server, err = securelink.NewLocalCallerServer(cfg)
	} else {
		server, err = securelink.NewOriginalTaskReadContinuationServer(cfg)
	}
	if err != nil {
		panic(err)
	}
	go func() { <-stop; _ = server.Retire() }()
	event(map[string]any{"event": "ready", "pid": os.Getpid(), "uid": os.Geteuid(), "PUBLIC": true, "mode": mode, "genuineLocalCaller": true})
	serveErr := server.Serve(listener)
	_ = server.Retire()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	joinErr := server.Join(ctx)
	closeErr := server.Close()
	event(map[string]any{"event": "drained", "serveError": fmt.Sprint(serveErr), "joinError": fmt.Sprint(joinErr), "closeError": fmt.Sprint(closeErr), "activeHandlers": handlers.Load(), "completedHandlers": completed.Load(), "PUBLIC": true})
}
