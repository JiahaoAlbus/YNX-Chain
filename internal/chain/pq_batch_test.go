package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func (f *pqLedgerFixture) batchTransfer(nonce, amount uint64) ynxauth.Transfer {
	return ynxauth.Transfer{ChainID: f.network, NativeChainID: uint64(f.d.cfg.ChainID), From: f.owner, To: f.to, Amount: amount, Fee: 1, Nonce: nonce}
}

func (f *pqLedgerFixture) whole(t *testing.T, transfers ...ynxauth.Transfer) []byte {
	t.Helper()
	messages := make([][]byte, len(transfers))
	for i, transfer := range transfers {
		var err error
		messages[i], err = transfer.SigningBytes()
		pqMust(t, err)
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	pqMust(t, err)
	defer batch.Discard()
	wire, err := batch.WholeWire()
	pqMust(t, err)
	return wire
}

func pqBatchSnapshotCopy(t *testing.T, d *Devnet) devnetSnapshot {
	t.Helper()
	raw, err := d.ReplicationSnapshotJSON()
	pqMust(t, err)
	var snapshot devnetSnapshot
	pqMust(t, json.Unmarshal(raw, &snapshot))
	return snapshot
}

func TestPQBatchTransactionHashFixedFramingVectors(t *testing.T) {
	// Independently calculated with Node SHA-256 and explicit four-byte E frames.
	// The zero digest is an identity-codec vector, not an authenticated WholeWire.
	for _, vector := range []struct {
		index uint32
		hash  string
	}{
		{0, "0xc3734379b242cee7e34589669a060798062b01f809b6b749af0ad0ee7c6652c9"},
		{1, "0x6754ab3d53902b48068d49f9d0974b8e1f8125f3399830b9f4da66c809b6a6bf"},
		{1023, "0x2e976c0c8997192623c73de89594605ac8d1c1d6d9dabbc48a41deb65950d53d"},
	} {
		hash, err := PQBatchTransactionHash("0x"+strings.Repeat("0", 64), vector.index)
		pqMust(t, err)
		if hash != vector.hash {
			t.Fatalf("E identity vector %d mismatch", vector.index)
		}
	}
	for _, bad := range []string{"", "0x0", "0X" + strings.Repeat("0", 64), "0x" + strings.Repeat("A", 64)} {
		if _, err := PQBatchTransactionHash(bad, 0); err == nil {
			t.Fatal("noncanonical batch hash accepted")
		}
	}
	if _, err := PQBatchTransactionHash("0x"+strings.Repeat("0", 64), 1024); err == nil {
		t.Fatal("out-of-range member index accepted")
	}
}

func TestPQStandaloneLargerCertificateAndBatchSingleAuthentication(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	wire := f.batchMember(t, 2, 1, 8)
	tx, replayed, err := f.d.SubmitPQTransfer(wire)
	pqMust(t, err)
	if replayed || tx.Nonce != 2 {
		t.Fatal("valid member of N=8 certificate was not admitted")
	}
	whole := f.whole(t, f.batchTransfer(3, 1), f.batchTransfer(4, 1))
	state, height := f.d.AccountAuthorization(f.owner)
	a, err := authenticatePQBatch(whole, state, height, f.d.cfg.ChainID)
	pqMust(t, err)
	defer a.verifier.Clear()
	for i := range a.whole.Messages {
		_, err = a.transfer(uint32(i), height)
		pqMust(t, err)
	}
	if stats := a.verifier.Stats(); stats.SignatureChecks != 2 || stats.CacheHits != 0 || stats.CachedCertificates != 1 {
		t.Fatalf("batch repeated signatures or failed to refresh trust: %+v", stats)
	}
	// The private batch admission is not a permanent authorization capability.
	state.Records[0].PKA[0] ^= 1
	if _, err = a.transfer(0, height); err == nil {
		t.Fatal("batch member ignored a changed current trusted full key")
	}
}

func TestPQBatchPartialBusinessResultsSharedProofAndRestart(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	badFee := f.batchTransfer(5, 1)
	badFee.Fee = 2
	wire := f.whole(t, f.batchTransfer(2, 3), f.batchTransfer(2, 3), f.batchTransfer(3, 2000), f.batchTransfer(3, 4), f.batchTransfer(5, 1), f.batchTransfer(4, 2), badFee, f.batchTransfer(5, 1))
	original := bytes.Clone(wire)
	out, err := f.d.SubmitPQBatch(wire)
	pqMust(t, err)
	if out.Status != "durable" || out.Replayed || len(out.Results) != 8 || len(f.d.pqBatches) != 1 {
		t.Fatalf("invalid batch outcome: %+v", out)
	}
	for i, r := range out.Results {
		wantAdmitted := i == 0 || i == 3 || i == 5 || i == 7
		if (r.Outcome == "admitted") != wantAdmitted || r.Index != uint32(i) {
			t.Fatalf("member %d did not use independent nonce/balance/fee rules: %+v", i, r)
		}
		if wantAdmitted {
			hash, e := PQBatchTransactionHash(out.BatchHash, uint32(i))
			pqMust(t, e)
			tx, ok := f.d.Transaction(hash)
			if !ok || tx.Hash != r.TransactionHash || tx.Memo != pqBatchMemberMemo(out.BatchHash, uint32(i)) || len(tx.Memo) > 128 {
				t.Fatal("transaction copied a whole proof or lost stable index identity")
			}
		} else if r.Error == "" || r.TransactionHash != "" {
			t.Fatal("rejected member has an execution identity")
		}
	}
	sender, _ := f.d.Account(f.owner)
	recipient, _ := f.d.Account(f.to)
	if sender.Balance != 985 || sender.Nonce != 5 || recipient.Balance != 10 {
		t.Fatal("partial batch consumed a rejected member or stopped after failure")
	}
	proof := f.d.pqBatches[out.BatchHash]
	if proof.Height != 2 || !bytes.Equal(proof.Whole, original) || len(proof.Results) != 8 {
		t.Fatal("shared proof does not preserve complete original input")
	}
	wire[len(wire)-1] ^= 1
	out.Results[0].TransactionHash = "changed-caller-output"
	if !bytes.Equal(f.d.pqBatches[out.BatchHash].Whole, original) || f.d.pqBatches[out.BatchHash].Results[0].TransactionHash == out.Results[0].TransactionHash {
		t.Fatal("mutable caller buffers alias authoritative proof state")
	}
	before := moduleBusinessState(t, f.d)
	replay, err := f.d.SubmitPQBatch(original)
	pqMust(t, err)
	if !replay.Replayed || replay.Status != "durable" || !reflect.DeepEqual(replay.Results, proof.Results) {
		t.Fatal("same batch retry changed prior partial outcomes")
	}
	assertModuleState(t, f.d, before)
	pqMust(t, validateAccountPolicySnapshot(pqBatchSnapshotCopy(t, f.d)))
	restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, before)
	replay, err = restored.SubmitPQBatch(original)
	pqMust(t, err)
	if !replay.Replayed || !reflect.DeepEqual(replay.Results, proof.Results) {
		t.Fatal("cold replay re-executed previously rejected members")
	}
	f.d.ProduceBlock()
	payload, err := f.d.ReplicationSnapshotJSON()
	pqMust(t, err)
	follower, err := NewPersistentDevnet(f.d.cfg, t.TempDir())
	pqMust(t, err)
	result, err := follower.ApplyReplicationSnapshotJSON(payload, false)
	pqMust(t, err)
	if !result.Applied || !reflect.DeepEqual(follower.pqBatches, f.d.pqBatches) {
		t.Fatal("replication omitted shared batch history")
	}
	replay, err = follower.SubmitPQBatch(original)
	pqMust(t, err)
	if !replay.Replayed || !reflect.DeepEqual(replay.Results, proof.Results) {
		t.Fatal("replicated replay lost stable partial results")
	}
}

