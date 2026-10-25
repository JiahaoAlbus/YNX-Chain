package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func walletAccountQuery(t *testing.T, a *Application, owner string) PQWalletAccountView {
	t.Helper()
	r, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQWalletAuthorizationPath + owner})
	var v PQWalletAccountView
	if err != nil || r.Code != 0 || json.Unmarshal(r.Value, &v) != nil || v.CommittedHeight != r.Height {
		t.Fatalf("account query: %+v %v", r, err)
	}
	if err := ValidatePQWalletAccountView(v, owner); err != nil {
		t.Fatal(err)
	}
	return v
}

func walletHistoryQuery(t *testing.T, a *Application, hash string) PQWalletHistoryView {
	t.Helper()
	r, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQWalletHistoryPath + hash})
	var v PQWalletHistoryView
	if err != nil || r.Code != 0 || json.Unmarshal(r.Value, &v) != nil || v.Authorization.CommittedHeight != r.Height {
		t.Fatalf("history query: %+v %v", r, err)
	}
	return v
}

func TestPQWalletQueryCommittedMigrationRotationRevocationAndRestart(t *testing.T) {
	f := newABCIRevocationFixture(t)
	ctx := context.Background()
	before := walletAccountQuery(t, f.a, f.owner)
	registration := f.registration(t, false, 3)
	payloads := [][]byte{mustPQEnvelope(t, PQMigrationType, registration), mustPQEnvelope(t, PQMigrationType, f.registration(t, true, 3))}
	result, err := f.a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: 2, Time: time.Unix(2, 0).UTC(), Txs: payloads})
	if err != nil || len(result.TxResults) != 2 || result.TxResults[0].Code != 0 || result.TxResults[1].Code != 0 {
		t.Fatalf("real registration Finalize: %+v %v", result, err)
	}
	if actual := walletAccountQuery(t, f.a, f.owner); !reflect.DeepEqual(actual, before) {
		t.Fatal("uncommitted candidate escaped the Wallet query")
	}
	r, err := f.a.Query(ctx, &abcitypes.RequestQuery{Path: PQWalletHistoryPath + SignedTransactionHash(registration)})
	if err != nil || r.Code == 0 {
		t.Fatal("uncommitted migration escaped history query")
	}
	if _, err = f.a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	active := walletAccountQuery(t, f.a, f.owner)
	if active.CommittedHeight != 2 || active.ExecutionHeight != 3 || active.LedgerNonce != 1 || active.CommittedAuthorizationStatus != "pending_activation" || active.CommittedPQSigningEnabled || active.AuthorizationStatus != "active" || !active.PQSigningEnabled || len(active.Policy.Records) != 1 || active.Policy.Records[0].Owner != f.owner || !bytes.Equal(active.Policy.Records[0].PKA, f.public.PKA) || active.NetworkID != f.m.OriginalGenesisHash || active.NativeChainID != 6423 {
		t.Fatalf("incomplete next/committed account view: %+v", active)
	}
	// Mutating decoded output cannot replace the ledger's full registered key.
	active.Policy.Records[0].PKA[0] ^= 1
	if bytes.Equal(walletAccountQuery(t, f.a, f.owner).Policy.Records[0].PKA, active.Policy.Records[0].PKA) {
		t.Fatal("query exposed ledger-owned key storage")
	}
	transfer := f.transfer(t, false, 2, 7)
	next, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer next.Destroy()
	rotation := abciRegistrationWire(t, nil, f.key, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 3, ActivateAt: 5})
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQTransferType, transfer), mustPQEnvelope(t, PQMigrationType, rotation))
	commitSponsorBlock(t, f.a, 4, time.Unix(4, 0).UTC(), mustPQEnvelope(t, PQRevocationType, f.revocation(t, 4, 4, 2)))
	v := walletAccountQuery(t, f.a, f.owner)
	if v.LedgerNonce != 4 || v.AuthorizationStatus != "revoked" || v.PQSigningEnabled || v.CommittedAuthorizationStatus != "revocation_pending" || !v.CommittedPQSigningEnabled || len(v.Policy.Records) != 2 || len(v.Policy.Revocations) != 1 || v.Policy.Revocations[0].ThroughRevision != 2 || v.Policy.Version != ynxauth.PolicyRevocationVersion || v.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion {
		t.Fatalf("terminal history or cancelled rotation omitted: %+v", v)
	}
	other := walletAccountQuery(t, f.a, f.other)
	if !other.PQSigningEnabled || other.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion || other.Policy.Version != ynxauth.PolicyVersion || len(other.Policy.Revocations) != 0 || len(other.Policy.Records) != 1 || other.Policy.Records[0].Owner != f.other {
		t.Fatal("global v2 froze another owner or leaked another owner's history")
	}
	history := walletHistoryQuery(t, f.a, SignedTransactionHash(transfer))
	if history.Source != "comet-rpc" || history.ExecutionHeight != 3 || history.Authorization.ExecutionHeight != 5 || history.ABCITransactionHash != SignedTransactionHash(mustPQEnvelope(t, PQTransferType, transfer)) || history.Transaction.Memo != pqTransferMemo+hex.EncodeToString(transfer) || !reflect.DeepEqual(history.Authorization, v) {
		t.Fatal("original history identity or same committed view changed")
	}
	if err := chain.ValidateConsensusHistoricalPQTransaction(history.Transaction, history.Authorization.Policy, history.ExecutionHeight, history.Authorization.NativeChainID); err != nil {
		t.Fatalf("current revocation erased lawful historical authorization: %v", err)
	}
	restarted, err := NewPersistentApplication(f.m, f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(walletAccountQuery(t, restarted, f.owner), v) || !reflect.DeepEqual(walletHistoryQuery(t, restarted, SignedTransactionHash(transfer)), history) {
		t.Fatal("cold restart changed complete Wallet evidence")
	}
}

