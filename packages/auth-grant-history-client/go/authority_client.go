package originalclient

import (
	"bytes"
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"sync"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// Private DATA: original signed bytes are preserved. Body/URL/TLS exporter,
// authenticated caller context and an approval flag are NOT request operands.
type TaskAuthorityCall struct {
	Grant, Holder     policy.Proof
	RawInput          []byte
	GrantRef          open.LegacyGrantRefV1
	OriginalOperation string
}
type TaskAuthorityResult struct {
	State, OriginalOperation, Original string
	RecoveryOnly                       bool
	Resource                           *TaskResourceResult
	OriginalServiceResponse            []byte
}

// Observation only after a verifier has returned metadata. Never preserve a
// stale body, opaque receipt, Source, scope or binding as usable authorization.
func authorityObservationPartial(r TaskAuthorityResult) TaskAuthorityResult {
	p := TaskAuthorityResult{State: r.State, OriginalOperation: r.OriginalOperation, RecoveryOnly: true}
	if r.Resource != nil {
		p.Resource = &TaskResourceResult{OperationID: r.Resource.OperationID, RemoteRef: r.Resource.RemoteRef}
	}
	return p
}

type authoritySource interface {
	Current(context.Context) error
	AssertOriginalCallerAndBinding(context.Context, TaskAuthorityCall) error
	PrepareOriginalAuthorityWire(context.Context, link.AuthenticatedChannel, string, TaskAuthorityCall) (link.WireRequest, error)
	VerifyOriginalAuthorityResponse(context.Context, string, TaskAuthorityCall, link.WireResponse) (TaskAuthorityResult, error)
	Retire() error
	Join() error
	Close() error
}
type authorityClientSelection struct {
	Peer                            *link.FixedPeerClient
	Source                          authoritySource
	EffectOperation, QueryOperation string
}

var admittedOriginalAuthorityClients = [...]func() (authorityClientSelection, error){acquireProtectedOriginalAuthorityClient}

type TaskAuthorityClient struct {
	selected authorityClientSelection
	mu       sync.Mutex
	retired  bool
	active   sync.WaitGroup
	once     sync.Once
	closeErr error
}

func OpenOriginalTaskAuthorityClient() (*TaskAuthorityClient, error) {
	if len(admittedOriginalAuthorityClients) != 1 {
		return nil, ErrUnavailable
	}
	for _, open := range admittedOriginalAuthorityClients {
		s, e := open()
		c := &TaskAuthorityClient{selected: s}
		if e != nil {
			return c, e
		}
		if s.Peer == nil || s.Source == nil || s.EffectOperation == "" && s.QueryOperation == "" {
			return c, ErrUnavailable
		}
		return c, nil
	}
	return nil, ErrUnavailable
}
func authorityCall(in TaskAuthorityCall, history bool) (TaskAuthorityCall, error) {
	if len(in.Grant.Wire) < 1 || len(in.Holder.Wire) < 1 || len(in.Grant.Wire) > 1048576 || len(in.Holder.Wire) > 1048576 {
		return TaskAuthorityCall{}, ErrBinding
	}
	g, e := open.DecodeBoundGrant(in.Grant.Payload)
	if e != nil {
		return TaskAuthorityCall{}, e
	}
	h, e := open.DecodeGrantEffect(in.Holder.Payload)
	if e != nil {
		return TaskAuthorityCall{}, e
	}
	original, e := open.EncodeBoundGrant(h.Grant)
	if e != nil || !bytes.Equal(original, in.Grant.Payload) || in.Grant.Purpose != open.BoundGrantDomain || in.Holder.Purpose != open.GrantEffectDomain {
		return TaskAuthorityCall{}, ErrBinding
	}
	if in.GrantRef.Realm != g.Realm || in.GrantRef.Tenant != g.Tenant || in.GrantRef.Kind != "grant" || in.GrantRef.ID != g.ID {
		return TaskAuthorityCall{}, ErrBinding
	}
	refRevision, e := strconv.ParseUint(in.GrantRef.Rev, 10, 64)
	if e != nil || strconv.FormatUint(refRevision, 10) != in.GrantRef.Rev {
		return TaskAuthorityCall{}, ErrBinding
	}
	signedRevision, e := strconv.ParseUint(g.Rev, 10, 64)
	if e != nil || refRevision < signedRevision {
		return TaskAuthorityCall{}, ErrBinding
	}
	if !history && in.GrantRef.Rev != g.Rev {
		return TaskAuthorityCall{}, ErrBinding
	}
	if history && (len(in.OriginalOperation) != 64) {
		return TaskAuthorityCall{}, ErrBinding
	}
	if history {
		decoded, e := hex.DecodeString(in.OriginalOperation)
		if e != nil || hex.EncodeToString(decoded) != in.OriginalOperation {
			return TaskAuthorityCall{}, ErrBinding
		}
	}
	if !history && in.OriginalOperation != "" {
		return TaskAuthorityCall{}, ErrBinding
	} // actual Node once assigns it, not caller
	a, b := sha3.Sum512(in.RawInput), sha512.Sum512(in.RawInput)
	if !history && (g.Binding.Input.Bytes != strconv.Itoa(len(in.RawInput)) || g.Binding.Input.SHA3_512 != hex.EncodeToString(a[:]) || g.Binding.Input.SHA512 != hex.EncodeToString(b[:])) {
		return TaskAuthorityCall{}, ErrBinding
	}
	in.Grant.Payload = bytes.Clone(in.Grant.Payload)
	in.Grant.Wire = bytes.Clone(in.Grant.Wire)
	in.Holder.Payload = bytes.Clone(in.Holder.Payload)
	in.Holder.Wire = bytes.Clone(in.Holder.Wire)
	in.RawInput = bytes.Clone(in.RawInput)
	return in, nil
}
func (c *TaskAuthorityClient) current(ctx context.Context) error {
	if c == nil || ctx == nil || c.selected.Source == nil {
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

// Startup/teardown current check only: no reserve, dispatch or model data read.
func (c *TaskAuthorityClient) Current(ctx context.Context) error {
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
func (c *TaskAuthorityClient) exchange(ctx context.Context, history bool, in TaskAuthorityCall) (result TaskAuthorityResult, err error) {
	if c == nil || ctx == nil || c.selected.Peer == nil || c.selected.Source == nil {
		return result, ErrUnavailable
	}
	c.mu.Lock()
	if c.retired {
		c.mu.Unlock()
		return result, ErrUnavailable
	}
	c.active.Add(1)
	c.mu.Unlock()
	defer c.active.Done()
	if e := c.current(ctx); e != nil {
		return result, e
	}
	call, e := authorityCall(in, history)
	if e != nil {
		return result, e
	}
	if e = c.selected.Source.AssertOriginalCallerAndBinding(ctx, call); e != nil {
		return result, e
	}
	route, action := c.selected.EffectOperation, "effect"
	if history {
		route, action = c.selected.QueryOperation, "query"
	}
	if route == "" {
		return result, ErrUnavailable
	}
	response, e := c.selected.Peer.Exchange(ctx, route, func(ctx context.Context, actual link.AuthenticatedChannel) (link.WireRequest, error) {
		if e := c.current(ctx); e != nil {
			return link.WireRequest{}, e
		}
		// Source uses original service-codec canonical body and original caller
		// acquisition. Actual outer channel is available NOW; no fake exporter.
		wire, e := c.selected.Source.PrepareOriginalAuthorityWire(ctx, actual, action, call)
		if e != nil {
			return wire, e
		}
		if wire.ContentType != "application/json" {
			return link.WireRequest{}, ErrBinding
		}
		return wire, c.current(ctx)
	})
	if e != nil {
		return result, e
	} // no reconnect/retry/new op after possible dispatch
	if e = c.current(ctx); e != nil {
		return result, e
	}
	return c.verifyReceivedAuthority(ctx, action, call, history, response)
}
func (c *TaskAuthorityClient) verifyReceivedAuthority(ctx context.Context, action string, call TaskAuthorityCall, history bool, response link.WireResponse) (TaskAuthorityResult, error) {
	var result TaskAuthorityResult
	if e := c.current(ctx); e != nil {
		return result, e
	}
	originalResponse := bytes.Clone(response.Body)
	result, e := c.selected.Source.VerifyOriginalAuthorityResponse(ctx, action, call, response)
	if e != nil {
		return authorityObservationPartial(result), e
	}
	if !bytes.Equal(originalResponse, response.Body) {
		return TaskAuthorityResult{}, ErrBinding
	}
	serviceBody := bytes.Clone(result.OriginalServiceResponse)
	if len(serviceBody) == 0 {
		return TaskAuthorityResult{}, ErrWholeResponseUnavailable
	}
	result.OriginalServiceResponse = nil
	result, e = correlateAuthorityResult(serviceBody, call, history, result)
	if e != nil {
		return TaskAuthorityResult{}, e
	}
	// Original service uses HTTP200 for ok/recovery and HTTP409 for UNKNOWN
	// error. HTTP status alone is never proof, but disagreement is fail closed.
	var statusEnvelope serviceEnvelopeDATA
	if json.Unmarshal(serviceBody, &statusEnvelope) != nil || statusEnvelope.OK && response.StatusCode != 200 || !statusEnvelope.OK && response.StatusCode != 409 {
		return TaskAuthorityResult{}, ErrBinding
	}
	// No HTTP status, body ref or request field alone becomes a verified result.
	if history && result.OriginalOperation != call.OriginalOperation {
		return TaskAuthorityResult{}, ErrBinding
	}
	switch result.State {
	case "COMMITTED", "FAILED", "UNKNOWN":
	default:
		return TaskAuthorityResult{}, ErrBinding
	}
	if e = c.current(ctx); e != nil {
		return authorityObservationPartial(result), e
	}
	result.OriginalServiceResponse = bytes.Clone(serviceBody)
	return result, nil
}
func (c *TaskAuthorityClient) AuthorizeAtEffect(ctx context.Context, in TaskAuthorityCall) (TaskAuthorityResult, error) {
	return c.exchange(ctx, false, in)
}
func (c *TaskAuthorityClient) QueryOriginalEffect(ctx context.Context, in TaskAuthorityCall) (TaskAuthorityResult, error) {
	return c.exchange(ctx, true, in)
}
func (c *TaskAuthorityClient) Close() error {
	if c == nil {
		return nil
	}
	c.once.Do(func() {
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