func TestPQBatchHistoryRequiresThreeWayCoverageAndImmutableProofs(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	wire := f.whole(t, f.batchTransfer(2, 1), f.batchTransfer(2, 1))
	out, err := f.d.SubmitPQBatch(wire)
	pqMust(t, err)
	pqMust(t, validateAccountPolicySnapshot(pqBatchSnapshotCopy(t, f.d)))
	cases := []struct {
		name string
		edit func(*devnetSnapshot)
	}{
		{"missing shared proof", func(s *devnetSnapshot) { delete(s.PQBatches, out.BatchHash) }},
		{"whole bytes changed", func(s *devnetSnapshot) { p := s.PQBatches[out.BatchHash]; p.Whole[len(p.Whole)-1] ^= 1 }},
		{"execution height changed", func(s *devnetSnapshot) { p := s.PQBatches[out.BatchHash]; p.Height++; s.PQBatches[out.BatchHash] = p }},
		{"result count changed", func(s *devnetSnapshot) {
			p := s.PQBatches[out.BatchHash]
			p.Results = p.Results[:1]
			s.PQBatches[out.BatchHash] = p
		}},
		{"result index changed", func(s *devnetSnapshot) { p := s.PQBatches[out.BatchHash]; p.Results[0].Index = 1 }},
		{"admitted transaction missing", func(s *devnetSnapshot) { s.Pending = nil }},
		{"admitted transaction duplicated", func(s *devnetSnapshot) { s.Pending = append(s.Pending, s.Pending[0]) }},
		{"execution amount changed", func(s *devnetSnapshot) { s.Pending[0].Amount++ }},
		{"rejected member referenced", func(s *devnetSnapshot) {
			tx := s.Pending[0]
			tx.Hash, _ = PQBatchTransactionHash(out.BatchHash, 1)
			tx.Memo = pqBatchMemberMemo(out.BatchHash, 1)
			s.Pending = append(s.Pending, tx)
		}},
		{"admitted outcome changed", func(s *devnetSnapshot) {
			p := s.PQBatches[out.BatchHash]
			p.Results[0] = PQBatchMemberResult{Index: 0, Outcome: "rejected", Error: "rewritten"}
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := pqBatchSnapshotCopy(t, f.d)
			c.edit(&s)
			// Recomputing the outer hash cannot repair broken proof coverage.
			sealed, e := sealDevnetSnapshot(s)
			pqMust(t, e)
			if e = validateAccountPolicySnapshot(sealed); e == nil {
				t.Fatal("tampered semantic history accepted after resealing")
			}
		})
	}
	prior := clonePQBatches(f.d.pqBatches)
	if err = validatePQBatchContinuation(prior, nil); err == nil {
		t.Fatal("proof removal accepted")
	}
	changed := clonePQBatches(prior)
	p := changed[out.BatchHash]
	p.Results[1].Error = "different historical outcome"
	if err = validatePQBatchContinuation(prior, changed); err == nil {
		t.Fatal("proof result rewrite accepted")
	}
	pqMust(t, validatePQBatchContinuation(prior, clonePQBatches(prior)))
}

