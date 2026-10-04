package exchangeproduct

import (
	"bytes"
	"os"
	"sync"
	"testing"
)

// Controlled engine accounts and fake indexer only. This is not public
// authorization or a real deposit; no user key, RPC or chain write is used.
func attributionBalance(s *Service, account string) int64 {
	for _, balance := range s.Snapshot(account).Balances {
		if balance.Asset == NativeAsset {
			return balance.AvailableMicro
		}
	}
	return 0
}

func TestDepositCannotClaimAnotherSendersCommonCustodyTransfer(t *testing.T) {
	s, chain, path := newTestService(t)
	owner := accountSession(t, s, alice, "sender-owner", "exchange:read", "exchange:deposit")
	other := accountSession(t, s, carol, "claim-other", "exchange:read", "exchange:deposit")
	ownerIntent, err := s.CreateDepositIntent(owner.session, "attribution-owner-intent")
	if err != nil {
		t.Fatal(err)
	}
	otherIntent, err := s.CreateDepositIntent(other.session, "attribution-other-intent")
	if err != nil {
		t.Fatal(err)
	}
	hash := "abcdabcdabcdabcd"
	chain.set(hash, ChainTransfer{Hash: hash, From: alice, To: bob, AmountMicro: 5 * AmountScale, Confirmations: 3, Committed: true})
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ObserveDeposit(other.session, otherIntent.ID, hash, "attribution-wrong-sender"); err != ErrForbidden {
		t.Fatalf("another actor claimed the common-custody transfer: err=%v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("rejected claim changed durable state")
	}
	chain.set(hash, ChainTransfer{Hash: hash, From: "", To: bob, AmountMicro: 5 * AmountScale, Confirmations: 3, Committed: true})
	if _, err := s.ObserveDeposit(owner.session, ownerIntent.ID, hash, "attribution-missing-sender"); err != ErrForbidden {
		t.Fatalf("missing sender was attributed: err=%v", err)
	}
	chain.set(hash, ChainTransfer{Hash: hash, From: alice, To: bob, AmountMicro: 5 * AmountScale, Confirmations: 3, Committed: true})
	deposit, err := s.ObserveDeposit(owner.session, ownerIntent.ID, hash, "attribution-correct-sender")
	if err != nil || deposit.Status != "confirmed" {
		t.Fatalf("owner deposit=%+v err=%v", deposit, err)
	}
	if attributionBalance(s, alice) != 5*AmountScale || attributionBalance(s, carol) != 0 {
		t.Fatal("deposit attribution confused actors")
	}
}

func TestDepositRefreshSenderTamperCannotCreditOrChangeRecord(t *testing.T) {
	s, chain, path := newTestService(t)
	owner := accountSession(t, s, alice, "refresh-sender", "exchange:read", "exchange:deposit")
	intent, err := s.CreateDepositIntent(owner.session, "sender-refresh-intent")
	if err != nil {
		t.Fatal(err)
	}
	hash := "ddddaaaaddddaaaa"
	transfer := ChainTransfer{Hash: hash, From: alice, To: bob, AmountMicro: 3 * AmountScale, Confirmations: 1, Committed: true}
	chain.set(hash, transfer)
	deposit, err := s.ObserveDeposit(owner.session, intent.ID, hash, "sender-refresh-observe")
	if err != nil || deposit.Status != "confirming" {
		t.Fatalf("observe=%+v err=%v", deposit, err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, sender := range []string{"", carol} {
		wrong := transfer
		wrong.From = sender
		wrong.Confirmations = 3
		chain.set(hash, wrong)
		if _, err := s.RefreshDeposit(owner.session, deposit.ID); err != ErrForbidden {
			t.Fatalf("unattributed refresh sender=%q err=%v", sender, err)
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) || attributionBalance(s, alice) != 0 {
			t.Fatal("tampered refresh changed record or credited balance")
		}
	}
	transfer.Confirmations = 3
	chain.set(hash, transfer)
	if _, err := s.RefreshDeposit(owner.session, deposit.ID); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.RefreshDeposit(owner.session, deposit.ID); err != nil {
		t.Fatal(err)
	}
	if attributionBalance(restarted, alice) != 3*AmountScale {
		t.Fatal("restart/replay credited more than once")
	}
}

func TestDepositTwoActorRaceCreditsOnlyProvenSender(t *testing.T) {
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "race-owner", "exchange:read", "exchange:deposit")
	other := accountSession(t, s, carol, "race-other", "exchange:read", "exchange:deposit")
	i1, err := s.CreateDepositIntent(owner.session, "race-sender-owner-intent")
	if err != nil {
		t.Fatal(err)
	}
	i2, err := s.CreateDepositIntent(other.session, "race-sender-other-intent")
	if err != nil {
		t.Fatal(err)
	}
	hash := "bbbbddddbbbbdddd"
	chain.set(hash, ChainTransfer{Hash: hash, From: alice, To: bob, AmountMicro: 7 * AmountScale, Confirmations: 3, Committed: true})
	var wg sync.WaitGroup
	wg.Add(2)
	errors := make([]error, 2)
	go func() {
		defer wg.Done()
		_, errors[0] = s.ObserveDeposit(owner.session, i1.ID, hash, "race-sender-owner-observe")
	}()
	go func() {
		defer wg.Done()
		_, errors[1] = s.ObserveDeposit(other.session, i2.ID, hash, "race-sender-other-observe")
	}()
	wg.Wait()
	if errors[0] != nil || errors[1] != ErrForbidden || attributionBalance(s, alice) != 7*AmountScale || attributionBalance(s, carol) != 0 {
		t.Fatalf("sender race errors=%v", errors)
	}
}
