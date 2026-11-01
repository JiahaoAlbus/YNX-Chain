package aitaskactionsource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
)

var ErrOriginalOutcomeUnavailable = errors.New("AI_TASK_V6_ORIGINAL_BUSINESS_OUTCOME_NOT_SUPPLIED")
var ErrOriginalOnly = errors.New("AI_TASK_V6_ORIGINAL_QUERY_ONLY")

type OriginalLocalActionDATA struct {
	OperationID, RequestRef, RequestDigest, BodyDigest, Action, Method, Path string
	Body                                                                     []byte
}
type HeldOriginalBusinessOutcome struct {
	parent    *OriginalTaskStateReader
	receipt   *aiproduct.TaskActionOutcomeReceipt
	lookup    *aiproduct.TaskStoreActionOutcome
	released  atomic.Bool
	first     atomic.Pointer[taskStateFailure]
	action    string
	closeOnce sync.Once
	closeErr  error
}
type OriginalBusinessOutcomeDATA struct {
	State, Action, BusinessAction, CompletionScope, RequestRef, OriginalRef, OperationID, RequestDigest string
	BodyDigest, BodyBytes                                                                               string
	Status                                                                                              int
	BusinessReceiptOriginal, BodyOriginal                                                               []byte
}

func originalProductAction(action string) (string, error) {
	switch action {
	case "task.create":
		return "create-task", nil
	case "task.prepare":
		return "prepare-task", nil
	case "task.cancel":
		return "cancel-task", nil
	case "task.complete":
		return "complete-task", nil
	case "task.propose-tool-step":
		return "propose-tool-step", nil
	}
	return "", ErrOriginalOutcomeUnavailable
}
func (o *HeldOriginalBusinessOutcome) remember(e error) error {
	if e == nil {
		return nil
	}
	o.first.CompareAndSwap(nil, &taskStateFailure{cause: e})
	return o.first.Load().cause
}

