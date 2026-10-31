package aiproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	authgrant "ynx.local/authgrantpolicy"
)

// This verifier is a PUBLIC consumer-port fixture, NOT a protected Auth
// response verifier, signature implementation, Source or Root admission.
// Its facts are independent fixture facts, never echoed from incoming headers.
type p08SDKResponseVerifierFixture struct {
	current  func(context.Context) error
	facts    OriginalShopOrderSDKResponseFacts
	proofErr error
	checks   int
	onProof  func(OriginalShopOrderCall, OriginalShopOrderTransportResult)
}

func (v *p08SDKResponseVerifierFixture) Current(ctx context.Context) error {
	if v == nil || v.current == nil {
		return errTaskEffectSourceUnavailable
	}
	return v.current(ctx)
}
func (v *p08SDKResponseVerifierFixture) VerifyShopOrderResponse(_ context.Context, call OriginalShopOrderCall, response OriginalShopOrderTransportResult) (OriginalShopOrderSDKResponseFacts, error) {
	v.checks++
	if v.onProof != nil {
		v.onProof(call, response)
	}
	return v.facts, v.proofErr
}

type p08ShopSDKFixture struct {
	call     OriginalShopOrderCall
	profile  OriginalShopOrderProfile
	response OriginalShopOrderTransportResult
	data     openprotocol.ShopOrderReadResponseDATA
	verifier *p08SDKResponseVerifierFixture
}

