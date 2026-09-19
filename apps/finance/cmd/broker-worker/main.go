// broker-worker is an operator-only Finance Sandbox recovery and dispatch tool.
// It is intentionally not started by the Finance server and exposes no HTTP
// route. Every provider write is an explicit, one-shot command.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

var orderIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var providerAccountPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var walletPublicKeyPattern = regexp.MustCompile(`^(02|03)[0-9a-f]{64}$`)

type invocation struct {
	command, statePath, account, orderID, receipt, brokerAccount, walletPublicKey string
}

func main() { os.Exit(run(os.Args[1:], os.Getenv, os.Stdin, os.Stdout)) }

func parsePairs(args []string) (map[string]string, error) {
	if len(args)%2 == 0 {
		return nil, errors.New("worker arguments must be exact flag/value pairs")
	}
	values := map[string]string{}
	for index := 1; index < len(args); index += 2 {
		if _, duplicate := values[args[index]]; duplicate || args[index] == "" || index+1 >= len(args) {
			return nil, errors.New("duplicate or incomplete worker argument")
		}
		values[args[index]] = args[index+1]
	}
	return values, nil
}

func exactKeys(values map[string]string, keys ...string) bool {
	if len(values) != len(keys) {
		return false
	}
	for _, key := range keys {
		if values[key] == "" {
			return false
		}
	}
	return true
}

func parseInvocation(args []string, get func(string) string) (invocation, error) {
	if len(args) < 1 {
		return invocation{}, errors.New("USAGE: link-account|query|reconcile|dispatch-one|cancel-one|verify-approved|apply-events")
	}
	values, err := parsePairs(args)
	if err != nil {
		return invocation{}, err
	}
	statePath, err := filepath.Abs(values["--state"])
	if err != nil || statePath != values["--state"] {
		return invocation{}, errors.New("state path must be absolute")
	}
	if _, err := finance.DeriveFinanceSubjectID(values["--account"]); err != nil {
		return invocation{}, errors.New("Finance account is invalid")
	}
	result := invocation{command: args[0], statePath: statePath, account: values["--account"], orderID: values["--order"], receipt: values["--activation-receipt"], brokerAccount: values["--broker-account"], walletPublicKey: values["--wallet-public-key"]}
	switch result.command {
	case "link-account":
		if !exactKeys(values, "--state", "--account", "--broker-account", "--wallet-public-key", "--confirm") || values["--confirm"] != "LINK_SANDBOX_ACCOUNT" || !providerAccountPattern.MatchString(result.brokerAccount) || !walletPublicKeyPattern.MatchString(result.walletPublicKey) {
			return invocation{}, errors.New("link-account arguments fail the exact Sandbox contract")
		}
	case "query":
		if !exactKeys(values, "--state", "--account", "--confirm") || values["--confirm"] != "READ_SANDBOX_ONCE" {
			return invocation{}, errors.New("query arguments fail the exact Sandbox contract")
		}
	case "reconcile":
		if !exactKeys(values, "--state", "--account", "--confirm") || values["--confirm"] != "RECONCILE_SANDBOX_ONCE" {
			return invocation{}, errors.New("reconcile arguments fail the exact Sandbox contract")
		}
	case "apply-events":
		if !exactKeys(values, "--state", "--account", "--confirm") || values["--confirm"] != "APPLY_SANDBOX_EVENTS_ONCE" {
			return invocation{}, errors.New("apply-events arguments fail the exact Sandbox contract")
		}
	case "dispatch-one", "cancel-one", "verify-approved":
		confirmation := "SANDBOX_WRITE_ONCE"
		if result.command == "cancel-one" {
			confirmation = "SANDBOX_CANCEL_ONCE"
		} else if result.command == "verify-approved" {
			confirmation = "SANDBOX_VERIFY_APPROVED_ORDER_ONCE"
		}
		if !exactKeys(values, "--state", "--account", "--order", "--activation-receipt", "--confirm") || values["--confirm"] != confirmation || !orderIDPattern.MatchString(result.orderID) {
			return invocation{}, errors.New("provider write arguments fail the exact Sandbox contract")
		}
		if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(result.receipt) || result.receipt != get("FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256") {
			return invocation{}, errors.New("activation receipt does not match the server-side contract")
		}
	default:
		return invocation{}, errors.New("unsupported worker command")
	}
	return result, nil
}