func TestPQWalletQuerySourceImportAndDisabledPolicy(t *testing.T) {
	f := newABCIRevocationFixture(t)
	wire := f.registration(t, false, 3)
	if _, _, err := f.d.SubmitAccountMigration(wire); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	migration, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	history := walletHistoryQuery(t, app, SignedTransactionHash(wire))
	if history.Source != "source_import" || history.ABCITransactionHash != "" || history.ExecutionHeight != 2 || history.Transaction.BlockHash == "" || history.Authorization.CommittedHeight != 2 {
		t.Fatal("source transaction was relabeled as Comet history")
	}
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err = d.Faucet(f.owner, 10); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	disabled, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err = NewApplication(disabled)
	if err != nil {
		t.Fatal(err)
	}
	v := walletAccountQuery(t, app, f.owner)
	if v.Enabled || v.Policy != nil || v.GlobalPolicyVersion != "" || v.PQSigningEnabled || v.AuthorizationStatus != "legacy" {
		t.Fatal("disabled chain gained a PQ policy from query")
	}
}

func TestPQWalletQueryRejectsHeightOwnerAndHistoryTampering(t *testing.T) {
	f := newABCIRevocationFixture(t)
	wire := f.registration(t, false, 3)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, wire))
	accountPath := PQWalletAuthorizationPath + f.owner
	historyPath := PQWalletHistoryPath + SignedTransactionHash(wire)
	for _, path := range []string{accountPath, historyPath} {
		for _, req := range []abcitypes.RequestQuery{{Path: path, Height: 1}, {Path: path, Height: 3}, {Path: path, Height: -1}, {Path: path, Prove: true}, {Path: path, Data: []byte("{}")}} {
			r, err := f.a.Query(context.Background(), &req)
			if err != nil || r.Code == 0 || len(r.Value) != 0 {
				t.Fatalf("unsupported query silently became latest: %+v %+v %v", req, r, err)
			}
		}
		r, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: path, Height: 2})
		if err != nil || r.Code != 0 || r.Height != 2 {
			t.Fatal("exact committed height was rejected")
		}
	}
	for _, path := range []string{PQWalletAuthorizationPath + " " + f.owner, PQWalletAuthorizationPath + strings.ToUpper(f.owner), accountPath + "/", PQWalletHistoryPath + strings.ToUpper(SignedTransactionHash(wire)), PQWalletHistoryPath + "0x" + strings.Repeat("0", 64)} {
		r, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: path})
		if err != nil || r.Code == 0 {
			t.Fatalf("noncanonical or absent query accepted: %s", path)
		}
	}
	baseline := f.a.committed
	defer func() { f.a.committed = baseline }()
	f.a.committed.PQHistory = clonePQHistory(baseline.PQHistory)
	f.a.committed.PQHistory[0].ABCITransactionHash = "0x" + strings.Repeat("0", 64)
	r, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: historyPath})
	if err != nil || r.Code == 0 {
		t.Fatal("forged outer identity survived original query")
	}
	f.a.committed = baseline
	f.a.committed.Height = math.MaxInt64
	r, err = f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: accountPath})
	if err != nil || r.Code == 0 {
		t.Fatal("next-height overflow was published")
	}
}

