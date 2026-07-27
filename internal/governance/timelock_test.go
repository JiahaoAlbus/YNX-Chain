package governance

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func proposalAtTimelock(t *testing.T, service *Service, now time.Time) Proposal {
	t.Helper()
	proposal := proposalAtVoting(t, service, now, VotingSnapshot{BasePower: map[string]uint64{"alice": 100}})
	var err error
	if proposal, err = castTestVote(t, service, proposal.ID, "alice", "yes", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if proposal, err = service.Finalize(proposal.ID, proposal.VotingEndsAt); err != nil {
		t.Fatal(err)
	}
	return proposal
}

func TestFirstClassTimelockBindsActionHashGraceAndSingleSubmission(t *testing.T) {
	now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	records := service.ListTimelocks(proposal.ExecuteAfter)
	if len(records) != 1 {
		t.Fatalf("timelock record missing: %v", records)
	}
	record := records[0]
	if record.ID != hash("timelock", proposal.ID, proposal.ActionHash) || record.ActionHash != proposal.ActionHash || record.Status != TimelockActive ||
		record.EarliestExecution != proposal.ExecuteAfter || record.GraceEndsAt != proposal.ExecuteAfter.Add(service.policy.TimelockGrace) ||
		len(record.Transitions) != 2 || record.AuditHash == "" || len(record.NoticeEvidence) == 0 {
		t.Fatalf("invalid first-class timelock: %+v", record)
	}
	manifest := strings.Repeat("a", 64)
	if _, err := service.BeginExecution(proposal.ID, manifest, proposal.ExecuteAfter.Add(-time.Second)); !errors.Is(err, ErrNotReady) {
		t.Fatalf("early execution accepted: %v", err)
	}
	passTestCanary(t, service, proposal, manifest)
	submitted, err := service.BeginExecution(proposal.ID, manifest, proposal.ExecuteAfter)
	if err != nil || submitted.Status != StatusExecutionSubmitted {
		t.Fatalf("execution submission: %+v %v", submitted, err)
	}
	if _, err = service.BeginExecution(proposal.ID, manifest, proposal.ExecuteAfter.Add(time.Second)); !errors.Is(err, ErrReplay) {
		t.Fatalf("duplicate execution was not classified as replay: %v", err)
	}
	record = service.ListTimelocks(proposal.ExecuteAfter)[0]
	if record.Status != TimelockSubmitted || record.ExecutionManifestHash != manifest || record.ExecutionStartedAt != proposal.ExecuteAfter {
		t.Fatalf("submission not bound to timelock: %+v", record)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	if err = service.Save(path, proposal.ExecuteAfter.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatalf("submitted timelock restart recovery failed: %v", err)
	}
	if records = restored.ListTimelocks(proposal.ExecuteAfter); len(records) != 1 || records[0].Status != TimelockSubmitted {
		t.Fatalf("submitted timelock restart records invalid: %v", records)
	}
}

func TestTimelockGraceExpiryPersistsAndFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	afterGrace := proposal.ExecuteAfter.Add(service.policy.TimelockGrace).Add(time.Nanosecond)
	if _, err := service.BeginExecution(proposal.ID, strings.Repeat("b", 64), afterGrace); !errors.Is(err, ErrNotReady) {
		t.Fatalf("post-grace execution accepted: %v", err)
	}
	expired, err := service.Get(proposal.ID)
	if err != nil || expired.Status != StatusExpired || service.ListTimelocks(afterGrace)[0].Status != TimelockExpired {
		t.Fatalf("grace expiry not authoritative: proposal=%+v timelock=%+v err=%v", expired, service.ListTimelocks(afterGrace), err)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	if err = service.Save(path, afterGrace); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatalf("expired timelock restore failed: %v", err)
	}
	if records := restored.ListTimelocks(afterGrace); len(records) != 1 || records[0].Status != TimelockExpired {
		t.Fatalf("expired timelock restore records invalid: %v", records)
	}
}

func TestTimelockRestoreRejectsTamperWithRecomputedSnapshotDigest(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	path := filepath.Join(t.TempDir(), "state.json")
	if err := service.Save(path, proposal.ExecuteAfter); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		envelope.Payload.Timelocks[0].ActionHash = strings.Repeat("f", 64)
		envelope.Payload.Timelocks[0].AuditHash = timelockAudit(&envelope.Payload.Timelocks[0])
	})
	if _, err := Load(path); !errors.Is(err, ErrForbidden) {
		t.Fatalf("timelock tamper accepted: %v", err)
	}
}

func TestTimelockCancellationRequiresExactActionHashAndScopedSession(t *testing.T) {
	now := time.Date(2026, 7, 27, 11, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	auth := &testAuth{principal: Principal{Account: "technical-1", Product: "governance", DeviceID: "device-1", SessionID: "session-1", Roles: map[string]bool{"technical_council": true}, Scopes: map[Scope]bool{ScopeBridge: true}}}
	path := filepath.Join(t.TempDir(), "state.json")
	server, err := NewServer(service, auth, path, func() time.Time { return proposal.ExecuteAfter.Add(-time.Minute) })
	if err != nil {
		t.Fatal(err)
	}
	call := func(actionHash string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]any{"actionHash": actionHash, "reason": "New safety evidence invalidates this exact scheduled action.", "evidence": []string{"sha256:timelock-cancellation-evidence"}})
		request := httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/timelock/cancel", bytes.NewReader(body))
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		return recorder
	}
	if response := call(strings.Repeat("0", 64)); response.Code != http.StatusForbidden {
		t.Fatalf("wrong action hash cancellation status=%d body=%s", response.Code, response.Body.String())
	}
	if response := call(proposal.ActionHash); response.Code != http.StatusOK {
		t.Fatalf("exact cancellation rejected status=%d body=%s", response.Code, response.Body.String())
	}
	cancelled, err := service.Get(proposal.ID)
	if err != nil || cancelled.Status != StatusCancelled || service.ListTimelocks(proposal.ExecuteAfter)[0].Status != TimelockCancelled {
		t.Fatalf("cancellation not synchronized: proposal=%+v timelock=%+v err=%v", cancelled, service.ListTimelocks(proposal.ExecuteAfter), err)
	}
	if _, err = Load(path); err != nil {
		t.Fatalf("cancelled timelock did not persist: %v", err)
	}
}

func TestEmergencyPauseSynchronizesPersistentTimelock(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	actionInput := emergencyInput(proposal.ExecuteAfter.Add(-time.Hour))
	actionInput.Target = proposal.ID
	action, err := service.CreateEmergency(actionInput, "emergency-1", proposal.ExecuteAfter.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	for index, signer := range []string{"emergency-1", "emergency-2", "emergency-3"} {
		if action, err = service.ApproveEmergency(action.ID, signer, "emergency_council", proposal.ExecuteAfter.Add(-time.Hour+time.Duration(index+1)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	paused, err := service.PauseProposal(proposal.ID, action.ID, "emergency-1", proposal.ExecuteAfter.Add(-30*time.Minute))
	if err != nil || paused.Status != StatusEmergencyPaused {
		t.Fatalf("pause failed: %+v %v", paused, err)
	}
	records := service.ListTimelocks(proposal.ExecuteAfter)
	if len(records) != 1 || records[0].Status != TimelockPaused {
		t.Fatalf("timelock pause not synchronized: %v", records)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	if err = service.Save(path, proposal.ExecuteAfter); err != nil {
		t.Fatal(err)
	}
	if _, err = Load(path); err != nil {
		t.Fatalf("paused timelock restore failed: %v", err)
	}
}
