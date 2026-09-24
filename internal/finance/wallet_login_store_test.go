package finance

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func loginChallengeFixture(now time.Time) WalletLoginChallengeRecord {
	return WalletLoginChallengeRecord{
		RequestID:      "finance-login-request-0001",
		Nonce:          "FinanceNonce000001",
		Account:        "0x1111111111111111111111111111111111111111",
		ExactChallenge: `{"version":"1","scheme":"eip4361","productId":"finance"}`,
		IssuedAt:       now,
		ExpiresAt:      now.Add(5 * time.Minute),
	}
}

func TestWalletLoginChallengePersistsAndConsumesExactlyOnce(t *testing.T) {
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	record := loginChallengeFixture(now)
	if err := store.PutWalletLoginChallenge(record, now); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := reopened.WalletLoginChallenge(record.Account, record.RequestID)
	if err != nil || string(loaded.ExactChallenge) != string(record.ExactChallenge) || loaded.ConsumedAt != nil {
		t.Fatalf("unexpected challenge: %#v %v", loaded, err)
	}
	if err := reopened.ConsumeWalletLoginChallenge(record.Account, record.RequestID, record.Nonce, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := reopened.ConsumeWalletLoginChallenge(record.Account, record.RequestID, record.Nonce, now.Add(2*time.Minute)); err == nil || !strings.Contains(err.Error(), "already consumed") {
		t.Fatalf("expected replay rejection, got %v", err)
	}
}

func TestWalletLoginChallengeConcurrentConsumeHasOneWinner(t *testing.T) {
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	record := loginChallengeFixture(now)
	if err := store.PutWalletLoginChallenge(record, now); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	winners := make(chan struct{}, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if store.ConsumeWalletLoginChallenge(record.Account, record.RequestID, record.Nonce, now.Add(time.Minute)) == nil {
				winners <- struct{}{}
			}
		}()
	}
	wait.Wait()
	if len(winners) != 1 {
		t.Fatalf("expected one consume winner, got %d", len(winners))
	}
}

func TestWalletLoginChallengeRejectsCrossAccountReplayAndExpiry(t *testing.T) {
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	store, _ := OpenStore("")
	record := loginChallengeFixture(now)
	if err := store.PutWalletLoginChallenge(record, now); err != nil {
		t.Fatal(err)
	}
	other := "0x2222222222222222222222222222222222222222"
	if _, err := store.WalletLoginChallenge(other, record.RequestID); err == nil {
		t.Fatal("cross-account challenge lookup succeeded")
	}
	if err := store.ConsumeWalletLoginChallenge(other, record.RequestID, record.Nonce, now.Add(time.Minute)); err == nil {
		t.Fatal("cross-account challenge consume succeeded")
	}
	if err := store.ConsumeWalletLoginChallenge(record.Account, record.RequestID, record.Nonce, record.ExpiresAt); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expiry rejection, got %v", err)
	}
}
