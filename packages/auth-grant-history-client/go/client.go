package originalclient

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"sync"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
)

var ErrUnavailable = errors.New("AUTH_ORIGINAL_LINK_CLIENT_NOT_SUPPLIED")
var ErrBinding = errors.New("AUTH_ORIGINAL_LINK_BINDING_INVALID")
var ErrMediaContract = errors.New("AUTH_SDK_LINK_REGISTERED_MEDIA_CONTRACT_UNAVAILABLE")

// Node's reserved original operation remains outside SDK's original immutable
// E21/E3 bytes. It is never regenerated from a new TLS exporter or copied from
// an unverified response. The original Source verifies response correlation.
type OriginalExecution struct {
	OperationID string
	Call        open.OriginalShopTaskOrderCallDATA
}
type OriginalReceipt struct {
	State, OperationID, Original, RemoteRef, AuthScope string
	Source                                             open.ShopOrderReadDeclaredSourceDATA
	ResponseBinding                                    open.GrantBindV1
	ResponseOriginal, SourceBytes                      []byte
}

// These are facts returned by the actual protected Source verifier, never
// accepted directly from DATA. Exact DATA comparison is an additional fence,
// not an authority verifier or a replacement for that original callee.
func validateOriginalReceipt(operation string, decoded open.ShopOrderReadResponseDATA, r OriginalReceipt) error {
	if r.OperationID != operation || (r.State != "COMMITTED" && r.State != "FAILED") || r.Original == "" || r.RemoteRef == "" || r.AuthScope != "egress-only-read-fence" || decoded.AuthFence != r.AuthScope || !reflect.DeepEqual(r.Source, decoded.DeclaredSource) || r.ResponseBinding != decoded.ResponseBinding {
		return ErrBinding
	}
	return nil
}

// Private original protected Source callee. A JSON boolean, request or caller
// cannot install this. Actual bootstrap table is empty below. This verifier
// must use the registered SourceBytes/original-op association, not HTTP200.
type protectedSource interface {
	Current(context.Context) error
	AssertOriginalOperation(context.Context, string, open.OriginalShopTaskOrderCallDATA) error
	AssertInnerHolderChannel(context.Context, string) error
	AssertOuterLINKChannel(context.Context, link.AuthenticatedChannel) error
	VerifyOriginalResponse(context.Context, string, open.OriginalShopTaskOrderCallDATA, open.ShopOrderReadResponseDATA, link.WireResponse) (OriginalReceipt, error)
	Retire() error
	Join() error
	Close() error
}
type clientSelection struct {
	Peer      *link.FixedPeerClient
	Source    protectedSource
	Operation string
	Expected  open.ShopOrderReadExpectedProfileDATA
	Response  open.ShopOrderReadExpectedResponseDATA
}

var admittedOriginalTaskClients = [...]func() (clientSelection, error){}

type Client struct {
	mu        sync.Mutex
	selected  clientSelection
	retired   bool
	active    sync.WaitGroup
	closeOnce sync.Once
	closeErr  error
}

func OpenOriginalTaskEffectClient() (*Client, error) {
	if len(admittedOriginalTaskClients) != 1 {
		return nil, ErrUnavailable
	}
	for _, acquire := range admittedOriginalTaskClients {
		s, e := acquire()
		c := &Client{selected: s}
		if e != nil {
			return c, e
		}
		if s.Peer == nil || s.Source == nil || s.Operation == "" {
			return c, ErrUnavailable
		}
		return c, nil
	}
	return nil, ErrUnavailable
}

