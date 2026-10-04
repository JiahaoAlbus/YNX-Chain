package exchangeproduct

import (
	"bytes"
	"os"
	"sync"
	"testing"
	"time"
)

type simultaneousDepositReader struct {
	transfer ChainTransfer
	arrived  chan struct{}
	release  chan struct{}
}

func (r *simultaneousDepositReader) Transfer(string) (ChainTransfer, error) {
	r.arrived <- struct{}{}
	<-r.release
	return r.transfer, nil
}

func TestDepositSimultaneousConfirmationCreditsOnceAndRestarts(t *testing.T) {
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "confirm-race", "exchange:read", "exchange:deposit")
	intent, err := s.CreateDepositIntent(owner.session, "confirmation-race-intent")
	if err != nil {
		t.Fatal(err)
	}
	hash := "abcdefabcdefabcd"
	transfer := ChainTransfer{Hash: hash, From: alice, To: bob, AmountMicro: 4 * AmountScale, Confirmations: 1, Committed: true}
	chain.set(hash, transfer)
	dep, err := s.ObserveDeposit(owner.session, intent.ID, hash, "confirmation-race-observe")
	if err != nil {
		t.Fatal(err)
	}
	transfer.Confirmations = 3
	barrier := &simultaneousDepositReader{transfer: transfer, arrived: make(chan struct{}, 2), release: make(chan struct{})}
	s.cfg.Chain = barrier
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) { defer wg.Done(); _, errs[i] = s.RefreshDeposit(owner.session, dep.ID) }(i)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-barrier.arrived:
		case <-time.After(5 * time.Second):
			close(barrier.release)
			wg.Wait()
			t.Fatal("confirmation read barrier not reached")
		}
	}
	close(barrier.release)
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := attributionBalance(s, alice); got != 4*AmountScale {
		t.Fatalf("concurrent confirmation credited %d, want %d", got, 4*AmountScale)
	}
	s.cfg.Chain = chain
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.RefreshDeposit(owner.session, dep.ID); err != nil {
		t.Fatal(err)
	}
	if got := attributionBalance(restarted, alice); got != 4*AmountScale {
		t.Fatalf("cold replay balance=%d", got)
	}
}

func TestDepositIndexerHashMismatchCannotObserveOrConfirm(t *testing.T) {
	s, chain, statePath := newTestService(t)
	owner := accountSession(t, s, alice, "hash-bound", "exchange:read", "exchange:deposit")
	intent, err := s.CreateDepositIntent(owner.session, "hash-bound-intent")
	if err != nil {
		t.Fatal(err)
	}
	hash := "aaaabbbbccccdddd"
	transfer := ChainTransfer{Hash: "ddddccccbbbbaaaa", From: alice, To: bob, AmountMicro: AmountScale, Confirmations: 3, Committed: true}
	chain.set(hash, transfer)
	before, _ := os.ReadFile(statePath)
	if _, err = s.ObserveDeposit(owner.session, intent.ID, hash, "hash-mismatch-observe"); err != ErrInvalid {
		t.Fatalf("wrong hash observation err=%v", err)
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("hash mismatch mutated durable state")
	}
	transfer.Hash = hash
	transfer.Confirmations = 1
	chain.set(hash, transfer)
	dep, err := s.ObserveDeposit(owner.session, intent.ID, hash, "hash-bound-observe")
	if err != nil {
		t.Fatal(err)
	}
	before, _ = os.ReadFile(statePath)
	transfer.Hash = "ddddccccbbbbaaaa"
	transfer.Confirmations = 3
	chain.set(hash, transfer)
	if _, err = s.RefreshDeposit(owner.session, dep.ID); err != ErrInvalid {
		t.Fatalf("wrong hash confirmation err=%v", err)
	}
	after, _ = os.ReadFile(statePath)
	if !bytes.Equal(before, after) || attributionBalance(s, alice) != 0 {
		t.Fatal("wrong hash credited or mutated deposit")
	}
}