func output(out io.Writer, value any) int {
	if err := json.NewEncoder(out).Encode(value); err != nil {
		return 1
	}
	return 0
}

func run(args []string, get func(string) string, stdin io.Reader, stdout io.Writer) int {
	invocation, err := parseInvocation(args, get)
	if err != nil {
		_ = output(stdout, map[string]any{"ok": false, "error": "WORKER_INVOCATION_REJECTED"})
		return 2
	}
	databaseURL := strings.TrimSpace(get("YNX_FINANCE_DATABASE_URL"))
	if databaseURL == "" {
		info, statErr := os.Lstat(invocation.statePath)
		if statErr != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			_ = output(stdout, map[string]any{"ok": false, "error": "STATE_STORE_NOT_REGULAR"})
			return 2
		}
	}
	// The worker uses the same authoritative backend selector as the server.
	// A configured but unavailable PostgreSQL backend is an error; it must never
	// silently dispatch from the bootstrap file store.
	store, err := finance.OpenStoreWithDatabase(invocation.statePath, databaseURL)
	if err != nil {
		_ = output(stdout, map[string]any{"ok": false, "error": "STATE_STORE_UNAVAILABLE", "configuredBackend": map[bool]string{true: "postgres", false: "file"}[databaseURL != ""]})
		return 1
	}
	now := time.Now().UTC()
	if invocation.command == "link-account" {
		mapping, linkErr := store.PutBrokerSandboxMappingWithWalletKey(invocation.account, invocation.brokerAccount, invocation.walletPublicKey, now)
		if linkErr != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": "ACCOUNT_LINK_REJECTED"})
			return 1
		}
		return output(stdout, map[string]any{"ok": true, "command": invocation.command, "subjectId": mapping.SubjectID, "provider": mapping.Provider, "environment": mapping.TradingEnvironment, "walletKeyLinked": true, "stateBackend": store.StateStoreMode()})
	}
	config := brokerage.LoadConfig(get)
	adapter := brokerage.NewAlpaca(config)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	dispatcher := finance.BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now }}
	switch invocation.command {
	case "query":
		snapshot, queryErr := adapter.Reconcile(ctx, invocation.account, store)
		if queryErr != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": brokerage.ErrorCode(queryErr), "providerWriteAttempted": false})
			return 1
		}
		return output(stdout, map[string]any{"ok": true, "command": invocation.command, "snapshot": snapshot, "providerWriteAttempted": false})
	case "reconcile":
		if err := store.RecoverInterruptedBrokerDispatches(invocation.account, now); err != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": "RESTART_RECOVERY_FAILED", "providerWriteAttempted": false})
			return 1
		}
		snapshot, reconcileErr := dispatcher.Reconcile(ctx, invocation.account)
		if reconcileErr != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": brokerage.ErrorCode(reconcileErr), "providerWriteAttempted": false})
			return 1
		}
		return output(stdout, map[string]any{"ok": true, "command": invocation.command, "snapshot": snapshot, "workspace": store.BrokerWorkspace(invocation.account, now), "providerWriteAttempted": false})
	case "apply-events":
		brokerAccount, resolveErr := store.ResolveBrokerAccount(ctx, invocation.account, finance.FinanceOrderProvider, finance.FinanceOrderTradingEnv)
		if resolveErr != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": "ACCOUNT_NOT_LINKED", "providerWriteAttempted": false})
			return 1
		}
		events, cursor, parseErr := brokerage.ParseTradeEventStream(stdin, brokerAccount, 512)
		if parseErr != nil || store.ApplyBrokerTradeEvents(invocation.account, events, cursor, now) != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": "TRADE_EVENT_APPLY_REJECTED", "providerWriteAttempted": false})
			return 1
		}
		return output(stdout, map[string]any{"ok": true, "command": invocation.command, "eventCount": len(events), "cursor": cursor, "workspace": store.BrokerWorkspace(invocation.account, now), "providerWriteAttempted": false})
	case "cancel-one":
		if !config.Status().SubmissionEnabled {
			_ = output(stdout, map[string]any{"ok": false, "error": "ORDER_CANCELLATION_DISABLED"})
			return 2
		}
		record, cancelErr := dispatcher.Cancel(ctx, invocation.account, invocation.orderID)
		if cancelErr != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": brokerage.ErrorCode(cancelErr), "orderState": record.State, "orderId": invocation.orderID, "retryAllowed": false})
			return 1
		}
		return output(stdout, map[string]any{"ok": true, "command": invocation.command, "orderId": record.Order.OrderID, "orderState": record.State, "attempts": 1, "retryAllowed": false, "environment": "sandbox"})
	case "dispatch-one":
		if !config.Status().SubmissionEnabled {
			_ = output(stdout, map[string]any{"ok": false, "error": "ORDER_SUBMISSION_DISABLED"})
			return 2
		}
		if err := store.RecoverInterruptedBrokerDispatches(invocation.account, now); err != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": "RESTART_RECOVERY_FAILED"})
			return 1
		}
		record, dispatchErr := dispatcher.Dispatch(ctx, invocation.account, invocation.orderID)
		if dispatchErr != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": brokerage.ErrorCode(dispatchErr), "orderState": record.State, "orderId": invocation.orderID, "retryAllowed": false})
			return 1
		}
		return output(stdout, map[string]any{"ok": true, "command": invocation.command, "orderId": record.Order.OrderID, "providerOrderId": record.ProviderOrderID, "orderState": record.State, "attempts": 1, "retryAllowed": false, "environment": "sandbox"})
	case "verify-approved":
		if !config.Status().SubmissionEnabled {
			_ = output(stdout, map[string]any{"ok": false, "error": "ORDER_SUBMISSION_DISABLED", "providerWriteAttempted": false})
			return 2
		}
		receipt, verifyErr := runControlledVerification(ctx, dispatcher, store, invocation.account, invocation.orderID, now)
		if verifyErr != nil {
			_ = output(stdout, map[string]any{"ok": false, "error": brokerage.ErrorCode(verifyErr), "providerWriteAttempted": true, "retryAllowed": false})
			return 1
		}
		return output(stdout, receipt)
	}
	_ = output(stdout, map[string]any{"ok": false, "error": fmt.Sprintf("unsupported command %s", invocation.command)})
	return 2
}

