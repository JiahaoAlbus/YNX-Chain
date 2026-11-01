package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
)

// Consumer bound from sole SDK 97e8f2e0 PRODUCT_SESSION_TASK_V6_LIMITS.body.
// Private transport may carry more bytes; that does not widen signed V6 bodies.
const maxTaskV6ObservationBodyBytes = 1048576

var ErrTaskV6ObservationBodyLimit = errors.New("AI_TASK_V6_OBSERVATION_BODY_LIMIT")

type taskObservationBodyWriter struct {
	taskActionBodyWriter
	err error
}

func (w *taskObservationBodyWriter) Write(body []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	if len(body) > maxTaskV6ObservationBodyBytes-w.body.Len() {
		w.err = ErrTaskV6ObservationBodyLimit
		return 0, w.err
	}
	return w.taskActionBodyWriter.Write(body)
}

type TaskStoreObservationView struct {
	Decision, Scope, Kind       string
	Principal                   TaskStorePrincipal
	Method, Path, RequestDigest string
	Status                      int
	BodyDigest                  string
	BodyBytes                   uint64
}

// An observation can only be constructed by an actual closed read handler or
// original opaque outcome read. It is never a write/Grant or completion receipt.
type TaskStoreObservation struct {
	source   *TaskStoreSource
	ctx      context.Context
	epoch    *taskStoreEpoch
	original *TaskStoreActionOutcome
	view     TaskStoreObservationView
	body     []byte
	released atomic.Bool
}

func (o *TaskStoreObservation) Current() error {
	if o == nil || o.source == nil || o.source.retired.Load() || o.released.Load() {
		return ErrTaskStoreSnapshotStale
	}
	if err := o.ctx.Err(); err != nil {
		return err
	}
	if o.original != nil {
		return o.original.Current()
	}
	if o.source.store.authorityEpoch.Load() != o.epoch {
		return ErrTaskStoreSnapshotStale
	}
	return nil
}
func (o *TaskStoreObservation) View() (TaskStoreObservationView, error) {
	if err := o.Current(); err != nil {
		return TaskStoreObservationView{}, err
	}
	return o.view, nil
}
func (o *TaskStoreObservation) Body() ([]byte, error) {
	if err := o.Current(); err != nil {
		return nil, err
	}
	return bytes.Clone(o.body), nil
}
func (o *TaskStoreObservation) Release() error {
	if o != nil {
		o.released.Store(true)
		if o.original != nil {
			return o.original.Close()
		}
	}
	return nil
}
func (o *TaskStoreObservation) Close() error { return o.Release() }
func observationView(p TaskStorePrincipal, call TaskActionCall, kind string, status int, body []byte) TaskStoreObservationView {
	digest := sha256.Sum256(body)
	return TaskStoreObservationView{Decision: "OBSERVED", Scope: "READ_ONLY_OBSERVATION", Kind: kind, Principal: p, Method: call.Method, Path: call.Path, RequestDigest: call.RequestDigest, Status: status, BodyDigest: hex.EncodeToString(digest[:]), BodyBytes: uint64(len(body))}
}
func validTaskReadCall(call TaskActionCall) bool {
	if !boundedTaskActionOperand(call.OriginalOperationID) || !boundedTaskActionOperand(call.RequestRef) || !boundedTaskActionOperand(call.RequestDigest) || !boundedTaskActionOperand(call.Action) || len(call.Path) > 2048 {
		return false
	}
	sum := sha256.Sum256(call.Body)
	return call.BodyDigest == hex.EncodeToString(sum[:])
}

