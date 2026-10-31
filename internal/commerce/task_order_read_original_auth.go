package commerce

import (
	"bytes"
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"unicode"

	authgrant "ynx.local/authgrantpolicy"
)

// Private in-process operands decoded by the ORIGINAL SDK/transport producer.
// This is not a public Grant/Source schema and is never JSON-decoded by Shop.
// Input is the exact original tool-input bytes; selection must be decoded from
// those bytes. The verifier must bind the real authenticated request channel.
type OriginalShopTaskOrderCall struct {
	Binding       authgrant.TaskEffectBinding
	Grant, Holder authgrant.Proof
	Input         []byte
}

type OriginalShopTaskOrderEncoding struct {
	ResponseOriginal []byte
	SourceBytes      []byte
	Body             []byte
	ContentType      string
}

// These locators are selected by the original protected operation authority,
// never derived from a step ID, response hash, snapshot or HTTP header.
type OriginalShopTaskOrderOperation struct{ OriginalOperationID, RemoteRef string }

type OriginalShopTaskOrderResponse struct {
	Binding    authgrant.TaskEffectBinding
	Operation  OriginalShopTaskOrderOperation
	Projection OrderProjection
	Source     authgrant.Source
	AuthScope  authgrant.FenceScope
	// Exact unchanged SDK DATA bytes frozen from this original locked read.
	// These are not the final signed frame and confer no receipt authority.
	// The original attester/receipt owner must retain them under the SAME
	// protected operation; never infer them by parsing an opaque original value.
	ResponseOriginal []byte
	SourceBytes      []byte
}

type OriginalShopTaskOrderResponseAuthority interface {
	OpenShopOrderReadResponse(context.Context, OriginalShopTaskOrderCall) (HeldOriginalShopTaskOrderResponse, error)
}
type HeldOriginalShopTaskOrderResponse interface {
	// Resolve the existing durable selection for this exact call/semantic slot;
	// keep it immutable through proof commit and Close. Never infer or mint it.
	Operation() (OriginalShopTaskOrderOperation, error)
	// The original authority must independently validate the exact expected
	// typed response and canonical payload before attesting. Not a blind signer.
	AttestShopOrderReadResponse(context.Context, OriginalShopTaskOrderResponse, []byte) (authgrant.Proof, error)
	Close() error
}

// In-process only; invoke synchronously exactly once and never retain it. The
// encoder asks the held original authority to attest actual source bytes and
// canonical payload. No serialized callback or bool.
type OriginalShopTaskOrderAttest func(context.Context, []byte, []byte) (authgrant.Proof, error)

func copyShopTaskResponse(r OriginalShopTaskOrderResponse) OriginalShopTaskOrderResponse {
	r.ResponseOriginal = bytes.Clone(r.ResponseOriginal)
	r.SourceBytes = bytes.Clone(r.SourceBytes)
	r.Binding = copyShopTaskOrderCall(OriginalShopTaskOrderCall{Binding: r.Binding}).Binding
	r.Source.Fields = append([]string(nil), r.Source.Fields...)
	r.Projection.Fields = append([]string(nil), r.Projection.Fields...)
	data := make(map[string]any, len(r.Projection.Data))
	for k, v := range r.Projection.Data {
		data[k] = v
	}
	r.Projection.Data = data
	return r
}

// The actual SDK supplies both operations. Calls must be concurrency-safe and
// return owned values. Encoding is pure apart from the one supplied attest call:
// encode the detached response context and verified original source/label. It
// returns the exact source-content bytes for the shared dual digest check.
// No local JSON-to-Grant decoder, signer, Source provider or default codec exists.
type OriginalShopTaskOrderCodec interface {
	DecodeShopOrderRead(context.Context, *http.Request, []byte) (OriginalShopTaskOrderCall, error)
	EncodeShopOrderRead(context.Context, OriginalShopTaskOrderResponse, OriginalShopTaskOrderAttest) (OriginalShopTaskOrderEncoding, error)
}

type originalShopTaskOrderReader struct {
	verifier  authgrant.OriginalTaskGrantVerifier
	codec     OriginalShopTaskOrderCodec
	responses OriginalShopTaskOrderResponseAuthority
	tool      authgrant.Tool
	target    authgrant.Sink
	orderKind string
}

