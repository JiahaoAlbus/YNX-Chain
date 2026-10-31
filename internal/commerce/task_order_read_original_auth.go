package commerce

import (
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
	SourceBytes []byte
	Body        []byte
	ContentType string
}

// The actual SDK supplies both operations. Calls must be concurrency-safe and
// return owned values. Encoding must be pure: encode only
// the given detached projection and its verified original source/label. It
// returns the exact source-content bytes for the shared dual digest check.
// No local JSON-to-Grant decoder, signer, Source provider or default codec exists.
type OriginalShopTaskOrderCodec interface {
	DecodeShopOrderRead(context.Context, *http.Request, []byte) (OriginalShopTaskOrderCall, error)
	EncodeShopOrderRead(context.Context, OrderProjection, authgrant.Source, authgrant.FenceScope) (OriginalShopTaskOrderEncoding, error)
}

type originalShopTaskOrderReader struct {
	verifier  authgrant.OriginalTaskGrantVerifier
	codec     OriginalShopTaskOrderCodec
	tool      authgrant.Tool
	target    authgrant.Sink
	orderKind string
}

// PrepareOriginalShopTaskOrders is a normal Go composition constructor, never
// a network endpoint or process-global provider setter. Its verifier and codec
// must come from original protected producers; this function implements neither.
// Tool/schema/target/kind are trusted registered profile operands, not request
// metadata. A nil/zero/partial installation stays closed.
func PrepareOriginalShopTaskOrders(verifier authgrant.OriginalTaskGrantVerifier, codec OriginalShopTaskOrderCodec, tool authgrant.Tool, target authgrant.Sink, orderKind string, current func(context.Context) error) (*PreparedOriginalShopTaskOrders, error) {
	if missingTaskOrderOperand(verifier) || missingTaskOrderOperand(codec) || current == nil || orderKind == "" || tool != ShopOrderReadToolDescriptor() || target.Operation != shopOrderReadOperation || target.Path != shopOrderReadPath || target.Service == "" || target.Tenant == "" || target.Origin == "" || target.Region == "" {
		return nil, ErrUnavailable
	}
	reader := &originalShopTaskOrderReader{verifier, codec, tool, target, orderKind}
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
	defer func() {
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
	if r == nil || missingTaskOrderOperand(r.verifier) || missingTaskOrderOperand(r.codec) || store == nil || ctx == nil {
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
	return store.readOriginalTaskOrderAtEffect(ctx, held, r.codec, call, selection)
}

func (s *Store) readOriginalTaskOrderAtEffect(ctx context.Context, held *authgrant.TaskGrantCheck, codec OriginalShopTaskOrderCodec, call OriginalShopTaskOrderCall, selection ShopOrderReadSelection) (taskOrderReadPayload, error) {
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
	encoded, err := codec.EncodeShopOrderRead(ctx, projection, source, decision.Scope)
	if err != nil {
		return taskOrderReadPayload{}, err
	}
	if taskOrderBytesBinding(encoded.SourceBytes) != call.Binding.Sources[0].Binding {
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
