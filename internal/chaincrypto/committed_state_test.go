package chaincrypto

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func migrationFixture(t *testing.T) (fixture, MigrationState, MigrationRequest, Signatures) {
	t.Helper()
	f := newFixture(t)
	s := MigrationState{Network: testNetwork(), Policy: AuthPolicy{Account: [20]byte{1}, State: Legacy,
		Version: 1, KeyVersion: 1, Keys: PublicKeys{Classical: append([]byte(nil), f.account.Classical...)}},
		NextNonce: 1, Revision: 1, ActivationHeight: 30, CommittedHeight: 10}
	m := MigrationRequest{Network: s.Network, Account: s.Policy.Account, PolicyVersion: 1, KeyVersion: 1,
		Nonce: 1, ExpiryHeight: 90, Next: PQRegistered, NewPQKey: append([]byte(nil), f.account.PostQuantum...)}
	raw, err := m.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	return f, s, m, f.sign(t, raw, false)
}

func TestCommittedMigrationAtomicNonceAndImmutableReturn(t *testing.T) {
	_, s, m, sig := migrationFixture(t)
	ledger, err := NewMemoryMigrationLedger(s)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, m, sig, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	var wins atomic.Int32
	var workers sync.WaitGroup
	for i := 0; i < 16; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if _, err := ledger.Commit(context.Background(), proof, 21); err == nil {
				wins.Add(1)
			}
		}()
	}
	workers.Wait()
	if wins.Load() != 1 {
		t.Fatalf("duplicate commits: %d", wins.Load())
	}
	out := ledger.Snapshot()
	if out.Policy.State != PQRegistered || out.Policy.Version != 2 || out.NextNonce != 2 || out.Revision != 2 || out.CommittedHeight != 21 {
		t.Fatal("non-atomic state", out)
	}
	if !bytes.Equal(out.Policy.Keys.PostQuantum, m.NewPQKey) {
		t.Fatal("wrong authorized key")
	}
	out.Policy.Keys.PostQuantum[0] ^= 1
	if !bytes.Equal(ledger.Snapshot().Policy.Keys.PostQuantum, m.NewPQKey) {
		t.Fatal("snapshot aliases ledger")
	}
}

func TestCommittedMigrationRejectsStaleAndExpiredCapability(t *testing.T) {
	_, s, m, sig := migrationFixture(t)
	proof, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, m, sig, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"network", "revision", "nonce", "activation", "policy", "height"} {
		t.Run(name, func(t *testing.T) {
			other := snapshotMigrationState(s)
			switch name {
			case "network":
				other.Network.Genesis[2] = 9
			case "revision":
				other.Revision++
			case "nonce":
				other.NextNonce++
			case "activation":
				other.ActivationHeight++
			case "policy":
				other.Policy.Version++
			case "height":
				other.CommittedHeight++
			}
			ledger, err := NewMemoryMigrationLedger(other)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := ledger.Commit(context.Background(), proof, 21); err == nil {
				t.Fatal("stale context accepted")
			}
			if migrationStateHash(ledger.Snapshot()) != migrationStateHash(other) {
				t.Fatal("rejected commit changed state")
			}
		})
	}
	for _, height := range []uint64{19, 91} {
		ledger, _ := NewMemoryMigrationLedger(s)
		if _, err := ledger.Commit(context.Background(), proof, height); err == nil {
			t.Fatal("height boundary accepted", height)
		}
	}
}

func TestCommittedMigrationCancelDuringRealVerificationAndQueue(t *testing.T) {
	_, s, m, sig := migrationFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	paused := snapshotPauseProvider{make(chan struct{}), make(chan struct{}), false}
	result := make(chan error, 1)
	go func() { _, err := PrepareCommittedMigration(ctx, s, paused, m, sig, nil, 20); result <- err }()
	<-paused.entered
	cancel()
	close(paused.release)
	if !errors.Is(<-result, context.Canceled) {
		t.Fatal("canceled verification returned capability")
	}
	proof, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, m, sig, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	ledger, _ := NewMemoryMigrationLedger(s)
	ledger.mu.Lock()
	queued, cancelQueued := context.WithCancel(context.Background())
	go func() { _, err := ledger.Commit(queued, proof, 20); result <- err }()
	cancelQueued()
	ledger.mu.Unlock()
	if !errors.Is(<-result, context.Canceled) {
		t.Fatal("queued canceled commit accepted")
	}
	if migrationStateHash(ledger.Snapshot()) != migrationStateHash(s) {
		t.Fatal("canceled commit consumed nonce")
	}
}

func TestCommittedMigrationSnapshotsBeforeActualProvider(t *testing.T) {
	_, s, m, sig := migrationFixture(t)
	original := snapshotMigrationState(s)
	key := append([]byte(nil), m.NewPQKey...)
	paused := snapshotPauseProvider{make(chan struct{}), make(chan struct{}), false}
	type outcome struct {
		proof CommittedMigration
		err   error
	}
	done := make(chan outcome, 1)
	go func() {
		p, e := PrepareCommittedMigration(context.Background(), s, paused, m, sig, nil, 20)
		done <- outcome{p, e}
	}()
	<-paused.entered
	m.NewPQKey[0] ^= 1
	s.Policy.Keys.Classical[0] ^= 1
	sig.PostQuantum[0] ^= 1
	close(paused.release)
	r := <-done
	if r.err != nil {
		t.Fatal(r.err)
	}
	ledger, _ := NewMemoryMigrationLedger(original)
	next, err := ledger.Commit(context.Background(), r.proof, 20)
	if err != nil || !bytes.Equal(next.Policy.Keys.PostQuantum, key) {
		t.Fatal("caller aliases changed committed authorization", err)
	}
}

func TestCommittedMigrationActivationAndOverflowClosed(t *testing.T) {
	f, s, m, sig := migrationFixture(t)
	ledger, _ := NewMemoryMigrationLedger(s)
	proof, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, m, sig, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	s, err = ledger.Commit(context.Background(), proof, 20)
	if err != nil {
		t.Fatal(err)
	}
	enable := MigrationRequest{Network: s.Network, Account: s.Policy.Account, PolicyVersion: 2, KeyVersion: 1, Nonce: 2, ExpiryHeight: 90, Next: HybridEnforced, ExplicitEnable: true}
	raw, _ := enable.CanonicalBytes()
	dual := f.sign(t, raw, false)
	if _, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, enable, dual, nil, 29); err == nil {
		t.Fatal("activation before consensus schedule")
	}
	p, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, enable, dual, nil, 30)
	if err != nil {
		t.Fatal(err)
	}
	next, err := ledger.Commit(context.Background(), p, 30)
	if err != nil || next.Policy.EnforceHeight != 30 {
		t.Fatal("valid scheduled transition failed", err)
	}
	s.ActivationHeight = 0
	if _, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, enable, dual, nil, 30); err == nil {
		t.Fatal("unset activation accepted")
	}
	s.NextNonce = ^uint64(0)
	if _, err := PrepareCommittedMigration(context.Background(), s, CIRCLProvider{}, enable, dual, nil, 30); err == nil {
		t.Fatal("nonce overflow accepted")
	}
}
