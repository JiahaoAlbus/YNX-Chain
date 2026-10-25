package yusdsandbox

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReserveMintOutageRedemptionAndRestart(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state", "yusd.json")
	service, err := New(Config{StatePath: path, APIKey: "test-yusd-api-key-123456", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	evidence := strings.Repeat("a", 64)
	account := "0x1111111111111111111111111111111111111111"
	deposit, err := service.DepositReserve(MutationRequest{IdempotencyKey: "reserve-0001", Amount: 1_000_000_000, EvidenceHash: evidence})
	if err != nil || deposit.Record.ReserveUnits != 1_000_000_000 || deposit.Record.ExternalReserveAttested || deposit.Record.RealityValue {
		t.Fatalf("bad reserve: %+v %v", deposit, err)
	}
	minted, err := service.Mint(MutationRequest{IdempotencyKey: "mint-0000001", Amount: 600_000_000, Account: account, EvidenceHash: evidence})
	if err != nil || minted.Record.SupplyUnits != 600_000_000 || !minted.Record.Solvent {
		t.Fatalf("bad mint: %+v %v", minted, err)
	}
	if _, err := service.SetProvider(ProviderRequest{IdempotencyKey: "provider-001", Status: "outage", EvidenceHash: evidence}); err != nil {
		t.Fatal(err)
	}
	redemption, err := service.Redeem(MutationRequest{IdempotencyKey: "redeem-0001", Amount: 200_000_000, Account: account, EvidenceHash: evidence})
	if err != nil || redemption.Record.Status != "queued" {
		t.Fatalf("bad redemption: %+v %v", redemption, err)
	}
	if _, err := service.Fulfill(redemption.Record.ID, MutationRequest{IdempotencyKey: "fulfill-001", Amount: 200_000_000, EvidenceHash: evidence}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("outage fulfillment should fail: %v", err)
	}
	snapshot := service.Snapshot()
	if snapshot.SupplyUnits != 400_000_000 || snapshot.PendingRedemptionUnits != 200_000_000 || snapshot.RequiredBackingUnits != 600_000_000 || !snapshot.ProviderOutage || !snapshot.Reconciled {
		t.Fatalf("bad queued snapshot: %+v", snapshot)
	}
	restarted, err := New(Config{StatePath: path, APIKey: "test-yusd-api-key-123456", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Snapshot() != snapshot {
		t.Fatalf("restart changed snapshot: before=%+v after=%+v", snapshot, restarted.Snapshot())
	}
	if _, err := restarted.SetProvider(ProviderRequest{IdempotencyKey: "provider-002", Status: "available", EvidenceHash: evidence}); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Hour)
	fulfilled, err := restarted.Fulfill(redemption.Record.ID, MutationRequest{IdempotencyKey: "fulfill-001", Amount: 200_000_000, EvidenceHash: evidence})
	if err != nil || fulfilled.Record.Status != "completed" {
		t.Fatalf("fulfill failed: %+v %v", fulfilled, err)
	}
	final := restarted.Snapshot()
	if final.ReserveUnits != 800_000_000 || final.SupplyUnits != 400_000_000 || final.PendingRedemptionUnits != 0 || !final.Solvent || final.GuaranteedPeg {
		t.Fatalf("bad final snapshot: %+v", final)
	}
	if balance, _ := restarted.Balance(account); balance != 400_000_000 {
		t.Fatalf("balance=%d", balance)
	}
	if mode := mustMode(t, path); mode != 0o600 {
		t.Fatalf("state mode=%o", mode)
	}
}

func TestPauseAllowsExitQueueButBlocksMint(t *testing.T) {
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), APIKey: "test-yusd-api-key-123456"})
	e := strings.Repeat("b", 64)
	a := "0x2222222222222222222222222222222222222222"
	service.DepositReserve(MutationRequest{IdempotencyKey: "reserve-0001", Amount: 1000, EvidenceHash: e})
	service.Mint(MutationRequest{IdempotencyKey: "mint-0000001", Amount: 500, Account: a, EvidenceHash: e})
	service.SetPaused(PauseRequest{IdempotencyKey: "pause-000001", Paused: true, EvidenceHash: e})
	if _, err := service.Mint(MutationRequest{IdempotencyKey: "mint-0000002", Amount: 1, Account: a, EvidenceHash: e}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("paused mint=%v", err)
	}
	if result, err := service.Redeem(MutationRequest{IdempotencyKey: "redeem-0001", Amount: 100, Account: a, EvidenceHash: e}); err != nil || result.Record.Status != "queued" {
		t.Fatalf("paused exit failed: %+v %v", result, err)
	}
}

func TestIdempotencyLimitsAndTamperFailClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.json")
	service, _ := New(Config{StatePath: path, APIKey: "test-yusd-api-key-123456"})
	e := strings.Repeat("c", 64)
	req := MutationRequest{IdempotencyKey: "reserve-0001", Amount: 1000, EvidenceHash: e}
	first, err := service.DepositReserve(req)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := service.DepositReserve(req)
	if err != nil || !replay.Replayed || replay.Record.ReserveUnits != first.Record.ReserveUnits {
		t.Fatalf("replay failed: %+v %v", replay, err)
	}
	req.Amount++
	if _, err := service.DepositReserve(req); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed replay=%v", err)
	}
	if _, err := service.Mint(MutationRequest{IdempotencyKey: "mint-limit-01", Amount: AccountDailyLimit + 1, Account: "0x3333333333333333333333333333333333333333", EvidenceHash: e}); !errors.Is(err, ErrConflict) {
		t.Fatalf("limit=%v", err)
	}
	raw, _ := os.ReadFile(path)
	raw = []byte(strings.Replace(string(raw), `"reserve": 1000`, `"reserve": 1001`, 1))
	os.WriteFile(path, raw, 0o600)
	if _, err := New(Config{StatePath: path, APIKey: "test-yusd-api-key-123456"}); err == nil || !strings.Contains(err.Error(), "integrity mismatch") {
		t.Fatalf("tamper=%v", err)
	}
}
func mustMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}
