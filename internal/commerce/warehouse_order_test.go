package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Settlement, roles and HTTP nonce in these controls are PUBLIC fixtures.
// They verify product warehouse persistence, not actual Pay/funds acceptance.
func TestWarehouseEffectsRequireRetainedOriginalSettlement(t *testing.T) {
	for _, mode := range []string{"ship-missing", "stock-missing", "stock-wrong"} {
		t.Run(mode, func(t *testing.T) {
			s, o, owner, _, returnID := returnFixture(t, true)
			var receiptID string
			if mode != "ship-missing" {
				got, err := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "warehouse-proof-original", "warehouse-proof-receive", 1))
				if err != nil {
					t.Fatal(err)
				}
				receiptID = got.ReturnReceipts[0].ID
			}
			current := cloneOrder(s.s.Orders[o.ID])
			if mode == "stock-wrong" {
				current.Settlement.AmountYNXT++
			} else {
				current.Settlement = nil
			}
			if mode == "ship-missing" {
				current.Status = "paid"
				current.Shipment = nil
			}
			s.s.Orders[o.ID] = current
			before := transitionDomainSnapshot(t, s)
			var err error
			if mode == "ship-missing" {
				_, err = s.transition(owner, "seller", o.ID, "shipped", &Shipment{Carrier: "PUBLIC carrier", TrackingNumber: "PUBLIC tracking"}, nil, nil, "warehouse-proof-ship")
			} else {
				_, err = s.RestockReturn(owner, o.ID, RestockReturnInput{receiptID, "warehouse-proof-stock"})
			}
			if err == nil || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
				t.Fatal("missing/mismatched original settlement admitted warehouse effect", err)
			}
		})
	}
}

