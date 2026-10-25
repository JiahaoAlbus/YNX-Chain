package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type abciRevocationFixture struct {
	d                     *chain.Devnet
	a                     *Application
	m                     chain.ConsensusMigrationState
	path                  string
	classic, otherClassic *secp256k1.PrivateKey
	key, otherKey         *ynxbatch.PrivateKey
	public, otherPublic   ynxbatch.PublicKey
	owner, other          string
	network               []byte
}

func newABCIRevocationFixture(t *testing.T) *abciRevocationFixture {
	t.Helper()
	f := &abciRevocationFixture{classic: deterministicPrivateKey(193), otherClassic: deterministicPrivateKey(194)}
	f.owner, f.other = mustNativeAddress(t, f.classic), mustNativeAddress(t, f.otherClassic)
	var err error
	f.d, err = chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{f.owner, f.other} {
		if _, err = f.d.Faucet(owner, 100); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	if err = f.d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	f.m, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.network, err = hex.DecodeString(f.m.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	f.key, f.public, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.key.Destroy)
	f.otherKey, f.otherPublic, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.otherKey.Destroy)
	f.path = filepath.Join(t.TempDir(), "revocation-state.json")
	f.a, err = NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func abciRegistrationWire(t *testing.T, classic *secp256k1.PrivateKey, current, proposed *ynxbatch.PrivateKey, intent ynxauth.RegistrationIntent) []byte {
	t.Helper()
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	whole, _ := consensusPQProof(t, proposed, intent.ChainID, intent.Owner, ynxauth.MigrationPurpose, message)
	m := ynxauth.Migration{Intent: intent, NewKeyProof: whole}
	if current != nil {
		_, m.CurrentPQProof = consensusPQProof(t, current, intent.ChainID, intent.Owner, ynxauth.MigrationPurpose, message)
	} else {
		digest := sha256.Sum256(message)
		m.ClassicPublicKey, m.ClassicSignature = classic.PubKey().SerializeCompressed(), ecdsa.Sign(classic, digest[:]).Serialize()
	}
	wire, err := m.Encode()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func (f *abciRevocationFixture) registration(t *testing.T, other bool, activate uint64) []byte {
	classic, key, public, owner := f.classic, f.key, f.public, f.owner
	if other {
		classic, key, public, owner = f.otherClassic, f.otherKey, f.otherPublic, f.other
	}
	return abciRegistrationWire(t, classic, nil, key, ynxauth.RegistrationIntent{ChainID: f.network, Owner: owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: activate})
}

func (f *abciRevocationFixture) revocation(t *testing.T, nonce, height, through uint64) []byte {
	t.Helper()
	intent := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB, AuthorizingRevision: 1, ThroughRevision: through, LedgerNonce: nonce, ExecuteAt: height, RevokeAt: height + 1}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, proof := consensusPQProof(t, f.key, f.network, f.owner, ynxauth.RevocationPurpose, message)
	wire, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: proof}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func (f *abciRevocationFixture) transferMessage(t *testing.T, other bool, nonce, amount uint64) []byte {
	t.Helper()
	from, to := f.owner, f.other
	if other {
		from, to = f.other, f.owner
	}
	message, err := (ynxauth.Transfer{ChainID: f.network, NativeChainID: uint64(f.m.Network.ChainID), From: from, To: to, Amount: amount, Fee: 1, Nonce: nonce}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	return message
}

func (f *abciRevocationFixture) transfer(t *testing.T, other bool, nonce, amount uint64) []byte {
	key, owner := f.key, f.owner
	if other {
		key, owner = f.otherKey, f.other
	}
	_, wire := consensusPQProof(t, key, f.network, owner, ynxauth.TransactionPurpose, f.transferMessage(t, other, nonce, amount))
	return wire
}

func mustPQEnvelope(t *testing.T, kind string, wire []byte) []byte {
	t.Helper()
	payload, err := EncodePQTransaction(kind, wire)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestABCIRevocationRealExecutionHistoricalValidationAndRestart(t *testing.T) {
	f := newABCIRevocationFixture(t)
	ctx := context.Background()
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 2, 7)))
	before := queryConsensusAccount(t, f.a, f.owner)
	beforeFee := queryConsensusAccount(t, f.a, f.a.feeRecipient)
	originalRecords := f.a.committed.AccountPolicy.Clone().Records
	wire := f.revocation(t, 3, 4, 1)
	payload := mustPQEnvelope(t, PQRevocationType, wire)
	snapshot := mustJSON(t, f.a.committed)
	check, err := f.a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || check.Code != 0 || !bytes.Equal(snapshot, mustJSON(t, f.a.committed)) {
		t.Fatalf("current dual-proof CheckTx failed or mutated state: %+v %v", check, err)
	}
	isolated, _, err := f.a.applyTransaction(f.a.cloneExecutionState(), payload, 4, time.Unix(4, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	flow := isolated.pqHistory[len(isolated.pqHistory)-1].Transaction.LotFlows[0]
	oi, _ := accountIndex(isolated.accounts, f.owner)
	fi, _ := accountIndex(isolated.accounts, f.a.feeRecipient)
	if isolated.accounts[oi].Balance != before.Balance-1 || isolated.accounts[oi].Nonce != 3 || isolated.accounts[oi].Lots[flow.LotID] != before.Lots[flow.LotID]-1 || isolated.accounts[fi].Lots[flow.LotID] != beforeFee.Lots[flow.LotID]+1 || isolated.traceLots[flow.LotID].LastInbound != f.a.feeRecipient {
		t.Fatal("revocation fee, nonce or actual lot movement differs from its proof")
	}
	proposal := [][]byte{payload, mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 4, 1)), mustPQEnvelope(t, PQMigrationType, f.registration(t, true, 5))}
	prepared, err := f.a.PrepareProposal(ctx, &abcitypes.RequestPrepareProposal{Height: 4, Time: time.Unix(4, 0).UTC(), Txs: proposal, MaxTxBytes: math.MaxInt64})
	if err != nil || len(prepared.Txs) != len(proposal) {
		t.Fatalf("H+1 semantics lost during proposal preparation: %+v %v", prepared, err)
	}
	processed, err := f.a.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: 4, Time: time.Unix(4, 0).UTC(), Txs: proposal})
	if err != nil || processed.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("authentic revocation proposal rejected: %+v %v", processed, err)
	}
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), proposal...)
	state := f.a.committed
	after := queryConsensusAccount(t, f.a, f.owner)
	afterFee := queryConsensusAccount(t, f.a, f.a.feeRecipient)
	if after.Balance != before.Balance-3 || after.Nonce != 4 || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+2 || afterFee.Balance != beforeFee.Balance+3 {
		t.Fatal("revocation/same-height transfer did not consume exact fee, nonce and usage")
	}
	if state.AccountPolicy.Version != ynxauth.PolicyRevocationVersion || len(state.AccountPolicy.Revocations) != 1 {
		t.Fatal("terminal policy lost its tombstone")
	}
	for _, original := range originalRecords {
		found := false
		for _, current := range state.AccountPolicy.Records {
			if current.Owner == original.Owner && current.Revision == original.Revision {
				found = reflect.DeepEqual(original, current)
			}
		}
		if !found {
			t.Fatal("terminal policy rewrote original keys")
		}
	}
	var entry PQCommittedAuthorization
	for _, value := range state.PQHistory {
		if value.Transaction.Type == PQRevocationType {
			entry = value
		}
	}
	if entry.Transaction.Hash != SignedTransactionHash(wire) || entry.ABCITransactionHash != SignedTransactionHash(payload) || len(entry.Transaction.LotFlows) != 1 {
		t.Fatal("original revocation proof or fee flow lost")
	}
	flow = entry.Transaction.LotFlows[0]
	if flow.Amount != 1 || flow.From != f.owner || flow.To != f.a.feeRecipient {
		t.Fatal("revocation lineage does not identify its actual fee destination")
	}
	if _, err := state.AccountPolicy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, 4); err != nil {
		t.Fatal("future tombstone retroactively invalidated H")
	}
	if _, err := state.AccountPolicy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, 5); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatal("terminal policy still authorizes its old pair")
	}
	classic, err := NewSignedTransfer(f.classic, f.m.Network.ChainID, f.other, 1, 5)
	if err != nil {
		t.Fatal(err)
	}
	classicWire, err := EncodeSignedTransaction(classic)
	if err != nil {
		t.Fatal(err)
	}
	call := IDEContractCallPayload{Address: f.other, Calldata: "0x60fe47b1" + strings.Repeat("0", 64), IdempotencyKey: "revoked-classic-contract"}
	call.RequestHash = IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	action, err := NewSignedApplicationAction(f.classic, f.m.Network.ChainID, ActionIDEContractCall, call, 5)
	if err != nil {
		t.Fatal(err)
	}
	actionWire, err := EncodeSignedApplicationAction(action)
	if err != nil {
		t.Fatal(err)
	}
	for name, invalid := range map[string][]byte{"classic": classicWire, "old action and EVM": actionWire, "old PQ pair": mustPQEnvelope(t, PQTransferType, f.transfer(t, false, 5, 1)), "replayed revocation": payload} {
		t.Run(name, func(t *testing.T) {
			before := mustJSON(t, f.a.committed)
			out, err := f.a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: invalid})
			if err != nil || out.Code == 0 || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
				t.Fatalf("terminal admission changed state or allowed %s: %+v %v", name, out, err)
			}
		})
	}
	commitSponsorBlock(t, f.a, 5, time.Unix(5, 0).UTC(), mustPQEnvelope(t, PQTransferType, f.transfer(t, true, 2, 1)))
	restarted, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, f.a.committed), mustJSON(t, restarted.committed)) {
		t.Fatal("restart changed policy, original proof, fee, nonce or lot state")
	}
	if _, err := restarted.committed.AccountPolicy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, 6); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatal("restart reopened revoked authority")
	}
}

