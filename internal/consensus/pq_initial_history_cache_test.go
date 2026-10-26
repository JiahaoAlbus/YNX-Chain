package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func initialHistoryCacheFixture(t *testing.T) (*pqInitialFixture, *Application, string) {
	t.Helper()
	f := newPQInitialFixture(t)
	path := filepath.Join(t.TempDir(), "state.json")
	app, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if app.validatedMigration.initialCertificates == nil || app.validatedMigration.initialCertificates.Stats().Entries != 0 {
		t.Fatal("normal constructor did not start with an independent empty proof cache")
	}
	if _, err := app.InitChain(context.Background(), f.f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	payload, err := EncodePQInitialRegistrationTransaction(f.registration)
	if err != nil {
		t.Fatal(err)
	}
	initialHistoryCacheCommit(t, f, app, 2, payload)
	stats := app.validatedMigration.initialCertificates.Stats()
	if stats.Entries != 1 || stats.Misses != 1 || stats.Hits < 1 || stats.Capacity != initialRegistrationCertificateEntries {
		t.Fatal("normal Finalize/Commit did not share only the successful initial certificate", stats)
	}
	return f, app, path
}

func initialHistoryCacheCommit(t *testing.T, f *pqInitialFixture, app *Application, height int64, transactions ...[]byte) {
	t.Helper()
	result, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: f.f.doc.GenesisTime.Add(time.Duration(height) * time.Second), NextValidatorsHash: bytes.Clone(f.f.bootstrap.validatorSetHash), Txs: transactions})
	if err != nil || len(result.TxResults) != len(transactions) {
		t.Fatal("normal cache fixture Finalize failed", result, err)
	}
	for _, result := range result.TxResults {
		if result.Code != 0 {
			t.Fatal("normal initial-account execution failed", result)
		}
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func damageInitialHistoryCertificate(t *testing.T, state *CommittedState, branch string) {
	t.Helper()
	entry := &state.PQHistory[0]
	member, err := ynxbatch.DecodeMember(mustInitialHistoryWire(t, entry.Transaction.Memo))
	if err != nil {
		t.Fatal(err)
	}
	if branch == "ML-DSA-87" {
		member.Certificate.SigmaA[0] ^= 1
	} else if branch == "SLH-DSA-SHA2-256f" {
		member.Certificate.SigmaB[0] ^= 1
	} else {
		t.Fatal("unknown initial certificate branch")
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodePQInitialRegistrationTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	// Rebuild both original transport identities, so rejection reaches the
	// actual damaged dual signature rather than an unrelated outer hash gate.
	entry.Transaction.Memo = pqInitialRegistrationMemo + hex.EncodeToString(wire)
	entry.Transaction.Hash, entry.ABCITransactionHash = SignedTransactionHash(wire), SignedTransactionHash(payload)
}

func mustInitialHistoryWire(t *testing.T, memo string) []byte {
	t.Helper()
	if len(memo) <= len(pqInitialRegistrationMemo) || memo[:len(pqInitialRegistrationMemo)] != pqInitialRegistrationMemo {
		t.Fatal("initial history fixture lacks original memo")
	}
	wire, err := hex.DecodeString(memo[len(pqInitialRegistrationMemo):])
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func TestPQInitialHistoryCacheReusesMathAndKeepsColdRestoreAndStateHash(t *testing.T) {
	f, app, path := initialHistoryCacheFixture(t)
	initialHistoryCacheCommit(t, f, app, 3)
	before, err := json.Marshal(app.committed)
	if err != nil {
		t.Fatal(err)
	}
	stats := app.validatedMigration.initialCertificates.Stats()
	if err := app.committed.validateOwned(app.validatedMigration); err != nil {
		t.Fatal(err)
	}
	if now := app.validatedMigration.initialCertificates.Stats(); now.Misses != stats.Misses || now.Hits != stats.Hits+1 {
		t.Fatal("owned history replay repeated the initial dual certificate", now)
	}
	if err := app.committed.Validate(f.f.migration); err != nil {
		t.Fatal("standalone external validation stopped performing its normal complete check", err)
	}
	after, err := json.Marshal(app.committed)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("disposable math cache changed canonical committed state or AppHash", err)
	}
	cold, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap)
	if err != nil {
		t.Fatal("normal cold constructor rejected genuine initial history", err)
	}
	if cold.validatedMigration == app.validatedMigration || cold.validatedMigration.initialCertificates == app.validatedMigration.initialCertificates {
		t.Fatal("cold reopen inherited another application's warm proof cache")
	}
	if stats := cold.validatedMigration.initialCertificates.Stats(); stats.Entries != 1 || stats.Misses != 1 {
		t.Fatal("cold reopen did not independently authenticate the original certificate", stats)
	}
	actual, err := json.Marshal(cold.committed)
	if err != nil || !bytes.Equal(before, actual) {
		t.Fatal("independent cold cache changed original persisted state or AppHash", err)
	}
}

func TestPQInitialHistoryCacheRejectsMutationsInOriginalOrderAndOnCold(t *testing.T) {
	f, app, _ := initialHistoryCacheFixture(t)
	initialHistoryCacheCommit(t, f, app, 3)
	for _, branch := range []string{"ML-DSA-87", "SLH-DSA-SHA2-256f"} {
		t.Run(branch, func(t *testing.T) {
			bad := app.committed
			bad.PQHistory = clonePQHistory(bad.PQHistory)
			damageInitialHistoryCertificate(t, &bad, branch)
			want := validateConsensusPQState(bad, f.f.migration)
			if !errors.Is(want, ynxbatch.ErrInvalidSignature) {
				t.Fatal("damaged branch did not reach the original complete verifier")
			}
			got := validateConsensusPQStateWithInitialCache(bad, f.f.migration, app.validatedMigration.initialCertificates, app.validatedMigration.initialScope)
			sameValidationError(t, want, got)
			if err := bad.Validate(f.f.migration); err == nil {
				t.Fatal("external cold Validate reused an earlier valid proof")
			}
			if app.validatedMigration.initialCertificates.Stats().Entries != 1 {
				t.Fatal("damaged initial certificate was retained as a success")
			}
			path := filepath.Join(t.TempDir(), "damaged-state.json")
			wire, err := json.Marshal(bad)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, wire, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap); err == nil {
				t.Fatal("cold restore accepted a damaged initial certificate")
			}
			retained, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(retained, wire) {
				t.Fatal("failed cold restore rewrote the original damaged checkpoint", err)
			}
		})
	}
	for name, mutate := range map[string]func(*CommittedState){
		"height": func(s *CommittedState) { s.Height = int64(f.f.migration.Height) },
		"nonce":  func(s *CommittedState) { i, _ := accountIndex(s.Accounts, f.owner); s.Accounts[i].Nonce = 0 },
		"bandwidth": func(s *CommittedState) {
			i, _ := accountIndex(s.Accounts, f.owner)
			s.Accounts[i].ResourceUsage.BandwidthUsed = 0
		},
		"policy pair":  func(s *CommittedState) { s.AccountPolicy.Records[0].PKB[0] ^= 1 },
		"activation":   func(s *CommittedState) { s.AccountPolicy.Records[0].ActiveFrom++ },
		"duplicate":    func(s *CommittedState) { s.PQHistory = append(s.PQHistory, s.PQHistory[0]) },
		"ABCI binding": func(s *CommittedState) { s.PQHistory[0].ABCITransactionHash = "0x00" },
		"revocation evidence": func(s *CommittedState) {
			s.AccountPolicy.Version = ynxauth.PolicyRevocationVersion
			s.AccountPolicy.Revocations = []ynxauth.RevocationRecord{{Owner: f.owner, AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 3, RevokedFrom: 4, LedgerNonce: 2}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := app.committed
			bad.Accounts, bad.AccountPolicy, bad.PQHistory = cloneAccounts(bad.Accounts), cloneConsensusAccountPolicy(bad.AccountPolicy), clonePQHistory(bad.PQHistory)
			mutate(&bad)
			want := validateConsensusPQState(bad, f.f.migration)
			if want == nil {
				t.Fatal("negative control did not fail its original dynamic gate")
			}
			got := validateConsensusPQStateWithInitialCache(bad, f.f.migration, app.validatedMigration.initialCertificates, app.validatedMigration.initialScope)
			sameValidationError(t, want, got)
		})
	}
}