func TestWarehouseOrderBoundedReadCurrentRoleAndDetachedQuantities(t *testing.T) {
	s, o, owner, buyer, returnID := returnFixture(t, true)
	_, inventory := actor(t, 234)
	acceptSellerRole(t, s, owner, o.StoreID, inventory, SellerRoleInventory)
	got, err := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "warehouse-view-original", "warehouse-view-receive", 1))
	if err != nil {
		t.Fatal(err)
	}
	view, err := s.ReadWarehouseOrder(inventory, o.ID)
	if err != nil || len(view.Lines) != 1 || view.Lines[0].ReceivedQuantity != "1" || view.Lines[0].RemainingQuantity != "1" || len(view.Receipts) != 1 || view.Receipts[0].Restocked || !view.QueryOnly || view.FundsVerified {
		t.Fatal(view, err)
	}
	view.Receipts[0].Items[0].Quantity = "200"
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: inventory, role: "seller"}})
	w := businessHTTPRequest(server, "POST", "/api/seller/orders/"+o.ID+"/warehouse", strings.Repeat("w", 43), `{}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, forbidden := range []string{"Buyer", "Address", "Settlement", "TotalYNXT", "Refund", "ReceivedBy", "RestockedBy"} {
		if bytes.Contains(w.Body.Bytes(), []byte(`"`+forbidden+`"`)) {
			t.Fatal("private/financial/raw actor fields escaped bounded view", forbidden)
		}
	}
	if _, err := s.ReadWarehouseOrder(buyer, o.ID); err == nil {
		t.Fatal("buyer read Seller warehouse data")
	}
	if _, _, err := s.RevokeSellerRole(owner, o.StoreID, inventory, "PUBLIC warehouse read revoke"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadWarehouseOrder(inventory, o.ID); err == nil {
		t.Fatal("revoked role read warehouse data")
	}
	reopened, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	view, err = reopened.ReadWarehouseOrder(owner, o.ID)
	if err != nil || view.Receipts[0].Items[0].Quantity != "1" || view.Receipts[0].ReceiptID != got.ReturnReceipts[0].ID {
		t.Fatal("warehouse view rewrote original receipt", err)
	}
}

func TestWarehouseCompletedRestockReadbackDoesNotRepeatEffectAfterProofLoss(t *testing.T) {
	s, o, owner, _, returnID := returnFixture(t, true)
	got, err := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "warehouse-completed-original", "warehouse-completed-receive", 1))
	if err != nil {
		t.Fatal(err)
	}
	in := RestockReturnInput{got.ReturnReceipts[0].ID, "warehouse-completed-stock"}
	if _, err = s.RestockReturn(owner, o.ID, in); err != nil {
		t.Fatal(err)
	}
	current := cloneOrder(s.s.Orders[o.ID])
	current.Settlement = nil
	s.s.Orders[o.ID] = current
	before := transitionDomainSnapshot(t, s)
	if _, err = s.RestockReturn(owner, o.ID, in); err != nil || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
		t.Fatal("original completion became new stock mutation or unreadable", err)
	}
	in.IdempotencyKey = "replacement-stock-request"
	if _, err = s.RestockReturn(owner, o.ID, in); err == nil || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
		t.Fatal("proof loss admitted replacement stock effect", err)
	}
}

func TestWarehouseCLIActualHTTPPartialReceiveSeparateRestockAndColdRecovery(t *testing.T) {
	fixture := os.Getenv("YNX_SHOP_WAREHOUSE_CLI_FIXTURE")
	if fixture == "" {
		t.Skip("original Native CI supplies official SDK-bundled PUBLIC warehouse driver")
	}
	s, o, owner, _, returnID := returnFixture(t, true)
	journal := filepath.Join(t.TempDir(), "PUBLIC-warehouse-identities.json")
	beforeSettlement := *o.Settlement
	beforeRefund := o.RefundStatus
	receive := receiveInput(o, returnID, "warehouse-cli-original", "unused-native-journal-generates-key", 1)
	body := map[string]any{"ReturnID": receive.ReturnID, "EvidenceReference": receive.EvidenceReference, "Items": receive.Items}
	drive := func(command string, input any) map[string]json.RawMessage {
		t.Helper()
		server := httptest.NewServer(NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}}).Handler())
		defer server.Close()
		wire, _ := json.Marshal(map[string]any{"command": command, "orderID": o.ID, "storeID": o.StoreID, "body": input, "actor": owner, "journal": journal, "origin": server.URL})
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", fixture)
		cmd.Stdin = bytes.NewReader(wire)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("actual warehouse CLI process: %v %s", err, out)
		}
		var result map[string]json.RawMessage
		if json.Unmarshal(out, &result) != nil {
			t.Fatal(string(out))
		}
		return result
	}
	if string(drive("receive", body)["unknown"]) != "true" {
		t.Fatal("original receive loss not retained")
	}
	var err error
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	received := drive("recover-receive", body)
	var receipt struct{ Receipt WarehouseReceipt }
	if json.Unmarshal(received["result"], &receipt) != nil || receipt.Receipt.ReceiptID == "" || receipt.Receipt.Restocked {
		t.Fatal("original partial receipt not recovered", received)
	}
	p := s.s.Products[o.Lines[0].ProductID]
	if p.Variants[0].Inventory != 3 {
		t.Fatal("receiving goods automatically restocked")
	}
	stock := map[string]string{"ReceiptID": receipt.Receipt.ReceiptID}
	if string(drive("restock", stock)["unknown"]) != "true" {
		t.Fatal("stock loss not retained")
	}
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	stocked := drive("recover-restock", stock)
	if json.Unmarshal(stocked["result"], &receipt) != nil || !receipt.Receipt.Restocked {
		t.Fatal("original stock result not recovered")
	}
	current := s.s.Orders[o.ID]
	p = s.s.Products[o.Lines[0].ProductID]
	if p.Variants[0].Inventory != 4 || len(current.ReturnReceipts) != 1 || current.ReturnReceipts[0].Items[0].Quantity != "1" || *current.Settlement != beforeSettlement || current.RefundStatus != beforeRefund || current.Refund != nil || current.Status != o.Status {
		t.Fatal("cold warehouse workflow duplicated stock or changed funds/status")
	}
	if len(s.s.BusinessNonces) != 4 {
		t.Fatal("not exactly two writes and two original lookups")
	}
}
