//go:build weekly_v3_integration

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
)

func TestWeeklyV3OperatorControlledVerificationAndBackendFence(t *testing.T) {
	for _, scenario := range []string{"disabled", "approved", "no_approval", "database_unavailable"} {
		t.Run(scenario, func(t *testing.T) {
			cfg, store, provider := weeklyOperatorSetup(t)
			statePath := cfg["YNX_FINANCE_STATE_PATH"]
			orderID := "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			if scenario == "approved" {
				now := time.Now().UTC()
				order, err := finance.BuildBrokerOrderDraft(finance.BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "125.34"}, "1.25", "operator_policy")
				if err != nil {
					t.Fatal(err)
				}
				challenge, err := store.CreateBrokerOrderChallenge(weeklyOperatorAccount, finance.BrokerChallengeRequest{AccountPublicKey: weeklyOperatorKey, FeeBoundEstablished: true, FeeEvidenceRef: "local-operator-fixture", Order: order}, now)
				if err != nil {
					t.Fatal(err)
				}
				input, _ := json.Marshal(map[string]any{"mode": "approve", "challenge": challenge})
				cmd := exec.Command(filepath.Join(os.Getenv("WEEKLY_WALLET_ROOT"), "apps/wallet/node_modules/.bin/tsx"), os.Getenv("WEEKLY_BRIDGE"))
				cmd.Stdin = bytes.NewReader(input)
				raw, err := cmd.Output()
				if err != nil {
					t.Fatal(err)
				}
				var result struct {
					Raw string `json:"raw"`
				}
				if err := json.Unmarshal(raw, &result); err != nil {
					t.Fatal(err)
				}
				callback, err := finance.ParseFinanceOrderApprovalCallbackV1([]byte(result.Raw))
				if err != nil || callback.Approval == nil {
					t.Fatalf("actual Wallet callback: %v", err)
				}
				if _, err := store.VerifyAndConsumeBrokerOrder(weeklyOperatorAccount, *callback.Approval, time.Now()); err != nil {
					t.Fatal(err)
				}
				orderID = challenge.Unsigned.Order.OrderID
			}
			if scenario != "disabled" {
				cfg["FINANCE_SANDBOX_WRITES_ENABLED"] = "true"
			}
			if scenario == "database_unavailable" {
				cfg["YNX_FINANCE_DATABASE_URL"] = "://invalid-postgres-dsn"
			}
			args := []string{"verify-approved", "--state", statePath, "--account", weeklyOperatorAccount, "--order", orderID, "--activation-receipt", cfg["FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256"], "--confirm", "SANDBOX_VERIFY_APPROVED_ORDER_ONCE"}
			before, _ := os.ReadFile(statePath)
			var out bytes.Buffer
			code := run(args, func(k string) string { return cfg[k] }, strings.NewReader(""), &out)
			var result map[string]any
			if err := json.Unmarshal(out.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			provider.mu.Lock()
			posts, deletes, reads := provider.posts, provider.deletes, provider.reads
			provider.mu.Unlock()
			if scenario == "approved" {
				if code != 0 || posts != 1 || deletes != 1 || reads < 10 || result["officialSandboxVerified"] != false || result["productionApproved"] != false {
					t.Fatalf("controlled verification: code=%d writes=%d/%d reads=%d output=%s", code, posts, deletes, reads, out.String())
				}
				if receipt, _ := result["auditReceiptSha256"].(string); len(receipt) != 64 {
					t.Fatal("audit receipt missing")
				}
				reopened, err := finance.OpenStore(statePath)
				if err != nil {
					t.Fatal(err)
				}
				if reopened.BrokerWorkspace(weeklyOperatorAccount, time.Now()).Orders[0].State != "canceled" {
					t.Fatal("verified state not persisted")
				}
				var replay bytes.Buffer
				if run(args, func(k string) string { return cfg[k] }, strings.NewReader(""), &replay) == 0 {
					t.Fatal("verification replay accepted")
				}
				provider.mu.Lock()
				defer provider.mu.Unlock()
				if provider.posts != posts || provider.deletes != deletes {
					t.Fatal("verification replay repeated writes")
				}
			} else {
				if code == 0 || posts != 0 || deletes != 0 || reads != 0 {
					t.Fatalf("operator fence: %d %s calls=%d/%d/%d", code, out.String(), posts, deletes, reads)
				}
				after, _ := os.ReadFile(statePath)
				if !bytes.Equal(before, after) {
					t.Fatal("rejected command changed authoritative state")
				}
				if scenario == "database_unavailable" && result["configuredBackend"] != "postgres" {
					t.Fatal("database failure silently selected file backend")
				}
			}
		})
	}
}