func TestABCIRevocationRejectsEitherSignatureAndExecutionFailuresAtomically(t *testing.T) {
	f := newABCIRevocationFixture(t)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	wire := f.revocation(t, 2, 3, 1)
	for _, branch := range []string{"A", "B"} {
		t.Run(branch, func(t *testing.T) {
			r, err := ynxauth.DecodeRevocation(wire)
			if err != nil {
				t.Fatal(err)
			}
			m, err := ynxbatch.DecodeMember(r.CurrentPQProof)
			if err != nil {
				t.Fatal(err)
			}
			if branch == "A" {
				m.Certificate.SigmaA[0] ^= 1
			} else {
				m.Certificate.SigmaB[0] ^= 1
			}
			r.CurrentPQProof, err = ynxbatch.EncodeMember(m)
			if err != nil {
				t.Fatal(err)
			}
			bad, err := r.Encode()
			if err != nil {
				t.Fatal(err)
			}
			before := mustJSON(t, f.a.committed)
			out, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: mustPQEnvelope(t, PQRevocationType, bad)})
			if err != nil || out.Code == 0 || !bytes.Equal(before, mustJSON(t, f.a.committed)) {
				t.Fatal("one broken PQ branch admitted or partially charged revocation")
			}
		})
	}
	payload := mustPQEnvelope(t, PQRevocationType, wire)
	for name, mutate := range map[string]func(*executionState){
		"no balance": func(s *executionState) { i, _ := accountIndex(s.accounts, f.owner); s.accounts[i].Balance = 0 },
		"no traceable lot": func(s *executionState) {
			i, _ := accountIndex(s.accounts, f.owner)
			s.accounts[i].Lots = map[string]int64{}
		},
		"bandwidth overflow": func(s *executionState) {
			i, _ := accountIndex(s.accounts, f.owner)
			s.accounts[i].ResourceUsage.BandwidthUsed = math.MaxInt64
		},
		"recipient overflow": func(s *executionState) {
			i, _ := accountIndex(s.accounts, f.a.feeRecipient)
			s.accounts[i].Balance = math.MaxInt64
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := f.a.cloneExecutionState()
			mutate(&candidate)
			accounts := cloneAccounts(candidate.accounts)
			policy := candidate.accountPolicy.Clone()
			lots := cloneTraceLots(candidate.traceLots)
			if _, _, err := f.a.applyTransaction(candidate, payload, 3, time.Unix(3, 0).UTC()); err == nil {
				t.Fatal("invalid revocation effects accepted")
			}
			if !reflect.DeepEqual(accounts, candidate.accounts) || !reflect.DeepEqual(policy, *candidate.accountPolicy) || !reflect.DeepEqual(lots, candidate.traceLots) {
				t.Fatal("failed revocation mutated its input candidate")
			}
		})
	}
}

