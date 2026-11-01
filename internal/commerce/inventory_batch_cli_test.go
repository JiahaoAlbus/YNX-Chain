package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestInventoryBatchCLIActualHTTPLostReplyColdProcessAndStore(t *testing.T) {
	fixture := os.Getenv("YNX_SHOP_INVENTORY_CLI_FIXTURE")
	if fixture == "" {
		t.Skip("official SDK-bundled PUBLIC CLI integration driver supplied by original Native CI")
	}
	s, owner, in := inventoryBatchFixture(t)
	journal := filepath.Join(t.TempDir(), "PUBLIC-cli-identities.json")
	body := map[string]any{"StoreID": in.StoreID, "Items": in.Items}
	server := httptest.NewServer(NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}}).Handler())
	t.Cleanup(server.Close)
	drive := func(command, origin string) map[string]json.RawMessage {
		t.Helper()
		input, _ := json.Marshal(map[string]any{"command": command, "origin": origin, "actor": owner, "body": body, "journal": journal})
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", fixture)
		cmd.Stdin = bytes.NewReader(input)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("actual CLI process: %v %s", err, out)
		}
		var result map[string]json.RawMessage
		if json.Unmarshal(out, &result) != nil {
			t.Fatalf("actual CLI output: %s", out)
		}
		return result
	}
	first := drive("apply", server.URL)
	server.Close()
	if string(first["unknown"]) != "true" || string(first["remaining"]) != "1" {
		t.Fatal("original CLI UNKNOWN not durable", first)
	}
	if len(s.s.BusinessNonces) != 1 {
		t.Fatal("not exactly one original write")
	}
	item := in.Items[0]
	if _, err := s.SetInventory(owner, InventoryInput{StoreID: in.StoreID, ProductID: item.ProductID, VariantID: item.VariantID, Inventory: 99, IdempotencyKey: "separate-stock-after-cli"}); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	server = httptest.NewServer(NewServer(reopened, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}}).Handler())
	defer server.Close()
	second := drive("recover", server.URL)
	if string(second["recovered"]) != "true" || string(second["remaining"]) != "0" {
		t.Fatal("actual cold CLI did not finish original lookup", second)
	}
	if len(reopened.s.BusinessNonces) != 2 || reopened.s.Products[item.ProductID].Variants[0].Inventory != 99 {
		t.Fatal("recovery resent or reapplied old stock")
	}
	if len(reopened.s.Orders) != 0 {
		t.Fatal("inventory command manufactured order/funds")
	}
}
