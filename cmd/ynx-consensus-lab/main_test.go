package main

import (
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestLocalMigrationFixtureUsesExplicitBalance(t *testing.T) {
	const balance = int64(100_000)
	migration, signer, err := localMigrationFixture(balance)
	if err != nil {
		t.Fatal(err)
	}
	if signer == nil {
		t.Fatal("local migration fixture did not return its disposable signer")
	}
	if err := migration.Validate(); err != nil {
		t.Fatalf("local migration fixture is invalid: %v", err)
	}
	address, err := consensus.NativeAddress(signer.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, account := range migration.Accounts {
		if account.Address != address {
			continue
		}
		found = true
		if account.Balance != balance || account.Nonce != 0 {
			t.Fatalf("unexpected fixture signer account: %+v", account)
		}
	}
	if !found {
		t.Fatalf("fixture signer account %s is missing", address)
	}
}

func TestLocalMigrationFixtureRejectsNonPositiveBalance(t *testing.T) {
	for _, balance := range []int64{0, -1} {
		if _, _, err := localMigrationFixture(balance); err == nil {
			t.Fatalf("local fixture accepted balance %d", balance)
		}
	}
}