func TestPQBatchPersistenceFailureAndUnknownRetry(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		name := "before-rename"
		if afterRename {
			name = "after-rename"
		}
		t.Run(name, func(t *testing.T) {
			f := newPQLedger(t)
			f.activate(t)
			wire := f.whole(t, f.batchTransfer(2, 1), f.batchTransfer(3, 1))
			before := moduleBusinessState(t, f.d)
			target := f.d.snapshotPath() + ".tmp"
			if afterRename {
				target = f.d.snapshotIntegrityMarkerPath() + ".tmp"
			}
			unblock := blockSnapshotWrite(t, target)
			out, err := f.d.SubmitPQBatch(wire)
			if err == nil || out.Replayed {
				t.Fatal("failed batch checkpoint reported success")
			}
			if afterRename {
				if !errors.Is(err, ErrSnapshotDurabilityUncertain) || out.Status != "uncertain" || len(f.d.pqBatches) != 1 {
					t.Fatal("batch UNKNOWN erased shared intent")
				}
				retained := moduleBusinessState(t, f.d)
				for _, r := range out.Results {
					_, proof, ok := f.d.TransactionWithDurability(r.TransactionHash)
					if !ok || proof.Status != "uncertain" {
						t.Fatal("batch member falsely acknowledged durable")
					}
				}
				retry, e := f.d.SubmitPQBatch(wire)
				if !errors.Is(e, ErrSnapshotDurabilityUncertain) || retry.Status != "uncertain" || retry.Replayed || !reflect.DeepEqual(retry.Results, out.Results) {
					t.Fatal("UNKNOWN retry changed identity/results")
				}
				assertModuleState(t, f.d, retained)
				assertModuleState(t, readTransferSnapshot(t, f.d), retained)
			} else {
				if errors.Is(err, ErrSnapshotDurabilityUncertain) || out.Status != "not_committed" || len(f.d.pqBatches) != 0 {
					t.Fatal("pre-rename failure retained batch proof")
				}
				assertModuleState(t, f.d, before)
			}
			unblock()
			retry, err := f.d.SubmitPQBatch(wire)
			pqMust(t, err)
			if retry.Status != "durable" || retry.Replayed != afterRename || !reflect.DeepEqual(retry.Results, out.Results) {
				t.Fatal("batch recovery changed original outcome")
			}
			a, _ := f.d.Account(f.owner)
			if a.Balance != 995 || a.Nonce != 3 {
				t.Fatal("batch recovery double-applied members")
			}
			restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			assertModuleState(t, restored, moduleBusinessState(t, f.d))
		})
	}
}

