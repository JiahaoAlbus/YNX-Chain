package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"

	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	authgrant "ynx.local/authgrantpolicy"
)

// OriginalShopOrderRequestDATA has no operation, locator, session authority or
// verified flag. Decoding E21/E3 is DATA validation, never PQ verification.
type OriginalShopOrderRequestDATA struct {
	Binding       authgrant.TaskEffectBinding
	Grant, Holder authgrant.Proof
	Input         []byte
}

func shopSDKBind(b authgrant.Bind) openprotocol.GrantBindV1 {
	return openprotocol.GrantBindV1{Bytes: b.Bytes, SHA3_512: b.SHA3_512, SHA512: b.SHA512}
}
func shopPolicyBind(b openprotocol.GrantBindV1) authgrant.Bind {
	return authgrant.Bind{Bytes: b.Bytes, SHA3_512: b.SHA3_512, SHA512: b.SHA512}
}
func shopSDKRef(r authgrant.Ref) openprotocol.LegacyGrantRefV1 {
	return openprotocol.LegacyGrantRefV1{Realm: r.Realm, Tenant: r.Tenant, Kind: r.Kind, ID: r.ID, Rev: r.Revision}
}
func shopPolicyRef(r openprotocol.LegacyGrantRefV1) authgrant.Ref {
	return authgrant.Ref{Realm: r.Realm, Tenant: r.Tenant, Kind: r.Kind, ID: r.ID, Revision: r.Rev}
}
func shopSDKTarget(t authgrant.Sink) openprotocol.GrantTargetV1 {
	return openprotocol.GrantTargetV1{Service: t.Service, Tenant: t.Tenant, Origin: t.Origin, Path: t.Path, Region: t.Region, Operation: t.Operation}
}
func shopPolicyTarget(t openprotocol.GrantTargetV1) authgrant.Sink {
	return authgrant.Sink{Service: t.Service, Tenant: t.Tenant, Origin: t.Origin, Path: t.Path, Region: t.Region, Operation: t.Operation}
}
func shopSDKSource(s authgrant.Source) openprotocol.GrantSourceV1 {
	return openprotocol.GrantSourceV1{Ref: shopSDKRef(s.Resource), Fields: append([]string(nil), s.Fields...), Label: s.Label, Binding: shopSDKBind(s.Binding)}
}
func shopPolicySource(s openprotocol.GrantSourceV1) authgrant.Source {
	return authgrant.Source{Resource: shopPolicyRef(s.Ref), Fields: append([]string(nil), s.Fields...), Label: s.Label, Binding: shopPolicyBind(s.Binding)}
}
func shopSDKTool(t authgrant.Tool) openprotocol.ShopOrderReadTool {
	return openprotocol.ShopOrderReadTool{ID: t.ID, Version: t.Version, Operation: t.Operation, Purpose: t.Purpose, Risk: t.Risk, Schema: shopSDKBind(t.Schema)}
}

