package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func pqRevocationWire(t *testing.T, f *pqLedgerFixture, nonce, height, through uint64) []byte {
	t.Helper()
	intent := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB,
		AuthorizingRevision: 1, ThroughRevision: through, LedgerNonce: nonce, ExecuteAt: height, RevokeAt: height + 1}
	message, err := intent.SigningBytes()
	pqMust(t, err)
	_, proof := pqRevocationProofs(t, f.key, f.network, f.owner, ynxauth.RevocationPurpose, message)
	wire, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: proof}).Encode()
	pqMust(t, err)
	return wire
}

func pqRevocationProofs(t *testing.T, key *ynxbatch.PrivateKey, network []byte, owner, purpose string, message []byte) ([]byte, []byte) {
	t.Helper()
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: purpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	pqMust(t, err)
	defer batch.Discard()
	whole, err := batch.WholeWire()
	pqMust(t, err)
	member, err := ynxbatch.Extract(batch, 0)
	pqMust(t, err)
	proof, err := ynxbatch.EncodeMember(member)
	pqMust(t, err)
	return whole, proof
}

func pqRevocationRotation(t *testing.T, f *pqLedgerFixture, next *ynxbatch.PrivateKey, public ynxbatch.PublicKey, nonce, activate uint64) []byte {
	t.Helper()
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: nonce, ActivateAt: activate}
	message, err := intent.SigningBytes()
	pqMust(t, err)
	_, currentProof := pqRevocationProofs(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, message)
	newProof, _ := pqRevocationProofs(t, next, f.network, f.owner, ynxauth.MigrationPurpose, message)
	wire, err := (ynxauth.Migration{Intent: intent, CurrentPQProof: currentProof, NewKeyProof: newProof}).Encode()
	pqMust(t, err)
	return wire
}

func pqRevocationSecondOwner(t *testing.T, f *pqLedgerFixture) *pqLedgerFixture {
	t.Helper()
	classic, err := secp256k1.GeneratePrivateKey()
	pqMust(t, err)
	t.Cleanup(classic.Zero)
	owner, err := nativeResourceAddress(classic.PubKey().SerializeCompressed())
	pqMust(t, err)
	key, public, err := ynxbatch.KeyGen()
	pqMust(t, err)
	t.Cleanup(key.Destroy)
	_, err = f.d.Faucet(owner, 1000)
	pqMust(t, err)
	return &pqLedgerFixture{d: f.d, classic: classic, key: key, public: public, owner: owner, to: f.to, network: bytes.Clone(f.network)}
}