// Original Auth owns proof/action-schema/current admission and signs OBSERVED,
// not COMMITTED. The product selects a fixed real read operation from the exact
// verified route; it does not accept caller rows, response bytes or state.
func (source *TaskStoreSource) ObserveOriginalTaskRead(ctx context.Context, server *Server, session ProductSession, call TaskActionCall) (*TaskStoreObservation, error) {
	p := TaskStorePrincipal{Account: session.Account, DeviceID: session.DeviceID, SessionID: session.ID}
	if err := source.begin(ctx, p); err != nil {
		return nil, err
	}
	if server == nil || server.store != source.store || call.Method != http.MethodGet || len(call.Body) != 0 || !validTaskReadCall(call) {
		return nil, errToolInvalid
	}
	target, err := url.ParseRequestURI(call.Path)
	if err != nil || target.IsAbs() || target.RawPath != "" || target.Fragment != "" {
		return nil, errToolInvalid
	}
	segments := strings.Split(strings.Trim(target.Path, "/"), "/")
	if len(segments) < 2 || segments[0] != "api" || segments[1] != "tasks" || target.Path != "/"+strings.Join(segments, "/") {
		return nil, errToolInvalid
	}
	query, err := url.ParseQuery(target.RawQuery)
	if err != nil {
		return nil, errToolInvalid
	}
	request, err := http.NewRequestWithContext(ctx, call.Method, call.Path, nil)
	if err != nil {
		return nil, err
	}
	writer := &taskObservationBodyWriter{taskActionBodyWriter: taskActionBodyWriter{header: http.Header{}}}
	before := source.store.authorityEpoch.Load()
	kind := ""
	switch {
	case len(segments) == 2:
		for key, values := range query {
			if key != "afterId" || len(values) != 1 {
				return nil, errToolInvalid
			}
		}
		kind = "task-list"
		server.handleTaskList(writer, request, session)
	case len(segments) == 3:
		if !toolOperationID.MatchString(segments[2]) {
			return nil, errToolInvalid
		}
		for key, values := range query {
			if key != "afterCursor" || len(values) != 1 {
				return nil, errToolInvalid
			}
		}
		request.SetPathValue("id", segments[2])
		kind = "task-read"
		server.handleTaskProjection(writer, request, session)
	case len(segments) == 6 && segments[3] == "tool-steps" && segments[5] == "result":
		if target.RawQuery != "" || !toolOperationID.MatchString(segments[2]) || !toolOperationID.MatchString(segments[4]) {
			return nil, errToolInvalid
		}
		request.SetPathValue("id", segments[2])
		request.SetPathValue("stepId", segments[4])
		kind = "task-result-read"
		server.handleTaskToolResult(writer, request, session)
	case len(segments) == 5 && segments[3] == "runs":
		if target.RawQuery != "" || !toolOperationID.MatchString(segments[2]) || !toolOperationID.MatchString(segments[4]) {
			return nil, errToolInvalid
		}
		request.SetPathValue("id", segments[2])
		request.SetPathValue("runId", segments[4])
		kind = "task-run-read"
		server.handleTaskModelRunRead(writer, request, session)
	default:
		return nil, errToolInvalid
	}
	if writer.err != nil {
		return nil, writer.err
	}
	if before == nil || source.store.authorityEpoch.Load() != before {
		return nil, ErrTaskStoreSnapshotStale
	}
	if writer.status < 200 || writer.status >= 300 || !json.Valid(writer.body.Bytes()) {
		return nil, errToolNotFound
	}
	body := bytes.Clone(writer.body.Bytes())
	observation := &TaskStoreObservation{source: source, ctx: ctx, epoch: before, body: body, view: observationView(p, call, kind, writer.status, body)}
	if err := observation.Current(); err != nil {
		return observation, err
	}
	return observation, nil
}

// Outer read stays OBSERVED. Its payload may contain an original business
// outcome's COMMITTED/UNKNOWN evidence, but never a new CAS or an Auth admission.
func (source *TaskStoreSource) ObserveOriginalTaskOutcome(ctx context.Context, session ProductSession, call TaskActionCall, lookup TaskStoreActionOriginalLookup) (*TaskStoreObservation, error) {
	p := TaskStorePrincipal{Account: session.Account, DeviceID: session.DeviceID, SessionID: session.ID}
	if err := source.begin(ctx, p); err != nil {
		return nil, err
	}
	if call.Method != http.MethodGet || len(call.Body) != 0 || !validTaskReadCall(call) || p.Account != lookup.Principal.Account || p.DeviceID != lookup.Principal.DeviceID {
		return nil, errToolInvalid
	}
	original, err := source.CaptureOriginalActionOutcome(ctx, lookup)
	if err != nil {
		if original != nil {
			original.Close()
		}
		return nil, err
	}
	view, err := original.View()
	if err != nil {
		original.Close()
		return nil, err
	}
	body, err := taskActionResponse(http.StatusOK, map[string]any{"original": view})
	if err != nil {
		original.Close()
		return nil, err
	}
	if len(body) > maxTaskV6ObservationBodyBytes {
		original.Close()
		return nil, ErrTaskV6ObservationBodyLimit
	}
	observation := &TaskStoreObservation{source: source, ctx: ctx, original: original, body: body, view: observationView(p, call, "original-outcome-query", http.StatusOK, body)}
	if err := observation.Current(); err != nil {
		return observation, err
	}
	return observation, nil
}

