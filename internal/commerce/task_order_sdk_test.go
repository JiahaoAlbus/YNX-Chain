package commerce

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

func publicShopSDKRequest(t *testing.T) ([]byte, OriginalShopTaskOrderCall, *publicShopTaskCodec) {
	t.Helper()
	_, _, _, v, encoder, _ := publicShopTaskFixture(t)
	call := copyShopTaskOrderCall(encoder.call)
	call.Binding.GrantID = strings.Repeat("1", 32)
	b := call.Binding
	ref := func(r policy.Ref) openprotocol.LegacyGrantRefV1 {
		return openprotocol.LegacyGrantRefV1{Realm: r.Realm, Tenant: r.Tenant, Kind: r.Kind, ID: r.ID, Rev: r.Revision}
	}
	bind := func(b policy.Bind) openprotocol.GrantBindV1 {
		return openprotocol.GrantBindV1{Bytes: b.Bytes, SHA3_512: b.SHA3_512, SHA512: b.SHA512}
	}
	target := openprotocol.GrantTargetV1{Service: b.Target.Service, Tenant: b.Target.Tenant, Origin: b.Target.Origin, Path: b.Target.Path, Region: b.Target.Region, Operation: b.Target.Operation}
	resource := ref(b.Resources[0])
	source := openprotocol.GrantSourceV1{Ref: resource, Fields: b.Sources[0].Fields, Label: b.Sources[0].Label, Binding: bind(b.Sources[0].Binding)}
	tool := openprotocol.ShopOrderReadToolDescriptorDATA()
	step := openprotocol.GrantStepBindingV1{Task: ref(b.Task), Generation: b.Generation, StepID: b.StepID, Input: bind(b.Input), Tool: openprotocol.GrantToolV1{ID: tool.ID, Version: tool.Version, Schema: tool.Schema}, Target: target, Purpose: tool.Purpose, Risk: tool.Risk, HolderSession: openprotocol.GrantSessionV1{ID: b.SessionID, Epoch: b.SessionEpoch, Channel: b.ChannelBinding}, Sources: []openprotocol.GrantSourceV1{source}}
	grant := openprotocol.BoundGrantV1{Version: openprotocol.BoundGrantDataVersion, ID: b.GrantID, Realm: b.Realm, Tenant: b.Tenant, Issuer: ref(v.source.snapshot.Issuer.Ref), IssuerEpoch: "1", Holder: ref(b.Holder), HolderEpoch: b.HolderEpoch, Audience: b.Audience, Operation: tool.Operation, Resources: []openprotocol.LegacyGrantRefV1{resource}, Cap: "10", SingleMax: "1", ValidFrom: "1", Expires: "2", Nonce: strings.Repeat("2", 32), Rev: b.GrantRevision, NonDelegable: true, ApprovalID: "PUBLIC-original-approval", Binding: step}
	gp, err := openprotocol.EncodeBoundGrant(grant)
	if err != nil {
		t.Fatal(err)
	}
	hp, err := openprotocol.EncodeGrantEffect(grant, step)
	if err != nil {
		t.Fatal(err)
	}
	// Genuine SDK grammar; opaque PUBLIC wires are not original PQ signatures.
	call.Grant = policy.Proof{Purpose: openprotocol.BoundGrantDomain, Payload: gp, Wire: []byte("PUBLIC-not-a-grant-signature")}
	call.Holder = policy.Proof{Purpose: openprotocol.GrantEffectDomain, Payload: hp, Wire: []byte("PUBLIC-not-an-effect-signature")}
	data := openprotocol.OriginalShopTaskOrderCallDATA{Binding: openprotocol.ShopOrderReadTaskEffectBindingDATA{Realm: b.Realm, Tenant: b.Tenant, Account: b.Account, Audience: b.Audience, GrantID: b.GrantID, GrantRevision: b.GrantRevision, Task: ref(b.Task), Generation: b.Generation, StepID: b.StepID, Holder: ref(b.Holder), HolderEpoch: b.HolderEpoch, SessionID: b.SessionID, SessionEpoch: b.SessionEpoch, ChannelBinding: b.ChannelBinding, Tool: tool, Input: bind(b.Input), Fields: b.Fields, Target: target, Resources: []openprotocol.LegacyGrantRefV1{resource}, Sources: []openprotocol.GrantSourceV1{source}}, Grant: openprotocol.ShopOrderReadProofDATA{Purpose: call.Grant.Purpose, Payload: gp, Wire: call.Grant.Wire}, Holder: openprotocol.ShopOrderReadProofDATA{Purpose: call.Holder.Purpose, Payload: hp, Wire: call.Holder.Wire}, Input: call.Input}
	raw, err := openprotocol.EncodeShopOrderReadRequestDATA(data, openprotocol.ShopOrderReadExpectedProfileDATA{Target: target, OrderKind: resource.Kind})
	if err != nil {
		t.Fatal(err)
	}
	return raw, call, encoder
}

