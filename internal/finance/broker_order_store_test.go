package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func signFinanceApprovalForTest(t *testing.T, unsigned FinanceOrderApprovalUnsignedV1) FinanceOrderApprovalV1 {
	t.Helper()
	privateKeyBytes := make([]byte, 32)
	privateKeyBytes[31] = 1
	privateKey := secp256k1.PrivKeyFromBytes(privateKeyBytes)
	digestHex := digestFinanceCanonical(FinanceOrderApprovalDomain, unsigned)
	digest, _ := hex.DecodeString(digestHex)
	compact := secpECDSA.SignCompact(privateKey, digest, true)
	if len(compact) != 65 {
		t.Fatal("unexpected compact signature")
	}
	return FinanceOrderApprovalV1{FinanceOrderApprovalUnsignedV1: unsigned, Signature: hex.EncodeToString(compact[1:])}
}

func signFinanceRevocationForTest(t *testing.T, unsigned FinanceOrderApprovalUnsignedV1, revokedAt time.Time) FinanceOrderRevocationV1 {
	t.Helper()
	revocation := FinanceOrderRevocationV1{Account: unsigned.Account, AccountPublicKey: unsigned.AccountPublicKey, ApprovalDigest: digestFinanceCanonical(FinanceOrderApprovalDomain, unsigned), Reason: "USER_REVOKED", RequestID: unsigned.RequestID, RevokedAt: revokedAt.UTC().Format("2006-01-02T15:04:05.000Z"), Version: "1"}
	payload := struct {
		Account          string `json:"account"`
		AccountPublicKey string `json:"accountPublicKey"`
		ApprovalDigest   string `json:"approvalDigest"`
		Reason           string `json:"reason"`
		RequestID        string `json:"requestId"`
		RevokedAt        string `json:"revokedAt"`
		Version          string `json:"version"`
	}{revocation.Account, revocation.AccountPublicKey, revocation.ApprovalDigest, revocation.Reason, revocation.RequestID, revocation.RevokedAt, revocation.Version}
	digest, _ := hex.DecodeString(digestFinanceCanonical(FinanceOrderRevokeDomain, payload))
	secret := make([]byte, 32)
	secret[31] = 1
	revocation.Signature = hex.EncodeToString(secpECDSA.SignCompact(secp256k1.PrivKeyFromBytes(secret), digest, true)[1:])
	return revocation
}

