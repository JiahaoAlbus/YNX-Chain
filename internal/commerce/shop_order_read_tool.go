package commerce

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"io"
	"sort"
	"unicode/utf8"

	authgrant "ynx.local/authgrantpolicy"
)

// ShopOrderReadDescription is tool catalogue DATA, not registration or authority.
// An original Shop status alone does not establish qualified V5 payment finality.
const ShopOrderReadDescription = "Read only the selected original Shop order fields and exact snapshot. Shop status is a product projection; payment finality requires independently qualified Pay/Chain evidence. Model/external disclosure requires its own authorization."

//go:embed shop_order_read.input.schema.json
var shopOrderReadInputSchema []byte

// ShopOrderReadInputSchema returns owned bytes for original SDK registration.
// This is Shop's TOOL ARGUMENT schema, not a Grant/SourceRef/SourceSet schema.
func ShopOrderReadInputSchema() []byte { return append([]byte(nil), shopOrderReadInputSchema...) }

func ShopOrderReadToolDescriptor() authgrant.Tool {
	return authgrant.Tool{ID: shopOrderReadOperation, Version: "1", Operation: shopOrderReadOperation, Purpose: "read-selected-shop-order", Risk: "read", Schema: taskOrderBytesBinding(shopOrderReadInputSchema)}
}

type ShopOrderReadSelection struct {
	OrderID  string   `json:"orderId"`
	Fields   []string `json:"fields"`
	Snapshot string   `json:"snapshot"`
}

// DecodeShopOrderReadSelection parses only this product's tool arguments AFTER
// the original SDK extracts the exact input bytes. No authority/proof/Source is
// decoded here. Duplicate/alternate keys, trailing values and implicit fields
// are refused, keeping the same exact bytes bound by both shared digests.
func DecodeShopOrderReadSelection(raw []byte) (ShopOrderReadSelection, error) {
	var in ShopOrderReadSelection
	bad := func() (ShopOrderReadSelection, error) { return ShopOrderReadSelection{}, ErrInvalidState }
	if len(raw) == 0 || len(raw) > 32<<10 || !utf8.Valid(raw) {
		return bad()
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return bad()
	}
	seen := make(map[string]bool)
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return bad()
		}
		key, ok := token.(string)
		if !ok || seen[key] {
			return bad()
		}
		seen[key] = true
		switch key {
		case "orderId":
			err = d.Decode(&in.OrderID)
		case "fields":
			err = d.Decode(&in.Fields)
		case "snapshot":
			err = d.Decode(&in.Snapshot)
		default:
			return bad()
		}
		if err != nil {
			return bad()
		}
	}
	token, err = d.Token()
	if err != nil || token != json.Delim('}') || d.Decode(&struct{}{}) != io.EOF || len(seen) != 3 {
		return bad()
	}
	if len(in.OrderID) == 0 || len(in.OrderID) > 256 || len(in.Fields) == 0 || len(in.Fields) > 9 || !sort.StringsAreSorted(in.Fields) || len(in.Snapshot) != 128 {
		return bad()
	}
	for _, c := range in.Snapshot {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return bad()
		}
	}
	previous := ""
	for _, field := range in.Fields {
		if field == previous {
			return bad()
		}
		previous = field
		switch field {
		case "createdAt", "currency", "reservationExpiresAt", "shippingYNXT", "status", "subtotalYNXT", "taxYNXT", "totalYNXT", "updatedAt":
		default:
			return bad()
		}
	}
	return in, nil
}
