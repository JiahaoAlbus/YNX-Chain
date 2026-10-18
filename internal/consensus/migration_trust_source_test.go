package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type legacyTrustFixture struct {
	m        chain.ConsensusMigrationState
	key      *secp256k1.PrivateKey
	owner    string
	request  chain.GovernanceRequest
	label    chain.RiskLabel
	appeal   chain.TrustAppeal
	evidence chain.EvidencePacket
	tracking chain.TrackingPolicyReview
}

func newLegacyTrustFixture(t *testing.T) legacyTrustFixture {
	t.Helper()
	f := legacyTrustFixture{key: deterministicPrivateKey(181)}
	f.owner = mustNativeAddress(t, f.key)
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(f.owner, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	var err error
	f.label, err = d.AddRiskLabelFromInput(chain.RiskLabelInput{Subject: f.owner, Address: f.owner, Label: "original-advisory", Source: "source-review-desk", EvidenceHash: strings.Repeat("ab", 32), RiskWeightBps: 900, ConfidenceBps: 8000, ReviewRequired: true})
	if err != nil {
		t.Fatal(err)
	}
	f.request, err = d.CreateGovernanceRequest(chain.GovernanceRequestInput{Requester: f.owner, Subject: f.owner, Action: "add risk label", AssetType: "address", Scope: "one address", Description: "advisory source record", Evidence: []string{"case:original"}})
	if err != nil {
		t.Fatal(err)
	}
	// Even an address-shaped historical requester is not a signed review role.
	f.request, err = d.ReviewGovernanceRequest(f.request.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.evidence, err = d.EvidencePacket(f.owner)
	if err != nil {
		t.Fatal(err)
	}
	// Source permits BOTH references; the post-migration wire permits exactly
	// one. Preserve old semantics instead of revalidating it as a new payload.
	f.appeal, err = d.CreateTrustAppeal(chain.TrustAppealInput{RequestID: f.request.ID, LabelID: f.label.ID, Subject: f.owner, Appellant: "legacy-person", Claimant: "legacy-claimant", Reason: "original dispute", Evidence: []string{"old-case"}})
	if err != nil {
		t.Fatal(err)
	}
	f.appeal, err = d.ResolveTrustAppeal(f.appeal.ID, chain.TrustAppealDecisionInput{Reviewer: f.owner, Decision: "LABEL_REDUCED", ResolutionReason: "original operator correction"})
	if err != nil {
		t.Fatal(err)
	}
	f.tracking, err = d.CreateTrackingPolicyReview(chain.TrackingPolicyReviewInput{Requester: "source-review-desk", Subject: f.owner, Purpose: "bounded advisory review", QueryType: "address risk", Scope: "one address", Evidence: []string{"old-case"}, MinimumNecessary: true, ConfidenceBps: 8000})
	if err != nil {
		t.Fatal(err)
	}
	f.m, err = d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if err = f.m.Validate(); err != nil {
		t.Fatal(err)
	}
	return f
}

// Use the normal factory as well as shared dispatch, sealing and persistence.
// Construction preserves the source; it does not grant the unresolved reviewer
// capability, which remains fenced independently of new signer-bound claims.
func legacyTrustHarness(t *testing.T, f legacyTrustFixture) *Application {
	t.Helper()
	a, err := NewApplication(f.m)
	if err != nil {
		t.Fatal(err)
	}
	if a.feeRecipient == "" || a.feeRecipient == f.owner {
		t.Fatal("fixture requires distinct actual fee recipient")
	}
	if err := a.committed.Validate(f.m); err != nil {
		t.Fatal(err)
	}
	return a
}

func legacyTrustAppealRaw(t *testing.T, f legacyTrustFixture, request string, nonce uint64) []byte {
	t.Helper()
	return mustTrustAction(t, f.key, ActionTrustAppealCreate, TrustAppealPayload{RequestID: request, Subject: f.owner, Appellant: f.owner, Claimant: f.owner, Reason: "new signed claimant appeal", Evidence: []string{"fresh-case"}}, nonce)
}

func TestLegacyTrustSourcePreservesOriginalsAndBlocksNormalActivation(t *testing.T) {
	f := newLegacyTrustFixture(t)
	source, err := migrationTrustSource(f.m)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(source.Records, originalTrustRecords(f.m)) || len(source.Records.RiskLabels[f.owner]) != 2 || source.Records.RiskLabels[f.owner][0].RiskWeightBps != 900 || source.Records.RiskLabels[f.owner][1].RiskWeightBps != 100 {
		t.Fatal("original IDs, append-only correction or source values changed")
	}
	if !reflect.DeepEqual(source.Records.Evidence[f.evidence.ID], f.evidence) {
		t.Fatal("old packet was recalculated after the correction")
	}
	if source.Records.Appeals[f.appeal.ID].RequestID == "" || source.Records.Appeals[f.appeal.ID].LabelID == "" {
		t.Fatal("old dual-reference appeal was rewritten")
	}
	if len(legacyTrustAuthorityBlockers(source)) != 1 {
		t.Fatal("unproven reviewer authority was reported executable")
	}
	path := filepath.Join(t.TempDir(), "blocked.json")
	app, err := NewPersistentApplication(f.m, path)
	if err != nil || !reflect.DeepEqual(app.committed.LegacyTrustSource, source) {
		t.Fatal("normal factory did not preserve original Trust history", err)
	}
	if err = validateMigrationExecutionClosure(f.m); err == nil || !strings.Contains(err.Error(), "trust_governance(") {
		t.Fatal("source preservation granted unresolved reviewer authority", err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("read-only constructor wrote uncommitted state: %v", err)
	}
	copy := cloneLegacyTrustSource(source)
	entry := copy.Records.Governance[f.request.ID]
	entry.Evidence[0] = "mutated"
	copy.Records.Governance[f.request.ID] = entry
	if source.Records.Governance[f.request.ID].Evidence[0] == "mutated" {
		t.Fatal("source clone aliases evidence")
	}
	copy = cloneLegacyTrustSource(source)
	packet := copy.Records.Evidence[f.evidence.ID]
	packet.RiskSummary.ExpiredLabelIDs = []string{}
	copy.Records.Evidence[f.evidence.ID] = packet
	if !reflect.DeepEqual(copy, cloneLegacyTrustSource(copy)) {
		t.Fatal("clone normalized empty source slices")
	}
	if validateLegacyTrustSourceContinuation(source, copy) == nil {
		t.Fatal("history changed despite unchanged old packet hash")
	}
	badMigration := f.m
	runtimeCopy := *f.m.Runtime
	runtimeCopy.Evidence = copy.Records.Evidence
	packet = runtimeCopy.Evidence[f.evidence.ID]
	packet.JSONHash = strings.Repeat("0", 64)
	runtimeCopy.Evidence[f.evidence.ID] = packet
	badMigration.Runtime = &runtimeCopy
	if _, err = migrationTrustSource(badMigration); err == nil {
		t.Fatal("invalid source evidence was accepted")
	}
	// initialCommittedState deliberately has no error return. Its caller's
	// mandatory complete Validate must still refuse the omitted bad segment.
	if initialCommittedState(badMigration).Validate(badMigration) == nil {
		t.Fatal("discarded projection error bypassed complete state validation")
	}
}

func TestLegacyTrustSourceSignedAppealDispatchFeeAndColdRead(t *testing.T) {
	f := newLegacyTrustFixture(t)
	a := legacyTrustHarness(t, f)
	before := cloneAccounts(a.committed.Accounts)
	state := a.committedExecutionStateView()
	h := int64(f.m.Height) + 1
	at := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	raw := legacyTrustAppealRaw(t, f, f.request.ID, 1)
	next, execution, err := a.applyTransactionAt(state, raw, h, at, 0)
	if err != nil {
		t.Fatal(err)
	}
	if execution.event.Type != "ynx.source_trust_action" || len(next.legacyTrustSource.Updates) != 1 || !bytes.Equal(next.legacyTrustSource.Updates[0].Transaction, raw) {
		t.Fatal("normal action dispatcher did not retain the exact newly signed original")
	}
	if !reflect.DeepEqual(before, a.committed.Accounts) || len(a.committed.LegacyTrustSource.Updates) != 0 {
		t.Fatal("working candidate leaked into committed source")
	}
	oi, _ := accountIndex(before, f.owner)
	fi, _ := accountIndex(before, a.feeRecipient)
	ni, _ := accountIndex(next.accounts, f.owner)
	nf, _ := accountIndex(next.accounts, a.feeRecipient)
	owner, fee := next.accounts[ni], next.accounts[nf]
	if owner.Balance != before[oi].Balance-1 || owner.Nonce != before[oi].Nonce+1 || fee.Balance != before[fi].Balance+1 || fee.Nonce != before[fi].Nonce || owner.ResourceUsage.BandwidthUsed != before[oi].ResourceUsage.BandwidthUsed+1 || owner.ResourceUsage.TrustUsed != before[oi].ResourceUsage.TrustUsed+1 {
		t.Fatal("real source appeal fee/nonce/resources differ")
	}
	var moved int64
	for id, amount := range before[oi].Lots {
		delta := amount - owner.Lots[id]
		if delta < 0 || fee.Lots[id]-before[fi].Lots[id] != delta {
			t.Fatal("fee lots did not move exactly to actual validator")
		}
		moved += delta
	}
	if moved != 1 || len(next.feeEvents.events()) != 1 {
		t.Fatal("missing or duplicate actual fee lot/event")
	}
	sealed, err := sealCommittedState(f.m, h, next)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "source-state.json")
	if err = saveCommittedState(path, sealed, f.m); err != nil {
		t.Fatal(err)
	}
	cold, err := loadCommittedState(path, f.m)
	if err != nil {
		t.Fatal(err)
	}
	sealedJSON, err := encodeCommittedStateJSON(sealed)
	if err != nil {
		t.Fatal(err)
	}
	coldJSON, err := encodeCommittedStateJSON(cold)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(sealedJSON, coldJSON) || !reflect.DeepEqual(cold.LegacyTrustSource.Records, originalTrustRecords(f.m)) || !reflect.DeepEqual(cold.LegacyTrustSource.Updates, sealed.LegacyTrustSource.Updates) {
		t.Fatal("cold read lost exact complete encoded state, original records or signed continuation")
	}
	response := &abci.ResponseQuery{}
	id := ApplicationActionRecordID("trust-appeal", ApplicationActionHash(raw))
	if !queryLegacyTrustSource(response, "/trust/appeals/"+id, cold.LegacyTrustSource, cold) || response.Code != 0 {
		t.Fatalf("actual committed source lookup failed: %+v", response)
	}
	var got sourceTrustAppealView
	if err = json.Unmarshal(response.Value, &got); err != nil {
		t.Fatal(err)
	}
	if got.Appellant != f.owner || got.Authority != "signed_claimant_only" || got.ReviewerAuthorityAvailable || got.Continuation == nil || !bytes.Equal(got.Continuation.Transaction, raw) {
		t.Fatal("new signed claimant was erased or upgraded to reviewer authority")
	}
	// Native source evidence remains exactly the old packet under its old hash.
	response = &abci.ResponseQuery{}
	if !queryLegacyTrustSource(response, "/trust/evidence/"+f.evidence.ID, cold.LegacyTrustSource, cold) || response.Code != 0 {
		t.Fatal("original evidence query failed")
	}
	var original sourceTrustEvidenceView
	if err = json.Unmarshal(response.Value, &original); err != nil || !reflect.DeepEqual(original.EvidencePacket, f.evidence) || original.Authority != "historical_claim_only" {
		t.Fatal("source evidence was recast as a BFT signature")
	}
	response = &abci.ResponseQuery{}
	if !queryLegacyTrustSource(response, "/governance/transparency", cold.LegacyTrustSource, cold) || response.Code != 0 {
		t.Fatal("source/current transparency union failed")
	}
	var entries []json.RawMessage
	if err = json.Unmarshal(response.Value, &entries); err != nil || len(entries) != len(f.m.Runtime.Transp)+1 {
		t.Fatal("source transparency or new signed appeal audit was omitted")
	}
}

func TestLegacyTrustSourceRefusesReviewerTakeoverAndInvalidCandidates(t *testing.T) {
	f := newLegacyTrustFixture(t)
	a := legacyTrustHarness(t, f)
	state := a.committedExecutionStateView()
	h := int64(f.m.Height) + 1
	// The borrowed initial view has a non-nil empty slice; the execution clone
	// normalizes it to nil. The original asymmetric comparison already failed
	// before any transaction. Keep this fixture proof and compare symmetrically.
	baseline := cloneExecutionStateValue(state)
	if state.nativeTransfers == nil || len(state.nativeTransfers) != 0 || baseline.nativeTransfers != nil {
		t.Fatal("fixture must exercise the original nil/empty clone comparison mismatch")
	}
	cases := map[string][]byte{
		"review_same_historical_requester": mustTrustAction(t, f.key, ActionGovernanceReview, GovernanceDecisionPayload{RequestID: f.request.ID, Reviewer: f.owner}, 1),
		"reject_same_historical_requester": mustTrustAction(t, f.key, ActionGovernanceReject, GovernanceDecisionPayload{RequestID: f.request.ID, Reviewer: f.owner, Reason: "self claimed role"}, 1),
		"resolve_same_historical_reviewer": mustTrustAction(t, f.key, ActionTrustAppealResolve, TrustAppealDecisionPayload{AppealID: f.appeal.ID, Reviewer: f.owner, Decision: "ACCEPTED", ResolutionReason: "self claimed role"}, 1),
		"wrong_nonce":                      legacyTrustAppealRaw(t, f, f.request.ID, 2),
		"subject_substitution":             mustTrustAction(t, f.key, ActionTrustAppealCreate, TrustAppealPayload{RequestID: f.request.ID, Subject: "another-subject", Appellant: f.owner, Claimant: f.owner, Reason: "claim"}, 1),
	}
	valid := legacyTrustAppealRaw(t, f, f.request.ID, 1)
	tx, err := DecodeSignedApplicationAction(valid)
	if err != nil {
		t.Fatal(err)
	}
	tx.ChainID++
	cases["wrong_signed_network"], err = json.Marshal(tx)
	if err != nil {
		t.Fatal(err)
	}
	wantErrors := map[string]string{
		"review_same_historical_requester": "requires independently authenticated reviewer authority",
		"reject_same_historical_requester": "requires independently authenticated reviewer authority",
		"resolve_same_historical_reviewer": "requires independently authenticated reviewer authority",
		"wrong_nonce":                      "application action nonce 2 must equal next account nonce 1",
		"subject_substitution":             "source appeal requires actual signer-bound claimant and exact original subject/appeal permission",
		"wrong_signed_network":             fmt.Sprintf("application action chain ID %d does not match %d", tx.ChainID, f.m.Network.ChainID),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			before := cloneExecutionStateValue(state)
			if !reflect.DeepEqual(before, cloneExecutionStateValue(state)) {
				t.Fatal("symmetric baseline differs before candidate execution")
			}
			committedBefore, err := encodeCommittedStateJSON(a.committed)
			if err != nil {
				t.Fatal(err)
			}
			// Preserve original nil/empty values as well as every account field.
			accountsBefore := cloneLegacyTrustValue(reflect.ValueOf(state.accounts)).Interface().([]chain.ConsensusAccount)
			committedAccountsBefore := cloneLegacyTrustValue(reflect.ValueOf(a.committed.Accounts)).Interface().([]chain.ConsensusAccount)
			sourceBefore := cloneLegacyTrustSource(state.legacyTrustSource)
			committedSourceBefore := cloneLegacyTrustSource(a.committed.LegacyTrustSource)
			assertAccounts := func(label string, want, got []chain.ConsensusAccount) {
				t.Helper()
				if len(want) != len(got) {
					t.Fatalf("%s account count changed", label)
				}
				for i, account := range want {
					actual := got[i]
					if account.Address != actual.Address || account.Balance != actual.Balance || account.Staked != actual.Staked || account.Nonce != actual.Nonce {
						t.Fatalf("%s account %s identity/balance/stake/nonce changed", label, account.Address)
					}
					if !reflect.DeepEqual(account.Lots, actual.Lots) || !reflect.DeepEqual(account.ResourceUsage, actual.ResourceUsage) {
						t.Fatalf("%s account %s lots/resources changed", label, account.Address)
					}
				}
				if !reflect.DeepEqual(want, got) {
					t.Fatalf("%s complete accounts changed", label)
				}
			}
			assertAccounts("candidate baseline", accountsBefore, state.accounts)
			assertAccounts("committed baseline", committedAccountsBefore, a.committed.Accounts)
			if !reflect.DeepEqual(sourceBefore, state.legacyTrustSource) || !reflect.DeepEqual(committedSourceBefore, a.committed.LegacyTrustSource) || a.pending != nil {
				t.Fatal("source/pending baseline differs before candidate execution")
			}
			if _, _, err := a.applyTransactionAt(state, raw, h, time.Unix(100, 0).UTC(), 0); err == nil {
				t.Fatal("unauthorized original mutation admitted")
			} else if want := wantErrors[name]; want == "" || !strings.Contains(err.Error(), want) {
				t.Fatalf("candidate rejected for a different reason: got %v, want %q", err, want)
			}
			if !reflect.DeepEqual(before, cloneExecutionStateValue(state)) {
				t.Fatal("failed candidate changed the execution state")
			}
			committedAfter, err := encodeCommittedStateJSON(a.committed)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(committedBefore, committedAfter) {
				t.Fatal("failed candidate changed complete committed serialization")
			}
			assertAccounts("candidate", accountsBefore, state.accounts)
			assertAccounts("committed", committedAccountsBefore, a.committed.Accounts)
			if !reflect.DeepEqual(sourceBefore, state.legacyTrustSource) || !reflect.DeepEqual(committedSourceBefore, a.committed.LegacyTrustSource) || len(a.committed.LegacyTrustSource.Updates) != 0 || a.pending != nil {
				t.Fatal("failed candidate changed original source/history or created pending state")
			}
		})
	}
}