func p08ShopSDKFixtureFromOriginalVector(t *testing.T) p08ShopSDKFixture {
	t.Helper()
	var vector struct {
		Binding                                                                               openprotocol.ShopOrderReadTaskEffectBindingDATA
		Expected                                                                              openprotocol.ShopOrderReadExpectedProfileDATA
		InputHex, GrantPayloadHex, GrantWireHex, HolderPayloadHex, HolderWireHex, ResponseHex string
	}
	if err := json.Unmarshal([]byte(p08ShopSDKVectorJSON), &vector); err != nil {
		t.Fatal(err)
	}
	decode := func(raw string) []byte {
		b, err := hex.DecodeString(raw)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	call := OriginalShopOrderCall{Binding: shopPolicyBinding(vector.Binding), Grant: authgrant.Proof{Purpose: openprotocol.BoundGrantDomain, Payload: decode(vector.GrantPayloadHex), Wire: decode(vector.GrantWireHex)}, Holder: authgrant.Proof{Purpose: openprotocol.GrantEffectDomain, Payload: decode(vector.HolderPayloadHex), Wire: decode(vector.HolderWireHex)}, Input: decode(vector.InputHex), OriginalOperationID: "PUBLIC-reserved-operation"}
	call.Session = ProductSession{ID: call.Binding.SessionID, Account: call.Binding.Account, DeviceID: call.Binding.Holder.ID}
	profile := OriginalShopOrderProfile{Tool: call.Binding.Tool, Target: shopPolicyTarget(vector.Expected.Target), OrderKind: vector.Expected.OrderKind}
	response := OriginalShopOrderTransportResult{Body: decode(vector.ResponseHex), ContentType: "application/json", RemoteRef: "PUBLIC-proof-original-remote"}
	data, err := DecodeOriginalShopOrderResponseDATA(context.Background(), call, response, profile)
	if err != nil {
		t.Fatal(err)
	}
	// The original Source association is deliberately a distinct fixture value
	// from binding.StepID; DATA alone contains neither this op nor the locator.
	facts := OriginalShopOrderSDKResponseFacts{OriginalOperationID: "PUBLIC-reserved-operation", RemoteRef: "PUBLIC-proof-original-remote", Source: authgrant.Source{Resource: shopPolicyRef(data.DeclaredSource.Resource), Fields: append([]string(nil), data.DeclaredSource.Fields...), Label: data.DeclaredSource.Label, Binding: shopPolicyBind(data.DeclaredSource.Binding)}, ResponseBinding: shopPolicyBind(data.ResponseBinding), AuthScope: authgrant.FenceScope(data.AuthFence)}
	verifier := &p08SDKResponseVerifierFixture{current: func(ctx context.Context) error { return ctx.Err() }, facts: facts}
	return p08ShopSDKFixture{call: call, profile: profile, response: response, data: data, verifier: verifier}
}

func TestP08ShopOrderSDKActualDATAAndProtectedFacts(t *testing.T) {
	f := p08ShopSDKFixtureFromOriginalVector(t)
	ctx := context.Background()
	// The test consumes genuine original E21/E3 DATA, not PUBLIC-payload bytes.
	grant, err := openprotocol.DecodeBoundGrant(f.call.Grant.Payload)
	if err != nil {
		t.Fatal(err)
	}
	grantBytes, err := openprotocol.EncodeBoundGrant(grant)
	if err != nil || !bytes.Equal(grantBytes, f.call.Grant.Payload) {
		t.Fatalf("original E21 changed: %v", err)
	}
	holderBytes, err := openprotocol.EncodeGrantEffect(grant, grant.Binding)
	if err != nil || !bytes.Equal(holderBytes, f.call.Holder.Payload) {
		t.Fatalf("original E3 changed: %v", err)
	}
	before := cloneShopOrderCall(f.call)
	encoded, err := EncodeOriginalShopOrderRequestDATA(ctx, f.call, f.profile)
	if err != nil || encoded.ContentType != openprotocol.ShopOrderReadRequestContentType {
		t.Fatalf("actual request DATA failed: %v", err)
	}
	decoded, err := DecodeOriginalShopOrderRequestDATA(ctx, encoded, f.profile)
	if err != nil || !reflect.DeepEqual(decoded.Binding, f.call.Binding) || !reflect.DeepEqual(decoded.Grant, f.call.Grant) || !reflect.DeepEqual(decoded.Holder, f.call.Holder) || !bytes.Equal(decoded.Input, f.call.Input) {
		t.Fatalf("policy/SDK mapping altered exact signed operands: %v", err)
	}
	if !reflect.DeepEqual(f.call, before) || decoded.Binding.ChannelBinding != "PUBLIC-inner-channel" {
		t.Fatal("DATA helper modified signed inner channel or caller-owned values")
	}
	if !f.data.DataOnly || f.data.SourceVerified || f.data.OperationVerified {
		t.Fatal("DATA codec falsely established operation/Source authority")
	}
	selection, err := openprotocol.DecodeShopOrderReadInputDATA(f.call.Input)
	if err != nil {
		t.Fatal(err)
	}
	encodedResponse, err := openprotocol.EncodeShopOrderReadResponseDATA(openprotocol.ShopOrderReadResponseValueDATA{Version: "1", Profile: openprotocol.ShopOrderReadResultProfile, Projection: f.data.Projection, Source: f.data.DeclaredSource, AuthFence: f.data.AuthFence}, openprotocol.ShopOrderReadExpectedResponseDATA{Selection: selection, Source: f.data.DeclaredSource})
	if err != nil || !bytes.Equal(encodedResponse.ResponseOriginal, f.response.Body) || !bytes.Equal(encodedResponse.SourceBytes, f.data.SourceBytes) {
		t.Fatalf("actual response DATA did not match original SDK vector: %v", err)
	}
	codec, err := PrepareOriginalShopOrderSDKCodec(ctx, f.profile, f.verifier)
	if err != nil {
		t.Fatal(err)
	}
	result, err := codec.DecodeShopOrderRead(ctx, f.call, f.response)
	if err != nil || f.verifier.checks != 1 || result.OriginalOperationID != f.verifier.facts.OriginalOperationID || result.OriginalOperationID == f.call.Binding.StepID || result.RemoteRef != f.verifier.facts.RemoteRef || !reflect.DeepEqual(result.Source, f.verifier.facts.Source) || !bytes.Equal(result.SourceBytes, f.data.SourceBytes) || result.AuthScope != authgrant.FenceScope(f.data.AuthFence) {
		t.Fatalf("protected response facts were not consumed: %+v %v", result, err)
	}
	var projection openprotocol.ShopOrderReadProjectionDATA
	if err := json.Unmarshal(result.ResultJSON, &projection); err != nil || !reflect.DeepEqual(projection, f.data.Projection) {
		t.Fatalf("product projection differs from actual SDK bytes: %v", err)
	}
}

func TestP08ShopOrderSDKNoVerifierNoAdmission(t *testing.T) {
	f := p08ShopSDKFixtureFromOriginalVector(t)
	ctx := context.Background()
	var typedNil *p08SDKResponseVerifierFixture
	for _, verifier := range []OriginalShopOrderProtectedResponseVerifier{nil, typedNil, &p08SDKResponseVerifierFixture{facts: f.verifier.facts}} {
		codec, err := PrepareOriginalShopOrderSDKCodec(ctx, f.profile, verifier)
		if !errors.Is(err, errTaskEffectSourceUnavailable) || codec != nil {
			t.Fatalf("DATA/missing Current became protected verifier: %v", err)
		}
	}
	var zero PreparedOriginalShopOrderSDKCodec
	if result, err := zero.DecodeShopOrderRead(ctx, f.call, f.response); !errors.Is(err, errTaskEffectSourceUnavailable) || result.OriginalOperationID != "" || len(result.ResultJSON) != 0 {
		t.Fatal("zero codec admitted DATA")
	}
}

func TestP08ShopOrderSDKRejectsWrongProtectedFacts(t *testing.T) {
	for _, mode := range []string{"op", "empty_op", "ref", "empty_ref", "source", "source_bytes", "body", "scope", "proof_error", "late_current"} {
		t.Run(mode, func(t *testing.T) {
			f := p08ShopSDKFixtureFromOriginalVector(t)
			cause := errors.New("PUBLIC protected response proof refused")
			codec, err := PrepareOriginalShopOrderSDKCodec(context.Background(), f.profile, f.verifier)
			if err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "op":
				f.verifier.facts.OriginalOperationID = "another-reserved-op"
			case "empty_op":
				f.verifier.facts.OriginalOperationID = ""
			case "ref":
				f.verifier.facts.RemoteRef = "another-remote"
			case "empty_ref":
				f.verifier.facts.RemoteRef = ""
			case "source":
				f.verifier.facts.Source.Resource.Revision = "2"
			case "source_bytes":
				f.verifier.facts.Source.Binding.SHA512 = strings.Repeat("0", 128)
			case "body":
				f.verifier.facts.ResponseBinding.SHA3_512 = strings.Repeat("0", 128)
			case "scope":
				f.verifier.facts.AuthScope = authgrant.SameAuthorityResourceFence
			case "proof_error":
				f.verifier.proofErr = cause
			case "late_current":
				f.verifier.onProof = func(OriginalShopOrderCall, OriginalShopOrderTransportResult) {
					f.verifier.current = func(context.Context) error { return cause }
				}
			}
			result, err := codec.DecodeShopOrderRead(context.Background(), f.call, f.response)
			if err == nil || result.OriginalOperationID != "" || result.RemoteRef != "" || len(result.ResultJSON) != 0 || len(result.SourceBytes) != 0 {
				t.Fatalf("bad proof facts accepted: mode=%s result=%+v err=%v", mode, result, err)
			}
			if (mode == "proof_error" || mode == "late_current") && !errors.Is(err, cause) {
				t.Fatal("actual producer first cause lost")
			}
		})
	}
}