func TestPQBatchBoundsAllRejectedAndMaximumMemberCount(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	before := moduleBusinessState(t, f.d)
	if _, err := f.d.SubmitPQBatch(make([]byte, MaxPQBatchBytes+1)); err == nil {
		t.Fatal("oversized complete wire accepted")
	}
	allBad := f.whole(t, f.batchTransfer(100, 1), f.batchTransfer(101, 1))
	out, err := f.d.SubmitPQBatch(allBad)
	pqMust(t, err)
	if out.Status != "rejected" || out.Replayed || len(f.d.pqBatches) != 0 {
		t.Fatal("all-rejected batch fabricated durable identity")
	}
	assertModuleState(t, f.d, before)
	// Repeating the same business nonce across a valid N=1024 commitment admits
	// exactly one independent transaction; all other members remain rejected.
	transfers := make([]ynxauth.Transfer, ynxbatch.MaxN)
	for i := range transfers {
		transfers[i] = f.batchTransfer(2, 1)
	}
	wire := f.whole(t, transfers...)
	out, err = f.d.SubmitPQBatch(wire)
	pqMust(t, err)
	if len(out.Results) != ynxbatch.MaxN || out.Status != "durable" {
		t.Fatal("N=1024 complete batch not processed")
	}
	for i, r := range out.Results {
		if (r.Outcome == "admitted") != (i == 0) {
			t.Fatalf("member %d replayed the same nonce", i)
		}
	}
	for _, tx := range f.d.pending {
		if strings.Contains(tx.Memo, string(wire)) {
			t.Fatal("whole proof repeated in a transaction")
		}
	}
	if len(f.d.pqBatches) != 1 || len(f.d.pqBatches[out.BatchHash].Whole) != len(wire) {
		t.Fatal("maximum batch duplicated its proof")
	}
}

func TestPQBatchReplicationUnknownKeepsSharedProofAndOriginalResults(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	wire := f.whole(t, f.batchTransfer(2, 1), f.batchTransfer(2, 1))
	out, err := f.d.SubmitPQBatch(wire)
	pqMust(t, err)
	payload, err := f.d.ReplicationSnapshotJSON()
	pqMust(t, err)
	follower, err := NewPersistentDevnet(f.d.cfg, t.TempDir())
	pqMust(t, err)
	unblock := blockSnapshotWrite(t, follower.snapshotIntegrityMarkerPath()+".tmp")
	if _, err = follower.ApplyReplicationSnapshotJSON(payload, false); !errors.Is(err, ErrSnapshotDurabilityUncertain) {
		t.Fatalf("replicated shared proof lost UNKNOWN: %v", err)
	}
	if !reflect.DeepEqual(follower.pqBatches, f.d.pqBatches) {
		t.Fatal("replication rolled memory back after exposing the shared proof")
	}
	retained := moduleBusinessState(t, follower)
	if _, err = follower.SubmitPQBatch(wire); !errors.Is(err, ErrSnapshotDurabilityUncertain) {
		t.Fatal("replicated UNKNOWN batch falsely reconciled")
	}
	assertModuleState(t, follower, retained)
	unblock()
	retry, err := follower.SubmitPQBatch(wire)
	pqMust(t, err)
	if !retry.Replayed || retry.Status != "durable" || !reflect.DeepEqual(retry.Results, out.Results) {
		t.Fatal("replication retry changed partial business results")
	}
	assertModuleState(t, follower, retained)
	restored, err := NewPersistentDevnet(follower.cfg, follower.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, retained)
}
