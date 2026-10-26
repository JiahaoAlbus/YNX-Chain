package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func pqHistoryMathFixture(t *testing.T) *abciRevocationFixture {
	t.Helper()
	f := newABCIRevocationFixture(t)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 7)))
	if len(f.a.committed.PQHistory) != 2 || f.a.committed.PQHistory[1].Transaction.Type != SignedTransactionType {
		t.Fatal("normal ABCI fixture has no complete migration and original N=1 transfer")
	}
	member, err := ynxbatch.DecodeMember(pqHistoryMathTransferWire(t, f.a.committed))
	if err != nil || member.Certificate.N != 1 {
		t.Fatal("historical fixture did not execute an ordinary N=1 member", err)
	}
	return f
}

func pqHistoryMathCache(t *testing.T, app *Application) *chain.PQCertificateCache {
	t.Helper()
	if app.validatedMigration == nil || app.validatedMigration.historyCertificates == nil {
		t.Fatal("normal constructor omitted its privately owned history cache")
	}
	return app.validatedMigration.historyCertificates
}

func pqHistoryMathTransferWire(t *testing.T, state CommittedState) []byte {
	t.Helper()
	if len(state.PQHistory) != 2 || !strings.HasPrefix(state.PQHistory[1].Transaction.Memo, pqTransferMemo) {
		t.Fatal("expected the original two-entry migration/transfer history")
	}
	wire, err := hex.DecodeString(strings.TrimPrefix(state.PQHistory[1].Transaction.Memo, pqTransferMemo))
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func pqHistoryMathRehash(t *testing.T, state *CommittedState) {
	t.Helper()
	hash, err := state.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	state.AppHash = hash
}

func TestPQHistoryMathCacheOwnedReplayCommitAndColdRestart(t *testing.T) {
	f := pqHistoryMathFixture(t)
	cache := pqHistoryMathCache(t, f.a)
	cache.Invalidate()
	start := cache.Stats()
	original, appHash := mustJSON(t, f.a.committed), f.a.committed.AppHash
	disk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.a.committed.validateOwned(f.a.validatedMigration); err != nil {
		t.Fatal(err)
	}
	first := cache.Stats()
	if first.Certificates.Capacity != 16 || first.Certificates.Entries != 1 || first.Certificates.Misses != start.Certificates.Misses+1 || first.Certificates.Hits != start.Certificates.Hits || first.ScopeComputations != start.ScopeComputations+1 {
		t.Fatalf("first full owned replay omitted real N=1 mathematics: start=%+v first=%+v", start, first)
	}
	if err := f.a.committed.validateOwned(f.a.validatedMigration); err != nil {
		t.Fatal(err)
	}
	second := cache.Stats()
	if second.Certificates.Hits != first.Certificates.Hits+1 || second.Certificates.Misses != first.Certificates.Misses || second.Certificates.Entries != first.Certificates.Entries || second.ScopeComputations != first.ScopeComputations+1 {
		t.Fatalf("owned replay did not reuse only the exact successful math with a fresh complete policy scope: first=%+v second=%+v", first, second)
	}
	// Public validation creates its own complete ownership boundary. The old
	// uncached history bridge also remains usable and cannot borrow this cache.
	public := copyWholeCommittedState(t, f.a.committed)
	if err := public.Validate(f.m); err != nil {
		t.Fatal(err)
	}
	if err := validateConsensusPQState(public, f.m); err != nil {
		t.Fatal(err)
	}
	afterDisk, err := os.ReadFile(f.path)
	if err != nil || cache.Stats() != second || public.AppHash != appHash || !bytes.Equal(original, mustJSON(t, public)) || !bytes.Equal(original, mustJSON(t, f.a.committed)) || !bytes.Equal(disk, afterDisk) {
		t.Fatal("owned/public verification changed complete state, AppHash, disk or another owner's cache", err)
	}
	for _, height := range []int64{4, 5} {
		before := cache.Stats()
		commitSponsorBlock(t, f.a, height, time.Unix(height, 0).UTC())
		after := cache.Stats()
		if after.Certificates.Misses != before.Certificates.Misses || after.Certificates.Hits <= before.Certificates.Hits || after.Certificates.Entries != 1 {
			t.Fatalf("real empty Finalize/Commit repeated original transfer mathematics: before=%+v after=%+v", before, after)
		}
		if err := f.a.committed.Validate(f.m); err != nil {
			t.Fatal("empty Commit changed public validation semantics", err)
		}
	}
	stable := mustJSON(t, f.a.committed)
	stableDisk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	warm := cache.Stats()
	cold, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal("normal cold constructor rejected complete original history", err)
	}
	fresh := pqHistoryMathCache(t, cold)
	stats := fresh.Stats()
	if cold.validatedMigration == f.a.validatedMigration || fresh == cache || stats.Certificates.Capacity != 16 || stats.Certificates.Misses != 1 || stats.Certificates.Entries != 1 {
		t.Fatalf("cold constructor inherited a historical certificate instead of verifying its own original: %+v", stats)
	}
	if err := cold.committed.validateOwned(cold.validatedMigration); err != nil {
		t.Fatal(err)
	}
	updated := fresh.Stats()
	afterDisk, err = os.ReadFile(f.path)
	if err != nil || updated.Certificates.Misses != stats.Certificates.Misses || updated.Certificates.Hits != stats.Certificates.Hits+1 || cache.Stats() != warm || !bytes.Equal(stable, mustJSON(t, cold.committed)) || !bytes.Equal(stableDisk, afterDisk) || cold.committed.AppHash != f.a.committed.AppHash {
		t.Fatal("independent cold ownership changed original state, disk, AppHash or warm-owner facts", err)
	}
	for _, branch := range []string{"A", "B"} {
		t.Run("rehashed-bad-"+branch, func(t *testing.T) {
			bad := copyWholeCommittedState(t, f.a.committed)
			member, err := ynxbatch.DecodeMember(pqHistoryMathTransferWire(t, bad))
			if err != nil {
				t.Fatal(err)
			}
			if branch == "A" {
				member.Certificate.SigmaA[0] ^= 1
			} else {
				member.Certificate.SigmaB[0] ^= 1
			}
			wire, err := ynxbatch.EncodeMember(member)
			if err != nil {
				t.Fatal(err)
			}
			entry := &bad.PQHistory[1]
			oldABCI := entry.ABCITransactionHash
			entry.Transaction.Hash = SignedTransactionHash(wire)
			entry.Transaction.Memo = pqTransferMemo + hex.EncodeToString(wire)
			entry.ABCITransactionHash = SignedTransactionHash(mustPQEnvelope(t, PQTransferType, wire))
			for i := range bad.NativeTransfers {
				if bad.NativeTransfers[i].TransactionHash == oldABCI {
					bad.NativeTransfers[i].TransactionHash = entry.ABCITransactionHash
				}
			}
			for i := range bad.FeeEvents {
				if bad.FeeEvents[i].TxHash == oldABCI {
					bad.FeeEvents[i].TxHash = entry.ABCITransactionHash
				}
			}
			pqHistoryMathRehash(t, &bad)
			raw := mustJSON(t, bad)
			before := cache.Stats()
			warmErr := bad.validateOwned(f.a.validatedMigration)
			if !errors.Is(warmErr, ynxbatch.ErrInvalidSignature) || cache.Stats().Certificates.Entries != before.Certificates.Entries || cache.Stats().Certificates.Misses != before.Certificates.Misses+1 {
				t.Fatal("warm full replay accepted or retained a broken dual-signature branch", warmErr)
			}
			path := filepath.Join(t.TempDir(), "broken-original.json")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			beforeFile, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			_, coldErr := NewPersistentApplication(f.m, path)
			if !errors.Is(coldErr, ynxbatch.ErrInvalidSignature) {
				t.Fatal("cold constructor did not independently reject the original broken signature", coldErr)
			}
			afterFile, statErr := os.Stat(path)
			retained, readErr := os.ReadFile(path)
			if statErr != nil || readErr != nil || !os.SameFile(beforeFile, afterFile) || beforeFile.Mode() != afterFile.Mode() || !beforeFile.ModTime().Equal(afterFile.ModTime()) || !bytes.Equal(raw, retained) || !bytes.Equal(raw, mustJSON(t, bad)) || !bytes.Equal(stable, mustJSON(t, f.a.committed)) {
				t.Fatal("failed warm/cold validation repaired or changed its original DATA")
			}
		})
	}
}

