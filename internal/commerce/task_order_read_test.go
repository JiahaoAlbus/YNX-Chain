package commerce

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestShopTaskOrderReadZeroPreparedCannotOpenOriginalStore(t *testing.T) {
	for _, profile := range []*PreparedOriginalShopTaskOrders{nil, {}} {
		opens := 0
		server, err := profile.OpenOriginal(context.Background(), func() (*Store, error) { opens++; return Open("") }, ServerConfig{})
		if !errors.Is(err, ErrUnavailable) || server != nil || opens != 0 {
			t.Fatal("zero task profile opened original state", server, err, opens)
		}
	}
}

func TestShopTaskOrderReadSelectionIsExactDataNotAuthority(t *testing.T) {
	valid := `{"orderId":"order-original","fields":["currency","status"],"snapshot":"` + strings.Repeat("a", 128) + `"}`
	in, err := DecodeShopOrderReadSelection([]byte(valid))
	if err != nil || in.OrderID != "order-original" || len(in.Fields) != 2 {
		t.Fatal(in, err)
	}
	for _, invalid := range []string{
		strings.Replace(valid, `"fields":["currency","status"]`, `"fields":["status","currency"]`, 1),
		strings.Replace(valid, `"fields":["currency","status"]`, `"fields":["status","status"]`, 1),
		strings.Replace(valid, `"fields":["currency","status"]`, `"fields":["address"]`, 1),
		strings.Replace(valid, `"orderId":`, `"OrderID":`, 1),
		strings.Replace(valid, `"orderId":"order-original"`, `"orderId":"order-original","orderId":"order-other"`, 1),
		strings.Replace(valid, `"orderId":"order-original"`, `"orderId":"order-original","approved":true`, 1),
		strings.Replace(valid, `"fields":["currency","status"]`, `"fields":[]`, 1),
		valid + `{}`,
	} {
		if _, err := DecodeShopOrderReadSelection([]byte(invalid)); !errors.Is(err, ErrInvalidState) {
			t.Fatal("invalid tool data accepted", invalid, err)
		}
	}
	schema := ShopOrderReadInputSchema()
	schema[0] = 'X'
	if ShopOrderReadInputSchema()[0] != '{' || ShopOrderReadToolDescriptor().Schema != taskOrderBytesBinding(ShopOrderReadInputSchema()) {
		t.Fatal("catalogue argument bytes were mutable or hashed differently")
	}
}