func TestP08ShopOrderSDKRejectsInnerRewriteAndOldFixture(t *testing.T) {
	for _, mode := range []string{"inner_channel", "original_input", "fake_e21", "wrong_purpose", "holder_inner", "old_response", "unknown_verified", "request_mime", "response_mime"} {
		t.Run(mode, func(t *testing.T) {
			f := p08ShopSDKFixtureFromOriginalVector(t)
			switch mode {
			case "inner_channel":
				f.call.Binding.ChannelBinding = "new-outer-TLS-channel"
			case "original_input":
				f.call.Input = append(bytes.Clone(f.call.Input), ' ')
			case "fake_e21":
				f.call.Grant.Payload = []byte("PUBLIC-payload")
			case "wrong_purpose":
				f.call.Holder.Purpose = openprotocol.BoundGrantDomain
			case "holder_inner":
				g, err := openprotocol.DecodeBoundGrant(f.call.Grant.Payload)
				if err != nil {
					t.Fatal(err)
				}
				g.Nonce = strings.Repeat("33", 16)
				f.call.Holder.Payload, err = openprotocol.EncodeGrantEffect(g, g.Binding)
				if err != nil {
					t.Fatal(err)
				}
			case "old_response":
				f.response.Body = []byte(`{"Projection":{},"SourceBytes":"PUBLIC","Operation":"PUBLIC-reserved-operation","RemoteRef":"PUBLIC-proof-original-remote"}`)
			case "unknown_verified":
				f.response.Body = bytes.Replace(f.response.Body, []byte(`"version":"1"`), []byte(`"verified":true,"version":"1"`), 1)
			case "response_mime":
				f.response.ContentType = "application/json; charset=utf-8"
			case "request_mime":
				encoded, err := EncodeOriginalShopOrderRequestDATA(context.Background(), f.call, f.profile)
				if err != nil {
					t.Fatal(err)
				}
				encoded.ContentType = "application/json"
				if _, err := DecodeOriginalShopOrderRequestDATA(context.Background(), encoded, f.profile); err == nil {
					t.Fatal("JSON request MIME accepted")
				}
				return
			}
			codec, err := PrepareOriginalShopOrderSDKCodec(context.Background(), f.profile, f.verifier)
			if err != nil {
				t.Fatal(err)
			}
			if result, err := codec.DecodeShopOrderRead(context.Background(), f.call, f.response); err == nil || result.OriginalOperationID != "" || f.verifier.checks != 0 {
				t.Fatalf("bad DATA reached protected verifier: mode=%s err=%v", mode, err)
			}
		})
	}
}