// Reconciliation may recover and persist an original protected result, but
// never dispatches a new effect. The outer action remains a read observation.
func (source *TaskStoreSource) ObserveOriginalTaskQuery(ctx context.Context, server *Server, session ProductSession, call TaskActionCall) (*TaskStoreObservation, error) {
	p := TaskStorePrincipal{Account: session.Account, DeviceID: session.DeviceID, SessionID: session.ID}
	if err := source.begin(ctx, p); err != nil {
		return nil, err
	}
	if server == nil || server.store != source.store || call.Method != http.MethodPost || len(call.Body) == 0 || len(call.Body) > 32<<10 {
		return nil, errToolInvalid
	}
	call.Body = bytes.Clone(call.Body)
	if !validTaskReadCall(call) {
		return nil, errToolInvalid
	}
	target, err := url.ParseRequestURI(call.Path)
	if err != nil || target.IsAbs() || target.RawPath != "" || target.RawQuery != "" {
		return nil, errToolInvalid
	}
	segments := strings.Split(strings.Trim(target.Path, "/"), "/")
	if len(segments) != 6 || segments[0] != "api" || segments[1] != "tasks" || segments[3] != "tool-steps" || segments[5] != "reconcile" || target.Path != "/"+strings.Join(segments, "/") || !toolOperationID.MatchString(segments[2]) || !toolOperationID.MatchString(segments[4]) {
		return nil, errToolInvalid
	}
	request, err := http.NewRequestWithContext(ctx, call.Method, call.Path, bytes.NewReader(call.Body))
	if err != nil {
		return nil, err
	}
	request.SetPathValue("id", segments[2])
	request.SetPathValue("stepId", segments[4])
	writer := &taskObservationBodyWriter{taskActionBodyWriter: taskActionBodyWriter{header: http.Header{}}}
	server.handleTaskToolReconcile(writer, request, session)
	if writer.err != nil {
		return nil, writer.err
	}
	if writer.status == http.StatusServiceUnavailable {
		return nil, errTaskEffectSourceUnavailable
	}
	if writer.status != http.StatusOK || !json.Valid(writer.body.Bytes()) {
		return nil, errTaskEffectUnresolved
	}
	s := source.store
	s.mu.Lock()
	defer s.mu.Unlock()
	actual, err := s.effectCallLocked(session, segments[2], segments[4], false)
	if err != nil {
		return nil, err
	}
	receipt, err := s.taskReadReceiptLocked(actual.OriginalStep)
	if err != nil {
		return nil, err
	}
	var response any = receipt
	if actual.CurrentTask.Holder != session.DeviceID {
		response = map[string]any{"state": receipt.State, "effectRef": receipt.EffectRef, "recoveryOnly": true}
	}
	body, err := taskActionResponse(http.StatusOK, response)
	if err != nil {
		return nil, err
	}
	if len(body) > maxTaskV6ObservationBodyBytes {
		return nil, ErrTaskV6ObservationBodyLimit
	}
	if !bytes.Equal(body, writer.body.Bytes()) {
		return nil, ErrTaskStoreSnapshotStale
	}
	observation := &TaskStoreObservation{source: source, ctx: ctx, epoch: s.authorityEpoch.Load(), body: body, view: observationView(p, call, "original-effect-query", http.StatusOK, body)}
	if err := observation.Current(); err != nil {
		return observation, err
	}
	return observation, nil
}
