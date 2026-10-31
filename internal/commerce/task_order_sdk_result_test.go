package commerce

import (
	"bytes"
	"context"
	"errors"
	"testing"

	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// PUBLIC input/receipt custody only. Actual Auth policy, original Store and
// actual SDK production result encoder execute, not a response JSON fixture.
type publicOriginalSDKResultCodec struct{ *publicShopTaskCodec }

func (c publicOriginalSDKResultCodec) EncodeShopOrderRead(ctx context.Context, r OriginalShopTaskOrderResponse, attest OriginalShopTaskOrderAttest) (OriginalShopTaskOrderEncoding, error) {
	c.encodes++
	return (originalShopSDKResultEncoder{}).EncodeShopOrderRead(ctx, r, attest)
}

func TestShopTaskOrderSDKResultMatchesActualAuthRegisteredBodyContract(t *testing.T) {
	s, order, _, verifier, inputCodec, input := publicShopTaskFixture(t)
	prepared, err := PrepareOriginalShopTaskOrders(verifier, publicOriginalSDKResultCodec{inputCodec}, verifier, ShopOrderReadToolDescriptor(), inputCodec.call.Binding.Target, inputCodec.call.Binding.Resources[0].Kind, func(ctx context.Context) error { return ctx.Err() })
	if err != nil {
		t.Fatal(err)
	}
	before := transitionDomainSnapshot(t, s)
	w := shopTaskRequest(t, s, prepared, input)
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/json" || !bytes.Equal(w.Body.Bytes(), verifier.retainedResponse) || verifier.attests != 1 || verifier.source.asserts != 4 || verifier.responseClosed != 1 || verifier.source.closed != 1 {
		t.Fatal("actual result/receipt custody diverged", w.Code, w.Body.String(), verifier.attests)
	}
	projection, err := s.ReadScopedOrder(order.Buyer, "buyer", order.ID, inputCodec.call.Binding.Fields, "")
	if err != nil {
		t.Fatal(err)
	}
	data, err := encodeOriginalShopOrderDATA(OriginalShopTaskOrderResponse{Projection: projection, Source: inputCodec.call.Binding.Sources[0], AuthScope: policy.EgressOnlyReadFence})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := openprotocol.DecodeShopOrderReadResponseDATA(w.Body.Bytes(), openprotocol.ShopOrderReadExpectedResponseDATA{Selection: openprotocol.ShopOrderReadSelection{OrderID: order.ID, Fields: projection.Fields, Snapshot: projection.Snapshot}, Source: data.DeclaredSource})
	if err != nil || !bytes.Equal(decoded.SourceBytes, verifier.retainedSource) || !decoded.DataOnly || decoded.OperationVerified || decoded.SourceVerified {
		t.Fatal("Auth registered SDK receiver cannot decode exact product Body or DATA became authority", err)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("PUBLIC-not-a-response-signature")) || bytes.Contains(w.Body.Bytes(), []byte("PUBLIC-original-op")) || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
		t.Fatal("new envelope/operation authority was invented or read mutated business state")
	}
}

func TestShopTaskOrderSDKResultProofMismatchStopsHTTPWithoutFallback(t *testing.T) {
	s, order, _, verifier, inputCodec, input := publicShopTaskFixture(t)
	verifier.badResponseProof = true
	prepared, err := PrepareOriginalShopTaskOrders(verifier, publicOriginalSDKResultCodec{inputCodec}, verifier, ShopOrderReadToolDescriptor(), inputCodec.call.Binding.Target, inputCodec.call.Binding.Resources[0].Kind, func(ctx context.Context) error { return ctx.Err() })
	if err != nil {
		t.Fatal(err)
	}
	w := shopTaskRequest(t, s, prepared, input)
	if w.Code != 503 || verifier.attests != 1 || verifier.source.closed != 1 || verifier.responseClosed != 1 || bytes.Contains(w.Body.Bytes(), []byte(order.ID)) {
		t.Fatal("failed original proof fell back to DATA-only output", w.Code, w.Body.String())
	}
}

func TestShopTaskOrderSDKResultRequiresOriginalAttestationAndUnchangedBytes(t *testing.T) {
	s, order, _, _, inputCodec, _ := publicShopTaskFixture(t)
	p, err := s.ReadScopedOrder(order.Buyer, "buyer", order.ID, inputCodec.call.Binding.Fields, "")
	if err != nil {
		t.Fatal(err)
	}
	r := OriginalShopTaskOrderResponse{Operation: OriginalShopTaskOrderOperation{"PUBLIC-original-op", "PUBLIC-remote-ref"}, Projection: p, Source: inputCodec.call.Binding.Sources[0], AuthScope: policy.EgressOnlyReadFence}
	frozen, err := encodeOriginalShopOrderDATA(r)
	if err != nil {
		t.Fatal(err)
	}
	r.ResponseOriginal, r.SourceBytes = bytes.Clone(frozen.ResponseOriginal), bytes.Clone(frozen.SourceBytes)
	r.ResponseBinding = policy.Bind{Bytes: frozen.ResponseBinding.Bytes, SHA3_512: frozen.ResponseBinding.SHA3_512, SHA512: frozen.ResponseBinding.SHA512}
	for _, fault := range []string{"missing-attester", "original-operation", "unregistered-fence", "reencoded-result", "wrong-source", "input-binding-as-response", "attester-denied", "late-cancel", "wrong-proof-payload", "empty-proof"} {
		t.Run(fault, func(t *testing.T) {
			response := copyShopTaskResponse(r)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			calls := 0
			var attest OriginalShopTaskOrderAttest = func(_ context.Context, source, payload []byte) (policy.Proof, error) {
				calls++
				if !bytes.Equal(source, frozen.SourceBytes) || !bytes.Equal(payload, frozen.ResponseOriginal) {
					t.Fatal("original attester received recomputed/guessed result")
				}
				proof := policy.Proof{Purpose: "PUBLIC-response-proof", Payload: bytes.Clone(payload), Wire: []byte("PUBLIC-opaque-proof")}
				switch fault {
				case "attester-denied":
					return policy.Proof{}, ErrUnauthorized
				case "late-cancel":
					cancel()
				case "wrong-proof-payload":
					proof.Payload = []byte(`{}`)
				case "empty-proof":
					proof.Wire = nil
				}
				return proof, nil
			}
			switch fault {
			case "missing-attester":
				attest = nil
			case "original-operation":
				response.Operation.OriginalOperationID = ""
			case "unregistered-fence":
				response.AuthScope = policy.SameAuthorityResourceFence
			case "reencoded-result":
				response.ResponseOriginal = append(response.ResponseOriginal, '\n')
			case "wrong-source":
				response.SourceBytes = []byte(`{}`)
			case "input-binding-as-response":
				response.ResponseBinding = inputCodec.call.Binding.Input
			}
			out, err := (originalShopSDKResultEncoder{}).EncodeShopOrderRead(ctx, response, attest)
			if err == nil || len(out.Body) != 0 || len(out.SourceBytes) != 0 || len(out.ResponseOriginal) != 0 || calls > 1 {
				t.Fatal("invalid result escaped original proof gate", fault, out, err)
			}
			if fault == "late-cancel" && !errors.Is(err, context.Canceled) {
				t.Fatal("late cancellation cause lost", err)
			}
		})
	}
}
