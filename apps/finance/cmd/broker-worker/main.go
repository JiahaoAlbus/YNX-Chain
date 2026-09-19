// broker-worker is an operator-only, single-order Sandbox dispatcher. It is
// intentionally not started by the Finance server and exposes no HTTP route.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

var orderIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type invocation struct {
	statePath, account, orderID, receipt string
}

func main() { os.Exit(run(os.Args[1:], os.Getenv)) }

func parseInvocation(args []string, get func(string) string) (invocation, error) {
	if len(args) != 11 || args[0] != "dispatch-one" {
		return invocation{}, errors.New("USAGE: dispatch-one --state ABSOLUTE_PATH --account YNX_ADDRESS --order UUID --activation-receipt SHA256 --confirm SANDBOX_WRITE_ONCE")
	}
	values := map[string]string{}
	for index := 1; index < len(args); index += 2 {
		if _, duplicate := values[args[index]]; duplicate {
			return invocation{}, errors.New("duplicate worker argument")
		}
		values[args[index]] = args[index+1]
	}
	statePath, err := filepath.Abs(values["--state"])
	if err != nil || statePath != values["--state"] || values["--confirm"] != "SANDBOX_WRITE_ONCE" || !orderIDPattern.MatchString(values["--order"]) {
		return invocation{}, errors.New("worker arguments fail the exact Sandbox contract")
	}
	if _, err := finance.DeriveFinanceSubjectID(values["--account"]); err != nil {
		return invocation{}, errors.New("Finance account is invalid")
	}
	receipt := values["--activation-receipt"]
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(receipt) || receipt != get("FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256") {
		return invocation{}, errors.New("activation receipt does not match the server-side contract")
	}
	for _, required := range []string{"--state", "--account", "--order", "--activation-receipt", "--confirm"} {
		if values[required] == "" {
			return invocation{}, fmt.Errorf("%s is required", required)
		}
	}
	return invocation{statePath: statePath, account: values["--account"], orderID: values["--order"], receipt: receipt}, nil
}

func run(args []string, get func(string) string) int {
	invocation, err := parseInvocation(args, get)
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": "WORKER_INVOCATION_REJECTED"})
		return 2
	}
	info, err := os.Lstat(invocation.statePath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": "STATE_STORE_NOT_REGULAR"})
		return 2
	}
	config := brokerage.LoadConfig(get)
	if !config.Status().SubmissionEnabled {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": "ORDER_SUBMISSION_DISABLED"})
		return 2
	}
	store, err := finance.OpenStore(invocation.statePath)
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": "STATE_STORE_UNAVAILABLE"})
		return 1
	}
	now := time.Now().UTC()
	if err := store.RecoverInterruptedBrokerDispatches(invocation.account, now); err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": "RESTART_RECOVERY_FAILED"})
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	dispatcher := finance.BrokerDispatcher{Store: store, Adapter: brokerage.NewAlpaca(config)}
	record, err := dispatcher.Dispatch(ctx, invocation.account, invocation.orderID)
	if err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "error": brokerage.ErrorCode(err), "orderState": record.State, "orderId": invocation.orderID, "retryAllowed": false})
		return 1
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "orderId": record.Order.OrderID, "providerOrderId": record.ProviderOrderID, "orderState": record.State, "attempts": 1, "retryAllowed": false, "environment": "sandbox"})
	return 0
}