func TestPQRevocationRealPipelinePreservesHistoryAndClosesAllAuthorization(t *testing.T) {
	f := newPQLedger(t)
	migration := f.activate(t)
	genesis := f.d.blocks[0].Hash
	member := f.member(t, 2, 2)
	_, _, err := f.d.SubmitPQTransfer(member)
	pqMust(t, err)
	whole := f.whole(t, f.batchTransfer(3, 1), f.batchTransfer(4, 1))
	batch, err := f.d.SubmitPQBatch(whole)
	pqMust(t, err)
	if len(batch.Results) != 2 || batch.Results[0].Outcome != "admitted" || batch.Results[1].Outcome != "admitted" {
		t.Fatal("QA historical batch did not execute")
	}
	beforeAccount, _ := f.d.Account(f.owner)
	f.d.mu.RLock()
	feeAddress := f.d.nextValidatorAddressLocked()
	f.d.mu.RUnlock()
	beforeFee, _ := f.d.Account(feeAddress)
	wire := pqRevocationWire(t, f, 5, 2, 1)
	tx, replayed, err := f.d.SubmitAccountRevocation(wire)
	pqMust(t, err)
	digest := sha256.Sum256(wire)
	if replayed || tx.Type != "account_revocation" || tx.Hash != "0x"+hex.EncodeToString(digest[:]) || tx.Memo != pqRevocationMemo+hex.EncodeToString(wire) || tx.From != f.owner || tx.To != f.owner || tx.Amount != 0 || tx.Fee != 1 || tx.Nonce != 5 {
		t.Fatal("revocation lost original wire, owner or exact fee/nonce identity")
	}
	afterAccount, _ := f.d.Account(f.owner)
	afterFee, _ := f.d.Account(feeAddress)
	if afterAccount.Balance != beforeAccount.Balance-1 || afterAccount.Nonce != 5 || afterAccount.ResourceUsage.BandwidthUsed != beforeAccount.ResourceUsage.BandwidthUsed+1 || afterFee.Balance != beforeFee.Balance+1 {
		t.Fatal("revocation did not atomically move fee, bandwidth and nonce")
	}
	var moved int64
	for _, flow := range tx.LotFlows {
		moved += flow.Amount
	}
	if moved != 1 || len(tx.LotFlows) == 0 {
		t.Fatal("revocation fee lost traceable lot flow")
	}
	view := f.d.AccountAuthorizationDetails(f.owner)
	pqMust(t, view.State.Validate(f.network))
	if view.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion || view.State.Version != ynxauth.PolicyRevocationVersion || len(view.State.Revocations) != 1 || len(view.State.Records) != 1 || view.ExecutionHeight != 2 {
		t.Fatal("pending revocation query lost full owner policy")
	}
	if _, effective := view.State.RevocationAt(f.owner, 2); effective {
		t.Fatal("revocation invalidated transactions in its own execution block")
	}
	// The explicit H+1 rule permits another ordinary transaction at H, while
	// terminal policy has already closed all future registration/recovery paths.
	_, _, err = f.d.SubmitPQTransfer(f.member(t, 6, 1))
	pqMust(t, err)
	next, nextPublic, err := ynxbatch.KeyGen()
	pqMust(t, err)
	defer next.Destroy()
	rotation := pqRevocationRotation(t, f, next, nextPublic, 7, 4)
	before := moduleBusinessState(t, f.d)
	if _, _, err := f.d.SubmitAccountMigration(rotation); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatalf("terminal registration gate reopened before effective height: %v", err)
	}
	assertModuleState(t, f.d, before)
	f.d.ProduceBlock()
	view = f.d.AccountAuthorizationDetails(f.owner)
	if revoked, ok := view.State.RevocationAt(f.owner, view.ExecutionHeight); !ok || revoked.RegisteredAt != 2 || revoked.RevokedFrom != 3 || view.CommittedHeight != 2 {
		t.Fatal("terminal policy did not become effective at H+1")
	}
	before = moduleBusinessState(t, f.d)
	newMember := f.member(t, 7, 1)
	newWhole := f.whole(t, f.batchTransfer(7, 1), f.batchTransfer(8, 1))
	classicMigration := pqClassicMigration(t, f.classic, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: nextPublic.PKA, PKB: nextPublic.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 7, ActivateAt: 4})
	for name, submit := range map[string]func() error{
		"classic transfer": func() error {
			_, _, e := f.d.SubmitSignedTransfer(SignedTransferInput{Hash: "0x" + strings.Repeat("6", 64), From: f.owner, To: f.to, Amount: 1, Fee: 1, Nonce: 7})
			return e
		},
		"Member":           func() error { _, _, e := f.d.SubmitPQTransfer(newMember); return e },
		"Whole":            func() error { _, e := f.d.SubmitPQBatch(newWhole); return e },
		"lawful rotation":  func() error { _, _, e := f.d.SubmitAccountMigration(rotation); return e },
		"classic recovery": func() error { _, _, e := f.d.SubmitAccountMigration(classicMigration); return e },
		"legacy stake":     func() error { _, _, e := f.d.Stake(f.owner, 1); return e },
	} {
		t.Run(name, func(t *testing.T) {
			if err := submit(); !errors.Is(err, ynxauth.ErrPolicy) {
				t.Fatalf("revoked authority accepted or wrong failure: %v", err)
			}
			assertModuleState(t, f.d, before)
		})
	}
	// Old receipts remain exact read/reconciliation operations after revocation.
	if replay, done, err := f.d.SubmitAccountRevocation(wire); err != nil || !done || replay.Hash != tx.Hash {
		t.Fatal("terminal receipt replay lost identity")
	}
	if _, done, err := f.d.SubmitAccountMigration(migration); err != nil || !done {
		t.Fatal("old migration cannot be read after revocation")
	}
	if _, done, err := f.d.SubmitPQTransfer(member); err != nil || !done {
		t.Fatal("old Member cannot be read after revocation")
	}
	if replay, err := f.d.SubmitPQBatch(whole); err != nil || !replay.Replayed || replay.BatchHash != batch.BatchHash {
		t.Fatal("old Whole cannot be read after revocation")
	}
	assertModuleState(t, f.d, before)
	restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, before)
	if restored.blocks[0].Hash != genesis || restored.accountPolicy.Version != ynxauth.PolicyRevocationVersion {
		t.Fatal("restart changed genesis or lost global terminal policy")
	}
	if _, _, err := restored.SubmitPQTransfer(newMember); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatal("restart reopened a revoked member")
	}
}