// PrepareOriginalShopTaskOrders is a normal Go composition constructor, never
// a network endpoint or process-global provider setter. Its verifier and codec
// must come from original protected producers; this function implements neither.
// Tool/schema/target/kind are trusted registered profile operands, not request
// metadata. A nil/zero/partial installation stays closed.
func PrepareOriginalShopTaskOrders(verifier authgrant.OriginalTaskGrantVerifier, codec OriginalShopTaskOrderCodec, responses OriginalShopTaskOrderResponseAuthority, tool authgrant.Tool, target authgrant.Sink, orderKind string, current func(context.Context) error) (*PreparedOriginalShopTaskOrders, error) {
	if missingTaskOrderOperand(verifier) || missingTaskOrderOperand(codec) || missingTaskOrderOperand(responses) || current == nil || orderKind == "" || tool != ShopOrderReadToolDescriptor() || target.Operation != shopOrderReadOperation || target.Path != shopOrderReadPath || target.Service == "" || target.Tenant == "" || target.Origin == "" || target.Region == "" {
		return nil, ErrUnavailable
	}
	reader := &originalShopTaskOrderReader{verifier: verifier, codec: codec, responses: responses, tool: tool, target: target, orderKind: orderKind}
	return &PreparedOriginalShopTaskOrders{reader: reader, current: current}, nil
}

