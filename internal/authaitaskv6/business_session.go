package aitaskactionsource

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
)

// Private fixed normal LINK adapter, never an exported provider or JSON grant.
// Its synchronous fence is observed ORIGINAL request lifetime only. Fresh OS /
// Root / Node SQLite current occurs outside the product Store lock; those are
// separate processes, not one atomic transaction.
type originalTaskRuntimeLoan interface {
	currentOriginalRequest(*http.Request) error
}
type originalTaskRequestBinding struct {
	principal aiproduct.TaskStorePrincipal
	task      TaskBindingDATA
	call      OriginalLocalActionDATA
}

// These DATA locators may only be read from the original Node Source's SAME
// SQLite ticket/record over the held private LINK loan. Never derive AuthRef
// from a product OriginalRef, HTTP field or a second canonical/E5 codec.
type originalTaskNodeRecord struct {
	requestRef                                                 string
	lookupOperation, lookupDigest, lookupAction, lookupSession string
}
type originalBusinessResource struct {
	snapshot *HeldTaskStateDATA
	outcome  *HeldOriginalBusinessOutcome
	observed *HeldOriginalObservation
	closed   bool
	first    error
}
type originalTaskBusinessSession struct {
	mu              sync.Mutex
	request         *http.Request
	ctx             context.Context
	reader          *OriginalTaskStateReader
	loan            originalTaskRuntimeLoan
	binding         originalTaskRequestBinding
	node            originalTaskNodeRecord
	resources       map[string]*originalBusinessResource
	next            uint64
	retired         atomic.Bool
	first, closeErr error
	closeSelected   bool
}
type originalBusinessReply struct {
	Handle          string  `json:"handle"`
	Kind            string  `json:"kind"`
	Metadata        any     `json:"metadata"`
	BodyOriginal    *string `json:"bodyOriginal"`
	ReceiptOriginal *string `json:"receiptOriginal"`
}

var errTaskRuntimeOriginal = errors.New("AI_V6_ORIGINAL_RUNTIME_LOAN_NOT_SUPPLIED")
var errTaskRuntimeResource = errors.New("AI_V6_ORIGINAL_RUNTIME_RESOURCE")

func (s *originalTaskBusinessSession) fence() error {
	if s == nil || s.request == nil || s.ctx == nil || s.reader == nil || s.loan == nil {
		return errTaskRuntimeOriginal
	}
	if s.first != nil {
		return s.first
	}
	if s.retired.Load() {
		return ErrTaskStateUnavailable
	}
	if e := s.ctx.Err(); e != nil {
		if c, ok := s.ctx.(*originalTaskRuntimeContext); ok {
			e = c.cause()
		}
		s.first = e
		return e
	}
	if e := s.loan.currentOriginalRequest(s.request); e != nil {
		s.first = e
		return e
	}
	return nil
}
func (s *originalTaskBusinessSession) retain(r *originalBusinessResource) (string, error) {
	if len(s.resources) >= 16 {
		return "", errTaskRuntimeResource
	}
	s.next++
	key := strconv.FormatUint(s.next, 10)
	s.resources[key] = r
	return key, nil
}
func (r *originalBusinessResource) close() error {
	if r.closed {
		return r.first
	}
	r.closed = true
	for _, close := range []func() error{func() error {
		if r.observed != nil {
			return r.observed.Close()
		}
		return nil
	}, func() error {
		if r.outcome != nil {
			return r.outcome.Close()
		}
		return nil
	}, func() error {
		if r.snapshot != nil {
			return r.snapshot.Close()
		}
		return nil
	}} {
		if e := close(); e != nil && r.first == nil {
			r.first = e
		}
	}
	return r.first
}
func wireBytes(b []byte) *string {
	if b == nil {
		return nil
	}
	s := base64.RawURLEncoding.EncodeToString(b)
	return &s
}

