package securelink

import (
	"bytes"
	"context"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

// DispatchError preserves the first error and reports only this transport
// exchange's uncertainty. DispatchPossible is set immediately before writing
// the original request; it does not assert delivery, execution, or any business
// status. PartialResponseBytes is a byte count, never a replacement receipt.
// Callers keep the original operation/UNKNOWN and reconcile with its authority.
type DispatchError struct {
	Cause                error
	DispatchPossible     bool
	PartialResponseBytes int64
}

func (e *DispatchError) Error() string {
	if e == nil || e.Cause == nil {
		return "securelink: protected exchange failed"
	}
	return e.Cause.Error()
}
func (e *DispatchError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

type exchangeCaptureKey struct{}
type exchangeCapture struct {
	caller               *LocalCaller
	conn                 *native.Conn
	request              WireRequest
	dispatchPossible     atomic.Bool
	partialResponseBytes int64
}

func markDispatchPossible(ctx context.Context) error {
	if capture, ok := ctx.Value(exchangeCaptureKey{}).(*exchangeCapture); ok && capture != nil {
		if capture.caller != nil {
			if _, err := capture.caller.Current(ctx); err != nil {
				return err
			}
		}
		capture.dispatchPossible.Store(true)
	}
	return nil
}

// ProtectedExchange is an opaque, process-local binding to an actual protected
// client exchange made while an original OS-verified LocalCaller was live.
// It is transport material only. It is not a Source, Agent/Grant permission,
// signature verification, receipt domain, operation ID, or settlement decision.
// Its fields and constructor are private; JSON, headers, diagnostic channels,
// copied handles, and a caller-created WireResponse cannot manufacture it.
type ProtectedExchange struct {
	self                *ProtectedExchange
	caller              *LocalCaller
	client              *FixedPeerClient
	conn                *native.Conn
	operation           ServiceOperation
	request             WireRequest
	responseBody        []byte
	responseContentType string
	statusCode          int
	channel             AuthenticatedChannel
}

// ProtectedExchangeMaterial is a detached copy of the original local request,
// fixed registered TLS destination/operation, and exact protected request and
// response. The original authority must independently qualify the caller,
// whole-response proof, issuer, current business state and original op/body.
// It must not derive that qualification from these transport fields/exporter.
type ProtectedExchangeMaterial struct {
	Caller       LocalCallerMaterial
	Profile      FixedPeerProfile
	Operation    ServiceOperation
	Request      WireRequest
	ResponseBody []byte
	ContentType  string
	StatusCode   int
	Channel      AuthenticatedChannel
}

func cloneAuthenticatedChannel(channel AuthenticatedChannel) AuthenticatedChannel {
	channel.Exporter = bytes.Clone(channel.Exporter)
	return channel
}

// ProtectedExchangeFromResponse accepts only the actual unchanged result of
// FixedPeerClient.Exchange and the same original local caller context (or its
// live descendant). A plain Exchange without that real IPC caller remains a
// valid diagnostic wire operation but has no such private bridge material.
func ProtectedExchangeFromResponse(ctx context.Context, response WireResponse) (*ProtectedExchange, error) {
	m := response.material
	if m == nil || m.self != m || !bytes.Equal(response.Body, m.responseBody) || response.ContentType != m.responseContentType || response.StatusCode != m.statusCode || response.Channel.Peer != m.channel.Peer || response.Channel.LocalSAN != m.channel.LocalSAN || response.Channel.ConnectionID != m.channel.ConnectionID || !bytes.Equal(response.Channel.Exporter, m.channel.Exporter) {
		return nil, ErrDenied
	}
	if _, err := m.Current(ctx); err != nil {
		return nil, err
	}
	return m, nil
}

// Current obtains fresh OS-peer and actual TLS endpoint evidence every time.
// It fails after the original local request, either connection, registration,
// revocation, expiry or cancellation ceases to be current. Callers must finish
// authority verification during the original local request, before releasing
// its native caller; this method cannot revive a saved/exported handle.
func (m *ProtectedExchange) Current(ctx context.Context) (ProtectedExchangeMaterial, error) {
	var result ProtectedExchangeMaterial
	if m == nil || m.self != m || m.caller == nil || m.client == nil || m.client.transport == nil || m.conn == nil || ctx == nil {
		return result, ErrDenied
	}
	caller, err := LocalCallerFromContext(ctx)
	if err != nil || caller != m.caller {
		return result, ErrDenied
	}
	local, err := caller.Current(ctx)
	if err != nil {
		return result, err
	}
	channel, err := authenticatedChannel(ctx, m.conn, m.client.transport.gate, m.client.profile.EdgeID, m.operation.Method, m.operation.Path)
	if err != nil {
		return result, err
	}
	if channel.ConnectionID != m.channel.ConnectionID || channel.Peer != m.channel.Peer || channel.LocalSAN != m.channel.LocalSAN || !bytes.Equal(channel.Exporter, m.channel.Exporter) {
		return result, ErrDenied
	}
	// OS identity/current may change while querying the native endpoint. Keep
	// the original request and independent authority's current fence in scope.
	if _, err = caller.Current(ctx); err != nil {
		return result, err
	}
	return ProtectedExchangeMaterial{Caller: local, Profile: m.client.Profile(), Operation: m.operation,
		Request:      WireRequest{Body: bytes.Clone(m.request.Body), ContentType: m.request.ContentType},
		ResponseBody: bytes.Clone(m.responseBody), ContentType: m.responseContentType,
		StatusCode: m.statusCode, Channel: cloneAuthenticatedChannel(channel)}, nil
}