func TestPQInitialHistoryCacheSeparatesBootstrapAtSameNativeGenesis(t *testing.T) {
	f, app, _ := initialHistoryCacheFixture(t)
	plain, err := cmtjson.Marshal(f.f.doc)
	if err != nil {
		t.Fatal(err)
	}
	configuration := f.configuration
	configuration.Accounts = append([]PQInitialAccountBinding(nil), configuration.Accounts...)
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	configuration.Accounts[0].PKA, configuration.Accounts[0].PKB = hex.EncodeToString(public.PKA), hex.EncodeToString(public.PKB)
	raw, err := EncodePQInitialAccountGenesis(plain, f.f.migration, configuration)
	if err != nil {
		t.Fatal(err)
	}
	pin := sha256.Sum256(raw)
	pins := f.f.pins
	pins.CometGenesisSHA256 = hex.EncodeToString(pin[:])
	other, err := NewConsensusBootstrap(raw, pins, f.f.migration)
	if err != nil {
		t.Fatal(err)
	}
	witness, err := newValidatedMigration(f.f.migration, other)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(witness.initialScope, app.validatedMigration.initialScope) || witness.initialCertificates.Stats().Entries != 0 || other.record.OriginalGenesisHash != app.bootstrap.record.OriginalGenesisHash {
		t.Fatal("different independently pinned bootstrap did not get an empty separate mathematical scope")
	}
	bad := app.committed
	bad.bootstrap = witness.bootstrap
	want := validateConsensusPQState(bad, f.f.migration)
	got := validateConsensusPQStateWithInitialCache(bad, f.f.migration, app.validatedMigration.initialCertificates, witness.initialScope)
	if want == nil {
		t.Fatal("original pair should not authorize a different complete bootstrap assignment")
	}
	sameValidationError(t, want, got)
	if err := bad.validateOwned(witness); err == nil || witness.initialCertificates.Stats().Entries != 0 {
		t.Fatal("new bootstrap reused original cached authority or retained a failed binding", err)
	}
}