func TestShopTaskOrderSDKRequestDecodesActualOriginalGrammarWithoutPromotion(t *testing.T) {
	raw, expected, _ := publicShopSDKRequest(t)
	original := bytes.Clone(raw)
	got, err := DecodeOriginalShopTaskOrderRequestDATA(context.Background(), raw, ShopOrderReadRequestContentType, expected.Binding.Target, expected.Binding.Resources[0].Kind)
	if err != nil || !reflect.DeepEqual(got, expected) {
		t.Fatal("SDK original signed operands changed", err)
	}
	for i := range raw {
		raw[i] = 0
	}
	if !reflect.DeepEqual(got, expected) || bytes.Equal(got.Grant.Wire, []byte("verified")) || bytes.Equal(original, raw) {
		t.Fatal("decoded proof aliased carrier or was reinterpreted as verified")
	}
}

func TestShopTaskOrderSDKWrongProfileMediaOrCarrierRejected(t *testing.T) {
	raw, call, _ := publicShopSDKRequest(t)
	for _, fault := range []string{"media", "target", "kind", "trailing", "oversize", "cancel"} {
		t.Run(fault, func(t *testing.T) {
			target, kind, media, wire, ctx := call.Binding.Target, call.Binding.Resources[0].Kind, ShopOrderReadRequestContentType, bytes.Clone(raw), context.Background()
			switch fault {
			case "media":
				media = "application/json"
			case "target":
				target.Service = "other-service"
			case "kind":
				kind = "ai.conversation"
			case "trailing":
				wire = append(wire, 0)
			case "oversize":
				wire = make([]byte, maxBody+1)
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			got, err := DecodeOriginalShopTaskOrderRequestDATA(ctx, wire, media, target, kind)
			if err == nil || len(got.Input) != 0 || len(got.Grant.Wire) != 0 {
				t.Fatal("invalid request returned partial authority", fault, err)
			}
		})
	}
}

type publicShopOuterChannel struct{ checks int }

func (*publicShopOuterChannel) Current(ctx context.Context) error { return ctx.Err() }
func (p *publicShopOuterChannel) CheckShopOrderReadOuterChannel(context.Context, OriginalShopTaskOrderCall, securelink.AuthenticatedChannel) error {
	p.checks++
	return errors.New("PUBLIC fixture cannot admit original channel")
}

func TestShopTaskOrderSDKUnsealedRequestNeverReachesSourceChannelBinder(t *testing.T) {
	raw, call, encoder := publicShopSDKRequest(t)
	channels := &publicShopOuterChannel{}
	codec, err := PrepareOriginalShopTaskOrderSDKCodec(context.Background(), encoder, channels, call.Binding.Target, call.Binding.Resources[0].Kind)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(raw))
	r.Header.Set("Content-Type", ShopOrderReadRequestContentType)
	r.TLS = &tls.ConnectionState{HandshakeComplete: true}
	r.Header.Set("X-YNX-Holder", call.Binding.Holder.ID)
	got, err := codec.DecodeShopOrderRead(context.Background(), r, raw)
	if err == nil || len(got.Input) != 0 || channels.checks != 0 {
		t.Fatal("ordinary TLS/header admitted outer channel", err, channels.checks)
	}
}
