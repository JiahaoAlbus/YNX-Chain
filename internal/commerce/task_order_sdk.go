package commerce

import (
	"bytes"
	"context"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// OriginalShopTaskOrderResponseEncoder is the original final response-frame
// encoder, not SDK DATA-only JSON. It must carry the actual operation/proof.
type OriginalShopTaskOrderResponseEncoder interface {
	EncodeShopOrderRead(context.Context, OriginalShopTaskOrderResponse, OriginalShopTaskOrderAttest) (OriginalShopTaskOrderEncoding, error)
}

// OriginalShopTaskOrderOuterChannelAuthority checks the separately authorized
// service carrier against its ORIGINAL current Source. TLS exporter data must
// never replace the signed inner holder/session channel or confer a Grant.
type OriginalShopTaskOrderOuterChannelAuthority interface {
	Current(context.Context) error
	CheckShopOrderReadOuterChannel(context.Context, OriginalShopTaskOrderCall, securelink.AuthenticatedChannel) error
}

type originalShopTaskOrderSDKCodec struct {
	target   policy.Sink
	kind     string
	encoder  OriginalShopTaskOrderResponseEncoder
	channels OriginalShopTaskOrderOuterChannelAuthority
}

func originalShopSDKProfile(target policy.Sink, kind string) (openprotocol.ShopOrderReadExpectedProfileDATA, error) {
	t := ShopOrderReadToolDescriptor()
	if kind == "" || target.Path != shopOrderReadPath || target.Operation != shopOrderReadOperation || target.Service == "" || target.Tenant == "" || target.Origin == "" || target.Region == "" || !bytes.Equal(ShopOrderReadInputSchema(), openprotocol.ShopOrderReadInputSchemaDATA()) || (openprotocol.ShopOrderReadTool{ID: t.ID, Version: t.Version, Operation: t.Operation, Purpose: t.Purpose, Risk: t.Risk, Schema: openprotocol.GrantBindV1{Bytes: t.Schema.Bytes, SHA3_512: t.Schema.SHA3_512, SHA512: t.Schema.SHA512}}) != openprotocol.ShopOrderReadToolDescriptorDATA() {
		return openprotocol.ShopOrderReadExpectedProfileDATA{}, ErrUnavailable
	}
	return openprotocol.ShopOrderReadExpectedProfileDATA{Target: openprotocol.GrantTargetV1{Service: target.Service, Tenant: target.Tenant, Origin: target.Origin, Path: target.Path, Region: target.Region, Operation: target.Operation}, OrderKind: kind}, nil
}

// DecodeOriginalShopTaskOrderRequestDATA delegates E5/E21/E3 parsing to the
// unchanged SDK. It is DATA validation only; no channel or PQ proof is admitted.
func DecodeOriginalShopTaskOrderRequestDATA(ctx context.Context, raw []byte, contentType string, target policy.Sink, kind string) (OriginalShopTaskOrderCall, error) {
	var zero OriginalShopTaskOrderCall
	if ctx == nil {
		return zero, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if len(raw) == 0 || len(raw) > maxBody {
		return zero, ErrInvalidState
	}
	profile, err := originalShopSDKProfile(target, kind)
	if err != nil {
		return zero, err
	}
	d, err := openprotocol.DecodeShopOrderReadRequestDATA(bytes.Clone(raw), profile, contentType)
	if err != nil {
		return zero, ErrInvalidState
	}
	ref := func(r openprotocol.LegacyGrantRefV1) policy.Ref {
		return policy.Ref{Realm: r.Realm, Tenant: r.Tenant, Kind: r.Kind, ID: r.ID, Revision: r.Rev}
	}
	bind := func(b openprotocol.GrantBindV1) policy.Bind {
		return policy.Bind{Bytes: b.Bytes, SHA3_512: b.SHA3_512, SHA512: b.SHA512}
	}
	b := d.Binding
	result := OriginalShopTaskOrderCall{Binding: policy.TaskEffectBinding{
		Realm: b.Realm, Tenant: b.Tenant, Account: b.Account, Audience: b.Audience,
		GrantID: b.GrantID, GrantRevision: b.GrantRevision, Task: ref(b.Task), Generation: b.Generation, StepID: b.StepID,
		Holder: ref(b.Holder), HolderEpoch: b.HolderEpoch, SessionID: b.SessionID, SessionEpoch: b.SessionEpoch, ChannelBinding: b.ChannelBinding,
		Tool:  policy.Tool{ID: b.Tool.ID, Version: b.Tool.Version, Operation: b.Tool.Operation, Purpose: b.Tool.Purpose, Risk: b.Tool.Risk, Schema: bind(b.Tool.Schema)},
		Input: bind(b.Input), Fields: append([]string(nil), b.Fields...), Target: target,
	}, Input: bytes.Clone(d.Input), Grant: policy.Proof{Purpose: d.Grant.Purpose, Payload: bytes.Clone(d.Grant.Payload), Wire: bytes.Clone(d.Grant.Wire)}, Holder: policy.Proof{Purpose: d.Holder.Purpose, Payload: bytes.Clone(d.Holder.Payload), Wire: bytes.Clone(d.Holder.Wire)}}
	for _, r := range b.Resources {
		result.Binding.Resources = append(result.Binding.Resources, ref(r))
	}
	for _, s := range b.Sources {
		result.Binding.Sources = append(result.Binding.Sources, policy.Source{Resource: ref(s.Ref), Fields: append([]string(nil), s.Fields...), Label: s.Label, Binding: bind(s.Binding)})
	}
	if b.EgressActual != nil {
		v := bind(*b.EgressActual)
		result.Binding.EgressActual = &v
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	return result, nil
}

func PrepareOriginalShopTaskOrderSDKCodec(ctx context.Context, encoder OriginalShopTaskOrderResponseEncoder, channels OriginalShopTaskOrderOuterChannelAuthority, target policy.Sink, kind string) (OriginalShopTaskOrderCodec, error) {
	if ctx == nil || missingTaskOrderOperand(encoder) || missingTaskOrderOperand(channels) {
		return nil, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if _, err := originalShopSDKProfile(target, kind); err != nil {
		return nil, err
	}
	if err := channels.Current(ctx); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &originalShopTaskOrderSDKCodec{target: target, kind: kind, encoder: encoder, channels: channels}, nil
}

func (c *originalShopTaskOrderSDKCodec) DecodeShopOrderRead(ctx context.Context, r *http.Request, raw []byte) (OriginalShopTaskOrderCall, error) {
	var zero OriginalShopTaskOrderCall
	if c == nil || missingTaskOrderOperand(c.channels) || ctx == nil || r == nil || r.URL == nil || r.Method != http.MethodPost || r.URL.Path != shopOrderReadPath || r.URL.RawPath != "" || r.URL.RawQuery != "" || r.URL.ForceQuery || len(r.Header.Values("Content-Type")) != 1 {
		return zero, ErrUnavailable
	}
	if err := c.channels.Current(ctx); err != nil {
		return zero, err
	}
	before, err := securelink.ServiceChannelFromRequest(r)
	if err != nil {
		return zero, ErrUnavailable
	}
	call, err := DecodeOriginalShopTaskOrderRequestDATA(ctx, raw, r.Header.Get("Content-Type"), c.target, c.kind)
	if err != nil {
		return zero, err
	}
	channel := before
	channel.Exporter = bytes.Clone(before.Exporter)
	if err := c.channels.CheckShopOrderReadOuterChannel(ctx, copyShopTaskOrderCall(call), channel); err != nil {
		return zero, err
	}
	if err := c.channels.Current(ctx); err != nil {
		return zero, err
	}
	after, err := securelink.ServiceChannelFromRequest(r)
	if err != nil || before.ConnectionID != after.ConnectionID || before.Peer != after.Peer || before.LocalSAN != after.LocalSAN || !bytes.Equal(before.Exporter, after.Exporter) {
		return zero, ErrUnavailable
	}
	return copyShopTaskOrderCall(call), nil
}

func (c *originalShopTaskOrderSDKCodec) EncodeShopOrderRead(ctx context.Context, response OriginalShopTaskOrderResponse, attest OriginalShopTaskOrderAttest) (OriginalShopTaskOrderEncoding, error) {
	if c == nil || missingTaskOrderOperand(c.encoder) || missingTaskOrderOperand(c.channels) || attest == nil || ctx == nil {
		return OriginalShopTaskOrderEncoding{}, ErrUnavailable
	}
	if err := c.channels.Current(ctx); err != nil {
		return OriginalShopTaskOrderEncoding{}, err
	}
	out, err := c.encoder.EncodeShopOrderRead(ctx, copyShopTaskResponse(response), attest)
	if err != nil {
		return OriginalShopTaskOrderEncoding{}, err
	}
	if err := c.channels.Current(ctx); err != nil {
		return OriginalShopTaskOrderEncoding{}, err
	}
	out.Body, out.SourceBytes, out.ResponseOriginal = bytes.Clone(out.Body), bytes.Clone(out.SourceBytes), bytes.Clone(out.ResponseOriginal)
	return out, nil
}

// OpenOriginalShopTaskOrdersSDK joins the actual SDK request decoder and the
// original native Source factory. Missing final frame/channel/response authority
// stays unavailable; it never substitutes DATA-only JSON as a tool receipt.
func OpenOriginalShopTaskOrdersSDK(ctx context.Context, encoder OriginalShopTaskOrderResponseEncoder, channels OriginalShopTaskOrderOuterChannelAuthority, responses OriginalShopTaskOrderResponseAuthority, target policy.Sink, kind string) (*PreparedOriginalShopTaskOrders, error) {
	codec, err := PrepareOriginalShopTaskOrderSDKCodec(ctx, encoder, channels, target, kind)
	if err != nil {
		return nil, err
	}
	return OpenOriginalShopTaskOrders(ctx, codec, responses, target, kind)
}