func TestP08ShopOrderSDKOwnsAllMutableOperands(t *testing.T) {
	f := p08ShopSDKFixtureFromOriginalVector(t)
	before := cloneShopOrderCall(f.call)
	wire := bytes.Clone(f.response.Body)
	f.verifier.onProof = func(call OriginalShopOrderCall, response OriginalShopOrderTransportResult) {
		call.Grant.Payload[0] ^= 1
		call.Holder.Payload[0] ^= 1
		call.Input[0] = '!'
		call.Binding.Sources[0].Fields[0] = "address"
		response.Body[0] = '!'
	}
	codec, err := PrepareOriginalShopOrderSDKCodec(context.Background(), f.profile, f.verifier)
	if err != nil {
		t.Fatal(err)
	}
	result, err := codec.DecodeShopOrderRead(context.Background(), f.call, f.response)
	if err != nil {
		t.Fatal(err)
	}
	result.Source.Fields[0] = "address"
	result.SourceBytes[0] = '!'
	result.ResultJSON[0] = '!'
	if !reflect.DeepEqual(before, f.call) || !bytes.Equal(wire, f.response.Body) || f.verifier.facts.Source.Fields[0] == "address" {
		t.Fatal("producer/product result aliased original signed input, received wire or verifier facts")
	}
	encoded, err := EncodeOriginalShopOrderRequestDATA(context.Background(), f.call, f.profile)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeOriginalShopOrderRequestDATA(context.Background(), encoded, f.profile)
	if err != nil {
		t.Fatal(err)
	}
	decoded.Grant.Payload[0] ^= 1
	decoded.Binding.Sources[0].Fields[0] = "address"
	if !reflect.DeepEqual(before, f.call) {
		t.Fatal("decoded policy DATA aliases original caller values")
	}
}