// This is a concrete PRODUCT-local DATA adapter, never an Auth constructor.
// Normal Source independently verifies sole SDK V6/E5/current and durably
// reserves its sameSQLite request BEFORE invoking this actual P08 CAS port.
func (r *OriginalTaskStateReader) ExecuteOriginalLocalActionDATA(ctx context.Context, held *HeldTaskStateDATA, call OriginalLocalActionDATA) (out *HeldOriginalBusinessOutcome, err error) {
	out = &HeldOriginalBusinessOutcome{parent: r, action: call.Action}
	if r != nil {
		r.children.Add(1)
	}
	defer func() {
		if err != nil {
			out.remember(err)
		}
	}()
	if ctx == nil || r == nil || r.retired.Load() || r.original == nil || r.server == nil || held == nil || held.parent != r || held.snapshot == nil {
		return out, ErrOriginalOutcomeUnavailable
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	if err = held.Current(); err != nil {
		return out, err
	}
	action, e := originalProductAction(call.Action)
	if e != nil {
		return out, e
	}
	if !held.effectEntered.CompareAndSwap(false, true) {
		return out, ErrOriginalOnly
	}
	out.receipt, err = r.server.ExecuteOriginalLocalTaskAction(ctx, held.snapshot, aiproduct.TaskActionCall{OriginalOperationID: call.OperationID, RequestRef: call.RequestRef, RequestDigest: call.RequestDigest, BodyDigest: call.BodyDigest, Action: action, Method: call.Method, Path: call.Path, Body: append([]byte(nil), call.Body...)})
	if err != nil {
		return out, err
	}
	// Do NOT recheck the obsolete writer snapshot. A successful local action
	// changes its epoch/gen; only its original op-limited durable receipt is read.
	if err = out.Current(); err != nil {
		return out, err
	}
	return out, nil
}
func (r *OriginalTaskStateReader) CaptureOriginalOutcomeDATA(ctx context.Context, p aiproduct.TaskStorePrincipal, operationID, requestDigest, action string) (out *HeldOriginalBusinessOutcome, err error) {
	out = &HeldOriginalBusinessOutcome{parent: r, action: action}
	if r != nil {
		r.children.Add(1)
	}
	defer func() {
		if err != nil {
			out.remember(err)
		}
	}()
	if r == nil || r.retired.Load() || r.original == nil || ctx == nil {
		return out, ErrOriginalOutcomeUnavailable
	}
	mapped, e := originalProductAction(action)
	if e != nil {
		return out, e
	}
	out.lookup, err = r.original.CaptureOriginalActionOutcome(ctx, aiproduct.TaskStoreActionOriginalLookup{Principal: p, OperationID: operationID, RequestDigest: requestDigest, Action: mapped})
	if err != nil {
		return out, err
	}
	if err = out.Current(); err != nil {
		return out, err
	}
	return out, nil
}
func (o *HeldOriginalBusinessOutcome) Current() error {
	if o == nil {
		return ErrOriginalOutcomeUnavailable
	}
	if first := o.first.Load(); first != nil {
		return first.cause
	}
	if o.released.Load() || o.parent == nil || o.parent.retired.Load() {
		return o.remember(ErrOriginalOutcomeUnavailable)
	}
	if o.receipt != nil {
		return o.remember(o.receipt.Current())
	}
	if o.lookup != nil {
		return o.remember(o.lookup.Current())
	}
	return o.remember(ErrOriginalOutcomeUnavailable)
}
func (o *HeldOriginalBusinessOutcome) ReadOriginalOutcomeDATA() (OriginalBusinessOutcomeDATA, error) {
	var out OriginalBusinessOutcomeDATA
	if e := o.Current(); e != nil {
		return out, e
	}
	out.Action = o.action
	if o.receipt != nil {
		v, e := o.receipt.View()
		if e != nil {
			return out, o.remember(e)
		}
		raw, e := json.Marshal(v)
		if e != nil {
			return out, e
		}
		body, e := o.receipt.Body()
		if e != nil {
			return out, o.remember(e)
		}
		out = OriginalBusinessOutcomeDATA{State: v.State, Action: o.action, BusinessAction: v.Action, CompletionScope: v.Scope, RequestRef: v.RequestRef, OriginalRef: v.OriginalRef, OperationID: v.OriginalOperationID, RequestDigest: v.RequestDigest, Status: v.HTTPStatus, BusinessReceiptOriginal: raw, BodyOriginal: body}
		sum := sha256.Sum256(body)
		out.BodyDigest, out.BodyBytes = hex.EncodeToString(sum[:]), strconv.FormatUint(uint64(len(body)), 10)
	} else {
		v, e := o.lookup.View()
		if e != nil {
			return out, o.remember(e)
		}
		raw, e := json.Marshal(v)
		if e != nil {
			return out, e
		}
		out.State = v.State
		out.BusinessAction = v.Action
		out.OriginalRef = v.OriginalRef
		out.OperationID = v.OperationID
		out.RequestDigest = v.RequestDigest
		out.Status = v.Status
		out.BodyDigest, out.BodyBytes = v.BodyDigest, strconv.FormatUint(v.BodyBytes, 10)
		out.BusinessReceiptOriginal = raw
		if v.State == "COMMITTED" {
			out.CompletionScope = "PRODUCT_LOCAL_COMMIT_ONLY"
		}
	}
	if e := o.Current(); e != nil {
		return OriginalBusinessOutcomeDATA{}, e
	}
	return out, nil
}
func (o *HeldOriginalBusinessOutcome) Close() error {
	if o == nil {
		return nil
	}
	o.closeOnce.Do(func() {
		o.released.Store(true)
		if o.parent != nil {
			defer o.parent.children.Add(-1)
		}
		if o.receipt != nil {
			o.closeErr = o.receipt.Close()
		} else if o.lookup != nil {
			o.closeErr = o.lookup.Close()
		}
	})
	return o.closeErr
}
