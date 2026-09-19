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