func TestPQHistoryMathCacheWarmDynamicRejectionsMatchCold(t *testing.T) {
	f := pqHistoryMathFixture(t)
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 3, 4, 1)))
	cache := pqHistoryMathCache(t, f.a)
	// Revocation legitimately changes the complete policy scope. Clear earlier
	// successes so this assertion observes only this original terminal policy.
	cache.Invalidate()
	start := cache.Stats()
	if err := f.a.committed.validateOwned(f.a.validatedMigration); err != nil {
		t.Fatal(err)
	}
	if err := f.a.committed.validateOwned(f.a.validatedMigration); err != nil {
		t.Fatal(err)
	}
	warm := cache.Stats()
	if warm.Certificates.Entries != 1 || warm.Certificates.Misses != start.Certificates.Misses+1 || warm.Certificates.Hits != start.Certificates.Hits+1 {
		t.Fatal("revocation fixture did not warm its genuinely historical N=1 proof")
	}
	original := mustJSON(t, f.a.committed)
	disk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"fee", "nonce", "height", "key", "revocation"} {
		t.Run(scenario, func(t *testing.T) {
			bad := copyWholeCommittedState(t, f.a.committed)
			switch scenario {
			case "fee":
				bad.PQHistory[1].Transaction.Fee++
			case "nonce":
				bad.PQHistory[1].Transaction.Nonce++
			case "height":
				bad.PQHistory[1].Transaction.BlockNum = uint64(bad.Height) + 1
			case "key":
				bad.AccountPolicy.Records[0].PKA[0] ^= 1
			case "revocation":
				bad.AccountPolicy.Revocations[0].ThroughRevision++
			}
			pqHistoryMathRehash(t, &bad)
			before := mustJSON(t, bad)
			warmErr, coldErr := bad.validateOwned(f.a.validatedMigration), bad.Validate(f.m)
			if warmErr == nil || coldErr == nil || warmErr.Error() != coldErr.Error() || !bytes.Equal(before, mustJSON(t, bad)) {
				t.Fatalf("warm history changed the original cold first cause for %s: warm=%v cold=%v", scenario, warmErr, coldErr)
			}
		})
	}
	afterDisk, err := os.ReadFile(f.path)
	if err != nil || !bytes.Equal(disk, afterDisk) || !bytes.Equal(original, mustJSON(t, f.a.committed)) {
		t.Fatal("warm invalid candidates changed committed history or disk", err)
	}
}