// No generic RPC and no HTTP-current route. Normal factory's private LINK
// callback is the only production caller. A resource selector alone is useless
// without this exact request/session loan and the original opaque object.
func (s *originalTaskBusinessSession) dispatch(operation, selector string) (reply originalBusinessReply, err error) {
	if s == nil {
		return reply, errTaskRuntimeOriginal
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if operation == "release" {
		r := s.resources[selector]
		if r == nil {
			return reply, errTaskRuntimeResource
		}
		return reply, r.close()
	}
	if err = s.fence(); err != nil {
		return reply, err
	}
	if s.resources == nil {
		s.resources = make(map[string]*originalBusinessResource)
	}
	// Reserve budget BEFORE any producer can return a partial owner. Never
	// create a seventeenth opaque object then drop unknown cleanup debt.
	if len(s.resources) >= 16 {
		return reply, errTaskRuntimeResource
	}
	var r *originalBusinessResource
	kind := ""
	switch operation {
	case "capture", "capture-conversation":
		if selector != "" || operation == "capture-conversation" && s.binding.task.Action != "task.create" || operation == "capture" && s.binding.task.Action == "task.create" {
			return reply, errTaskRuntimeResource
		}
		r = &originalBusinessResource{}
		r.snapshot, err = s.reader.CaptureDATA(s.ctx, s.binding.principal, s.binding.task)
		kind = "snapshot"
	case "execute-local":
		previous := s.resources[selector]
		if previous == nil || previous.closed || previous.snapshot == nil || s.node.requestRef == "" {
			return reply, errTaskRuntimeResource
		}
		c := s.binding.call
		c.RequestRef = s.node.requestRef
		r = &originalBusinessResource{}
		r.outcome, err = s.reader.ExecuteOriginalLocalActionDATA(s.ctx, previous.snapshot, c)
		kind = "outcome"
	case "outcome":
		if selector != "" || s.node.lookupOperation == "" || s.node.lookupDigest == "" || s.node.lookupSession == "" {
			return reply, errTaskRuntimeOriginal
		}
		p := s.binding.principal
		p.SessionID = s.node.lookupSession
		r = &originalBusinessResource{}
		r.outcome, err = s.reader.CaptureOriginalOutcomeDATA(s.ctx, p, s.node.lookupOperation, s.node.lookupDigest, s.node.lookupAction)
		kind = "outcome"
	case "observe", "reconcile-observe":
		if selector != "" || s.node.requestRef == "" || operation == "reconcile-observe" && s.binding.call.Action != "task.reconcile" || operation == "observe" && s.binding.call.Action == "task.reconcile" {
			return reply, errTaskRuntimeResource
		}
		c := s.binding.call
		c.RequestRef = s.node.requestRef
		r = &originalBusinessResource{}
		r.observed, err = s.reader.ObserveOriginalDATA(s.ctx, aiproduct.ProductSession{ID: s.binding.principal.SessionID, Account: s.binding.principal.Account, DeviceID: s.binding.principal.DeviceID}, c)
		kind = "observation"
	case "observe-outcome":
		if selector != "" || s.node.requestRef == "" || s.node.lookupOperation == "" || s.node.lookupDigest == "" || s.node.lookupSession == "" {
			return reply, errTaskRuntimeOriginal
		}
		c := s.binding.call
		c.RequestRef = s.node.requestRef
		mapped, e := originalProductAction(s.node.lookupAction)
		if e != nil {
			return reply, e
		}
		p := s.binding.principal
		p.SessionID = s.node.lookupSession
		r = &originalBusinessResource{observed: &HeldOriginalObservation{parent: s.reader, action: c.Action, requestRef: c.RequestRef}}
		s.reader.children.Add(1)
		r.observed.original, err = s.reader.original.ObserveOriginalTaskOutcome(s.ctx, aiproduct.ProductSession{ID: s.binding.principal.SessionID, Account: p.Account, DeviceID: p.DeviceID}, aiproduct.TaskActionCall{OriginalOperationID: c.OperationID, RequestRef: c.RequestRef, RequestDigest: c.RequestDigest, BodyDigest: c.BodyDigest, Action: c.Action, Method: c.Method, Path: c.Path, Body: append([]byte(nil), c.Body...)}, aiproduct.TaskStoreActionOriginalLookup{Principal: p, OperationID: s.node.lookupOperation, RequestDigest: s.node.lookupDigest, Action: mapped})
		if err != nil {
			r.observed.remember(err)
		}
		kind = "observation"
	default:
		return reply, errTaskRuntimeResource
	}
	// Retain every nonnull partial BEFORE looking at an error or post-current.
	if r != nil {
		key, e := s.retain(r)
		if e != nil {
			_ = r.close()
			if err == nil {
				err = e
			}
		} else {
			reply.Handle = key
			reply.Kind = kind
		}
	}
	if err != nil {
		return reply, err
	}
	if err = s.fence(); err != nil {
		return reply, err
	}
	if r.snapshot != nil {
		v, e := r.snapshot.ViewDATA()
		if e != nil {
			return reply, e
		}
		reply.Metadata = map[string]any{"principal": map[string]string{"account": v.Principal.Account, "deviceId": v.Principal.DeviceID, "sessionId": v.Principal.SessionID}, "conversationId": v.ConversationID, "task": map[string]string{"id": v.Task.ID, "holder": v.Task.Holder, "status": v.Task.Status, "revision": strconv.FormatUint(v.Task.Revision, 10), "generation": strconv.FormatUint(v.Task.Generation, 10)}, "operation": map[string]string{"id": v.Operation.ID, "holder": v.Operation.Holder, "status": v.Operation.Status, "toolId": v.Operation.ToolID, "toolVersion": v.Operation.ToolVersion, "inputDigest": v.Operation.InputDigest, "revision": strconv.FormatUint(v.Operation.Revision, 10), "generation": strconv.FormatUint(v.Operation.Generation, 10)}}
	} else if r.outcome != nil {
		v, e := r.outcome.ReadOriginalOutcomeDATA()
		if e != nil {
			return reply, e
		}
		reply.Metadata = map[string]any{"state": v.State, "action": v.Action, "businessAction": v.BusinessAction, "completionScope": originalNullableString(v.CompletionScope), "requestRef": originalNullableString(v.RequestRef), "originalRef": v.OriginalRef, "operationId": v.OperationID, "requestDigest": v.RequestDigest, "status": v.Status, "bodyDigest": v.BodyDigest, "bodyBytes": v.BodyBytes}
		reply.BodyOriginal = wireBytes(v.BodyOriginal)
		reply.ReceiptOriginal = wireBytes(v.BusinessReceiptOriginal)
	} else if r.observed != nil {
		v, e := r.observed.ReadOriginalObservationDATA()
		if e != nil {
			return reply, e
		}
		if len(v.BodyOriginal) > 1<<20 {
			return reply, errors.New("AI_V6_OBSERVATION_BODY_EXCEEDS_SIGNED_CAP")
		}
		reply.Metadata = map[string]any{"state": v.State, "action": v.Action, "businessAction": nil, "completionScope": originalNullableString(v.CompletionScope), "requestRef": originalNullableString(v.RequestRef), "status": v.Status, "bodyDigest": v.BodyDigest, "bodyBytes": v.BodyBytes}
		reply.BodyOriginal = wireBytes(v.BodyOriginal)
		reply.ReceiptOriginal = wireBytes(v.BusinessReceiptOriginal)
	}
	return reply, s.fence()
}
func (s *originalTaskBusinessSession) close() error {
	if s == nil {
		return nil
	}
	s.retired.Store(true)
	if c, ok := s.ctx.(*originalTaskRuntimeContext); ok {
		c.cancel()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closeSelected {
		return s.closeErr
	}
	s.closeSelected = true
	for _, r := range s.resources {
		if e := r.close(); e != nil && s.closeErr == nil {
			s.closeErr = e
		}
	}
	return s.closeErr
}