func TestABCIRevocationProofCoverageAndLiveAppendOnlyBoundary(t *testing.T) {
	f := newABCIRevocationFixture(t)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	before := f.a.committed
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 2, 3, 1)))
	if err := validateConsensusPQContinuation(before, f.a.committed); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*CommittedState){
		"proof removed":    func(s *CommittedState) { s.PQHistory = s.PQHistory[:1] },
		"proof duplicated": func(s *CommittedState) { s.PQHistory = append(s.PQHistory, s.PQHistory[1]) },
		"tombstone removed": func(s *CommittedState) {
			s.AccountPolicy.Version = ynxauth.PolicyVersion
			s.AccountPolicy.Revocations = nil
		},
		"fee omitted":            func(s *CommittedState) { s.FeeEvents = s.FeeEvents[:1] },
		"lot flow omitted":       func(s *CommittedState) { s.PQHistory[1].Transaction.LotFlows = nil },
		"lot flow changed":       func(s *CommittedState) { s.PQHistory[1].Transaction.LotFlows[0].Amount++ },
		"transport hash changed": func(s *CommittedState) { s.PQHistory[1].ABCITransactionHash = SignedTransactionHash([]byte("changed")) },
		"unconsumed nonce":       func(s *CommittedState) { i, _ := accountIndex(s.Accounts, f.owner); s.Accounts[i].Nonce = 1 },
		"fabricated sponsor authority": func(s *CommittedState) {
			s.PQHistory[1].Transaction.Sponsor = f.owner
			s.PQHistory[1].Transaction.SponsorPoolID = "invented-pool"
			s.PQHistory[1].Transaction.ResourceConsumed = 100
		},
		"fabricated source receipt": func(s *CommittedState) {
			s.PQHistory[1].Transaction.BlockHash = SignedTransactionHash([]byte("not-a-source-block"))
		},
	} {
		t.Run(name, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			mutate(&bad)
			var err error
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			if err = bad.Validate(f.m); err == nil {
				t.Fatal("rehashed incomplete authorization state accepted")
			}
		})
	}
	if err := validateConsensusPQContinuation(f.a.committed, before); err == nil {
		t.Fatal("live transition deleted both tombstone and proof")
	}
	cloned := f.a.cloneExecutionState()
	cloned.pqHistory[1].Transaction.LotFlows[0].Amount++
	if f.a.committed.PQHistory[1].Transaction.LotFlows[0].Amount != 1 {
		t.Fatal("candidate aliases committed fee flow")
	}
	// A rehashed document with no policy must not be able to manufacture a
	// structurally valid revocation fee event outside the normal proof loop.
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(f.owner, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	withoutPolicy, err := NewApplication(m)
	if err != nil {
		t.Fatal(err)
	}
	bad := withoutPolicy.committed
	bad.FeeEvents = []BFTFeeEvent{newCurrentFeeEvent(SignedTransactionHash([]byte("orphan revocation")), PQRevocationType, f.owner, withoutPolicy.feeRecipient, 1, int64(m.Height), time.Unix(int64(m.Height), 0).UTC())}
	bad.AppHash, err = bad.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	if err = bad.Validate(m); err == nil {
		t.Fatal("orphan revocation fee accepted without any account policy or proof")
	}
}

