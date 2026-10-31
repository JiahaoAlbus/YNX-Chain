package commerce

import (
	"time"

	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
)

// encodeOriginalShopOrderDATA freezes only the fields read from the original
// locked order. The SDK owns canonical bytes. Its DATA-only result is never an
// attested response, a Source admission, or an original-operation receipt.
func encodeOriginalShopOrderDATA(r OriginalShopTaskOrderResponse) (openprotocol.ShopOrderReadResponseDATA, error) {
	var zero openprotocol.ShopOrderReadResponseDATA
	p := r.Projection
	data := make(map[string]string, len(p.Data))
	for name, value := range p.Data {
		switch v := value.(type) {
		case string:
			data[name] = v
		case time.Time:
			if name != "createdAt" && name != "updatedAt" && name != "reservationExpiresAt" {
				return zero, ErrInvalidState
			}
			// Match the original order JSON timestamp, retaining nanoseconds and
			// its offset. Do not parse/reformat money through floating point.
			raw, err := v.MarshalJSON()
			if err != nil {
				return zero, ErrInvalidState
			}
			data[name] = string(raw[1 : len(raw)-1])
		default:
			return zero, ErrInvalidState
		}
	}
	ref := r.Source.Resource
	source := openprotocol.ShopOrderReadDeclaredSourceDATA{
		Resource: openprotocol.LegacyGrantRefV1{Realm: ref.Realm, Tenant: ref.Tenant, Kind: ref.Kind, ID: ref.ID, Rev: ref.Revision},
		Fields:   append([]string(nil), r.Source.Fields...), Label: r.Source.Label,
		Binding: openprotocol.GrantBindV1{Bytes: r.Source.Binding.Bytes, SHA3_512: r.Source.Binding.SHA3_512, SHA512: r.Source.Binding.SHA512},
	}
	value := openprotocol.ShopOrderReadResponseValueDATA{
		Version: "1", Profile: openprotocol.ShopOrderReadResultProfile,
		Projection: openprotocol.ShopOrderReadProjectionDATA{OrderID: p.OrderID, Snapshot: p.Snapshot, Fields: append([]string(nil), p.Fields...), Data: data},
		Source:     source, AuthFence: string(r.AuthScope),
	}
	encoded, err := openprotocol.EncodeShopOrderReadResponseDATA(value, openprotocol.ShopOrderReadExpectedResponseDATA{
		Selection: openprotocol.ShopOrderReadSelection{OrderID: p.OrderID, Fields: append([]string(nil), p.Fields...), Snapshot: p.Snapshot}, Source: source,
	})
	if err != nil {
		return zero, ErrConflict
	}
	return encoded, nil
}
