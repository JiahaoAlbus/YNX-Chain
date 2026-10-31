package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
)

func TestP08ShopSDKInputUnicodeAndOriginalSchema(t *testing.T) {
	if !bytes.Equal(open.ShopOrderReadInputSchemaDATA(), shopOrderRegisteredInputSchema) {
		t.Fatal("registered schema differs from original SDK/P07 bytes")
	}
	snapshot := strings.Repeat("a", 128)
	for _, id := range []string{`"\ud800"`, `"\udfff"`, `"\ud800x"`} {
		raw := []byte(fmt.Sprintf(`{"orderId":%s,"fields":["status","currency"],"snapshot":"%s"}`, id, snapshot))
		before := bytes.Clone(raw)
		if _, _, err := canonicalShopOrderInput(raw); err == nil || !bytes.Equal(raw, before) {
			t.Fatal("invalid Unicode repaired before signing")
		}
	}
	for _, id := range []string{`"\ud83d\ude80"`, `"\ufffd"`, `"\\ud800"`, `"<>&\u2028"`} {
		raw := []byte(fmt.Sprintf(`{"orderId":%s,"fields":["status","currency"],"snapshot":"%s"}`, id, snapshot))
		_, canonical, err := canonicalShopOrderInput(raw)
		if err != nil {
			t.Fatalf("valid original Unicode rejected: %s %v", id, err)
		}
		if _, err = open.DecodeShopOrderReadInputDATA(canonical); err != nil {
			t.Fatal(err)
		}
	}
	raw := []byte(fmt.Sprintf(`{"OrderID":"original","fields":["currency","status"],"snapshot":"%s"}`, snapshot))
	if _, _, err := canonicalShopOrderInput(raw); err == nil {
		t.Fatal("alternate-cased SDK field accepted")
	}
}

func TestP08ShopSDKResponseMediaAndBounds(t *testing.T) {
	f := newP08ShopFixture(t, false)
	decoded := false
	f.codec.onDecode = func() { decoded = true }
	for _, ct := range []string{"application/cbor", "application/json; charset=utf-8", "Application/JSON", "application/vnd.ynx.shop-order-read.v1"} {
		if _, err := f.bridge.acceptResult(context.Background(), f.store, taskEffectCall{}, OriginalShopOrderCall{}, OriginalShopOrderTransportResult{Body: []byte(`{}`), ContentType: ct}); err == nil || decoded {
			t.Fatal("wrong response MIME reached a verifier")
		}
	}
	selected := taskShopOrderInput{OrderID: "original", Snapshot: strings.Repeat("a", 128), Fields: []string{"status"}}
	raw, _ := json.Marshal(taskShopOrderProjection{OrderID: selected.OrderID, Snapshot: selected.Snapshot, Fields: selected.Fields, Data: map[string]json.RawMessage{"status": json.RawMessage(`"` + strings.Repeat("a", 200<<10) + `"`)}})
	if err := validateShopProjection(raw, selected); err != nil {
		t.Fatal("SDK-sized projection retained stale 128KiB/private 4KiB limit", err)
	}
	raw = append(raw, bytes.Repeat([]byte(" "), 1<<20)...)
	if err := validateShopProjection(raw, selected); err == nil {
		t.Fatal("SDK 1MiB projection boundary bypassed")
	}
}