func TestABCIRevocationCanonicalEnvelopeBound(t *testing.T) {
	payload := mustPQEnvelope(t, PQRevocationType, []byte{0xab})
	if kind, err := TransactionEnvelopeType(payload); err != nil || kind != PQRevocationType {
		t.Fatal("revocation did not reach actual ABCI router")
	}
	if _, _, err := DecodePQTransaction(payload); err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]byte{append(bytes.Clone(payload), ' '), bytes.Replace(payload, []byte(`"ab"`), []byte(`"AB"`), 1), bytes.Replace(payload, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1)} {
		if _, _, err := DecodePQTransaction(bad); err == nil {
			t.Fatal("noncanonical revocation transport accepted")
		}
	}
	if _, err := EncodePQTransaction(PQRevocationType, make([]byte, ynxauth.MaxRevocationBytes+1)); err == nil {
		t.Fatal("oversized revocation envelope accepted")
	}
}

func TestABCIRevocationCancelsSameHeightPendingRotationWithoutRewritingHistory(t *testing.T) {
	f := newABCIRevocationFixture(t)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	next, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer next.Destroy()
	rotation := abciRegistrationWire(t, nil, f.key, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 2, ActivateAt: 5})
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQMigrationType, rotation), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 3, 3, 2)))
	if len(f.a.committed.AccountPolicy.Records) != 2 || f.a.committed.AccountPolicy.Revocations[0].ThroughRevision != 2 || len(f.a.committed.PQHistory) != 3 {
		t.Fatal("terminal decision deleted same-height rotation or its genuine authorization")
	}
	if err := f.a.committed.Validate(f.m); err != nil {
		t.Fatal("later same-height tombstone invalidated the preceding migration", err)
	}
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC())
	commitSponsorBlock(t, f.a, 5, time.Unix(5, 0).UTC())
	_, member := consensusPQProof(t, next, f.network, f.owner, ynxauth.TransactionPurpose, f.transferMessage(t, false, 4, 1))
	out, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: mustPQEnvelope(t, PQTransferType, member)})
	if err != nil || out.Code == 0 {
		t.Fatal("revoked pending keys activated later")
	}
	restarted, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, f.a.committed), mustJSON(t, restarted.committed)) {
		t.Fatal("same-height historical policy changed across restart")
	}
}
