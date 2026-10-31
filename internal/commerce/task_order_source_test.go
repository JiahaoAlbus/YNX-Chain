package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	authgrant "ynx.local/authgrantpolicy"
)

func TestShopTaskOrderSourceUsesOriginalSnapshotAndSDKCanonicalFields(t *testing.T) {
	s, o, _, _, c, _ := publicShopTaskFixture(t)
	fields := []string{"createdAt", "currency", "reservationExpiresAt", "shippingYNXT", "status", "subtotalYNXT", "taxYNXT", "totalYNXT", "updatedAt"}
	p, err := s.ReadScopedOrder(o.Buyer, "buyer", o.ID, fields, "")
	if err != nil {
		t.Fatal(err)
	}
	// The public fixture computes its expected bytes independently; production
	// obtains the declared binding/ref/rev from the protected original Source.
	stringsOnly := map[string]string{}
	for name, value := range p.Data {
		if v, ok := value.(time.Time); ok {
			raw, e := v.MarshalJSON()
			if e != nil {
				t.Fatal(e)
			}
			stringsOnly[name] = string(raw[1 : len(raw)-1])
		} else {
			stringsOnly[name] = value.(string)
		}
	}
	raw, _ := json.Marshal(stringsOnly)
	source := c.call.Binding.Sources[0]
	source.Fields = fields
	source.Binding = taskOrderBytesBinding(raw)
	source.Resource.Revision = "73" // independent Source revision, not snapshot
	r := OriginalShopTaskOrderResponse{Projection: p, Source: source, AuthScope: authgrant.EgressOnlyReadFence}
	before := transitionDomainSnapshot(t, s)
	got, err := encodeOriginalShopOrderDATA(r)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got.SourceBytes, raw) || got.DeclaredSource.Resource.Rev != "73" || got.Projection.Snapshot != p.Snapshot || !got.DataOnly || got.SourceVerified || got.OperationVerified {
		t.Fatal("original snapshot/ref/bytes or DATA-only boundary lost", got)
	}
	decoded, err := openprotocol.DecodeShopOrderReadResponseDATA(got.ResponseOriginal, openprotocol.ShopOrderReadExpectedResponseDATA{
		Selection: openprotocol.ShopOrderReadSelection{OrderID: o.ID, Fields: fields, Snapshot: p.Snapshot}, Source: got.DeclaredSource,
	})
	if err != nil || !reflect.DeepEqual(decoded.Projection.Data, stringsOnly) || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
		t.Fatal("actual SDK response round trip or original Store changed", err)
	}
	for _, hidden := range []string{o.Buyer, o.Address.Line1, o.InvoiceID} {
		if hidden != "" && bytes.Contains(got.SourceBytes, []byte(hidden)) {
			t.Fatal("unselected order data escaped")
		}
	}
}

func TestShopTaskOrderSourceMismatchStopsBeforeEnvelopeAndAttester(t *testing.T) {
	s, _, p, v, c, body := publicShopTaskFixture(t)
	bad := taskOrderBytesBinding([]byte(`{"status":"fabricated"}`))
	c.call.Binding.Sources[0].Binding = bad
	v.source.snapshot.Grant.Binding.Sources[0].Binding = bad
	v.source.snapshot.Sources[0].Binding = bad
	w := shopTaskRequest(t, s, p, body)
	if w.Code != 409 || c.encodes != 0 || v.attests != 0 || v.source.closed != 1 || v.responseClosed != 1 {
		t.Fatal("declared hash substituted actual resource before attestation", w.Code, c.encodes, v.attests)
	}
}

func TestShopTaskOrderSourceRejectsExpandedOrNonStringProjection(t *testing.T) {
	for _, fault := range []string{"extra-field", "missing-field", "numeric-money", "time-in-money", "wrong-id", "wrong-revision", "unsupported-field"} {
		t.Run(fault, func(t *testing.T) {
			s, o, _, _, c, _ := publicShopTaskFixture(t)
			p, err := s.ReadScopedOrder(o.Buyer, "buyer", o.ID, c.call.Binding.Fields, "")
			if err != nil {
				t.Fatal(err)
			}
			r := OriginalShopTaskOrderResponse{Projection: p, Source: c.call.Binding.Sources[0], AuthScope: authgrant.EgressOnlyReadFence}
			switch fault {
			case "extra-field":
				r.Projection.Data["buyer"] = o.Buyer
			case "missing-field":
				delete(r.Projection.Data, "status")
			case "numeric-money":
				r.Projection.Data["totalYNXT"] = int64(25)
			case "time-in-money":
				r.Projection.Data["totalYNXT"] = time.Now()
			case "wrong-id":
				r.Source.Resource.ID = "other-order"
			case "wrong-revision":
				r.Source.Resource.Revision = ""
			case "unsupported-field":
				r.Projection.Fields = []string{"buyer"}
				r.Source.Fields = []string{"buyer"}
				r.Projection.Data = map[string]any{"buyer": o.Buyer}
			}
			got, err := encodeOriginalShopOrderDATA(r)
			if err == nil || len(got.ResponseOriginal) != 0 || (!errors.Is(err, ErrConflict) && !errors.Is(err, ErrInvalidState)) {
				t.Fatal("invalid resource projection escaped", got, err)
			}
		})
	}
}