func TestPQRevocationCancelsPendingRotationButOtherOwnersKeepWorking(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	other := pqRevocationSecondOwner(t, f)
	next, public, err := ynxbatch.KeyGen()
	pqMust(t, err)
	defer next.Destroy()
	rotation := pqRevocationRotation(t, f, next, public, 2, 5)
	_, _, err = f.d.SubmitAccountMigration(rotation)
	pqMust(t, err)
	_, _, err = f.d.SubmitAccountRevocation(pqRevocationWire(t, f, 3, 2, 2))
	pqMust(t, err)
	// A different owner's first genuine migration is still admissible after the
	// global v2 transition; only the terminal owner's registration is closed.
	_, _, err = f.d.SubmitAccountMigration(other.migration(t, 3, 1))
	pqMust(t, err)
	if len(f.d.accountPolicy.Records) != 3 || f.d.accountPolicy.Revocations[0].ThroughRevision != 2 {
		t.Fatal("revocation deleted a pending pair or unrelated owner")
	}
	// Migration and its later terminal event share height 2. Snapshot history
	// reconstruction must use this owner's nonce order rather than invalidate the
	// migration with a tombstone that was only admitted afterward.
	pqMust(t, validateAccountPolicySnapshot(pqBatchSnapshotCopy(t, f.d)))
	f.d.ProduceBlock()
	view := f.d.AccountAuthorizationDetails(other.owner)
	if view.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion || view.State.Version != ynxauth.PolicyVersion || len(view.State.Records) != 1 || view.State.Records[0].Owner != other.owner || len(view.State.Revocations) != 0 {
		t.Fatal("unrelated owner received global terminal state or another owner's keys")
	}
	pqMust(t, view.State.Validate(other.network))
	if len(f.d.accountPolicy.Revocations) != 1 || f.d.accountPolicy.Version != ynxauth.PolicyRevocationVersion {
		t.Fatal("query projection rewrote the global persisted state")
	}
	otherMember := other.member(t, 2, 1)
	_, _, err = f.d.SubmitPQTransfer(otherMember)
	pqMust(t, err)
	otherWhole := other.whole(t, other.batchTransfer(3, 1), other.batchTransfer(4, 1))
	out, err := f.d.SubmitPQBatch(otherWhole)
	pqMust(t, err)
	if out.Results[0].Outcome != "admitted" || out.Results[1].Outcome != "admitted" {
		t.Fatal("global v2 froze a lawful unrelated owner")
	}
	// A separate still-classic account also retains its original lawful policy.
	legacy := pqRevocationSecondOwner(t, f)
	_, err = f.d.Transfer(legacy.owner, legacy.to, 1)
	pqMust(t, err)
	for f.d.blocks[len(f.d.blocks)-1].Height < 4 {
		f.d.ProduceBlock()
	}
	oldMember := f.member(t, 4, 1)
	future := *f
	future.key, future.public = next, public
	newMember := future.member(t, 4, 1)
	before := moduleBusinessState(t, f.d)
	for _, member := range [][]byte{oldMember, newMember} {
		if _, _, err := f.d.SubmitPQTransfer(member); !errors.Is(err, ynxauth.ErrPolicy) {
			t.Fatalf("cancelled current/pending pair escaped at original rotation height: %v", err)
		}
	}
	assertModuleState(t, f.d, before)
	restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, before)
	unknownView := restored.AccountAuthorizationDetails("0x9999999999999999999999999999999999999999")
	if unknownView.State.Version != ynxauth.PolicyVersion || len(unknownView.State.Records) != 0 || len(unknownView.State.Revocations) != 0 {
		t.Fatal("unregistered owner projection inherited another account's tombstone")
	}
	pqMust(t, unknownView.State.Validate(f.network))
}

