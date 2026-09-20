package finance

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBrokerActivationReadinessReadsExistingStateWithoutMutation(t *testing.T) {
	store, account, _, now := consumedBrokerFixture(t)
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	beforeInfo, err := os.Stat(store.path)
	if err != nil {
		t.Fatal(err)
	}
	readiness, err := InspectBrokerActivationReadiness(context.Background(), store.path, "", account, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) || !beforeInfo.ModTime().Equal(afterInfo.ModTime()) {
		t.Fatal("read-only activation inspection changed the persisted state")
	}
	if readiness.StateBackend != "file-cas-single-host" || !readiness.MappingActive || !readiness.WalletKeyLinked || readiness.ExecutionRequested != 1 || readiness.ApprovedAwaitingExecution != 0 || !readiness.ReadyForWorkerDispatch || readiness.TotalOrders != 1 {
		t.Fatalf("unexpected activation readiness: %+v", readiness)
	}
}

func TestBrokerActivationReadinessFailsClosedOnUnsafeOrMissingState(t *testing.T) {
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	root := t.TempDir()
	missing := filepath.Join(root, "missing.json")
	if _, err := InspectBrokerActivationReadiness(context.Background(), missing, "", account, time.Now()); err == nil {
		t.Fatal("missing state was accepted")
	}
	target := filepath.Join(root, "state.json")
	if err := os.WriteFile(target, []byte(`{"version":2,"accounts":{},"audit":[],"usedWalletNonces":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	symlink := filepath.Join(root, "state-link.json")
	if err := os.Symlink(target, symlink); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectBrokerActivationReadiness(context.Background(), symlink, "", account, time.Now()); err == nil {
		t.Fatal("symlink state was accepted")
	}
	hardlink := filepath.Join(root, "state-hardlink.json")
	if err := os.Link(target, hardlink); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectBrokerActivationReadiness(context.Background(), target, "", account, time.Now()); err == nil || !strings.Contains(err.Error(), "one filesystem link") {
		t.Fatalf("hardlinked state result: %v", err)
	}
}

func TestBrokerActivationReadinessRequiresExactlyOneExecutionRequest(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	state, _, err := decodeFinanceState(raw)
	if err != nil {
		t.Fatal(err)
	}
	accountState := state.Accounts[account]
	secondOrderID := "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
	secondOrder := accountState.Brokerage.Orders[orderID]
	secondOrder.Order.OrderID = secondOrderID
	accountState.Brokerage.Orders[secondOrderID] = secondOrder
	secondOutbox := accountState.Brokerage.Outbox[orderID]
	secondOutbox.OrderID = secondOrderID
	secondOutbox.ExecutionRequestKey = "dispatch-test-request-0002"
	accountState.Brokerage.Outbox[secondOrderID] = secondOutbox
	state.Accounts[account] = accountState
	raw, _, err = encodeFinanceState(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	readiness, err := InspectBrokerActivationReadiness(context.Background(), store.path, "", account, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if readiness.ExecutionRequested != 2 || readiness.ReadyForWorkerDispatch {
		t.Fatalf("multiple execution requests must fail closed: %+v", readiness)
	}
}

func TestBrokerActivationReadinessAllowsOnlyOneEligibleLifecycle(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	state, _, err := decodeFinanceState(raw)
	if err != nil {
		t.Fatal(err)
	}
	accountState := state.Accounts[account]
	secondOrderID := "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
	secondOrder := accountState.Brokerage.Orders[orderID]
	secondOrder.Order.OrderID = secondOrderID
	accountState.Brokerage.Orders[secondOrderID] = secondOrder
	secondOutbox := accountState.Brokerage.Outbox[orderID]
	secondOutbox.OrderID = secondOrderID
	secondOutbox.Status = "pending_unwired"
	secondOutbox.ExecutionRequestKey = ""
	secondOutbox.ExecutionRequestedAt = time.Time{}
	accountState.Brokerage.Outbox[secondOrderID] = secondOutbox
	state.Accounts[account] = accountState
	raw, _, err = encodeFinanceState(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	readiness, err := InspectBrokerActivationReadiness(context.Background(), store.path, "", account, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if readiness.ApprovedAwaitingExecution != 1 || readiness.ExecutionRequested != 1 || readiness.ReadyForExecutionRequest || readiness.ReadyForWorkerDispatch {
		t.Fatalf("mixed eligible lifecycles must fail closed: %+v", readiness)
	}
	firstRequestID := accountState.Brokerage.Orders[orderID].RequestID
	delete(accountState.Brokerage.Orders, orderID)
	delete(accountState.Brokerage.Outbox, orderID)
	delete(accountState.Brokerage.Challenges, firstRequestID)
	state.Accounts[account] = accountState
	raw, _, err = encodeFinanceState(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	readiness, err = InspectBrokerActivationReadiness(context.Background(), store.path, "", account, now.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if readiness.ApprovedAwaitingExecution != 1 || readiness.ExecutionRequested != 0 || !readiness.ReadyForExecutionRequest || readiness.ReadyForWorkerDispatch {
		t.Fatalf("one approved request should enable only execution-request readiness: %+v", readiness)
	}
}

func TestBrokerActivationReadinessReportsLifecycleWithoutCallingPendingTerminal(t *testing.T) {
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	now := time.Date(2026, 9, 20, 4, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "finance.json")
	mapping := BrokerAccountMapping{
		Account:            account,
		Provider:           FinanceOrderProvider,
		TradingEnvironment: FinanceOrderTradingEnv,
		BrokerAccountID:    "01234567-89ab-4cde-8fab-0123456789ab",
		WalletPublicKey:    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
		Status:             "active",
	}
	orderRecord := func(orderID, approvalState, orderState string) BrokerOrderRecord {
		return BrokerOrderRecord{
			Order: FinanceOrderV1{OrderID: orderID}, RequestID: "request-" + orderID,
			ProviderClientOrderID: "client-" + orderID, ApprovalState: approvalState, State: orderState,
		}
	}
	outboxRecord := func(orderID, status, executionKey string) BrokerOrderOutbox {
		return BrokerOrderOutbox{
			OrderID: orderID, RequestID: "request-" + orderID, ProviderClientOrderID: "client-" + orderID,
			Provider: FinanceOrderProvider, TradingEnvironment: FinanceOrderTradingEnv, Status: status,
			ExecutionRequestKey: executionKey, ExecutionRequestedAt: now,
		}
	}
	orders := map[string]BrokerOrderRecord{
		"pending":       orderRecord("pending", "pending", "approval_pending"),
		"approved":      orderRecord("approved", "approved", "approved"),
		"rejected":      orderRecord("rejected", "rejected", "draft"),
		"ready-request": orderRecord("ready-request", "consumed", "submitting"),
		"ready-worker":  orderRecord("ready-worker", "consumed", "submitting"),
		"terminal":      orderRecord("terminal", "consumed", "provider_rejected"),
		"inconsistent":  orderRecord("inconsistent", "consumed", "submitting"),
	}
	outbox := map[string]BrokerOrderOutbox{
		"ready-request": outboxRecord("ready-request", "pending_unwired", ""),
		"ready-worker":  outboxRecord("ready-worker", "execution_requested", "dispatch-test-request-0003"),
		"terminal":      outboxRecord("terminal", "provider_rejected", ""),
		"inconsistent":  outboxRecord("inconsistent", "pending_unwired", "unexpected-valid-key"),
	}
	terminalOutbox := outbox["terminal"]
	terminalOutbox.LastErrorCode = "PROVIDER_REJECTED"
	outbox["terminal"] = terminalOutbox
	writeActivationState := func(orders map[string]BrokerOrderRecord) {
		t.Helper()
		state := persistedState{Version: currentStateVersion, Accounts: map[string]AccountState{
			account: {Brokerage: BrokerageAccountState{
				Mappings: map[string]BrokerAccountMapping{brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv): mapping},
				Orders:   orders, Outbox: outbox,
			}},
		}, Nonces: map[string]time.Time{}}
		raw, _, err := encodeFinanceState(state)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(statePath, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeActivationState(orders)
	readiness, err := InspectBrokerActivationReadiness(context.Background(), statePath, "", account, now)
	if err != nil {
		t.Fatal(err)
	}
	if readiness.ApprovalPending != 1 || readiness.ApprovedAwaitingConsume != 1 || readiness.RejectedOrRevoked != 1 || readiness.ApprovedAwaitingExecution != 1 || readiness.ExecutionRequested != 1 || readiness.Terminal != 1 || readiness.Inconsistent != 1 || readiness.StateConsistent || readiness.ReadyForExecutionRequest || readiness.ReadyForWorkerDispatch {
		t.Fatalf("inconsistent lifecycle was misclassified: %+v", readiness)
	}
	delete(orders, "inconsistent")
	delete(outbox, "inconsistent")
	writeActivationState(orders)
	readiness, err = InspectBrokerActivationReadiness(context.Background(), statePath, "", account, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if !readiness.StateConsistent || readiness.Inconsistent != 0 || readiness.ReadyForExecutionRequest || readiness.ReadyForWorkerDispatch || readiness.Terminal != 1 {
		t.Fatalf("mixed eligible lifecycle was not kept fail closed: %+v", readiness)
	}
}

func TestBrokerActivationReadinessRejectsContradictoryTerminalOutbox(t *testing.T) {
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	now := time.Date(2026, 9, 20, 5, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "finance.json")
	providerOrderID := "01234567-89ab-4cde-8fab-0123456789ab"
	tests := []struct {
		name, orderState, rawStatus, outboxStatus, outboxError, orderProviderID, outboxProviderID string
		consistent                                                                                bool
	}{
		{name: "filled", orderState: "filled", rawStatus: "filled", outboxStatus: "submitted", orderProviderID: providerOrderID, outboxProviderID: providerOrderID, consistent: true},
		{name: "canceled", orderState: "canceled", rawStatus: "canceled", outboxStatus: "submitted", orderProviderID: providerOrderID, outboxProviderID: providerOrderID, consistent: true},
		{name: "expired", orderState: "provider_expired", rawStatus: "expired", outboxStatus: "submitted", orderProviderID: providerOrderID, outboxProviderID: providerOrderID, consistent: true},
		{name: "rejected_without_provider_id", orderState: "provider_rejected", outboxStatus: "provider_rejected", outboxError: "ORDER_APPROVAL_EXPIRED", consistent: true},
		{name: "filled_unknown_outbox", orderState: "filled", rawStatus: "filled", outboxStatus: "dispatching", orderProviderID: providerOrderID, outboxProviderID: providerOrderID},
		{name: "canceled_missing_provider_id", orderState: "canceled", rawStatus: "canceled", outboxStatus: "submitted"},
		{name: "expired_wrong_raw_status", orderState: "provider_expired", rawStatus: "filled", outboxStatus: "submitted", orderProviderID: providerOrderID, outboxProviderID: providerOrderID},
		{name: "rejected_missing_error", orderState: "provider_rejected", outboxStatus: "provider_rejected"},
		{name: "rejected_id_mismatch", orderState: "provider_rejected", outboxStatus: "provider_rejected", outboxError: "PROVIDER_REJECTED", orderProviderID: providerOrderID},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			orderID := "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			state := persistedState{Version: currentStateVersion, Accounts: map[string]AccountState{
				account: {Brokerage: BrokerageAccountState{
					Orders: map[string]BrokerOrderRecord{orderID: {
						Order: FinanceOrderV1{OrderID: orderID}, RequestID: "request-terminal", ProviderClientOrderID: "client-terminal",
						ApprovalState: "consumed", State: test.orderState, ProviderOrderID: test.orderProviderID, ProviderRawStatus: test.rawStatus,
					}},
					Outbox: map[string]BrokerOrderOutbox{orderID: {
						OrderID: orderID, RequestID: "request-terminal", ProviderClientOrderID: "client-terminal", Provider: FinanceOrderProvider,
						TradingEnvironment: FinanceOrderTradingEnv, Status: test.outboxStatus, ProviderOrderID: test.outboxProviderID,
						ProviderRawStatus: test.rawStatus, LastErrorCode: test.outboxError,
					}},
				}},
			}, Nonces: map[string]time.Time{}}
			raw, _, err := encodeFinanceState(state)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(statePath, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			readiness, err := InspectBrokerActivationReadiness(context.Background(), statePath, "", account, now)
			if err != nil {
				t.Fatal(err)
			}
			if test.consistent && (readiness.Terminal != 1 || readiness.Inconsistent != 0 || !readiness.StateConsistent) {
				t.Fatalf("valid terminal state rejected: %+v", readiness)
			}
			if !test.consistent && (readiness.Terminal != 0 || readiness.Inconsistent != 1 || readiness.StateConsistent) {
				t.Fatalf("contradictory terminal state accepted: %+v", readiness)
			}
		})
	}
}

func TestBrokerFeePolicyRejectsUnsafeOrNoncanonicalEvidence(t *testing.T) {
	if err := ValidateBrokerFeePolicy("1.25", "operator_policy", "operator-policy:weekly-v3"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ fee, source, evidence string }{
		{fee: "1.250", source: "operator_policy", evidence: "operator-policy:weekly-v3"},
		{fee: "1.25", source: "caller_input", evidence: "operator-policy:weekly-v3"},
		{fee: "1.25", source: "operator_policy", evidence: "operator policy with spaces"},
		{fee: "1.25", source: "operator_policy", evidence: "operator-policy\nforged-log"},
	} {
		if err := ValidateBrokerFeePolicy(test.fee, test.source, test.evidence); err == nil {
			t.Fatalf("unsafe fee policy was accepted: %#v", test)
		}
	}
}