func (c *Client) begin() error {
	if c == nil {
		return ErrUnavailable
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.retired || c.selected.Peer == nil || c.selected.Source == nil {
		return ErrUnavailable
	}
	c.active.Add(1)
	return nil
}
func (c *Client) current(ctx context.Context) error {
	if c == nil || c.selected.Source == nil || ctx == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	c.mu.Lock()
	retired := c.retired
	c.mu.Unlock()
	if retired {
		return ErrUnavailable
	}
	if e := c.selected.Source.Current(ctx); e != nil {
		return e
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	c.mu.Lock()
	retired = c.retired
	c.mu.Unlock()
	if retired {
		return ErrUnavailable
	}
	return nil
}

// Current checks original held Source without dispatch/reserve/HTTP effect.
func (c *Client) Current(ctx context.Context) error {
	if c == nil || ctx == nil {
		return ErrUnavailable
	}
	c.mu.Lock()
	if c.retired || c.selected.Source == nil {
		c.mu.Unlock()
		return ErrUnavailable
	}
	c.active.Add(1)
	c.mu.Unlock()
	defer c.active.Done()
	return c.current(ctx)
}
func cloneCall(v open.OriginalShopTaskOrderCallDATA, expected open.ShopOrderReadExpectedProfileDATA) (open.OriginalShopTaskOrderCallDATA, error) {
	// Sole shared SDK encoder/decoder performs copying and exact E21/E3/input
	// binding. This is not a second E5 codec. WIP source pin is in supplier H.
	wire, e := open.EncodeShopOrderReadRequestDATA(v, expected)
	if e != nil {
		return open.OriginalShopTaskOrderCallDATA{}, e
	}
	return open.DecodeShopOrderReadRequestDATA(wire, expected, open.ShopOrderReadRequestContentType)
}

// Exact LINK07101 registered media intake. Default JSON/CBOR is NOT the Shop
// profile; E5 vendor bytes are never disguised as either of those formats.
func validateRegisteredMedia(op *link.ServiceOperation) error {
	if op == nil || op.MediaProfile != link.MediaProfileShopOrderReadV1 || op.ID != open.ShopOrderReadOperation || op.Method != "POST" || op.Path != open.ShopOrderReadPath || op.MaxRequestBytes < 1 || op.MaxRequestBytes > 1048576 || op.MaxResponseBytes < 1 || op.MaxResponseBytes > 1048576 || open.ShopOrderReadRequestContentType != "application/vnd.ynx.shop-order-read.v1" {
		return ErrMediaContract
	}
	return nil
}

func (c *Client) ExecuteOriginalTaskEffect(ctx context.Context, in OriginalExecution) (result OriginalReceipt, err error) {
	if e := c.begin(); e != nil {
		return result, e
	}
	defer c.active.Done()
	if e := c.current(ctx); e != nil {
		return result, e
	}
	if in.OperationID == "" || len(in.OperationID) > 256 {
		return result, ErrBinding
	}
	call, e := cloneCall(in.Call, c.selected.Expected)
	if e != nil {
		return result, e
	}
	if e = c.selected.Source.AssertOriginalOperation(ctx, in.OperationID, call); e != nil {
		return result, e
	}
	if e = c.selected.Source.AssertInnerHolderChannel(ctx, call.Binding.ChannelBinding); e != nil {
		return result, e
	}
	profile := c.selected.Peer.Profile()
	var registered *link.ServiceOperation
	for i := range profile.Operations {
		if profile.Operations[i].ID == c.selected.Operation {
			registered = &profile.Operations[i]
		}
	}
	if e = validateRegisteredMedia(registered); e != nil {
		return result, e
	} // before any connection/POST
	if registered == nil || registered.Method != "POST" || registered.Path != open.ShopOrderReadPath || profile.Service != call.Binding.Target.Service || profile.Origin != call.Binding.Target.Origin {
		return result, ErrBinding
	}
	// Encoding is INSIDE actual Exchange.PrepareWire: outer native TLS channel
	// is obtained first. Original inner holder channel remains byte-identical.
	response, e := c.selected.Peer.Exchange(ctx, c.selected.Operation, func(ctx context.Context, actual link.AuthenticatedChannel) (link.WireRequest, error) {
		if e := c.current(ctx); e != nil {
			return link.WireRequest{}, e
		}
		if e := c.selected.Source.AssertOuterLINKChannel(ctx, actual); e != nil {
			return link.WireRequest{}, e
		}
		beforeGrant, beforeHolder := bytes.Clone(call.Grant.Payload), bytes.Clone(call.Holder.Payload)
		if e := c.selected.Source.AssertInnerHolderChannel(ctx, call.Binding.ChannelBinding); e != nil {
			return link.WireRequest{}, e
		}
		wire, e := open.EncodeShopOrderReadRequestDATA(call, c.selected.Expected)
		if e != nil {
			return link.WireRequest{}, e
		}
		if !bytes.Equal(beforeGrant, call.Grant.Payload) || !bytes.Equal(beforeHolder, call.Holder.Payload) {
			return link.WireRequest{}, ErrBinding
		}
		if e = c.current(ctx); e != nil {
			return link.WireRequest{}, e
		}
		return link.WireRequest{Body: wire, ContentType: open.ShopOrderReadRequestContentType}, nil
	})
	if e != nil {
		return result, e
	} // no retry, new op, redirect or channel rewriting
	if e = c.current(ctx); e != nil {
		return result, e
	}
	return c.verifyReceivedResource(ctx, in, call, response)
}
func (c *Client) verifyReceivedResource(ctx context.Context, in OriginalExecution, call open.OriginalShopTaskOrderCallDATA, response link.WireResponse) (OriginalReceipt, error) {
	var result OriginalReceipt
	if response.StatusCode != 200 {
		return result, ErrBinding
	}
	expected := c.selected.Response
	expected.Selection.Fields = append([]string(nil), expected.Selection.Fields...)
	expected.Source.Fields = append([]string(nil), expected.Source.Fields...)
	decoded, e := open.DecodeShopOrderReadResponseDATA(response.Body, expected)
	if e != nil {
		return result, e
	}
	// SDK DATA flags remain false. Only original protected Source verifies exact
	// SourceBytes + actual call/operation/peer correlation and opaque receipt.
	// Capture actual SDK originals BEFORE calling the protected verifier; do not
	// infer output from opaqueOriginal or reuse mutable transport/Source buffers.
	originalBody, originalSource := bytes.Clone(decoded.ResponseOriginal), bytes.Clone(decoded.SourceBytes)
	result, e = c.selected.Source.VerifyOriginalResponse(ctx, in.OperationID, call, decoded, response)
	if e != nil {
		return OriginalReceipt{}, e
	}
	fresh, decodeErr := open.DecodeShopOrderReadResponseDATA(originalBody, expected)
	if decodeErr != nil || !reflect.DeepEqual(decoded, fresh) || validateOriginalReceipt(in.OperationID, fresh, result) != nil {
		return OriginalReceipt{}, ErrBinding
	}
	if !bytes.Equal(decoded.ResponseOriginal, originalBody) || !bytes.Equal(decoded.SourceBytes, originalSource) || !bytes.Equal(response.Body, originalBody) {
		return OriginalReceipt{}, ErrBinding
	}
	result.ResponseOriginal = bytes.Clone(originalBody)
	result.SourceBytes = bytes.Clone(originalSource)
	if e = validateOriginalResultBytes(result); e != nil {
		return OriginalReceipt{}, e
	}
	if e = c.current(ctx); e != nil {
		return OriginalReceipt{}, e
	}
	result.Source.Fields = append([]string(nil), result.Source.Fields...)
	return result, nil
}
func (c *Client) Close() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.retired = true
		c.mu.Unlock()
		if c.selected.Source != nil {
			c.closeErr = errors.Join(c.closeErr, c.selected.Source.Retire())
		}
		if c.selected.Peer != nil {
			c.closeErr = errors.Join(c.closeErr, c.selected.Peer.Close())
		}
		c.active.Wait()
		if c.selected.Source != nil {
			c.closeErr = errors.Join(c.closeErr, c.selected.Source.Join(), c.selected.Source.Close())
		}
	})
	return c.closeErr
}