func TestPQRevocationAuthenticatesCurrentDualProofBeforeAnyMutation(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	valid := pqRevocationWire(t, f, 2, 2, 1)
	before := moduleBusinessState(t, f.d)
	for _, branch := range []string{"A", "B"} {
		bad, err := ynxauth.DecodeRevocation(valid)
		pqMust(t, err)
		member, err := ynxbatch.DecodeMember(bad.CurrentPQProof)
		pqMust(t, err)
		if branch == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		bad.CurrentPQProof, err = ynxbatch.EncodeMember(member)
		pqMust(t, err)
		wire, err := bad.Encode()
		pqMust(t, err)
		if _, _, err := f.d.SubmitAccountRevocation(wire); err == nil {
			t.Fatalf("revocation with broken branch %s mutated ledger", branch)
		}
		assertModuleState(t, f.d, before)
	}
	for _, wire := range [][]byte{pqRevocationWire(t, f, 3, 2, 1), pqRevocationWire(t, f, 2, 3, 1), pqRevocationWire(t, f, 2, 2, 2), valid[:len(valid)-1], append(bytes.Clone(valid), 0)} {
		if tx, replayed, err := f.d.SubmitAccountRevocation(wire); err == nil || replayed || tx.Hash != "" {
			t.Fatal("invalid sequence/height/wire revocation obtained a transaction")
		}
		assertModuleState(t, f.d, before)
	}
	proposed, _, err := ynxbatch.KeyGen()
	pqMust(t, err)
	defer proposed.Destroy()
	bad, err := ynxauth.DecodeRevocation(valid)
	pqMust(t, err)
	message, err := bad.Intent.SigningBytes()
	pqMust(t, err)
	_, bad.CurrentPQProof = pqRevocationProofs(t, proposed, f.network, f.owner, ynxauth.RevocationPurpose, message)
	wrongPair, err := bad.Encode()
	pqMust(t, err)
	if _, _, err := f.d.SubmitAccountRevocation(wrongPair); err == nil {
		t.Fatal("new-pair possession revoked an account without current authority")
	}
	assertModuleState(t, f.d, before)
}

func TestPQRevocationDurabilityRollbackUnknownReplayAndRestart(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		name := "before-rename"
		if afterRename {
			name = "after-rename"
		}
		t.Run(name, func(t *testing.T) {
			f := newPQLedger(t)
			f.activate(t)
			wire := pqRevocationWire(t, f, 2, 2, 1)
			before := moduleBusinessState(t, f.d)
			target := f.d.snapshotPath() + ".tmp"
			if afterRename {
				target = f.d.snapshotIntegrityMarkerPath() + ".tmp"
			}
			unblock := blockSnapshotWrite(t, target)
			tx, replayed, err := f.d.SubmitAccountRevocation(wire)
			if err == nil || replayed {
				t.Fatal("failed durability returned revocation acceptance")
			}
			if !afterRename {
				if errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash != "" || f.d.accountPolicy.Version != ynxauth.PolicyVersion {
					t.Fatal("definite pre-rename failure did not restore original policy")
				}
				assertModuleState(t, f.d, before)
			} else {
				if !errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash == "" || len(f.d.accountPolicy.Revocations) != 1 || f.d.accountPolicy.Version != ynxauth.PolicyRevocationVersion {
					t.Fatal("UNKNOWN lost terminal policy or original transaction identity")
				}
				retained := moduleBusinessState(t, f.d)
				original, durability, found := f.d.TransactionWithDurability(tx.Hash)
				if !found || original.Hash != tx.Hash || durability.Status != "uncertain" || f.d.AccountAuthorizationDetails(f.owner).CheckpointStatus != "uncertain" {
					t.Fatal("UNKNOWN cannot be distinguished from durable revocation")
				}
				if retry, done, err := f.d.SubmitAccountRevocation(wire); !errors.Is(err, ErrSnapshotDurabilityUncertain) || done || retry.Hash != tx.Hash {
					t.Fatal("UNKNOWN retry fabricated a new intent or success")
				}
				assertModuleState(t, f.d, retained)
				cold := readTransferSnapshot(t, f.d)
				assertModuleState(t, cold, retained)
			}
			unblock()
			accepted, replayed, err := f.d.SubmitAccountRevocation(wire)
			pqMust(t, err)
			if replayed != afterRename || accepted.Hash == "" || (afterRename && accepted.Hash != tx.Hash) {
				t.Fatal("repaired checkpoint changed original revocation identity")
			}
			sender, _ := f.d.Account(f.owner)
			if sender.Balance != 998 || sender.Nonce != 2 || len(f.d.accountPolicy.Revocations) != 1 {
				t.Fatal("retry consumed nonce or fee twice")
			}
			state := moduleBusinessState(t, f.d)
			restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
			pqMust(t, err)
			assertModuleState(t, restored, state)
			if old, done, err := restored.SubmitAccountRevocation(wire); err != nil || !done || old.Hash != accepted.Hash {
				t.Fatal("cold original-wire reconciliation failed")
			}
			assertModuleState(t, restored, state)
		})
	}
}

