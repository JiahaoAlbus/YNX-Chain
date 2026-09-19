//go:build weekly_v3_integration

package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func weeklyRecoveryVectors(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(os.Getenv("WEEKLY_RECOVERY_FIXTURES"))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestWeeklyV3PagedPollFindsUnknownAfter500AndRestart(t *testing.T) {
	server, _, statePath, now := weeklyServer(t)
	challenge := weeklyApproved(t, server)
	adapter, provider := weeklyAlpaca(t, true)
	dispatcher := BrokerDispatcher{Store: server.service.Store, Adapter: adapter, Now: func() time.Time { return now }}
	record, err := dispatcher.Dispatch(context.Background(), testAccount, challenge.Unsigned.Order.OrderID)
	if err == nil || record.State != "submitted_unknown" {
		t.Fatalf("expected real lost ACK: %+v %v", record, err)
	}
	vectors := weeklyRecoveryVectors(t)
	var first, second []map[string]any
	if err := json.Unmarshal(vectors["firstPage"], &first); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(vectors["secondPage"], &second); err != nil {
		t.Fatal(err)
	}
	provider.mu.Lock()
	second[0]["client_order_id"] = challenge.Unsigned.Order.OrderID
	second[0]["id"] = provider.order["id"]
	provider.pages = [][]map[string]any{first, second}
	provider.mu.Unlock()
	reopened, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	dispatcher.Store = reopened
	snapshot, err := dispatcher.Reconcile(context.Background(), testAccount)
	if err != nil || len(snapshot.Orders) != 501 {
		t.Fatalf("paged reconciliation: count=%d err=%v", len(snapshot.Orders), err)
	}
	workspace := reopened.BrokerWorkspace(testAccount, now)
	if len(workspace.Orders) != 1 || workspace.Orders[0].State != "submitted" || workspace.Orders[0].ProviderOrderID == "" {
		t.Fatalf("unknown target beyond page one not recovered: %+v", workspace)
	}
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.posts != 1 || provider.deletes != 0 || provider.pageReads != 2 {
		t.Fatalf("paging replayed a write: post=%d delete=%d pages=%d", provider.posts, provider.deletes, provider.pageReads)
	}
}

func weeklyEventVector(t *testing.T, envelope map[string]any) ([]brokerage.TradeEvent, string) {
	t.Helper()
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	events, cursor, err := brokerage.ParseTradeEventStream(strings.NewReader(fmt.Sprintf("id: %s\nevent: trade_updates\ndata: %s\n\n", envelope["event_id"], raw)), "01234567-89ab-4cde-8fab-0123456789ab", 10)
	if err != nil {
		t.Fatal(err)
	}
	return events, cursor
}

func TestWeeklyV3IndependentCursorsSameTimeResumeAndTenantFence(t *testing.T) {
	server, _, statePath, now := weeklyServer(t)
	challenges := []BrokerApprovalChallenge{weeklyApproved(t, server), weeklyApproved(t, server)}
	vectors := weeklyRecoveryVectors(t)
	var envelopes []map[string]any
	if err := json.Unmarshal(vectors["sameTimeDifferentOrders"], &envelopes); err != nil {
		t.Fatal(err)
	}
	for index := range envelopes {
		envelopes[index]["order"].(map[string]any)["client_order_id"] = challenges[index].Unsigned.Order.OrderID
		if _, err := server.service.Store.ClaimBrokerDispatch(testAccount, challenges[index].Unsigned.Order.OrderID, now); err != nil {
			t.Fatal(err)
		}
	}
	first, cursor := weeklyEventVector(t, envelopes[0])
	if err := server.service.Store.ApplyBrokerTradeEvents(testAccount, first, cursor, now); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Account(testAccount).Brokerage.EventCursor != cursor {
		t.Fatal("provider cursor lost at restart")
	}
	second, next := weeklyEventVector(t, envelopes[1])
	if err := reopened.ApplyBrokerTradeEvents(testAccount, second, next, now); err != nil {
		t.Fatalf("same-time independent order after restart rejected: %v", err)
	}
	snapshot := brokerage.AccountSnapshot{RequestIDs: []string{"public-fixture-poll"}, Orders: []brokerage.Order{first[0].Order, second[0].Order}}
	if err := reopened.ApplyBrokerReconciliation(testAccount, snapshot, now); err != nil {
		t.Fatal(err)
	}
	state := reopened.Account(testAccount).Brokerage
	if state.EventCursor != next || !strings.HasPrefix(state.ReconcileCheckpoint, "reconcile_") {
		t.Fatalf("poll overwrote provider cursor: %+v", state)
	}
	before, _ := os.ReadFile(statePath)
	if err := reopened.ApplyBrokerTradeEvents(testAccount, first, cursor, now); err == nil {
		t.Fatal("old duplicate event was accepted")
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("duplicate changed persisted state")
	}
	foreign := append([]brokerage.TradeEvent(nil), second...)
	foreign[0].ProviderAccountID = "11234567-89ab-4cde-8fab-0123456789ab"
	foreign[0].Cursor = "01K5G3YEKRXAXKDZK3AABK68T9"
	if err := reopened.ApplyBrokerTradeEvents(testAccount, foreign, foreign[0].Cursor, now); err == nil {
		t.Fatal("cross-user provider event accepted")
	}
	after, _ = os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("cross-user rejection changed state")
	}
	server.service.Store = reopened
	r := httptest.NewRequest("GET", "/api/broker/recovery", nil)
	r.Header.Set(productsessionv2.ProofHeader, "finance.portfolio.read")
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), next) || !strings.Contains(w.Body.String(), state.ReconcileCheckpoint) {
		t.Fatalf("owner recovery route: %d %s", w.Code, w.Body.String())
	}
	missing := httptest.NewRecorder()
	server.Handler().ServeHTTP(missing, httptest.NewRequest("GET", "/api/broker/recovery", nil))
	if missing.Code == 200 || strings.Contains(missing.Body.String(), next) {
		t.Fatal("recovery leaked without product authority")
	}
	other := httptest.NewRecorder()
	server.brokerRecovery(other, r, Session{Account: "ynx1z5y9l6c6mp7eduxhn7d7p0tytpawsp5dfpjzsd"})
	if strings.Contains(other.Body.String(), next) || strings.Contains(other.Body.String(), state.ReconcileCheckpoint) {
		t.Fatal("other owner received recovery checkpoints")
	}
}