func TestLegacyTrustSourceHistoricalPolicyAndTamperColdControls(t *testing.T) {
	f := newLegacyTrustFixture(t)
	a := legacyTrustHarness(t, f)
	h := int64(f.m.Height) + 1
	state := a.committedExecutionStateView()
	raw := legacyTrustAppealRaw(t, f, f.request.ID, 1)
	next, _, err := a.applyTransactionAt(state, raw, h, time.Unix(100, 0).UTC(), 0)
	if err != nil {
		t.Fatal(err)
	}
	raw2 := legacyTrustAppealRaw(t, f, f.tracking.ID, 2)
	next, _, err = a.applyTransactionAt(next, raw2, h+1, time.Unix(101, 0).UTC(), 0)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealCommittedState(f.m, h+1, next)
	if err != nil {
		t.Fatal(err)
	}
	if err = validateLegacyTrustSourceContinuation(a.committed.LegacyTrustSource, sealed.LegacyTrustSource); err != nil {
		t.Fatal(err)
	}
	mutations := map[string]func(*CommittedState){
		"delete_signed_history": func(s *CommittedState) { s.LegacyTrustSource.Updates = nil },
		"missing_source":        func(s *CommittedState) { s.LegacyTrustSource = nil },
		"missing_original":      func(s *CommittedState) { delete(s.LegacyTrustSource.Records.Governance, f.request.ID) },
		"rewritten_packet": func(s *CommittedState) {
			v := s.LegacyTrustSource.Records.Evidence[f.evidence.ID]
			v.JSONHash = strings.Repeat("0", 64)
			s.LegacyTrustSource.Records.Evidence[f.evidence.ID] = v
		},
		"source_anchor":         func(s *CommittedState) { s.LegacyTrustSource.SourceAnchor = strings.Repeat("0", 64) },
		"source_height":         func(s *CommittedState) { s.LegacyTrustSource.SourceHeight++ },
		"future_execution":      func(s *CommittedState) { s.LegacyTrustSource.Updates[1].Height++ },
		"reorder":               func(s *CommittedState) { u := s.LegacyTrustSource.Updates; u[0], u[1] = u[1], u[0] },
		"rewrite_original_wire": func(s *CommittedState) { s.LegacyTrustSource.Updates[0].Transaction[0] ^= 1 },
		"missing_fee":           func(s *CommittedState) { s.FeeEvents = nil },
		"duplicate_fee":         func(s *CommittedState) { s.FeeEvents = append(s.FeeEvents, s.FeeEvents[0]) },
		"missing_resource_charge": func(s *CommittedState) {
			i, _ := accountIndex(s.Accounts, f.owner)
			s.Accounts[i].ResourceUsage.TrustUsed = 0
		},
		"shadow_original": func(s *CommittedState) { s.GovernanceRequests = []BFTGovernanceRequest{{GovernanceRequest: f.request}} },
		"pre18":           func(s *CommittedState) { s.Version = 17 },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			copy := sealed
			copy.LegacyTrustSource = cloneLegacyTrustSource(sealed.LegacyTrustSource)
			copy.Accounts = cloneAccounts(sealed.Accounts)
			copy.FeeEvents = append([]BFTFeeEvent(nil), sealed.FeeEvents...)
			mutate(&copy)
			if err := validateLegacyTrustSource(copy.LegacyTrustSource, copy, f.m); err == nil {
				t.Fatal("corrupt continuation passed source/history validator")
			}
			// Rehashing the tampered outer document must not make it a valid cold
			// checkpoint. The real loader still enforces source and effect history.
			hash, err := copy.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			copy.AppHash = hash
			wire, err := json.Marshal(copy)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "tampered.json")
			if err = os.WriteFile(path, wire, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err = loadCommittedState(path, f.m); err == nil {
				t.Fatal("rehash bypassed actual cold checkpoint validation")
			}
		})
	}
	truncated := cloneLegacyTrustSource(sealed.LegacyTrustSource)
	truncated.Updates = truncated.Updates[:1]
	if validateLegacyTrustSourceContinuation(sealed.LegacyTrustSource, truncated) == nil {
		t.Fatal("append-only continuation permitted deleting signed history")
	}
	// Real signed account migration activates only AFTER the two legacy events.
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	network, err := hex.DecodeString(f.m.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	policy := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: 1}
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 3, ActivateAt: uint64(h + 3)}
	wire := abciRegistrationWire(t, f.key, nil, key, intent)
	migration, err := ynxauth.DecodeMigration(wire)
	if err != nil {
		t.Fatal(err)
	}
	policy, err = policy.AdmitMigration(migration, uint64(h+2), 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = replayLegacyTrustSource(sealed.LegacyTrustSource, f.m, CommittedState{Height: h + 3, AccountPolicy: &policy}); err != nil {
		t.Fatalf("future PQ activation reinterpreted original legacy signatures: %v", err)
	}
	next.accountPolicy = &policy
	if _, _, err = a.applyTransactionAt(next, legacyTrustAppealRaw(t, f, f.request.ID, 4), h+3, time.Unix(104, 0).UTC(), 0); err == nil || !strings.Contains(err.Error(), ynxauth.ErrPolicy.Error()) {
		t.Fatalf("active PQ owner was not rejected by the actual policy guard: %v", err)
	}
}