func TestP08ShopOrderSDKControlBounds(t *testing.T) {
	f := p08ShopSDKFixtureFromOriginalVector(t)
	ctx := context.Background()
	if _, err := DecodeOriginalShopOrderRequestDATA(ctx, OriginalShopOrderEncodedCall{Body: make([]byte, openprotocol.MaxControlBytes+1), ContentType: openprotocol.ShopOrderReadRequestContentType}, f.profile); err == nil {
		t.Fatal("oversized request accepted")
	}
	if _, err := DecodeOriginalShopOrderResponseDATA(ctx, f.call, OriginalShopOrderTransportResult{Body: make([]byte, openprotocol.MaxControlBytes+1), ContentType: "application/json"}, f.profile); err == nil {
		t.Fatal("oversized response accepted")
	}
	// Exercise >old-128KiB valid DATA under the actual unchanged 1MiB SDK cap.
	g, err := openprotocol.DecodeBoundGrant(f.call.Grant.Payload)
	if err != nil {
		t.Fatal(err)
	}
	data := map[string]string{"currency": "YNXT", "status": strings.Repeat("s", 192<<10), "totalYNXT": "100"}
	sourceBytes, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	bind := shopSDKBind(shopAuthBind(sourceBytes))
	f.call.Binding.Sources[0].Binding = shopPolicyBind(bind)
	g.Binding.Sources[0].Binding = bind
	f.call.Grant.Payload, err = openprotocol.EncodeBoundGrant(g)
	if err != nil {
		t.Fatal(err)
	}
	f.call.Holder.Payload, err = openprotocol.EncodeGrantEffect(g, g.Binding)
	if err != nil {
		t.Fatal(err)
	}
	selection, err := openprotocol.DecodeShopOrderReadInputDATA(f.call.Input)
	if err != nil {
		t.Fatal(err)
	}
	source := f.data.DeclaredSource
	source.Binding = bind
	response, err := openprotocol.EncodeShopOrderReadResponseDATA(openprotocol.ShopOrderReadResponseValueDATA{Version: "1", Profile: openprotocol.ShopOrderReadResultProfile, Projection: openprotocol.ShopOrderReadProjectionDATA{OrderID: selection.OrderID, Fields: selection.Fields, Snapshot: selection.Snapshot, Data: data}, Source: source, AuthFence: string(authgrant.EgressOnlyReadFence)}, openprotocol.ShopOrderReadExpectedResponseDATA{Selection: selection, Source: source})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeOriginalShopOrderResponseDATA(ctx, f.call, OriginalShopOrderTransportResult{Body: response.ResponseOriginal, ContentType: "application/json"}, f.profile)
	if err != nil || len(decoded.ResponseOriginal) <= 128<<10 || !bytes.Equal(decoded.SourceBytes, sourceBytes) || !decoded.DataOnly || decoded.OperationVerified || decoded.SourceVerified {
		t.Fatalf("actual 1MiB DATA cap was replaced by old fixture bound: %v", err)
	}
}

func TestP08ShopOrderSDKFactsOwnershipAcrossCurrent(t *testing.T) {
	f := p08ShopSDKFixtureFromOriginalVector(t)
	checks := 0
	f.verifier.current = func(context.Context) error {
		checks++
		if checks == 3 {
			f.verifier.facts.Source.Fields[0] = "producer-mutated-after-proof"
		}
		return nil
	}
	codec, err := PrepareOriginalShopOrderSDKCodec(context.Background(), f.profile, f.verifier)
	if err != nil {
		t.Fatal(err)
	}
	result, err := codec.DecodeShopOrderRead(context.Background(), f.call, f.response)
	if err != nil || !reflect.DeepEqual(result.Source, f.call.Binding.Sources[0]) || result.Source.Fields[0] == "producer-mutated-after-proof" {
		t.Fatalf("final Current callback changed detached verified facts: %+v %v", result.Source, err)
	}
}

func TestP08ShopOrderSDKIncompleteProfileBeforeCurrent(t *testing.T) {
	for _, mode := range []string{"service", "tenant", "origin", "region", "purpose"} {
		t.Run(mode, func(t *testing.T) {
			f := p08ShopSDKFixtureFromOriginalVector(t)
			profile := f.profile
			switch mode {
			case "service":
				profile.Target.Service = ""
			case "tenant":
				profile.Target.Tenant = ""
			case "origin":
				profile.Target.Origin = ""
			case "region":
				profile.Target.Region = ""
			case "purpose":
				profile.Tool.Purpose = "caller-selected-purpose"
			}
			f.verifier.current = func(context.Context) error { t.Error("incomplete profile reached producer Current"); return nil }
			if codec, err := PrepareOriginalShopOrderSDKCodec(context.Background(), profile, f.verifier); err == nil || codec != nil {
				t.Fatalf("incomplete/unregistered profile prepared: %v", err)
			}
		})
	}
}

