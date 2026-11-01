// PUBLIC transport fixture only. It is not installed into an Auth/Source
// release, does not implement product actions, and grants no business authority.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

var outputMu sync.Mutex

func event(v any) { outputMu.Lock(); defer outputMu.Unlock(); _ = json.NewEncoder(os.Stdout).Encode(v) }

type fixtureSession struct {
	caller  *securelink.OriginalTaskRuntimeCaller
	request *http.Request
	ctx     context.Context
	mode    string
	retired atomic.Bool
	current atomic.Int32
}

func (s *fixtureSession) Current() error {
	if s.retired.Load() {
		return securelink.ErrDenied
	}
	if err := s.ctx.Err(); err != nil {
		return err
	}
	return s.caller.CurrentOriginalRequest(s.request)
}
func (s *fixtureSession) call(ctx context.Context, op string, b []byte) (securelink.TaskRuntimeReply, error) {
	if err := s.caller.Current(ctx); err != nil {
		return securelink.TaskRuntimeReply{StatusCode: 409}, err
	}
	if err := s.Current(); err != nil {
		return securelink.TaskRuntimeReply{StatusCode: 409}, err
	}
	event(map[string]any{"event": "operation", "op": op, "bytes": len(b), "ctxAlive": ctx.Err() == nil})
	if s.mode == "slow" && op == "execute-local" {
		<-ctx.Done()
		return securelink.TaskRuntimeReply{StatusCode: 409, Body: []byte(`{"originalPartial":"cancelled"}`)}, ctx.Err()
	}
	if s.mode == "partial" && op == "execute-local" {
		return securelink.TaskRuntimeReply{StatusCode: 409, Body: []byte(`{"originalPartial":"retained"}`)}, errors.New("PUBLIC original operation failure")
	}
	if op == "release" {
		s.retired.Store(true)
	}
	return securelink.TaskRuntimeReply{StatusCode: 200, Body: bytes.Clone(b)}, nil
}
func (s *fixtureSession) Capture(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "capture", b)
}
func (s *fixtureSession) CaptureConversation(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "capture-conversation", b)
}
func (s *fixtureSession) ExecuteLocal(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "execute-local", b)
}
func (s *fixtureSession) Observe(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "observe", b)
}
func (s *fixtureSession) Outcome(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "outcome", b)
}
func (s *fixtureSession) ObserveOutcome(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "observe-outcome", b)
}
func (s *fixtureSession) ReconcileObserve(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "reconcile-observe", b)
}
func (s *fixtureSession) Release(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.call(c, "release", b)
}
func (s *fixtureSession) Retire()                    { s.retired.Store(true) }
func (s *fixtureSession) Join(context.Context) error { return nil }
func (s *fixtureSession) Close() error {
	event(map[string]any{"event": "session-closed", "ctxAlive": s.ctx.Err() == nil})
	return nil
}
func main() {
	if len(os.Args) != 6 {
		panic("usage: fixture socket nodeUID nodePID effect|effect-query normal|partial|open-error|slow")
	}
	uid, err := strconv.ParseUint(os.Args[2], 10, 32)
	if err != nil {
		panic(err)
	}
	pid, err := strconv.Atoi(os.Args[3])
	if err != nil {
		panic(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://original-go-task.test/api/tasks", bytes.NewReader([]byte(`{"originalUserBody":"PUBLIC"}`)))
	if err != nil {
		panic(err)
	}
	req.Header.Set("Content-Type", "application/json")
	f, err := securelink.NewOriginalTaskRuntimeForwarder(securelink.TaskRuntimeForwarderConfig{Service: "runtime-test", SocketPath: os.Args[1], PeerUID: uint32(uid), PeerPID: pid, Timeout: 4 * time.Second, OpenSession: func(c context.Context, r *http.Request, caller *securelink.OriginalTaskRuntimeCaller) (securelink.TaskRuntimeSession, error) {
		s := &fixtureSession{caller: caller, request: r, ctx: c, mode: os.Args[5]}
		event(map[string]any{"event": "open", "sameRequest": r == req, "ctxAlive": c.Err() == nil})
		if s.mode == "open-error" {
			return s, errors.New("PUBLIC original partial open failure")
		}
		return s, nil
	}})
	if err != nil {
		panic(err)
	}
	event(map[string]any{"event": "ready", "pid": os.Getpid(), "uid": os.Geteuid()})
	if _, err = bufio.NewReader(os.Stdin).ReadString('\n'); err != nil {
		panic(err)
	}
	out, err := f.Forward(req.Context(), req, os.Args[4], []byte(`{"originalNodeEnvelope":"PUBLIC"}`))
	_ = f.Retire()
	drain, cancelDrain := context.WithTimeout(context.Background(), time.Second)
	defer cancelDrain()
	joinErr := f.Join(drain)
	closeErr := f.Close()
	var de *securelink.DispatchError
	dispatch := errors.As(err, &de) && de.DispatchPossible
	var partial int64
	if de != nil {
		partial = de.PartialResponseBytes
	}
	message := ""
	if err != nil {
		message = err.Error()
	}
	event(map[string]any{"event": "result", "statusCode": out.StatusCode, "body": string(out.Body), "error": message, "dispatchPossible": dispatch, "partialResponseBytes": partial, "drained": joinErr == nil && closeErr == nil})
	if joinErr != nil || closeErr != nil {
		fmt.Fprintln(os.Stderr, "PUBLIC retained runtime cleanup debt")
		os.Exit(1)
	}
}