func TestBrokerOrderLifecycleFailsClosedAfterMappedWalletKeyRotation(t *testing.T) {
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	brokerAccount := "01234567-89ab-4cde-8fab-0123456789ab"
	originalKey := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	rotatedKey := "03" + strings.Repeat("1", 64)
	now := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	request := func(orderID string) BrokerChallengeRequest {
		return BrokerChallengeRequest{
			AccountPublicKey: originalKey, FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test",
			Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: orderID, OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"},
		}
	}
	open := func(t *testing.T) *Store {
		t.Helper()
		store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, brokerAccount, originalKey, now); err != nil {
			t.Fatal(err)
		}
		return store
	}
	rotate := func(t *testing.T, store *Store) {
		t.Helper()
		if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, brokerAccount, rotatedKey, now.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("challenge", func(t *testing.T) {
		store := open(t)
		candidate := request("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
		candidate.AccountPublicKey = rotatedKey
		if _, err := store.CreateBrokerOrderChallenge(account, candidate, now); err == nil {
			t.Fatal("challenge accepted a Wallet key different from the current mapping")
		}
		if len(store.BrokerWorkspace(account, now).Orders) != 0 {
			t.Fatal("rejected challenge created an order")
		}
	})

	t.Run("approve", func(t *testing.T) {
		store := open(t)
		challenge, err := store.CreateBrokerOrderChallenge(account, request("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"), now)
		if err != nil {
			t.Fatal(err)
		}
		rotate(t, store)
		if _, err := store.ApproveBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(2*time.Minute)); err == nil {
			t.Fatal("approval signed by the former mapped Wallet key was accepted")
		}
		if state := store.Account(account).Brokerage.Orders[challenge.Unsigned.Order.OrderID]; state.ApprovalState != "pending" || state.State != "approval_pending" {
			t.Fatalf("rejected approval mutated order state: %+v", state)
		}
	})

	t.Run("consume", func(t *testing.T) {
		store := open(t)
		challenge, err := store.CreateBrokerOrderChallenge(account, request("cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa"), now)
		if err != nil {
			t.Fatal(err)
		}
		approval := signFinanceApprovalForTest(t, challenge.Unsigned)
		approved, err := store.ApproveBrokerOrder(account, approval, now.Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		rotate(t, store)
		if _, err := store.ConsumeBrokerOrder(account, challenge.Unsigned.RequestID, approved.ApprovalDigest, now.Add(2*time.Minute)); err == nil {
			t.Fatal("approval from the former mapped Wallet key was consumed")
		}
		if state := store.Account(account).Brokerage; len(state.Outbox) != 0 || state.Orders[challenge.Unsigned.Order.OrderID].ApprovalState != "approved" {
			t.Fatalf("rejected consumption mutated durable state: %+v", state)
		}
	})

	t.Run("dispatch claim", func(t *testing.T) {
		store := open(t)
		challenge, err := store.CreateBrokerOrderChallenge(account, request("dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb"), now)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
		if _, err := store.RequestBrokerExecution(account, challenge.Unsigned.Order.OrderID, "wallet-key-rotation-request-0001", now.Add(90*time.Second)); err != nil {
			t.Fatal(err)
		}
		rotate(t, store)
		claim, err := store.ClaimBrokerDispatch(account, challenge.Unsigned.Order.OrderID, now.Add(2*time.Minute))
		if err != nil || claim.BlockedCode != "ACCOUNT_MAPPING_CHANGED" || claim.Outbox.Status != "execution_blocked" || claim.Order.State != "execution_blocked" {
			t.Fatalf("rotated Wallet key was not fenced before provider dispatch: claim=%+v err=%v", claim, err)
		}
	})
}

func TestBrokerPendingApprovalCanBeRevokedBeforeCallbackDelivery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finance.json")
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	store, _ := OpenStore(path)
	_, _ = store.PutBrokerSandboxMapping(account, "01234567-89ab-4cde-8fab-0123456789ab", now)
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	revocation := signFinanceRevocationForTest(t, challenge.Unsigned, now.Add(time.Minute))
	if _, err := store.RevokeBrokerOrder(account, revocation, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	reopened, _ := OpenStore(path)
	state := reopened.Account(account).Brokerage
	if state.Challenges[challenge.Unsigned.RequestID].ApprovalState != "revoked" || len(state.Outbox) != 0 {
		t.Fatalf("pending revoke did not persist safely: %+v", state)
	}
	if _, err := reopened.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(2*time.Minute)); err == nil {
		t.Fatal("revoked pending approval was consumed")
	}
}

func TestBrokerOrderDurableConcurrentConsumeAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finance.json")
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	brokerID := "01234567-89ab-4cde-8fab-0123456789ab"
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMapping(account, brokerID, now); err != nil {
		t.Fatal(err)
	}
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{
		AccountPublicKey:    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
		FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test-fixture:v1",
		Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", ExtendedHours: false, FeeBoundSource: "operator_policy", LimitPrice: "125.34", MaxCost: "251.93", MaxFee: "1.25", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "2", Side: "buy", Symbol: "ACME", TimeInForce: "day"},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	approval := signFinanceApprovalForTest(t, challenge.Unsigned)
	digest := digestFinanceCanonical(FinanceOrderApprovalDomain, approval.FinanceOrderApprovalUnsignedV1)

	const workers = 24
	var wg sync.WaitGroup
	errorsByWorker := make(chan error, workers)
	for index := 0; index < workers; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			independent, openErr := OpenStore(path)
			if openErr != nil {
				errorsByWorker <- openErr
				return
			}
			result, consumeErr := independent.VerifyAndConsumeBrokerOrder(account, approval, now.Add(2*time.Minute))
			if consumeErr != nil {
				errorsByWorker <- consumeErr
				return
			}
			if result.Outbox.ProviderClientOrderID != approval.Order.OrderID {
				errorsByWorker <- fmt.Errorf("wrong correlation")
			}
		}()
	}
	wg.Wait()
	close(errorsByWorker)
	for err := range errorsByWorker {
		if err != nil {
			t.Error(err)
		}
	}

	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	state := restarted.Account(account).Brokerage
	if len(state.Outbox) != 1 {
		t.Fatalf("outbox=%d", len(state.Outbox))
	}
	consumedEvents := 0
	for _, event := range state.Journal {
		if event.Action == "approval.consumed_outbox_created" {
			consumedEvents++
		}
	}
	if consumedEvents != 1 {
		t.Fatalf("consume events=%d", consumedEvents)
	}
	replay, err := restarted.ConsumeBrokerOrder(account, approval.RequestID, digest, now.Add(3*time.Minute))
	if err != nil || !replay.Replayed {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
	if _, err := restarted.RevokeBrokerOrder(account, FinanceOrderRevocationV1{RequestID: approval.RequestID}, now.Add(3*time.Minute)); err == nil {
		t.Fatal("consumed approval revoked")
	}
}

