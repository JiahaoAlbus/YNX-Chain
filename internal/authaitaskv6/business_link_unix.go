//go:build darwin || linux

package aitaskactionsource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

type originalLINKTaskLoan struct {
	original *securelink.OriginalTaskRuntimeCaller
}

func (l *originalLINKTaskLoan) currentOriginalRequest(r *http.Request) error {
	if l == nil || l.original == nil {
		return errTaskRuntimeOriginal
	}
	return l.original.CurrentOriginalRequest(r)
}

var canonicalRuntimeRef = regexp.MustCompile(`^auth-task-(action|query)-v6:[a-f0-9]{64}$`)
var runtimeHex64 = regexp.MustCompile(`^[a-f0-9]{64}$`)

type originalNodeCommand struct {
	RequestRef *string `json:"requestRef"`
	Handle     *string `json:"handle"`
	Original   *struct {
		OperationID    string `json:"operationId"`
		RequestDigest  string `json:"requestDigest"`
		Action         string `json:"action"`
		SessionBinding string `json:"sessionBinding"`
	} `json:"original"`
}

func (s *originalTaskBusinessSession) exchange(ctx context.Context, operation string, raw []byte) (securelink.TaskRuntimeReply, error) {
	var result securelink.TaskRuntimeReply
	if ctx == nil || len(raw) > 1048576 {
		return result, errTaskRuntimeOriginal
	}
	if e := ctx.Err(); e != nil && operation != "release" {
		return result, e
	}
	fields, e := originalPrivateObject(raw, "requestRef", "handle", "original")
	if e != nil {
		return result, e
	}
	if !bytes.Equal(bytes.TrimSpace(fields["original"]), []byte("null")) {
		if _, e = originalPrivateObject(fields["original"], "operationId", "requestDigest", "action", "sessionBinding"); e != nil {
			return result, e
		}
	}
	var command originalNodeCommand
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&command) != nil || decoder.Decode(new(any)) != io.EOF || command.RequestRef != nil && !canonicalRuntimeRef.MatchString(*command.RequestRef) {
		return result, errTaskRuntimeResource
	}
	// This is a same-private-loan locator, never an HTTP supplied principal,
	// action, request body, expected row, Root bool or approval declaration.
	s.mu.Lock()
	if command.RequestRef != nil {
		if s.node.requestRef != "" && s.node.requestRef != *command.RequestRef {
			s.mu.Unlock()
			return result, errTaskRuntimeResource
		}
		if s.node.requestRef == "" {
			s.node.requestRef = *command.RequestRef
		}
	}
	if command.Original != nil {
		if operation != "outcome" && operation != "observe-outcome" {
			s.mu.Unlock()
			return result, errTaskRuntimeResource
		}
		q := command.Original
		if len(q.OperationID) == 0 || len(q.OperationID) > 128 || !runtimeHex64.MatchString(q.RequestDigest) || !runtimeHex64.MatchString(q.SessionBinding) {
			s.mu.Unlock()
			return result, errTaskRuntimeResource
		}
		if _, e := originalProductAction(q.Action); e != nil {
			s.mu.Unlock()
			return result, e
		}
		if s.node.lookupOperation != "" && (s.node.lookupOperation != q.OperationID || s.node.lookupDigest != q.RequestDigest || s.node.lookupAction != q.Action || s.node.lookupSession != q.SessionBinding) {
			s.mu.Unlock()
			return result, errTaskRuntimeResource
		}
		s.node.lookupOperation, s.node.lookupDigest, s.node.lookupAction, s.node.lookupSession = q.OperationID, q.RequestDigest, q.Action, q.SessionBinding
	}
	s.mu.Unlock()
	selector := ""
	if command.Handle != nil {
		selector = *command.Handle
	}
	reply, e := s.dispatch(operation, selector)
	encoded, encodingError := json.Marshal(reply)
	result = securelink.TaskRuntimeReply{StatusCode: 200, Body: encoded}
	if e != nil {
		result.StatusCode = 503
		return result, e
	}
	if encodingError != nil {
		return securelink.TaskRuntimeReply{}, encodingError
	}
	if len(encoded) > 33554432 {
		return securelink.TaskRuntimeReply{}, errTaskRuntimeResource
	}
	return result, nil
}
func (s *originalTaskBusinessSession) Capture(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "capture", b)
}
func (s *originalTaskBusinessSession) CaptureConversation(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "capture-conversation", b)
}
func (s *originalTaskBusinessSession) ExecuteLocal(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "execute-local", b)
}
func (s *originalTaskBusinessSession) Observe(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "observe", b)
}
func (s *originalTaskBusinessSession) Outcome(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "outcome", b)
}
func (s *originalTaskBusinessSession) ObserveOutcome(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "observe-outcome", b)
}
func (s *originalTaskBusinessSession) ReconcileObserve(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "reconcile-observe", b)
}
func (s *originalTaskBusinessSession) Release(c context.Context, b []byte) (securelink.TaskRuntimeReply, error) {
	return s.exchange(c, "release", b)
}
func (s *originalTaskBusinessSession) Current() error {
	if s == nil {
		return errTaskRuntimeOriginal
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.fence(); e != nil {
		return e
	}
	// Phase-aware: the most recently retained actual original wins. Never AND
	// an obsolete writer epoch with an already committed immutable result.
	for n := s.next; n > 0; n-- {
		r := s.resources[strconv.FormatUint(n, 10)]
		if r == nil || r.closed {
			continue
		}
		if r.outcome != nil {
			return r.outcome.Current()
		}
		if r.observed != nil {
			return r.observed.Current()
		}
		if r.snapshot != nil {
			return r.snapshot.Current()
		}
	}
	return nil
}
func (s *originalTaskBusinessSession) Retire() {
	if s != nil {
		s.retired.Store(true)
		if c, ok := s.ctx.(*originalTaskRuntimeContext); ok {
			c.cancel()
		}
	}
}
func (s *originalTaskBusinessSession) Join(ctx context.Context) error {
	if ctx == nil {
		return errTaskRuntimeOriginal
	}
	if s == nil {
		return nil
	}
	if !s.retired.Load() {
		return errors.New("AI_V6_RUNTIME_RETIRE_REQUIRED")
	}
	// TryLock avoids an unbounded mutex wait while a product operation drains.
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		if s.mu.TryLock() {
			s.mu.Unlock()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
func (s *originalTaskBusinessSession) Close() error { return s.close() }

var _ securelink.TaskRuntimeSession = (*originalTaskBusinessSession)(nil)