func taskOrderBytesBinding(raw []byte) authgrant.Bind {
	a, b := sha3.Sum512(raw), sha512.Sum512(raw)
	return authgrant.Bind{Bytes: strconv.Itoa(len(raw)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(b[:])}
}

func copyShopTaskOrderCall(c OriginalShopTaskOrderCall) OriginalShopTaskOrderCall {
	c.Input = append([]byte(nil), c.Input...)
	c.Grant.Payload = append([]byte(nil), c.Grant.Payload...)
	c.Grant.Wire = append([]byte(nil), c.Grant.Wire...)
	c.Holder.Payload = append([]byte(nil), c.Holder.Payload...)
	c.Holder.Wire = append([]byte(nil), c.Holder.Wire...)
	c.Binding.Fields = append([]string(nil), c.Binding.Fields...)
	c.Binding.Resources = append([]authgrant.Ref(nil), c.Binding.Resources...)
	c.Binding.Sources = append([]authgrant.Source(nil), c.Binding.Sources...)
	for i := range c.Binding.Sources {
		c.Binding.Sources[i].Fields = append([]string(nil), c.Binding.Sources[i].Fields...)
	}
	if c.Binding.EgressActual != nil {
		v := *c.Binding.EgressActual
		c.Binding.EgressActual = &v
	}
	return c
}

func (r *originalShopTaskOrderReader) selected(c OriginalShopTaskOrderCall, selection ShopOrderReadSelection) error {
	b := c.Binding
	if b.Tool != r.tool || b.Audience != r.target.Service || b.Target != r.target || b.Tenant != r.target.Tenant || b.EgressActual != nil {
		return ErrUnauthorized
	}
	if b.Input != taskOrderBytesBinding(c.Input) || !reflect.DeepEqual(selection.Fields, b.Fields) || len(b.Resources) != 1 || len(b.Sources) != 1 {
		return ErrUnauthorized
	}
	resource, source := b.Resources[0], b.Sources[0]
	if resource.ID != selection.OrderID || resource.Kind != r.orderKind || resource.Realm != b.Realm || resource.Tenant != b.Tenant || source.Resource != resource || !reflect.DeepEqual(source.Fields, selection.Fields) {
		return ErrUnauthorized
	}
	return nil
}

func taskOrderAuthFailure(err error) error {
	if err == nil {
		return nil
	}
	status, code, original := 503, "SHOP_TASK_ORDER_READ_UNAVAILABLE", ""
	switch {
	case errors.Is(err, ErrUnauthorized):
		status, code = 403, "SHOP_TASK_ORDER_READ_DENIED"
	case errors.Is(err, ErrNotFound):
		status, code = 404, "SHOP_TASK_ORDER_READ_NOT_FOUND"
	case errors.Is(err, ErrConflict):
		status, code = 409, "SHOP_TASK_ORDER_READ_STALE"
	case errors.Is(err, ErrInvalidState):
		status, code = 400, "SHOP_TASK_ORDER_READ_INVALID"
	default:
		classified, ref := authgrant.Classified(err)
		switch classified {
		case authgrant.Denied, authgrant.Retired:
			status, code = 403, "SHOP_TASK_ORDER_READ_DENIED"
		case authgrant.Expired:
			status, code = 403, "SHOP_TASK_ORDER_READ_EXPIRED"
		case authgrant.Stale:
			status, code = 409, "SHOP_TASK_ORDER_READ_STALE"
		case authgrant.Invalid:
			status, code = 400, "SHOP_TASK_ORDER_READ_INVALID"
		case authgrant.OriginalOnly:
			status, code = 409, "SHOP_TASK_ORDER_READ_ORIGINAL_ONLY"
			if len(ref) <= 256 && strings.IndexFunc(ref, unicode.IsControl) == -1 {
				original = ref
			}
		}
	}
	return &taskOrderReadFailure{code: code, status: status, originalOp: original, cause: err}
}

func (r *originalShopTaskOrderReader) readTaskOrder(ctx context.Context, store *Store, request *http.Request, raw []byte) (result taskOrderReadPayload, err error) {
	// The outer lifecycle includes SDK encoding and every partial close. No
	// order bytes escape to HTTP if source acquisition, final check or close fails.
	var held *authgrant.TaskGrantCheck
	var response HeldOriginalShopTaskOrderResponse
	defer func() {
		if !missingTaskOrderOperand(response) {
			if closeErr := response.Close(); closeErr != nil {
				if err == nil {
					err = closeErr
				} else {
					err = errors.Join(err, closeErr)
				}
			}
		}
		if held != nil {
			if closeErr := held.Close(); closeErr != nil {
				if err == nil {
					err = closeErr
				} else {
					err = errors.Join(err, closeErr)
				}
			}
		}
		if err != nil {
			result = taskOrderReadPayload{}
			err = taskOrderAuthFailure(err)
		}
	}()
	if r == nil || missingTaskOrderOperand(r.verifier) || missingTaskOrderOperand(r.codec) || missingTaskOrderOperand(r.responses) || store == nil || ctx == nil {
		return result, ErrUnavailable
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	call, err := r.codec.DecodeShopOrderRead(ctx, request, append([]byte(nil), raw...))
	if err != nil {
		return result, err
	}
	call = copyShopTaskOrderCall(call)
	selection, err := DecodeShopOrderReadSelection(call.Input)
	if err != nil {
		return result, err
	}
	if err = r.selected(call, selection); err != nil {
		return result, err
	}
	// Adopt non-nil partial ownership BEFORE inspecting the original open error.
	held, err = authgrant.OpenTaskGrantAtEffect(ctx, r.verifier, call.Binding, call.Grant, call.Holder)
	if err != nil {
		return result, err
	}
	response, err = r.responses.OpenShopOrderReadResponse(ctx, copyShopTaskOrderCall(call))
	if err != nil {
		return result, err
	}
	if missingTaskOrderOperand(response) {
		return result, ErrUnavailable
	}
	operation, err := response.Operation()
	if err != nil {
		return result, err
	}
	if !validShopTaskOperation(operation) {
		return result, ErrUnavailable
	}
	return store.readOriginalTaskOrderAtEffect(ctx, held, r.codec, response, operation, call, selection)
}

func validShopTaskOperation(op OriginalShopTaskOrderOperation) bool {
	for _, s := range []string{op.OriginalOperationID, op.RemoteRef} {
		if len(s) == 0 || len(s) > 256 || strings.IndexFunc(s, unicode.IsControl) != -1 {
			return false
		}
	}
	return true
}

func (s *Store) readOriginalTaskOrderAtEffect(ctx context.Context, held *authgrant.TaskGrantCheck, codec OriginalShopTaskOrderCodec, response HeldOriginalShopTaskOrderResponse, operation OriginalShopTaskOrderOperation, call OriginalShopTaskOrderCall, selection ShopOrderReadSelection) (taskOrderReadPayload, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return taskOrderReadPayload{}, err
	}
	decision, err := authgrant.CheckTaskGrantAtEffect(ctx, held)
	if err != nil {
		return taskOrderReadPayload{}, err
	}
	// Exact original account, current buyer/seller membership, selected fields
	// and full local snapshot are checked by the SAME original Store reader.
	role := "buyer"
	if order, ok := s.s.Orders[selection.OrderID]; ok && order.Buyer != call.Binding.Account {
		role = "seller"
	}
	projection, err := s.readScopedOrderLocked(call.Binding.Account, role, selection.OrderID, selection.Fields, selection.Snapshot)
	if err != nil {
		return taskOrderReadPayload{}, err
	}
	source := call.Binding.Sources[0]
	source.Fields = append([]string(nil), source.Fields...)
	expected := OriginalShopTaskOrderResponse{Binding: copyShopTaskOrderCall(call).Binding, Operation: operation, Projection: projection, Source: source, AuthScope: decision.Scope}
	// Bind the ACTUAL original Store projection through the sole SDK DATA
	// encoder before any response authority sees a signing request. A custom
	// envelope codec cannot substitute different bytes with a matching declared
	// source, or redefine source canonicalization. Ref.rev remains Source-owned.
	frozen, err := encodeOriginalShopOrderDATA(copyShopTaskResponse(expected))
	if err != nil {
		return taskOrderReadPayload{}, err
	}
	expected.ResponseOriginal = bytes.Clone(frozen.ResponseOriginal)
	expected.SourceBytes = bytes.Clone(frozen.SourceBytes)
	attestCalls := 0
	var attestFailure error
	attest := func(callbackContext context.Context, sourceBytes, payload []byte) (authgrant.Proof, error) {
		attestCalls++
		if callbackContext == nil {
			attestFailure = ErrUnavailable
			return authgrant.Proof{}, attestFailure
		}
		if e := callbackContext.Err(); e != nil {
			attestFailure = e
			return authgrant.Proof{}, e
		}
		if attestCalls != 1 || len(payload) == 0 || len(payload) > maxBody || !bytes.Equal(sourceBytes, frozen.SourceBytes) {
			attestFailure = ErrConflict
			return authgrant.Proof{}, attestFailure
		}
		if _, e := authgrant.CheckTaskGrantAtEffect(ctx, held); e != nil {
			attestFailure = e
			return authgrant.Proof{}, e
		}
		proof, e := response.AttestShopOrderReadResponse(ctx, copyShopTaskResponse(expected), append([]byte(nil), payload...))
		if e != nil {
			attestFailure = e
			return authgrant.Proof{}, e
		}
		if !bytes.Equal(proof.Payload, payload) || len(proof.Wire) == 0 || len(proof.Wire) > maxBody || proof.Purpose == "" {
			attestFailure = ErrUnavailable
			return authgrant.Proof{}, attestFailure
		}
		proof.Payload = append([]byte(nil), proof.Payload...)
		proof.Wire = append([]byte(nil), proof.Wire...)
		return proof, nil
	}
	encoded, err := codec.EncodeShopOrderRead(ctx, copyShopTaskResponse(expected), attest)
	if err != nil {
		return taskOrderReadPayload{}, err
	}
	if attestFailure != nil {
		return taskOrderReadPayload{}, attestFailure
	}
	if attestCalls != 1 {
		return taskOrderReadPayload{}, ErrUnavailable
	}
	if !bytes.Equal(encoded.SourceBytes, frozen.SourceBytes) || !bytes.Equal(encoded.ResponseOriginal, frozen.ResponseOriginal) {
		return taskOrderReadPayload{}, ErrConflict
	}
	// Encoding may run code at an SDK boundary. Recheck while still holding
	// this resource lock, without promoting its mutex to a global Auth fence.
	if _, err = authgrant.CheckTaskGrantAtEffect(ctx, held); err != nil {
		return taskOrderReadPayload{}, err
	}
	if err = ctx.Err(); err != nil {
		return taskOrderReadPayload{}, err
	}
	return taskOrderReadPayload{Body: append([]byte(nil), encoded.Body...), ContentType: encoded.ContentType, AuthFence: string(decision.Scope)}, nil
}