func runControlledVerification(ctx context.Context, dispatcher finance.BrokerDispatcher, store *finance.Store, account, orderID string, now time.Time) (map[string]any, error) {
	if err := store.RecoverInterruptedBrokerDispatches(account, now); err != nil {
		return nil, err
	}
	before := store.BrokerWorkspace(account, now)
	approved := false
	for _, order := range before.Orders {
		if order.Order.OrderID == orderID && order.ApprovalState == "consumed" {
			approved = true
		}
	}
	if !approved {
		return nil, &brokerage.Error{Code: "WALLET_APPROVAL_REQUIRED"}
	}
	dispatched, err := dispatcher.Dispatch(ctx, account, orderID)
	if err != nil {
		return nil, err
	}
	queried, err := dispatcher.Reconcile(ctx, account)
	if err != nil {
		return nil, err
	}
	canceled, err := dispatcher.Cancel(ctx, account, orderID)
	if err != nil {
		return nil, err
	}
	finalSnapshot, err := dispatcher.Reconcile(ctx, account)
	if err != nil {
		return nil, err
	}
	audit := map[string]any{"schemaVersion": "finance.broker.controlled-verification.v1", "account": account, "orderId": orderID, "providerOrderId": dispatched.ProviderOrderID, "approvalState": dispatched.ApprovalState, "dispatchState": dispatched.State, "queryRequestIds": queried.RequestIDs, "cancelState": canceled.State, "finalRequestIds": finalSnapshot.RequestIDs, "completedAt": now.UTC().Format(time.RFC3339Nano), "environment": "sandbox", "retryAllowed": false}
	raw, _ := json.Marshal(audit)
	digest := sha256.Sum256(raw)
	return map[string]any{"ok": true, "command": "verify-approved", "providerWriteAttempted": true, "audit": audit, "auditReceiptSha256": fmt.Sprintf("%x", digest[:]), "officialSandboxVerified": false, "productionApproved": false}, nil
}