func TestBrokerRevokeAndConsumeUseSameCAS(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finance.json")
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	store, _ := OpenStore(path)
	_, _ = store.PutBrokerSandboxMapping(account, "01234567-89ab-4cde-8fab-0123456789ab", now)
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	approval := signFinanceApprovalForTest(t, challenge.Unsigned)
	if _, err := store.ApproveBrokerOrder(account, approval, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	digest := digestFinanceCanonical(FinanceOrderApprovalDomain, approval.FinanceOrderApprovalUnsignedV1)
	revokedAt := now.Add(90 * time.Second).Format("2006-01-02T15:04:05.000Z")
	revocation := FinanceOrderRevocationV1{Account: account, AccountPublicKey: approval.AccountPublicKey, ApprovalDigest: digest, Reason: "USER_REVOKED", RequestID: approval.RequestID, RevokedAt: revokedAt, Version: "1"}
	privateKeyBytes := make([]byte, 32)
	privateKeyBytes[31] = 1
	unsigned := struct {
		Account          string `json:"account"`
		AccountPublicKey string `json:"accountPublicKey"`
		ApprovalDigest   string `json:"approvalDigest"`
		Reason           string `json:"reason"`
		RequestID        string `json:"requestId"`
		RevokedAt        string `json:"revokedAt"`
		Version          string `json:"version"`
	}{revocation.Account, revocation.AccountPublicKey, revocation.ApprovalDigest, revocation.Reason, revocation.RequestID, revocation.RevokedAt, revocation.Version}
	revokeDigest, _ := hex.DecodeString(digestFinanceCanonical(FinanceOrderRevokeDomain, unsigned))
	revocation.Signature = hex.EncodeToString(secpECDSA.SignCompact(secp256k1.PrivKeyFromBytes(privateKeyBytes), revokeDigest, true)[1:])

	var wg sync.WaitGroup
	outcomes := make(chan string, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		candidate, _ := OpenStore(path)
		if _, err := candidate.ConsumeBrokerOrder(account, approval.RequestID, digest, now.Add(2*time.Minute)); err == nil {
			outcomes <- "consumed"
		} else {
			outcomes <- "consume-failed"
		}
	}()
	go func() {
		defer wg.Done()
		candidate, _ := OpenStore(path)
		if _, err := candidate.RevokeBrokerOrder(account, revocation, now.Add(2*time.Minute)); err == nil {
			outcomes <- "revoked"
		} else {
			outcomes <- "revoke-failed"
		}
	}()
	wg.Wait()
	close(outcomes)
	final, _ := OpenStore(path)
	state := final.Account(account).Brokerage.Challenges[approval.RequestID].ApprovalState
	if state != "consumed" && state != "revoked" {
		t.Fatalf("state=%s", state)
	}
	if state == "consumed" && len(final.Account(account).Brokerage.Outbox) != 1 {
		t.Fatal("consumed result missing outbox")
	}
	if state == "revoked" && len(final.Account(account).Brokerage.Outbox) != 0 {
		t.Fatal("revoked result created outbox")
	}
}

func TestFinanceStateV1LazyMigrationAndBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finance-v1.json")
	legacy := []byte(`{"version":1,"accounts":{"ynx1legacy":{"categories":[],"budgets":[],"reminders":[],"notes":[],"privacy":{"includePayInStatements":true,"allowAiActivityContext":false,"alertsEnabled":true,"updatedAt":"0001-01-01T00:00:00Z"},"classifications":{},"aiJobs":[],"idempotency":{}}},"audit":[],"usedWalletNonces":{}}`)
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if store.state.Version != currentStateVersion {
		t.Fatalf("version=%d", store.state.Version)
	}
	if err := store.Update("ynx1legacy", "migration.test", "", func(state *AccountState) error { return nil }); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !containsBytes(raw, []byte(`"version": 2`)) || !containsBytes(raw, []byte(`"brokerage"`)) {
		t.Fatalf("not migrated: %s", raw)
	}
	backup := filepath.Join(t.TempDir(), "finance.backup")
	key := sha256.Sum256([]byte("finance-v2-backup-migration-test-key"))
	manifest, err := store.Backup(backup, key[:])
	if err != nil || manifest.StateVersion != currentStateVersion {
		t.Fatalf("manifest=%+v err=%v", manifest, err)
	}
}