func TestWeeklyV3QuoteWireStateAndExecutionFence(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		age     time.Duration
		status  int
		display string
		submit  bool
	}{
		{"fresh", 0, 0, "real_time", true},
		{"delayed_not_stale", time.Minute, 0, "delayed", true},
		{"too_old_for_execution", 121 * time.Second, 0, "delayed", false},
		{"stale", time.Hour, 0, "stale", false},
		{"future", -time.Minute, 0, "stale", false},
		{"unentitled", 0, 403, "", false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			server, _, _, now := weeklyServer(t)
			challenge := weeklyApproved(t, server)
			adapter, provider := weeklyAlpaca(t, false)
			provider.quoteTimestamp = now.Add(-scenario.age).Format(time.RFC3339Nano)
			provider.quoteHTTPStatus = scenario.status
			server.broker = adapter
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/broker/quote?symbol=ACME", nil))
			if scenario.status == 0 {
				var result map[string]any
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if w.Code != 200 || result["quoteState"] != scenario.display || result["officialSandboxVerified"] != false {
					t.Fatalf("quote truth %d %s", w.Code, w.Body.String())
				}
			} else if w.Code == 200 {
				t.Fatal("missing entitlement produced quote")
			}
			dispatcher := BrokerDispatcher{Store: server.service.Store, Adapter: adapter, Now: func() time.Time { return now }}
			_, err := dispatcher.Dispatch(context.Background(), testAccount, challenge.Unsigned.Order.OrderID)
			provider.mu.Lock()
			defer provider.mu.Unlock()
			if scenario.submit {
				if err != nil || provider.posts != 1 {
					t.Fatalf("fresh quote failed: %v posts=%d", err, provider.posts)
				}
			} else if err == nil || provider.posts != 0 {
				t.Fatalf("unsafe quote submitted: %v posts=%d", err, provider.posts)
			}
		})
	}
}