// The source-reviewer blocker is intentionally unchanged. Newly signed
// advisory evidence uses the normal factory, dispatcher and persistence.
func TestLegacyTrustSourceNewEvidenceUsesOriginalAndBFTLabels(t *testing.T) {
	f := newLegacyTrustFixture(t)
	a := legacyTrustHarness(t, f)
	original := cloneLegacyTrustSource(a.committed.LegacyTrustSource)
	before := cloneAccounts(a.committed.Accounts)
	h := int64(f.m.Height) + 1
	at := f.evidence.GeneratedAt.Add(time.Minute).UTC()
	labelRaw := mustTrustAction(t, f.key, ActionTrustLabelCreate, TrustLabelPayload{
		Issuer: f.owner, Subject: f.owner, SubjectType: "address", Address: f.owner,
		Label: "new-bft-advisory", RiskWeightBps: 2500, ConfidenceBps: 8000,
		Source: "case:new-signed-label", EvidenceHash: strings.Repeat("cd", 32),
		ExpiryHours: 24, ReviewRequired: true, AppealAvailable: true,
	}, 1)
	evidenceRaw := mustTrustAction(t, f.key, ActionTrustEvidenceCreate, TrustEvidencePayload{Requester: f.owner, Subject: f.owner}, 2)
	state := a.committedExecutionStateView()
	next, _, err := a.applyTransactionAt(state, labelRaw, h, at, 0)
	if err != nil {
		t.Fatal(err)
	}
	next, execution, err := a.applyTransactionAt(next, evidenceRaw, h, at, 1)
	if err != nil {
		t.Fatal(err)
	}
	if execution.event.Type != "ynx.trust_action" || len(next.trustLabels) != 1 || len(next.trustEvidence) != 1 {
		t.Fatal("new label/evidence did not use the actual BFT Trust dispatcher")
	}
	packet := next.trustEvidence[0]
	want := append([]chain.RiskLabel(nil), original.Records.RiskLabels[f.owner]...)
	want = append(want, next.trustLabels[0].RiskLabel)
	if !reflect.DeepEqual(packet.Labels, want) || len(packet.Labels) != 3 {
		t.Fatal("new evidence omitted or rewrote original source labels or the newly signed BFT label")
	}
	if packet.JSONHash != trustPacketJSONHash(packet.EvidencePacket) || !reflect.DeepEqual(packet.RiskSummary, chain.TrustRiskSummaryForLabels(f.owner, want, at)) || packet.Signer != f.owner || packet.Requester != f.owner || packet.BlockHeight != h || packet.TxHash != ApplicationActionHash(evidenceRaw) {
		t.Fatal("new evidence hash/risk calculation/actual signing metadata differs")
	}
	if !reflect.DeepEqual(original, next.legacyTrustSource) || !reflect.DeepEqual(original, a.committed.LegacyTrustSource) || !reflect.DeepEqual(before, a.committed.Accounts) || !reflect.DeepEqual(next.legacyTrustSource.Records.Evidence[f.evidence.ID], f.evidence) {
		t.Fatal("new evidence rewrote original packet/source or leaked candidate effects")
	}
	oi, _ := accountIndex(before, f.owner)
	fi, _ := accountIndex(before, a.feeRecipient)
	ni, _ := accountIndex(next.accounts, f.owner)
	nf, _ := accountIndex(next.accounts, a.feeRecipient)
	owner, fee := next.accounts[ni], next.accounts[nf]
	if owner.Balance != before[oi].Balance-2 || owner.Nonce != before[oi].Nonce+2 || owner.ResourceUsage.BandwidthUsed != before[oi].ResourceUsage.BandwidthUsed+2 || owner.ResourceUsage.TrustUsed != before[oi].ResourceUsage.TrustUsed+2 || fee.Balance != before[fi].Balance+2 || fee.Nonce != before[fi].Nonce {
		t.Fatal("two actual Trust actions did not charge exact fee/nonce/resources")
	}
	var moved int64
	for id, amount := range before[oi].Lots {
		delta := amount - owner.Lots[id]
		if delta < 0 || fee.Lots[id]-before[fi].Lots[id] != delta {
			t.Fatal("new label/evidence fee lots did not reach the actual recipient")
		}
		moved += delta
	}
	fees := next.feeEvents.events()
	if moved != 2 || len(fees) != 2 || fees[0] != newCurrentFeeEvent(ApplicationActionHash(labelRaw), ActionTrustLabelCreate, f.owner, a.feeRecipient, 1, h, at) || fees[1] != newCurrentFeeEvent(ApplicationActionHash(evidenceRaw), ActionTrustEvidenceCreate, f.owner, a.feeRecipient, 1, h, at) {
		t.Fatal("new label/evidence has missing, duplicated or substituted fee history")
	}
	sealed, err := sealCommittedState(f.m, h, next)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "evidence-candidate.json")
	if err = saveCommittedState(path, sealed, f.m); err != nil {
		t.Fatal(err)
	}
	cold, err := loadCommittedState(path, f.m)
	if err != nil {
		t.Fatal(err)
	}
	sealedJSON, err := encodeCommittedStateJSON(sealed)
	if err != nil {
		t.Fatal(err)
	}
	coldJSON, err := encodeCommittedStateJSON(cold)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(sealedJSON, coldJSON) || !reflect.DeepEqual(cold.LegacyTrustSource, original) || !reflect.DeepEqual(cold.TrustEvidence[0].Labels, want) {
		t.Fatal("cold read lost complete new evidence or altered original source")
	}
	a.committed = cold // Read back the same fully validated committed candidate.
	var readback BFTTrustEvidence
	queryJSON(t, a, "/trust/evidence/"+packet.ID, &readback)
	if !reflect.DeepEqual(readback.Labels, want) || readback.JSONHash != packet.JSONHash || readback.TxHash != packet.TxHash {
		t.Fatal("shared committed query did not return the persisted combined evidence")
	}
}