func TestBrokerMappingsRemainPerUserAndProviderEnvironment(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	now := time.Now().UTC()
	first := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	second := "ynx1qyr9ej0ja2f4km6s6wfa8q2t7uvxv2w4ed4m88"
	// The second checksum is intentionally invalid and must not create a mapping.
	if _, err := store.PutBrokerSandboxMapping(second, "11111111-2222-4333-8444-555555555555", now); err == nil {
		t.Fatal("invalid subject mapping accepted")
	}
	if _, err := store.PutBrokerSandboxMapping(first, "01234567-89ab-4cde-8fab-0123456789ab", now); err != nil {
		t.Fatal(err)
	}
	if got, err := store.ResolveBrokerAccount(t.Context(), first, FinanceOrderProvider, FinanceOrderTradingEnv); err != nil || got != "01234567-89ab-4cde-8fab-0123456789ab" {
		t.Fatalf("got=%s err=%v", got, err)
	}
	if _, err := store.ResolveBrokerAccount(t.Context(), first, FinanceOrderProvider, "live"); err == nil {
		t.Fatal("live mapping resolved")
	}
}

func TestBrokerAccountCannotBeSharedAcrossFinanceUsers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finance.json")
	first, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	accounts := []string{
		"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",
		"ynx172kmjz4z0g7xr22u2qrrkgy3nkq3u9rk768d6x",
	}
	brokerAccount := "01234567-89ab-4cde-8fab-0123456789ab"
	start := make(chan struct{})
	results := make(chan error, len(accounts))
	var wg sync.WaitGroup
	for index, store := range []*Store{first, second} {
		wg.Add(1)
		go func(index int, store *Store) {
			defer wg.Done()
			<-start
			_, putErr := store.PutBrokerSandboxMapping(accounts[index], brokerAccount, time.Now().UTC())
			results <- putErr
		}(index, store)
	}
	close(start)
	wg.Wait()
	close(results)
	successes, failures := 0, 0
	for result := range results {
		if result == nil {
			successes++
		} else if strings.Contains(result.Error(), "already linked") {
			failures++
		} else {
			t.Fatalf("unexpected mapping result: %v", result)
		}
	}
	if successes != 1 || failures != 1 {
		t.Fatalf("successes=%d failures=%d", successes, failures)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	linked := 0
	for _, account := range accounts {
		if _, resolveErr := reopened.ResolveBrokerAccount(t.Context(), account, FinanceOrderProvider, FinanceOrderTradingEnv); resolveErr == nil {
			linked++
		}
	}
	if linked != 1 {
		t.Fatalf("shared provider account linked to %d users", linked)
	}
}

func containsBytes(haystack, needle []byte) bool {
	return string(haystack) != "" && len(needle) > 0 && stringIndex(string(haystack), string(needle)) >= 0
}

func stringIndex(value, pattern string) int {
	for index := 0; index+len(pattern) <= len(value); index++ {
		if value[index:index+len(pattern)] == pattern {
			return index
		}
	}
	return -1
}
