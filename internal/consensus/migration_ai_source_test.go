package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

type legacyAISourceFixture struct {
	m, clean                   chain.ConsensusMigrationState
	permission, pending, cycle string
	canonicalPending, logged   string
}

// Every historical object is made through the original source API. Neither
// fabricated Signer/TxHash fields nor a rewritten migration anchor are used.
func newLegacyAISourceFixture(t *testing.T) legacyAISourceFixture {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	owner := mustNativeAddress(t, deterministicPrivateKey(211))
	if _, err := d.Faucet(owner, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	clean, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	permission, err := d.RequestAIPermission(chain.AIPermissionInput{SessionID: "legacy-session", Requester: "opaque-agent", Scope: "all_sensitive_actions", Purpose: "source history", ExpiryHours: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.RequestAIPermission(chain.AIPermissionInput{SessionID: "canonical-session", Requester: owner, Scope: "trust_label", Purpose: "address is not proof", ExpiryHours: 1}); err != nil {
		t.Fatal(err)
	}
	propose := func(session, requester, scope, kind, description string) chain.AIActionProposal {
		t.Helper()
		value, err := d.ProposeAIAction(chain.AIActionProposalInput{SessionID: session, Requester: requester, Scope: scope, ActionType: kind, Description: description, ExpiryHours: 1})
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	pending := propose("legacy-session", "opaque-agent", "wallet_transfer", "transfer", "request a bounded transfer")
	canonical := propose("canonical-session", owner, "trust_label", "risk label", "review one risk label")
	cycle := propose("legacy-session", "opaque-agent", "wallet_transfer", "transfer", "retain original decisions")
	approval := chain.AIActionApprovalInput{Approver: "unsigned-reviewer", PermissionID: permission.ID}
	if _, err := d.ApproveAIAction(cycle.ID, approval); err != nil {
		t.Fatal(err)
	}
	if _, err := d.RejectAIAction(cycle.ID, chain.AIActionApprovalInput{Approver: "unsigned-second-reviewer"}); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ApproveAIAction(cycle.ID, approval); err != nil {
		t.Fatal(err)
	}
	logged := propose("legacy-session", "opaque-agent", "public_summary", "summarize", "summarize a public bulletin")
	rejected := propose("legacy-session", "opaque-agent", "public_summary", "summarize", "retain a rejected public bulletin")
	if _, err := d.RejectAIAction(rejected.ID, chain.AIActionApprovalInput{Approver: "unsigned-reviewer"}); err != nil {
		t.Fatal(err)
	}
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	return legacyAISourceFixture{m: m, clean: clean, permission: permission.ID, pending: pending.ID,
		cycle: cycle.ID, canonicalPending: canonical.ID, logged: logged.ID}
}

func TestLegacyAISourcePreservesOriginalDomainsAndLinks(t *testing.T) {
	f := newLegacyAISourceFixture(t)
	source := migrationAISource(f.m)
	if source == nil || len(source.Permissions) != 2 || len(source.Actions) != 5 || len(source.Transparency) != 9 {
		t.Fatal("original AI history inventory changed")
	}
	if err := validateLegacyAISource(source, CommittedState{Version: 18}, f.m); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(source.Permissions, f.m.Runtime.AIPerms) || !reflect.DeepEqual(source.Actions, f.m.Runtime.AIActions) {
		t.Fatal("source records were normalized or relabeled")
	}
	cycle := source.Actions[f.cycle]
	if cycle.Status != "approved" || cycle.ApprovedAt == nil || cycle.RejectedAt == nil || !cycle.Executable {
		t.Fatal("legacy approve/reject/approve history was collapsed")
	}
	copy := cloneLegacyAISource(source)
	changed := copy.Actions[f.cycle]
	changed.Reasons[0] = "mutated clone"
	*changed.ApprovedAt = changed.ApprovedAt.Add(time.Hour)
	copy.Actions[f.cycle] = changed
	entry := copy.Transparency[cycle.TransparencyEntryID]
	entry.Reasons[0] = "mutated transparency clone"
	copy.Transparency[entry.ID] = entry
	if !reflect.DeepEqual(source, migrationAISource(f.m)) {
		t.Fatal("cloning leaked aliases into original history")
	}
	if err := validateLegacyAISource(copy, CommittedState{Version: 18}, f.m); err == nil {
		t.Fatal("modified full source accepted")
	}
	if err := validateLegacyAISource(source, CommittedState{Version: 17}, f.m); err == nil {
		t.Fatal("source segment added to an old hash domain")
	}
}

func TestLegacyAISourceRejectsTamperingAndInventedBFTAuthority(t *testing.T) {
	f := newLegacyAISourceFixture(t)
	original := migrationAISource(f.m)
	if err := validateLegacyAISource(nil, CommittedState{Version: 18}, f.m); err == nil {
		t.Fatal("complete source omission accepted")
	}
	for name, mutate := range map[string]func(*LegacyAISource){
		"anchor":               func(s *LegacyAISource) { s.SourceAnchor = strings.Repeat("f", 64) },
		"remove_permission":    func(s *LegacyAISource) { delete(s.Permissions, f.permission) },
		"remove_pending":       func(s *LegacyAISource) { delete(s.Actions, f.pending) },
		"unsigned_description": func(s *LegacyAISource) { v := s.Actions[f.pending]; v.Description += " altered"; s.Actions[v.ID] = v },
		"unsigned_expiry": func(s *LegacyAISource) {
			v := s.Actions[f.pending]
			v.ExpiresAt = v.ExpiresAt.Add(time.Hour)
			s.Actions[v.ID] = v
		},
		"rehashed_status": func(s *LegacyAISource) {
			v := s.Actions[f.pending]
			v.Executable = true
			v.AuditHash = legacyAIActionHash(v)
			s.Actions[v.ID] = v
		},
		"remove_final_entry": func(s *LegacyAISource) { delete(s.Transparency, s.Actions[f.cycle].TransparencyEntryID) },
		"entry_subject": func(s *LegacyAISource) {
			id := s.Actions[f.cycle].TransparencyEntryID
			v := s.Transparency[id]
			v.Subject = "other"
			s.Transparency[id] = v
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := cloneLegacyAISource(original)
			mutate(bad)
			if err := validateLegacyAISource(bad, CommittedState{Version: 18}, f.m); err == nil {
				t.Fatal("source tampering accepted")
			}
		})
	}
	for _, state := range []CommittedState{
		{Version: 18, AIPermissions: []BFTAIPermission{{ID: f.permission}}},
		{Version: 18, AIActions: []BFTAIAction{{ID: f.pending}}},
		{Version: 18, AIActions: []BFTAIAction{{ID: "new", PermissionID: f.permission}}},
		{Version: 18, AIAuditEvents: []BFTAIAuditEvent{{ID: "new", RecordID: f.pending}}},
	} {
		if err := validateLegacyAISource(original, state, f.m); err == nil {
			t.Fatal("source record gained fabricated BFT authority")
		}
	}
	// Exercise original-domain consistency separately from the pinned equality
	// check. These deliberately damaged inputs are not authenticated migrations.
	for name, mutate := range map[string]func(*chain.ConsensusMigrationState){
		"original_audit": func(m *chain.ConsensusMigrationState) {
			v := m.Runtime.AIPerms[f.permission]
			v.AuditHash = strings.Repeat("0", 64)
			m.Runtime.AIPerms[v.ID] = v
		},
		"original_id": func(m *chain.ConsensusMigrationState) {
			v := m.Runtime.AIActions[f.pending]
			v.CreatedAt = v.CreatedAt.Add(time.Second)
			v.AuditHash = legacyAIActionHash(v)
			m.Runtime.AIActions[v.ID] = v
		},
		"missing_permission_link": func(m *chain.ConsensusMigrationState) {
			v := m.Runtime.AIActions[f.cycle]
			v.PermissionID = strings.Repeat("1", 24)
			v.AuditHash = legacyAIActionHash(v)
			m.Runtime.AIActions[v.ID] = v
		},
		"missing_prior_decision": func(m *chain.ConsensusMigrationState) {
			for id, v := range m.Runtime.Transp {
				if v.Type == "ai_action_rejection" && v.RequestID == f.cycle {
					delete(m.Runtime.Transp, id)
				}
			}
		},
		"wrong_classification": func(m *chain.ConsensusMigrationState) {
			id := m.Runtime.AIActions[f.pending].TransparencyEntryID
			v := m.Runtime.Transp[id]
			v.Classification = chain.RequestRejected
			m.Runtime.Transp[id] = v
		},
	} {
		t.Run(name, func(t *testing.T) {
			var bad chain.ConsensusMigrationState
			if err := json.Unmarshal(mustJSON(t, f.m), &bad); err != nil {
				t.Fatal(err)
			}
			mutate(&bad)
			if err := validateLegacyAISource(migrationAISource(bad), CommittedState{Version: 18}, bad); err == nil {
				t.Fatal("malformed original domain/link accepted")
			}
		})
	}
}

func TestLegacyAISourceCandidatePersistenceAndActivationFence(t *testing.T) {
	f := newLegacyAISourceFixture(t)
	path := filepath.Join(t.TempDir(), "candidate-state.json")
	if _, err := NewPersistentApplication(f.m, path); err == nil || !strings.Contains(err.Error(), "ai(") {
		t.Fatal("normal constructor bypassed unresolved source authority", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("refused constructor wrote candidate state", err)
	}
	state := initialCommittedState(f.m)
	if err := state.Validate(f.m); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(state.LegacyAISource, migrationAISource(f.m)) || !accountsEqual(state.Accounts, f.m.Accounts) {
		t.Fatal("candidate projection changed source history or ledger")
	}
	// This is a candidate callee test, explicitly not constructor activation.
	// Use the real state view/seal path without starting an application or node.
	a := &Application{migration: f.m, committed: state}
	oldApproval := mustTrustAction(t, deterministicPrivateKey(211), ActionAIProposalApprove,
		AIActionDecisionPayload{ActionID: f.canonicalPending, PermissionID: f.permission, Approver: "reviewer"}, 1)
	beforeCandidate := mustJSON(t, a.committed)
	if _, _, err := a.applyTransaction(a.committedExecutionStateView(), oldApproval, int64(f.m.Height)+1, time.Now().UTC()); err == nil || !strings.Contains(err.Error(), "source AI") {
		t.Fatal("actual action dispatcher did not apply the source authority fence before charging", err)
	}
	if a.pending != nil || !bytes.Equal(beforeCandidate, mustJSON(t, a.committed)) {
		t.Fatal("source-fenced action changed committed state or pending checkpoint")
	}
	sealed, err := sealCommittedState(f.m, int64(f.m.Height)+1, a.committedExecutionStateView())
	if err != nil {
		t.Fatal(err)
	}
	if err := validateLegacySourceContinuation(state, sealed); err != nil {
		t.Fatal("unchanged original source cannot continue", err)
	}
	if err := saveCommittedState(path, sealed, f.m); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cold, err := loadCommittedState(path, f.m)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, sealed), mustJSON(t, cold)) || !reflect.DeepEqual(cold.LegacyAISource, migrationAISource(f.m)) {
		t.Fatal("cold candidate recovery changed source bytes")
	}
	// Rehashing a modified record must not defeat the original migration anchor.
	bad := cold
	bad.LegacyAISource = cloneLegacyAISource(cold.LegacyAISource)
	v := bad.LegacyAISource.Actions[f.pending]
	v.Description += " tampered after checkpoint"
	bad.LegacyAISource.Actions[v.ID] = v
	goodHash, err := cold.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	badHash, err := bad.calculateHash()
	if err != nil || badHash == goodHash {
		t.Fatal("complete source is absent from AppHash", err)
	}
	bad.AppHash = badHash
	if err := validateLegacySourceContinuation(cold, bad); err == nil {
		t.Fatal("source mutation passed checkpoint continuation")
	}
	// Commit must refuse a modified candidate before persistence and keep the
	// rejected pending value available for reconciliation instead of erasing it.
	a.committed, a.pending, a.statePath = cold, &bad, path
	if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err == nil || !strings.Contains(err.Error(), "source AI") {
		t.Fatal("Commit accepted rewritten source or missed the continuation guard", err)
	}
	if a.pending != &bad || !bytes.Equal(mustJSON(t, a.committed), mustJSON(t, cold)) {
		t.Fatal("refused source commit changed original or discarded pending evidence")
	}
	a.pending = nil // Test fixture cleanup only; production refusal retained it.
	if err := saveCommittedState(path, bad, f.m); err == nil {
		t.Fatal("source mutation was persisted")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("rejected save overwrote original checkpoint", err)
	}
	tamperedPath := filepath.Join(t.TempDir(), "tampered-state.json")
	if err := os.WriteFile(tamperedPath, mustJSON(t, bad), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadCommittedState(tamperedPath, f.m); err == nil {
		t.Fatal("rehash accepted tampered cold source")
	}
	omitted := cold
	omitted.LegacyAISource = nil
	omitted.AppHash, err = omitted.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tamperedPath, mustJSON(t, omitted), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadCommittedState(tamperedPath, f.m); err == nil {
		t.Fatal("rehash accepted removal of the complete source segment")
	}
	if _, err := NewPersistentApplication(f.m, path); err == nil {
		t.Fatal("a saved candidate self-authorized normal activation")
	}

	// Query the validated candidate through the actual dispatcher; this carries
	// provenance and never assigns the original requester's string a signer.
	a.committed = cold
	var original sourceAIActionView
	queryJSON(t, a, "/ai/actions/"+f.canonicalPending, &original)
	if original.Writable || original.RequesterBinding != "canonical_requester_unproven" || original.MutationFence != "signed_principal_binding_missing" || !reflect.DeepEqual(original.AIActionProposal, f.m.Runtime.AIActions[f.canonicalPending]) {
		t.Fatal("query invented source authority or changed original action")
	}
	var opaque sourceAIPermissionView
	queryJSON(t, a, "/ai/permissions/"+f.permission, &opaque)
	if opaque.Writable || opaque.RequesterBinding != "opaque_requester_unbound" || !reflect.DeepEqual(opaque.AIPermissionGrant, f.m.Runtime.AIPerms[f.permission]) {
		t.Fatal("opaque permission was converted into a new BFT principal")
	}
	rawQuery, err := a.Query(context.Background(), &abci.RequestQuery{Path: "/ai/actions/" + f.pending})
	if err != nil || rawQuery.Code != 0 {
		t.Fatal("original pending record is not queryable", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(rawQuery.Value, &fields); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"signer", "txHash", "blockHeight"} {
		if _, ok := fields[forbidden]; ok {
			t.Fatal("query invented signed provenance", forbidden)
		}
	}
	var requirements []SourceAIAuthorityRequirement
	queryJSON(t, a, "/ai/source/authority-requirements", &requirements)
	if len(requirements) != 7 {
		t.Fatal("missing source authority requirements")
	}
	var audit []json.RawMessage
	queryJSON(t, a, "/ai/audit", &audit)
	if len(audit) != len(f.m.Runtime.Transp) {
		t.Fatal("source audit entries disappeared")
	}
}

func TestLegacyAISourceNewSignedActionsDoNotInheritOldAuthority(t *testing.T) {
	f := newLegacyAISourceFixture(t)
	source := migrationAISource(f.m)
	key := deterministicPrivateKey(211)
	for _, input := range []AIActionDecisionPayload{
		{ActionID: f.pending, PermissionID: f.permission, Approver: "opaque-agent"},
		{ActionID: f.canonicalPending, PermissionID: f.permission, Approver: mustNativeAddress(t, key)},
		{ActionID: strings.Repeat("a", 24), PermissionID: f.permission, Approver: "opaque-agent"},
	} {
		raw := mustTrustAction(t, key, ActionAIProposalApprove, input, 1)
		tx, err := DecodeSignedApplicationAction(raw)
		if err != nil || tx.Verify(6423) != nil {
			t.Fatal("not a genuine signed test action", err)
		}
		before := mustJSON(t, source)
		if err := rejectLegacyAIActionWrite(source, tx, ApplicationActionHash(raw)); err == nil {
			t.Fatal("signed new action inherited unsigned historical authority")
		}
		if !bytes.Equal(before, mustJSON(t, source)) {
			t.Fatal("fence changed source history")
		}
	}
	reject := mustTrustAction(t, key, ActionAIProposalReject, AIActionDecisionPayload{ActionID: f.pending, Approver: "reviewer"}, 1)
	tx, err := DecodeSignedApplicationAction(reject)
	if err != nil || rejectLegacyAIActionWrite(source, tx, ApplicationActionHash(reject)) == nil {
		t.Fatal("old pending rejection bypassed the binding fence", err)
	}

	// Independent fresh signed records are still allowed, including the same
	// opaque requester text. Only their verified signer provides new authority.
	a, err := NewApplication(f.clean)
	if err != nil {
		t.Fatal(err)
	}
	permission := mustTrustAction(t, key, ActionAIPermissionCreate, AIPermissionPayload{SessionID: "legacy-session", Requester: "opaque-agent", Scope: "wallet_transfer", Purpose: "new independent signed permission", ExpiryHours: 2}, 1)
	proposal := mustTrustAction(t, key, ActionAIProposalCreate, AIActionProposalPayload{SessionID: "legacy-session", Requester: "opaque-agent", Scope: "wallet_transfer", ActionType: "transfer", Description: "new independent signed action", ExpiryHours: 2}, 2)
	approval := mustTrustAction(t, key, ActionAIProposalApprove, AIActionDecisionPayload{ActionID: ApplicationActionRecordID("ai-action", ApplicationActionHash(proposal)), PermissionID: ApplicationActionRecordID("ai-permission", ApplicationActionHash(permission)), Approver: "new reviewer"}, 3)
	for _, raw := range [][]byte{permission, proposal, approval} {
		tx, err := DecodeSignedApplicationAction(raw)
		if err != nil || rejectLegacyAIActionWrite(source, tx, ApplicationActionHash(raw)) != nil {
			t.Fatal("fresh signed records blocked by unrelated old claims", err)
		}
	}
	result, err := a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(f.clean.Height) + 1, Time: time.Now().UTC().Add(48 * time.Hour), Txs: [][]byte{permission, proposal, approval}})
	if err != nil || len(result.TxResults) != 3 {
		t.Fatal("fresh signed action execution failed", err)
	}
	for _, result := range result.TxResults {
		if result.Code != 0 {
			t.Fatal("fresh signed action was refused", result.Log)
		}
	}
	if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	assertConsensusAccount(t, a, mustNativeAddress(t, key), 97, 3)
	if len(a.committed.AIActions) != 1 || a.committed.AIActions[0].Status != "approved" || a.committed.AIActions[0].PermissionID == f.permission {
		t.Fatal("new BFT decision reused original source permission")
	}
}

func TestLegacyAISourceNilPreservesExistingEncoding(t *testing.T) {
	f := newLegacyAISourceFixture(t)
	state := initialCommittedState(f.clean)
	if state.LegacyAISource != nil {
		t.Fatal("empty source synthesized a segment")
	}
	wire := mustJSON(t, state)
	if bytes.Contains(wire, []byte(`"legacyAISource"`)) {
		t.Fatal("nil source changed historical JSON")
	}
	before, err := state.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	var cold CommittedState
	if err := json.Unmarshal(wire, &cold); err != nil {
		t.Fatal(err)
	}
	after, err := cold.calculateHash()
	if err != nil || before != after {
		t.Fatal("nil source changed the original hash across JSON restore", err)
	}
}