func TestLegacyTrustSourceEvidenceCannotDropOriginalLabelAfterRehash(t *testing.T) {
	f := newLegacyTrustFixture(t)
	a := legacyTrustHarness(t, f)
	h := int64(f.m.Height) + 1
	at := f.evidence.GeneratedAt.Add(time.Minute).UTC()
	raw := mustTrustAction(t, f.key, ActionTrustEvidenceCreate, TrustEvidencePayload{Requester: f.owner, Subject: f.owner}, 1)
	state, _, err := a.applyTransactionAt(a.committedExecutionStateView(), raw, h, at, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.trustEvidence) != 1 || !reflect.DeepEqual(state.trustEvidence[0].Labels, f.m.Runtime.RiskLabels[f.owner]) {
		t.Fatal("real dispatcher fixture did not include all original source labels")
	}
	// A later BFT label is not part of this historical packet. Validation must
	// preserve the packet snapshot, rather than require all current BFT labels.
	later := mustTrustAction(t, f.key, ActionTrustLabelCreate, TrustLabelPayload{Issuer: f.owner, Subject: f.owner, SubjectType: "address", Address: f.owner, Label: "later-bft-label", RiskWeightBps: 1500, ConfidenceBps: 8000, Source: "case:later", EvidenceHash: strings.Repeat("ef", 32), AppealAvailable: true}, 2)
	state, _, err = a.applyTransactionAt(state, later, h+1, at.Add(time.Second), 0)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealCommittedState(f.m, h+1, state)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "positive.json")
	if err = saveCommittedState(path, sealed, f.m); err != nil {
		t.Fatal(err)
	}
	cold, err := loadCommittedState(path, f.m)
	if err != nil || len(cold.TrustLabels) != 1 || !reflect.DeepEqual(cold.TrustEvidence[0].Labels, f.m.Runtime.RiskLabels[f.owner]) {
		t.Fatalf("unchanged historical evidence failed cold validation after a later BFT label: %v", err)
	}
	original := cloneLegacyTrustSource(sealed.LegacyTrustSource)
	for _, mutation := range []string{"remove", "alter", "duplicate", "risk_summary_only"} {
		t.Run(mutation, func(t *testing.T) {
			bad := sealed
			bad.TrustEvidence = cloneTrustEvidence(sealed.TrustEvidence)
			packet := &bad.TrustEvidence[0]
			index := -1
			for i, label := range packet.Labels {
				if label.ID == f.label.ID {
					index = i
					break
				}
			}
			if index < 0 {
				t.Fatal("fixture lacks the original source label to mutate")
			}
			switch mutation {
			case "remove":
				packet.Labels = append(packet.Labels[:index], packet.Labels[index+1:]...)
			case "alter":
				packet.Labels[index].RiskWeightBps++
			case "duplicate":
				packet.Labels = append(packet.Labels, packet.Labels[index])
			}
			packet.RiskSummary = chain.TrustRiskSummaryForLabels(packet.Subject, packet.Labels, packet.GeneratedAt)
			if mutation == "risk_summary_only" {
				packet.RiskSummary.EffectiveRiskWeightBps++
			}
			packet.JSONHash = trustPacketJSONHash(packet.EvidencePacket)
			packet.AuditHash = trustEvidenceAuditHash(*packet)
			bad.AppHash, err = bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			// These are coherent existing-format checksums and valid ordinary
			// Trust shapes. The old validator cannot reject them on that basis.
			if err = validateTrustCommittedState(bad); err != nil {
				t.Fatalf("attack fixture failed ordinary checksum/shape validation: %v", err)
			}
			if !reflect.DeepEqual(original, bad.LegacyTrustSource) {
				t.Fatal("attack changed the immutable source instead of only the derived packet")
			}
			wire, err := encodeCommittedStateJSON(bad)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "rehashed.json")
			if err = os.WriteFile(path, wire, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err = loadCommittedState(path, f.m); err == nil {
				t.Fatal("cold loader accepted a rehashed packet that changed immutable source label coverage or its deterministic risk summary")
			}
		})
	}
}