func TestPQRevocationSnapshotProofCoverageAndAppendOnlyContinuation(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	before := cloneAccountPolicy(f.d.accountPolicy)
	wire := pqRevocationWire(t, f, 2, 2, 1)
	tx, _, err := f.d.SubmitAccountRevocation(wire)
	pqMust(t, err)
	after := cloneAccountPolicy(f.d.accountPolicy)
	pqMust(t, validateAccountPolicyContinuation(before, after))
	pqMust(t, validateAccountPolicyContinuation(after, cloneAccountPolicy(after)))
	if err := validateAccountPolicyContinuation(after, before); err == nil {
		t.Fatal("v2 terminal state downgraded to v1")
	}
	for name, mutate := range map[string]func(*devnetSnapshot){
		"missing proof":   func(s *devnetSnapshot) { s.Pending = nil },
		"duplicate proof": func(s *devnetSnapshot) { s.Pending = append(s.Pending, tx) },
		"missing tombstone": func(s *devnetSnapshot) {
			s.AccountPolicy.Revocations = nil
			s.AccountPolicy.Version = ynxauth.PolicyVersion
		},
		"changed registered height": func(s *devnetSnapshot) {
			s.AccountPolicy.Revocations[0].RegisteredAt++
			s.AccountPolicy.Revocations[0].RevokedFrom++
		},
		"changed nonce":             func(s *devnetSnapshot) { s.AccountPolicy.Revocations[0].LedgerNonce++ },
		"wrong transaction fee":     func(s *devnetSnapshot) { s.Pending[0].Fee++ },
		"wrong transaction nonce":   func(s *devnetSnapshot) { s.Pending[0].Nonce++ },
		"wrong transaction owner":   func(s *devnetSnapshot) { s.Pending[0].From = f.to },
		"missing original memo":     func(s *devnetSnapshot) { s.Pending[0].Memo = "discarded proof" },
		"wrong transaction hash":    func(s *devnetSnapshot) { s.Pending[0].Hash = "0x" + strings.Repeat("7", 64) },
		"wrong full historical key": func(s *devnetSnapshot) { s.AccountPolicy.Records[0].PKA[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			bad := pqBatchSnapshotCopy(t, f.d)
			mutate(&bad)
			if err := validateAccountPolicySnapshot(bad); err == nil {
				t.Fatal("revocation snapshot accepted missing or rewritten original evidence")
			}
		})
	}
	pqMust(t, validateAccountPolicySnapshot(pqBatchSnapshotCopy(t, f.d)))
	for name, mutate := range map[string]func(*ynxauth.State){
		"remove":         func(s *ynxauth.State) { s.Revocations = nil; s.Version = ynxauth.PolicyVersion },
		"rewrite height": func(s *ynxauth.State) { s.Revocations[0].RegisteredAt++; s.Revocations[0].RevokedFrom++ },
		"rewrite nonce":  func(s *ynxauth.State) { s.Revocations[0].LedgerNonce++ },
	} {
		t.Run(name, func(t *testing.T) {
			bad := after.Clone()
			mutate(&bad)
			if err := validateAccountPolicyContinuation(after, &bad); err == nil {
				t.Fatal("terminal history was removed or rewritten")
			}
		})
	}
	if !reflect.DeepEqual(before.Records, after.Records) || !bytes.Equal(before.NetworkID, after.NetworkID) || before.EnableAt != after.EnableAt {
		t.Fatal("revocation altered original public registration history")
	}
}