func shopSDKBinding(b authgrant.TaskEffectBinding) openprotocol.ShopOrderReadTaskEffectBindingDATA {
	out := openprotocol.ShopOrderReadTaskEffectBindingDATA{Realm: b.Realm, Tenant: b.Tenant, Account: b.Account, Audience: b.Audience, GrantID: b.GrantID, GrantRevision: b.GrantRevision, Task: shopSDKRef(b.Task), Generation: b.Generation, StepID: b.StepID, Holder: shopSDKRef(b.Holder), HolderEpoch: b.HolderEpoch, SessionID: b.SessionID, SessionEpoch: b.SessionEpoch, ChannelBinding: b.ChannelBinding, Tool: shopSDKTool(b.Tool), Input: shopSDKBind(b.Input), Fields: append([]string(nil), b.Fields...), Target: shopSDKTarget(b.Target)}
	for _, r := range b.Resources {
		out.Resources = append(out.Resources, shopSDKRef(r))
	}
	for _, s := range b.Sources {
		out.Sources = append(out.Sources, shopSDKSource(s))
	}
	if b.EgressActual != nil {
		v := shopSDKBind(*b.EgressActual)
		out.EgressActual = &v
	}
	return out
}
func shopPolicyBinding(b openprotocol.ShopOrderReadTaskEffectBindingDATA) authgrant.TaskEffectBinding {
	out := authgrant.TaskEffectBinding{Realm: b.Realm, Tenant: b.Tenant, Account: b.Account, Audience: b.Audience, GrantID: b.GrantID, GrantRevision: b.GrantRevision, Task: shopPolicyRef(b.Task), Generation: b.Generation, StepID: b.StepID, Holder: shopPolicyRef(b.Holder), HolderEpoch: b.HolderEpoch, SessionID: b.SessionID, SessionEpoch: b.SessionEpoch, ChannelBinding: b.ChannelBinding, Tool: authgrant.Tool{ID: b.Tool.ID, Version: b.Tool.Version, Operation: b.Tool.Operation, Purpose: b.Tool.Purpose, Risk: b.Tool.Risk, Schema: shopPolicyBind(b.Tool.Schema)}, Input: shopPolicyBind(b.Input), Fields: append([]string(nil), b.Fields...), Target: shopPolicyTarget(b.Target)}
	for _, r := range b.Resources {
		out.Resources = append(out.Resources, shopPolicyRef(r))
	}
	for _, s := range b.Sources {
		out.Sources = append(out.Sources, shopPolicySource(s))
	}
	if b.EgressActual != nil {
		v := shopPolicyBind(*b.EgressActual)
		out.EgressActual = &v
	}
	return out
}
func shopSDKProof(p authgrant.Proof) openprotocol.ShopOrderReadProofDATA {
	return openprotocol.ShopOrderReadProofDATA{Purpose: p.Purpose, Payload: bytes.Clone(p.Payload), Wire: bytes.Clone(p.Wire)}
}
func shopPolicyProof(p openprotocol.ShopOrderReadProofDATA) authgrant.Proof {
	return authgrant.Proof{Purpose: p.Purpose, Payload: bytes.Clone(p.Payload), Wire: bytes.Clone(p.Wire)}
}

func originalShopSDKProfile(profile OriginalShopOrderProfile) (openprotocol.ShopOrderReadExpectedProfileDATA, error) {
	if profile.OrderKind == "" || shopSDKTool(profile.Tool) != openprotocol.ShopOrderReadToolDescriptorDATA() || profile.Target.Path != openprotocol.ShopOrderReadPath || profile.Target.Operation != openprotocol.ShopOrderReadOperation || profile.Target.Service == "" || profile.Target.Tenant == "" || profile.Target.Origin == "" || profile.Target.Region == "" {
		return openprotocol.ShopOrderReadExpectedProfileDATA{}, errToolInvalid
	}
	return openprotocol.ShopOrderReadExpectedProfileDATA{Target: shopSDKTarget(profile.Target), OrderKind: profile.OrderKind}, nil
}

// EncodeOriginalShopOrderRequestDATA is a pure DATA helper for the actual
// protected caller's LINK Exchange.PrepareWire. It neither acquires nor claims
// a channel. Fresh TLS/exporter belongs to the OUTER carrier; never rewrite the
// signed INNER channel, E21, E3, proof wire or exact original input here.
func EncodeOriginalShopOrderRequestDATA(ctx context.Context, call OriginalShopOrderCall, profile OriginalShopOrderProfile) (OriginalShopOrderEncodedCall, error) {
	if ctx == nil {
		return OriginalShopOrderEncodedCall{}, errToolInvalid
	}
	if err := ctx.Err(); err != nil {
		return OriginalShopOrderEncodedCall{}, err
	}
	expected, err := originalShopSDKProfile(profile)
	if err != nil {
		return OriginalShopOrderEncodedCall{}, err
	}
	encoded, err := openprotocol.EncodeShopOrderReadRequestDATA(openprotocol.OriginalShopTaskOrderCallDATA{Binding: shopSDKBinding(call.Binding), Grant: shopSDKProof(call.Grant), Holder: shopSDKProof(call.Holder), Input: bytes.Clone(call.Input)}, expected)
	if err != nil {
		return OriginalShopOrderEncodedCall{}, err
	}
	if len(encoded) == 0 || len(encoded) > openprotocol.MaxControlBytes {
		return OriginalShopOrderEncodedCall{}, openprotocol.ErrBounds
	}
	if err := ctx.Err(); err != nil {
		return OriginalShopOrderEncodedCall{}, err
	}
	return OriginalShopOrderEncodedCall{Body: bytes.Clone(encoded), ContentType: openprotocol.ShopOrderReadRequestContentType}, nil
}

