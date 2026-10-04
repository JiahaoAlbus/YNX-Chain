package quantlab

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgreSQLPaperReceiptObservationIsReadOnlyAndOwnerIsolated(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if url == "" {
		t.Skip("isolated PostgreSQL required; file tests are separate evidence")
	}
	namespace := fmt.Sprintf("receipt-observation-qa-%d", time.Now().UnixNano())
	cfg := Config{DatabaseURL: url, StateNamespace: namespace, StatePath: filepath.Join(t.TempDir(), "unused.json")}
	server, err := NewTenantServer(cfg, "all")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	db := server.baseService.store.(*postgresStateStore).db
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DELETE FROM ynx_quant_state WHERE state_key = $1 OR state_key LIKE $2`, namespace, namespace+":%")
		if err != nil {
			t.Error(err)
		}
	})
	state := func() string {
		t.Helper()
		rows, err := db.QueryContext(context.Background(), `SELECT state_key,revision,payload::text FROM ynx_quant_state WHERE state_key = $1 OR state_key LIKE $2 ORDER BY state_key`, namespace, namespace+":%")
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var result strings.Builder
		for rows.Next() {
			var key, payload string
			var revision int64
			if err := rows.Scan(&key, &revision, &payload); err != nil {
				t.Fatal(err)
			}
			fmt.Fprintf(&result, "%s:%d:%s\n", key, revision, payload)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result.String()
	}
	before := state()
	for range 3 {
		if _, err := server.existingPaperReceiptWorkspace("owner-a"); err != ErrUnavailable {
			t.Fatalf("missing mapping err=%v", err)
		}
	}
	if state() != before || server.paperMappings != nil || len(server.servers) != 0 {
		t.Fatal("missing lookup allocated mapping/tenant/cache")
	}
	mapping, err := server.paperMappingStore()
	if err != nil {
		t.Fatal(err)
	}
	a := paperWorkspaceBinding{Account: "owner-a", TenantID: hash("owner-a"), CreatedAt: mapping.cfg.Now()}
	mapping.state.PaperWorkspaceBindings = map[string]paperWorkspaceBinding{}
	mapping.state.PaperWorkspaceBindings[hashBytes([]byte("YNX Quant Paper workspace v1\x00owner-a"))] = a
	if err := mapping.save(); err != nil {
		t.Fatal(err)
	}
	before = state()
	if _, err := server.existingPaperReceiptWorkspace("owner-a"); err != ErrUnavailable {
		t.Fatalf("missing tenant err=%v", err)
	}
	if state() != before || len(server.servers) != 0 {
		t.Fatal("receipt lookup enrolled missing tenant")
	}
	const key = "quant-native-paper-11111111-1111-4111-8111-111111111111"
	for _, owner := range []string{"owner-a", "owner-b"} {
		workspace, err := server.paperWorkspace(owner)
		if err != nil {
			t.Fatal(err)
		}
		workspace.state.Paper.Orders = []PaperOrder{{ID: owner + "-original-receipt", IdempotencyKey: key}}
		if err := workspace.save(); err != nil {
			t.Fatal(err)
		}
	}
	before = state()
	// Independent server instance and then a second launch must SELECT the
	// original receipts without enrollment, mutation, audit or tenant caching.
	for range 2 {
		reader, err := NewTenantServer(cfg, "all")
		if err != nil {
			t.Fatal(err)
		}
		for _, owner := range []string{"owner-a", "owner-b"} {
			workspace, err := reader.existingPaperReceiptWorkspace(owner)
			if err != nil {
				t.Fatal(err)
			}
			receipt, err := workspace.savedPaperOrderReceipt(httptest.NewRequest("GET", "/v1/wallet/paper/order-receipt?key="+key, nil))
			if err != nil || receipt.ID != owner+"-original-receipt" {
				t.Fatalf("cross-owner receipt=%+v err=%v", receipt, err)
			}
		}
		if _, err := reader.existingPaperReceiptWorkspace("owner-c"); err != ErrUnavailable {
			t.Fatalf("foreign owner err=%v", err)
		}
		if state() != before || reader.paperMappings != nil || len(reader.servers) != 0 {
			t.Fatal("observation wrote durable state or enrolled/cache")
		}
		if err := reader.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
