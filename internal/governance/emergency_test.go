package governance

import (
	"errors"
	"testing"
	"time"
)

func emergencyInput(now time.Time) EmergencyInput {
	return EmergencyInput{Nonce: "emergency-nonce-0001", Scope: EmergencyBridge, Target: "ynx-testnet-bridge", Reason: "Provider reconciliation mismatch requires a bounded pause.", Evidence: []string{"sha256:provider-reconciliation-record"}, Notice: "Bridge deposits and withdrawals are temporarily paused.", Duration: 2 * time.Hour, FollowUpBy: now.Add(24 * time.Hour)}
}

func TestEmergencyRequiresThresholdExpiresAndNeedsFollowUp(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	a, err := s.CreateEmergency(emergencyInput(now), "security-member-0", now)
	if err != nil {
		t.Fatal(err)
	}
	for i, signer := range []string{"security-1", "technical-1", "security-2"} {
		role := "security_council"
		if i == 1 {
			role = "technical_council"
		}
		a, err = s.ApproveEmergency(a.ID, signer, role, now.Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
	}
	if a.Status != "active" || !s.ActiveEmergency(EmergencyBridge, "ynx-testnet-bridge", now.Add(time.Hour)) {
		t.Fatalf("not active: %+v", a)
	}
	a, err = s.Emergency(a.ID, now.Add(3*time.Hour))
	if err != nil || a.Status != "expired" {
		t.Fatalf("not expired: %+v %v", a, err)
	}
	if _, err = s.CloseEmergency(a.ID, "missing-proposal", now.Add(3*time.Hour)); !errors.Is(err, ErrNotReady) {
		t.Fatalf("missing follow-up: %v", err)
	}
	p, err := s.Create(proposalInput(now.Add(3*time.Hour)), now.Add(3*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	a, err = s.CloseEmergency(a.ID, p.ID, now.Add(4*time.Hour))
	if err != nil || a.Status != "closed" {
		t.Fatalf("close: %+v %v", a, err)
	}
}

func TestEmergencyCannotTransferMintOrBecomePermanent(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	for i, forbidden := range []string{"transfer user asset", "mint reserve tokens", "burn user balance", "owner change", "restore mandate", "permanent parameter"} {
		in := emergencyInput(now)
		in.Nonce = "emergency-nonce-" + string(rune('a'+i))
		in.Reason = "Emergency request attempts to " + forbidden + " without public governance."
		if _, err := s.CreateEmergency(in, "security-member", now); !errors.Is(err, ErrForbidden) {
			t.Fatalf("%q accepted: %v", forbidden, err)
		}
	}
	in := emergencyInput(now)
	in.Duration = 25 * time.Hour
	if _, err := s.CreateEmergency(in, "security-member", now); !errors.Is(err, ErrInvalid) {
		t.Fatalf("overlong pause: %v", err)
	}
}