func TestPQRevocationRefreshesAlreadyAuthenticatedWholeForEveryMember(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	whole := f.whole(t, f.batchTransfer(2, 1), f.batchTransfer(3, 1))
	state := f.d.accountPolicy.Clone()
	admission, err := authenticatePQBatch(whole, &state, 2, f.d.cfg.ChainID)
	pqMust(t, err)
	defer admission.verifier.Clear()
	_, err = admission.transfer(0, 2)
	pqMust(t, err)
	revocation, err := ynxauth.DecodeRevocation(pqRevocationWire(t, f, 2, 2, 1))
	pqMust(t, err)
	revoked, err := state.AdmitRevocation(revocation, 2, 1)
	pqMust(t, err)
	state = revoked
	if _, err := admission.transfer(1, 3); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatalf("previously authenticated Whole ignored terminal eligibility: %v", err)
	}
	// Historical use of the same full proof at its actual original height stays
	// legal; current terminal policy is not retroactive signature invalidation.
	_, err = admission.transfer(1, 2)
	pqMust(t, err)
}

func TestPQRevocationReplicationUpgradeCannotEraseTerminalHistory(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	v1, err := f.d.ReplicationSnapshotJSON()
	pqMust(t, err)
	wire := pqRevocationWire(t, f, 2, 2, 1)
	tx, _, err := f.d.SubmitAccountRevocation(wire)
	pqMust(t, err)
	for _, batchMode := range []bool{false, true} {
		name := "full"
		if batchMode {
			name = "batch"
		}
		t.Run(name, func(t *testing.T) {
			destination, err := NewPersistentDevnet(f.d.cfg, t.TempDir())
			pqMust(t, err)
			_, err = destination.ApplyReplicationSnapshotJSON(v1, false)
			pqMust(t, err)
			var result ReplicationApplyResult
			if batchMode {
				base := destination.LatestBlock()
				payload, err := f.d.ReplicationBatchJSON(base.Height, base.Hash)
				pqMust(t, err)
				result, err = destination.ApplyReplicationBatchJSON(payload)
				pqMust(t, err)
			} else {
				payload, err := f.d.ReplicationSnapshotJSON()
				pqMust(t, err)
				result, err = destination.ApplyReplicationSnapshotJSON(payload, false)
				pqMust(t, err)
			}
			if !result.Applied || !reflect.DeepEqual(destination.accountPolicy, f.d.accountPolicy) {
				t.Fatal("same-height replication dropped the explicit terminal upgrade")
			}
			if got, found := destination.Transaction(tx.Hash); !found || got.Memo != tx.Memo || got.Nonce != 2 {
				t.Fatal("replication lost the original revocation wire or nonce")
			}
			before := moduleBusinessState(t, destination)
			if _, err := destination.ApplyReplicationSnapshotJSON(v1, true); err == nil {
				t.Fatal("authoritative rebase erased terminal history")
			}
			assertModuleState(t, destination, before)
			restored, err := NewPersistentDevnet(destination.cfg, destination.dataDir)
			pqMust(t, err)
			assertModuleState(t, restored, before)
			if replay, done, err := restored.SubmitAccountRevocation(wire); err != nil || !done || replay.Hash != tx.Hash {
				t.Fatal("replicated original wire failed cold idempotent reconciliation")
			}
			assertModuleState(t, restored, before)
		})
	}
}
