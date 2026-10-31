package commerce

import (
	"bytes"
	"context"
	"testing"

	policy "ynx.local/authgrantpolicy"
)

func TestShopTaskOrderReceiptOwnerReceivesExactSDKBytesAndOriginalOperation(t *testing.T) {
	s, order, prepared, verifier, codec, body := publicShopTaskFixture(t)
	p, err := s.ReadScopedOrder(order.Buyer, "buyer", order.ID, codec.call.Binding.Fields, "")
	if err != nil {
		t.Fatal(err)
	}
	want, err := encodeOriginalShopOrderDATA(OriginalShopTaskOrderResponse{Projection: p, Source: codec.call.Binding.Sources[0], AuthScope: policy.EgressOnlyReadFence})
	if err != nil {
		t.Fatal(err)
	}
	w := shopTaskRequest(t, s, prepared, body)
	if w.Code != 200 || verifier.attests != 1 || !bytes.Equal(verifier.retainedResponse, want.ResponseOriginal) || !bytes.Equal(verifier.retainedSource, want.SourceBytes) {
		t.Fatal("original receipt owner lost exact SDK result bytes", w.Code, w.Body.String(), verifier.attests)
	}
	if bytes.Equal(verifier.retainedResponse, w.Body.Bytes()) {
		t.Fatal("SDK DATA bytes confused with final proof envelope")
	}
}

type replacedShopReceiptCodec struct {
	*publicShopTaskCodec
	fault string
}

func (c replacedShopReceiptCodec) EncodeShopOrderRead(ctx context.Context, r OriginalShopTaskOrderResponse, attest OriginalShopTaskOrderAttest) (OriginalShopTaskOrderEncoding, error) {
	out, err := c.publicShopTaskCodec.EncodeShopOrderRead(ctx, r, attest)
	if err != nil {
		return out, err
	}
	switch c.fault {
	case "missing-original":
		out.ResponseOriginal = nil
	case "replacement-json":
		out.ResponseOriginal = []byte(`{"status":"success"}`)
	case "late-source-replacement":
		out.SourceBytes = []byte(`{"status":"success"}`)
	case "mutated-borrowed-original":
		// The codec's borrowed input cannot mutate the expected bytes retained
		// by the actual effect/receipt authority or its frozen Store snapshot.
		r.ResponseOriginal[0] = 'x'
		out.ResponseOriginal = r.ResponseOriginal
	}
	return out, nil
}

func TestShopTaskOrderReceiptBytesCannotChangeAfterAttestation(t *testing.T) {
	for _, fault := range []string{"missing-original", "replacement-json", "late-source-replacement", "mutated-borrowed-original"} {
		t.Run(fault, func(t *testing.T) {
			s, order, _, verifier, codec, body := publicShopTaskFixture(t)
			before := transitionDomainSnapshot(t, s)
			prepared, err := PrepareOriginalShopTaskOrders(verifier, replacedShopReceiptCodec{codec, fault}, verifier, ShopOrderReadToolDescriptor(), codec.call.Binding.Target, codec.call.Binding.Resources[0].Kind, func(ctx context.Context) error { return ctx.Err() })
			if err != nil {
				t.Fatal(err)
			}
			w := shopTaskRequest(t, s, prepared, body)
			if w.Code != 409 || verifier.attests != 1 || verifier.responseClosed != 1 || verifier.source.closed != 1 || bytes.Contains(w.Body.Bytes(), []byte(order.ID)) || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
				t.Fatal("altered post-proof bytes escaped or read was repeated", fault, w.Code, w.Body.String(), verifier.attests)
			}
			if len(verifier.retainedResponse) == 0 || verifier.retainedResponse[0] != '{' || taskOrderBytesBinding(verifier.retainedSource) != codec.call.Binding.Sources[0].Binding {
				t.Fatal("borrowed codec bytes changed retained original receipt")
			}
		})
	}
}