func TestPQWalletRevocationQueryVerifiesActualFeeRecipientAndSourceLineage(t *testing.T) {
	f := newABCIRevocationFixture(t)
	registration := f.registration(t, false, 3)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, registration))
	previous := walletHistoryQuery(t, f.a, SignedTransactionHash(registration))
	previousJSON, err := json.Marshal(previous)
	if err != nil || previous.RevocationEffects != nil || bytes.Contains(previousJSON, []byte("revocationEffects")) {
		t.Fatal("migration response gained revocation-only fields")
	}
	wire := f.revocation(t, 2, 3, 1)
	commitSponsorBlock(t, f.a, 3, time.Unix(3, 0).UTC(), mustPQEnvelope(t, PQRevocationType, wire))
	hash := SignedTransactionHash(wire)
	original := walletHistoryQuery(t, f.a, hash)
	if err := ValidatePQWalletRevocationEffects(original); err != nil {
		t.Fatal(err)
	}
	effects := original.RevocationEffects
	if effects == nil || effects.FeeRecipient != "ynx_validator_0" || original.Transaction.LotFlows[0].To != effects.FeeRecipient || effects.FeeLot.Origin != f.m.Runtime.Lots[effects.FeeLot.LotID].Origin || effects.SourceLot.Origin != effects.FeeLot.Origin {
		t.Fatal("actual legacy validator fee identity or original source lineage was replaced")
	}
	encoded, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var shape struct {
		Effects struct {
			FeeLot    map[string]json.RawMessage `json:"feeLot"`
			SourceLot map[string]json.RawMessage `json:"sourceLot"`
			FeeEvent  map[string]json.RawMessage `json:"feeEvent"`
		} `json:"revocationEffects"`
	}
	if err := json.Unmarshal(encoded, &shape); err != nil {
		t.Fatal(err)
	}
	for _, lot := range []map[string]json.RawMessage{shape.Effects.FeeLot, shape.Effects.SourceLot} {
		for _, key := range []string{"amount", "riskWeightBps"} {
			if !bytes.HasPrefix(lot[key], []byte(`"`)) {
				t.Fatalf("new lot integer %s is not a decimal string", key)
			}
		}
	}
	for _, key := range []string{"policyVersion", "grossFeeYnxt", "burnYnxt", "validatorYnxt", "providerYnxt", "protocolYnxt", "treasuryYnxt", "blockHeight"} {
		if !bytes.HasPrefix(shape.Effects.FeeEvent[key], []byte(`"`)) {
			t.Fatalf("new fee integer %s is not a decimal string", key)
		}
	}
	// Codec-only range checks do not install invented amounts into the ledger.
	large := *effects
	large.FeeLot.Amount, large.SourceLot.Amount, large.FeeEvent.BlockHeight = math.MaxInt64, math.MaxInt64, math.MaxInt64
	largeJSON, err := json.Marshal(large)
	if err != nil || !bytes.Contains(largeJSON, []byte(`"9223372036854775807"`)) {
		t.Fatal("exact int64 effects could not be encoded")
	}
	var decoded PQWalletRevocationEffects
	if err := json.Unmarshal(largeJSON, &decoded); err != nil || !reflect.DeepEqual(decoded, large) {
		t.Fatal("lossy revocation effects round trip")
	}
	for _, invalid := range [][]byte{
		bytes.Replace(largeJSON, []byte(`"9223372036854775807"`), []byte(`9223372036854775807`), 1),
		bytes.Replace(largeJSON, []byte(`"9223372036854775807"`), []byte(`"9223372036854775808"`), 1),
		bytes.Replace(largeJSON, []byte(`"9223372036854775807"`), []byte(`"09223372036854775807"`), 1),
		bytes.Replace(largeJSON, []byte(`"burnYnxt":"0",`), nil, 1),
	} {
		if json.Unmarshal(invalid, &decoded) == nil {
			t.Fatal("numeric, overflowing, noncanonical or incomplete fee effects accepted")
		}
	}
	// Exercise query-time checks after a real successful execution. These are
	// intentionally corrupt in-memory candidates, never accepted test authority.
	baseline := f.a.committed
	defer func() { f.a.committed = baseline }()
	for name, mutate := range map[string]func(*CommittedState){
		"wrong-canonical-recipient": func(s *CommittedState) { s.PQHistory[len(s.PQHistory)-1].Transaction.LotFlows[0].To = f.other },
		"self-consistent-wrong-recipient": func(s *CommittedState) {
			entry := &s.PQHistory[len(s.PQHistory)-1]
			entry.Transaction.LotFlows[0].To = f.other
			for i := range s.FeeEvents {
				if s.FeeEvents[i].TxHash == entry.ABCITransactionHash {
					s.FeeEvents[i] = newCurrentFeeEvent(entry.ABCITransactionHash, PQRevocationType, f.owner, f.other, 1, 3, entry.Transaction.Timestamp)
				}
			}
		},
		"missing-trace-lot": func(s *CommittedState) { delete(s.TraceLots, effects.FeeLot.LotID) },
		"rewritten-source-lineage": func(s *CommittedState) {
			lot := s.TraceLots[effects.FeeLot.LotID]
			lot.Origin = "forged source"
			s.TraceLots[lot.LotID] = lot
		},
		"fee-event-audit": func(s *CommittedState) {
			for i := range s.FeeEvents {
				if s.FeeEvents[i].TxHash == original.ABCITransactionHash {
					s.FeeEvents[i].AuditHash = strings.Repeat("0", 64)
				}
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := baseline
			candidate.PQHistory = clonePQHistory(baseline.PQHistory)
			candidate.TraceLots = cloneTraceLots(baseline.TraceLots)
			candidate.FeeEvents = append([]BFTFeeEvent(nil), baseline.FeeEvents...)
			mutate(&candidate)
			f.a.mu.Lock()
			f.a.committed = candidate
			f.a.mu.Unlock()
			response, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: PQWalletHistoryPath + hash})
			if err != nil || response.Code == 0 || len(response.Value) != 0 {
				t.Fatalf("query exported invalid fee/lineage despite real core signature: %+v %v", response, err)
			}
		})
	}
	f.a.committed = baseline
	restored, err := NewPersistentApplication(f.m, f.path)
	if err != nil || !reflect.DeepEqual(walletHistoryQuery(t, restored, hash), original) {
		t.Fatalf("cold revocation fee evidence changed: %v", err)
	}
}