func TestP08ShopOrderSDKVerbatimUnicodeProjection(t *testing.T) {
	f := p08ShopSDKFixtureFromOriginalVector(t)
	// An additional PUBLIC DATA operand uses real SDK E21/E3 encoding. No
	// signature is created: opaque original fixture wire remains PUBLIC-only.
	status := "pending<&>\u2028line\u2029literal\\u2028"
	sourceBytes := []byte("{\"currency\":\"YNXT\",\"status\":\"pending<&>\u2028line\u2029literal\\\\u2028\",\"totalYNXT\":\"100\"}")
	bind := shopSDKBind(shopAuthBind(sourceBytes))
	g, err := openprotocol.DecodeBoundGrant(f.call.Grant.Payload)
	if err != nil {
		t.Fatal(err)
	}
	g.Binding.Sources[0].Binding = bind
	f.call.Binding.Sources[0].Binding = shopPolicyBind(bind)
	f.call.Grant.Payload, err = openprotocol.EncodeBoundGrant(g)
	if err != nil {
		t.Fatal(err)
	}
	f.call.Holder.Payload, err = openprotocol.EncodeGrantEffect(g, g.Binding)
	if err != nil {
		t.Fatal(err)
	}
	selection, err := openprotocol.DecodeShopOrderReadInputDATA(f.call.Input)
	if err != nil {
		t.Fatal(err)
	}
	source := f.data.DeclaredSource
	source.Binding = bind
	encoded, err := openprotocol.EncodeShopOrderReadResponseDATA(openprotocol.ShopOrderReadResponseValueDATA{Version: "1", Profile: openprotocol.ShopOrderReadResultProfile, Projection: openprotocol.ShopOrderReadProjectionDATA{OrderID: selection.OrderID, Fields: selection.Fields, Snapshot: selection.Snapshot, Data: map[string]string{"currency": "YNXT", "status": status, "totalYNXT": "100"}}, Source: source, AuthFence: string(authgrant.EgressOnlyReadFence)}, openprotocol.ShopOrderReadExpectedResponseDATA{Selection: selection, Source: source})
	if err != nil {
		t.Fatal(err)
	}
	f.response.Body = encoded.ResponseOriginal
	f.verifier.facts.Source = f.call.Binding.Sources[0]
	f.verifier.facts.ResponseBinding = shopPolicyBind(encoded.ResponseBinding)
	codec, err := PrepareOriginalShopOrderSDKCodec(context.Background(), f.profile, f.verifier)
	if err != nil {
		t.Fatal(err)
	}
	result, err := codec.DecodeShopOrderRead(context.Background(), f.call, f.response)
	if err != nil {
		t.Fatal(err)
	}
	var view openprotocol.ShopOrderReadProjectionDATA
	if err := json.Unmarshal(result.ResultJSON, &view); err != nil || view.Data["status"] != status {
		t.Fatalf("Unicode/literal escape value changed: %v", err)
	}
	if !bytes.Equal(result.SourceBytes, sourceBytes) || !bytes.Contains(result.ResultJSON, []byte("\u2028")) || !bytes.Contains(result.ResultJSON, []byte("\u2029")) || !bytes.Contains(result.ResultJSON, []byte(`literal\\u2028`)) || bytes.Contains(result.ResultJSON, []byte(`\u003c`)) {
		t.Fatal("adapter rewrote canonical SDK projection/source bytes")
	}
}

func TestP08ShopOrderSDKResponseEncodeThinDATA(t *testing.T) {
	f := p08ShopSDKFixtureFromOriginalVector(t)
	value := openprotocol.ShopOrderReadResponseValueDATA{Version: "1", Profile: openprotocol.ShopOrderReadResultProfile, Projection: f.data.Projection, Source: f.data.DeclaredSource, AuthFence: f.data.AuthFence}
	data, err := EncodeOriginalShopOrderResponseDATA(context.Background(), f.call, value, f.profile)
	if err != nil || !bytes.Equal(data.ResponseOriginal, f.response.Body) || !data.DataOnly || data.SourceVerified || data.OperationVerified {
		t.Fatalf("thin encode changed SDK canonical DATA or minted acceptance: %v", err)
	}
	codec, err := PrepareOriginalShopOrderSDKCodec(context.Background(), f.profile, f.verifier)
	if err != nil {
		t.Fatal(err)
	}
	result, err := codec.DecodeShopOrderRead(context.Background(), f.call, OriginalShopOrderTransportResult{Body: data.ResponseOriginal, ContentType: "application/json"})
	if err != nil || result.OriginalOperationID != f.verifier.facts.OriginalOperationID || result.RemoteRef != f.verifier.facts.RemoteRef || f.verifier.checks != 1 {
		t.Fatalf("DATA-only encode bypassed or broke protected proof composition: %v", err)
	}
	value.Source.Label = "PUBLIC"
	if _, err := EncodeOriginalShopOrderResponseDATA(context.Background(), f.call, value, f.profile); err == nil {
		t.Fatal("DATA encode widened independently selected source label")
	}
}
