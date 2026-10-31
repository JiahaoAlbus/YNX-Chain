package aiproduct

import (
	"bytes"
	"context"
	"fmt"
	"net/http"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// This original protected adapter must authenticate actual outer service IO.
// TLS exporter data never replaces the signed INNER holder session channel.
type originalShopOuterChannelAuthority interface {
	Current(context.Context) error
	checkOriginalShopOuterChannel(context.Context, OriginalShopOrderCall, link.AuthenticatedChannel) error
}
type originalShopLinkEvidence struct {
	channel    link.AuthenticatedChannel
	statusCode int
}
type originalShopLinkCaller struct {
	client    *link.FixedPeerClient
	target    policy.Sink
	authority originalShopOuterChannelAuthority
	profile   OriginalShopOrderProfile
}

func checkOriginalShopLinkProfile(profile link.FixedPeerProfile, target policy.Sink) error {
	if profile.Service != target.Service || profile.Origin != target.Origin || target.Path != shopOrderToolPath || target.Operation != shopOrderToolID {
		return errToolConflict
	}
	found := false
	for _, operation := range profile.Operations {
		if operation.ID == shopOrderToolID {
			if found || operation.Method != http.MethodPost || operation.Path != shopOrderToolPath || operation.MediaProfile != link.MediaProfileShopOrderReadV1 || operation.MaxRequestBytes <= 0 || operation.MaxRequestBytes > 1<<20 || operation.MaxResponseBytes <= 0 || operation.MaxResponseBytes > 1<<20 {
				return errToolConflict
			}
			found = true
		}
	}
	if !found {
		return errTaskEffectSourceUnavailable
	}
	return nil
}

func prepareOriginalShopLinkCaller(ctx context.Context, client *link.FixedPeerClient, profile OriginalShopOrderProfile, authority originalShopOuterChannelAuthority) (*originalShopLinkCaller, error) {
	if ctx == nil || client == nil || missingTaskRuntimeOperand(authority) {
		return nil, errTaskEffectSourceUnavailable
	}
	if _, err := originalShopSDKProfile(profile); err != nil {
		return nil, err
	}
	if err := authority.Current(ctx); err != nil {
		return nil, err
	}
	if err := checkOriginalShopLinkProfile(client.Profile(), profile.Target); err != nil {
		return nil, err
	}
	return &originalShopLinkCaller{client: client, target: profile.Target, authority: authority, profile: profile}, nil
}

func (c *originalShopLinkCaller) CallShopOrderRead(ctx context.Context, target policy.Sink, call OriginalShopOrderCall, beforeSend func(context.Context) error) (OriginalShopOrderTransportResult, error) {
	var zero OriginalShopOrderTransportResult
	if c == nil || c.client == nil || ctx == nil || beforeSend == nil || missingTaskRuntimeOperand(c.authority) {
		return zero, errTaskEffectSourceUnavailable
	}
	if target != c.target || call.Binding.Target != target {
		return zero, errToolConflict
	}
	if err := c.authority.Current(ctx); err != nil {
		return zero, err
	}
	if err := checkOriginalShopLinkProfile(c.client.Profile(), target); err != nil {
		return zero, err
	}
	response, err := c.client.Exchange(ctx, shopOrderToolID, func(preparation context.Context, actual link.AuthenticatedChannel) (link.WireRequest, error) {
		channel := actual
		channel.Exporter = bytes.Clone(actual.Exporter)
		if err := c.authority.checkOriginalShopOuterChannel(preparation, cloneShopOrderCall(call), channel); err != nil {
			return link.WireRequest{}, err
		}
		// Actual SDK encoding occurs HERE, after the actual native handshake. It
		// receives unchanged inner E21/E3/channel/input/op; no exporter is patched in.
		encoded, err := EncodeOriginalShopOrderRequestDATA(preparation, cloneShopOrderCall(call), c.profile)
		if err != nil {
			return link.WireRequest{}, err
		}
		if len(encoded.Body) == 0 || len(encoded.Body) > 1<<20 || encoded.ContentType != open.ShopOrderReadRequestContentType {
			return link.WireRequest{}, errToolInvalid
		}
		if err := c.authority.Current(preparation); err != nil {
			return link.WireRequest{}, err
		}
		if err := beforeSend(preparation); err != nil {
			return link.WireRequest{}, err
		}
		return link.WireRequest{Body: bytes.Clone(encoded.Body), ContentType: encoded.ContentType}, nil
	})
	channel := response.Channel
	channel.Exporter = bytes.Clone(channel.Exporter)
	result := OriginalShopOrderTransportResult{Body: bytes.Clone(response.Body), ContentType: response.ContentType, protectedTransport: originalShopLinkEvidence{channel: channel, statusCode: response.StatusCode}}
	// No operation ID/remoteRef/Source is fabricated from the call or headers.
	if err != nil {
		return result, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return result, fmt.Errorf("original Shop transport returned HTTP %d; no resource receipt verified", response.StatusCode)
	}
	return result, nil
}
func (c *originalShopLinkCaller) QueryShopOrderRead(context.Context, policy.Sink, OriginalShopOrderCall) (OriginalShopOrderTransportResult, error) {
	// No Shop query operation exists. Original Auth Source history/receipt
	// orchestration must supply its own actual callee, never another dispatch.
	return OriginalShopOrderTransportResult{}, errTaskEffectUnresolved
}

var _ OriginalShopOrderProtectedCaller = (*originalShopLinkCaller)(nil)
