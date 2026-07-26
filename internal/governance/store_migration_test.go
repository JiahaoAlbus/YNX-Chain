package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func rewriteSnapshot(t *testing.T, path string, mutate func(*snapshotEnvelope)) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var envelope snapshotEnvelope
	if err = json.Unmarshal(data, &envelope); err != nil {
		t.Fatal(err)
	}
	mutate(&envelope)
	encoded, err := json.Marshal(envelope.Payload)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(encoded)
	envelope.Digest = hex.EncodeToString(digest[:])
	data, err = json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLoadRejectsLegacyV1StateEvenWithValidSnapshotDigest(t *testing.T) {
	now := time.Date(2026, 7, 25, 9, 0, 0, 0, time.UTC)
	service := testService(t)
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, now); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		envelope.Payload.Version = legacySnapshotVersion
	})
	if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "state-machine migration") {
		t.Fatalf("legacy state was not rejected: %v", err)
	}
}

func TestLoadRejectsLegacyV2StateWithoutSignedVoteMigration(t *testing.T) {
	now := time.Date(2026, 7, 25, 9, 15, 0, 0, time.UTC)
	service := testService(t)
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, now); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		envelope.Payload.Version = legacyStateMachineSnapshotVersion
	})
	if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "signed-vote migration") {
		t.Fatalf("legacy v2 state was not rejected: %v", err)
	}
}

func TestLoadRejectsLegacyV3StateWithoutPersistentDelegationMigration(t *testing.T) {
	now := time.Date(2026, 7, 25, 9, 20, 0, 0, time.UTC)
	service := testService(t)
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, now); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		envelope.Payload.Version = legacySignedVoteSnapshotVersion
	})
	if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "persistent-delegation migration") {
		t.Fatalf("legacy v3 state was not rejected: %v", err)
	}
}

func TestLoadRejectsTamperedTransitionHistoryEvenWithValidSnapshotDigest(t *testing.T) {
	now := time.Date(2026, 7, 25, 9, 30, 0, 0, time.UTC)
	service := testService(t)
	proposal, err := service.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/state.json"
	if err = service.Save(path, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		for i := range envelope.Payload.Proposals {
			if envelope.Payload.Proposals[i].ID != proposal.ID {
				continue
			}
			envelope.Payload.Proposals[i].Transitions[1].To = StatusApproved
			envelope.Payload.Proposals[i].Status = StatusApproved
			envelope.Payload.Proposals[i].Transitions[1].AuditHash = transitionAudit(proposal.ID, envelope.Payload.Proposals[i].Transitions[1])
		}
	})
	if _, err = Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "transition history") {
		t.Fatalf("tampered state transition was not rejected: %v", err)
	}
}

func TestLoadRejectsLegacyCombinedRoleEvenWithValidSnapshotDigest(t *testing.T) {
	now := time.Date(2026, 7, 25, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, now); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		assignment := &envelope.Payload.Roles[0]
		assignment.Input.Role = GovernanceRole("token_holder_delegator")
		reference := strings.TrimPrefix(assignment.ProposalID, "genesis:")
		assignment.ID = hash("role", assignment.Input.Account, string(assignment.Input.Role), reference, assignment.Input.TermStartsAt.UTC().Format(time.RFC3339Nano), assignment.Input.TermEndsAt.UTC().Format(time.RFC3339Nano))
		assignment.AuditHash = roleAudit(assignment)
	})
	if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "explicit role migration") {
		t.Fatalf("legacy role was not rejected: %v", err)
	}
}

func TestLoadRejectsLegacyEmergencyCouncilApproval(t *testing.T) {
	now := time.Date(2026, 7, 25, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	action, err := service.CreateEmergency(emergencyInput(now), "emergency-1", now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.ApproveEmergency(action.ID, "emergency-1", "emergency_council", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/state.json"
	if err = service.Save(path, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		approval := envelope.Payload.Emergencies[0].Approvals["emergency-1"]
		approval.Role = "security_council"
		approval.AuditHash = hash(envelope.Payload.Emergencies[0].ID, approval.Signer, approval.Role)
		envelope.Payload.Emergencies[0].Approvals["emergency-1"] = approval
	})
	if _, err = Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "explicit migration") {
		t.Fatalf("legacy emergency approval was not rejected: %v", err)
	}
}