func TestPQWalletAccountJSONPreservesExactUint64Projection(t *testing.T) {
	f := newABCIRevocationFixture(t)
	commitSponsorBlock(t, f.a, 2, time.Unix(2, 0).UTC(), mustPQEnvelope(t, PQMigrationType, f.registration(t, false, 3)))
	v := walletAccountQuery(t, f.a, f.owner)
	// Codec-only boundary: do not install this modified projection as a ledger
	// or submit an invented transaction. Real acceptance is exercised above.
	v.LedgerNonce = math.MaxUint64
	v.Policy.Records[0].LedgerNonce = math.MaxUint64
	v.Policy.Records[0].ActiveFrom = math.MaxUint64
	wire, err := json.Marshal(v)
	if err != nil || !bytes.Contains(wire, []byte(`"ledgerNonce":"18446744073709551615"`)) || !bytes.Contains(wire, []byte(`"activeFrom":"18446744073709551615"`)) || !bytes.Contains(wire, []byte(`"pkA":"`+hex.EncodeToString(f.public.PKA)+`"`)) {
		t.Fatalf("uint64/full-key projection changed: %v", err)
	}
	var decoded PQWalletAccountView
	if err = json.Unmarshal(wire, &decoded); err != nil || !reflect.DeepEqual(decoded, v) {
		t.Fatalf("lossy uint64 roundtrip: %v", err)
	}
	for _, bad := range [][]byte{
		bytes.Replace(wire, []byte(`"18446744073709551615"`), []byte(`18446744073709551615`), 1),
		bytes.Replace(wire, []byte(`"18446744073709551615"`), []byte(`"18446744073709551616"`), 1),
		bytes.Replace(wire, []byte(`"18446744073709551615"`), []byte(`"018446744073709551615"`), 1),
		bytes.Replace(wire, []byte(`"recordsComplete":true`), []byte(`"recordsComplete":false,"recordsComplete":true`), 1),
	} {
		if json.Unmarshal(bad, &decoded) == nil {
			t.Fatal("noncanonical or overflowing Wallet projection accepted")
		}
	}
}