func DecodeOriginalShopOrderRequestDATA(ctx context.Context, encoded OriginalShopOrderEncodedCall, profile OriginalShopOrderProfile) (OriginalShopOrderRequestDATA, error) {
	var zero OriginalShopOrderRequestDATA
	if ctx == nil {
		return zero, errToolInvalid
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if len(encoded.Body) == 0 || len(encoded.Body) > openprotocol.MaxControlBytes {
		return zero, openprotocol.ErrBounds
	}
	expected, err := originalShopSDKProfile(profile)
	if err != nil {
		return zero, err
	}
	decoded, err := openprotocol.DecodeShopOrderReadRequestDATA(bytes.Clone(encoded.Body), expected, encoded.ContentType)
	if err != nil {
		return zero, err
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	return OriginalShopOrderRequestDATA{Binding: shopPolicyBinding(decoded.Binding), Grant: shopPolicyProof(decoded.Grant), Holder: shopPolicyProof(decoded.Holder), Input: bytes.Clone(decoded.Input)}, nil
}

func originalShopSDKExpectedResponse(ctx context.Context, call OriginalShopOrderCall, profile OriginalShopOrderProfile) (openprotocol.ShopOrderReadExpectedResponseDATA, error) {
	var zero openprotocol.ShopOrderReadExpectedResponseDATA
	// Validate the independently selected original signed DATA before using its
	// expected Source. No serialization or rewriting of signed inner operands.
	if _, err := EncodeOriginalShopOrderRequestDATA(ctx, call, profile); err != nil {
		return zero, err
	}
	selection, err := openprotocol.DecodeShopOrderReadInputDATA(bytes.Clone(call.Input))
	if err != nil {
		return zero, err
	}
	if len(call.Binding.Sources) != 1 {
		return zero, errToolInvalid
	}
	source := call.Binding.Sources[0]
	return openprotocol.ShopOrderReadExpectedResponseDATA{Selection: selection, Source: openprotocol.ShopOrderReadDeclaredSourceDATA{Resource: shopSDKRef(source.Resource), Fields: append([]string(nil), source.Fields...), Label: source.Label, Binding: shopSDKBind(source.Binding)}}, nil
}

// EncodeOriginalShopOrderResponseDATA is also DATA-only. It cannot create an
// operation/locator or satisfy the product's protected response codec interface.
func EncodeOriginalShopOrderResponseDATA(ctx context.Context, call OriginalShopOrderCall, value openprotocol.ShopOrderReadResponseValueDATA, profile OriginalShopOrderProfile) (openprotocol.ShopOrderReadResponseDATA, error) {
	expected, err := originalShopSDKExpectedResponse(ctx, call, profile)
	if err != nil {
		return openprotocol.ShopOrderReadResponseDATA{}, err
	}
	encoded, err := openprotocol.EncodeShopOrderReadResponseDATA(value, expected)
	if err != nil {
		return openprotocol.ShopOrderReadResponseDATA{}, err
	}
	if err := ctx.Err(); err != nil {
		return openprotocol.ShopOrderReadResponseDATA{}, err
	}
	return encoded, nil
}

// DecodeOriginalShopOrderResponseDATA returns the SDK's DATA-only value. It
// cannot implement OriginalShopOrderCodec and cannot supply operation facts.
func DecodeOriginalShopOrderResponseDATA(ctx context.Context, call OriginalShopOrderCall, response OriginalShopOrderTransportResult, profile OriginalShopOrderProfile) (openprotocol.ShopOrderReadResponseDATA, error) {
	var zero openprotocol.ShopOrderReadResponseDATA
	if response.ContentType != "application/json" || len(response.Body) == 0 || len(response.Body) > openprotocol.MaxControlBytes {
		return zero, errToolInvalid
	}
	expected, err := originalShopSDKExpectedResponse(ctx, call, profile)
	if err != nil {
		return zero, err
	}
	decoded, err := openprotocol.DecodeShopOrderReadResponseDATA(bytes.Clone(response.Body), expected)
	if err != nil {
		return zero, err
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	return decoded, nil
}

// Facts are returned only by the original protected response/correlation
// producer, NOT from DATA, a request echo, HTTP status or headers. That producer
// must verify actual response proof, current original operation association and
// authenticated remote locator/Source/scope for these exact received bytes.
type OriginalShopOrderSDKResponseFacts struct {
	OriginalOperationID string
	RemoteRef           string
	Source              authgrant.Source
	ResponseBinding     authgrant.Bind
	AuthScope           authgrant.FenceScope
}

type OriginalShopOrderProtectedResponseVerifier interface {
	Current(context.Context) error
	VerifyShopOrderResponse(context.Context, OriginalShopOrderCall, OriginalShopOrderTransportResult) (OriginalShopOrderSDKResponseFacts, error)
}

type PreparedOriginalShopOrderSDKCodec struct {
	profile  OriginalShopOrderProfile
	verifier OriginalShopOrderProtectedResponseVerifier
}

var _ OriginalShopOrderCodec = (*PreparedOriginalShopOrderSDKCodec)(nil)

// This constructor composes producers; it does not install/admit them. No
// verifier implementation, signing math, Root or global provider setter exists.
func PrepareOriginalShopOrderSDKCodec(ctx context.Context, profile OriginalShopOrderProfile, verifier OriginalShopOrderProtectedResponseVerifier) (*PreparedOriginalShopOrderSDKCodec, error) {
	codec := &PreparedOriginalShopOrderSDKCodec{profile: profile, verifier: verifier}
	if err := codec.current(ctx); err != nil {
		return nil, err
	}
	return codec, nil
}

func (c *PreparedOriginalShopOrderSDKCodec) current(ctx context.Context) error {
	if ctx == nil || c == nil || missingTaskRuntimeOperand(c.verifier) {
		return errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, err := originalShopSDKProfile(c.profile); err != nil {
		return err
	}
	if err := c.verifier.Current(ctx); err != nil {
		return err
	}
	return ctx.Err()
}

func (c *PreparedOriginalShopOrderSDKCodec) DecodeShopOrderRead(ctx context.Context, call OriginalShopOrderCall, response OriginalShopOrderTransportResult) (OriginalShopOrderDecodedResult, error) {
	var zero OriginalShopOrderDecodedResult
	if err := c.current(ctx); err != nil {
		return zero, err
	}
	if call.OriginalOperationID == "" || !shopOrderOperationRef.MatchString(call.OriginalOperationID) {
		return zero, errToolInvalid
	}
	call = cloneShopOrderCall(call)
	response.Body = bytes.Clone(response.Body)
	data, err := DecodeOriginalShopOrderResponseDATA(ctx, call, response, c.profile)
	if err != nil {
		return zero, err
	}
	// DATA flags intentionally remain false. They are not used as acceptance.
	proofResponse := response
	proofResponse.Body = bytes.Clone(response.Body)
	facts, err := c.verifier.VerifyShopOrderResponse(ctx, cloneShopOrderCall(call), proofResponse)
	if err != nil {
		return zero, err
	}
	facts.Source.Fields = append([]string(nil), facts.Source.Fields...)
	if facts.OriginalOperationID != call.OriginalOperationID || !validShopOrderRemoteRef(facts.RemoteRef) || (call.RemoteRef != "" && facts.RemoteRef != call.RemoteRef) || (response.RemoteRef != "" && facts.RemoteRef != response.RemoteRef) || !reflect.DeepEqual(facts.Source, call.Binding.Sources[0]) || facts.ResponseBinding != shopPolicyBind(data.ResponseBinding) || facts.ResponseBinding != shopAuthBind(response.Body) || facts.AuthScope != authgrant.FenceScope(data.AuthFence) {
		return zero, errToolConflict
	}
	if err := c.current(ctx); err != nil {
		return zero, err
	}
	// Extract the SDK-validated canonical projection verbatim rather than
	// inventing a second canonicalizer or escaping genuine U+2028/U+2029 again.
	var view struct {
		Projection json.RawMessage `json:"projection"`
	}
	if err := json.Unmarshal(data.ResponseOriginal, &view); err != nil {
		return zero, err
	}
	if len(view.Projection) == 0 {
		return zero, errToolInvalid
	}
	facts.Source.Fields = append([]string(nil), facts.Source.Fields...)
	return OriginalShopOrderDecodedResult{OriginalOperationID: facts.OriginalOperationID, RemoteRef: facts.RemoteRef, ResultJSON: bytes.Clone(view.Projection), SourceBytes: bytes.Clone(data.SourceBytes), Source: facts.Source, AuthScope: facts.AuthScope}, nil
}
