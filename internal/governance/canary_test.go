package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCanarySignatureHealthWindowAndExactManifestGate(t *testing.T) {
	now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	manifest := strings.Repeat("a", 64)
	if _, err := service.BeginExecution(proposal.ID, manifest, proposal.ExecuteAfter); !errors.Is(err, ErrForbidden) {
		t.Fatalf("execution without canary was not rejected: %v", err)
	}
	tampered := makeTestCanaryEnvelope(t, service, proposal, manifest)
	tampered.TargetBPS++
	if _, err := service.StartCanary(tampered, tampered.StartsAt); !errors.Is(err, ErrForbidden) {
		t.Fatalf("tampered signed cohort was not rejected: %v", err)
	}
	record := startTestCanary(t, service, proposal, manifest)
	healthyEarly := makeTestCanaryResultEnvelope(t, service, proposal, record, 100, 0, record.Envelope.EndsAt.Add(-time.Second))
	if _, err := service.CompleteCanary(healthyEarly, record.Envelope.EndsAt.Add(-time.Second)); !errors.Is(err, ErrNotReady) {
		t.Fatalf("healthy canary completed before its window: %v", err)
	}
	healthy := makeTestCanaryResultEnvelope(t, service, proposal, record, 100, 0, record.Envelope.EndsAt)
	record, err := service.CompleteCanary(healthy, record.Envelope.EndsAt)
	if err != nil || record.Status != CanaryPassed || record.Result == nil || record.Result.Outcome != "passed" {
		t.Fatalf("canary pass: %+v %v", record, err)
	}
	if _, err = service.BeginExecution(proposal.ID, strings.Repeat("b", 64), proposal.ExecuteAfter); !errors.Is(err, ErrForbidden) {
		t.Fatalf("manifest not evaluated by canary was accepted: %v", err)
	}
	submitTestChainExecution(t, service, proposal, manifest, proposal.ExecuteAfter)
}

func TestCanaryThresholdBreachAbortsEarlyAndPersists(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	manifest := strings.Repeat("b", 64)
	record := startTestCanary(t, service, proposal, manifest)
	breachedAt := record.Envelope.StartsAt.Add(time.Minute)
	breached := makeTestCanaryResultEnvelope(t, service, proposal, record, 100, 2, breachedAt)
	record, err := service.CompleteCanary(breached, breachedAt)
	if err != nil || record.Status != CanaryAborted || record.Result == nil || record.Result.FailureBPS != 200 {
		t.Fatalf("early threshold abort: %+v %v", record, err)
	}
	if _, err = service.BeginExecution(proposal.ID, manifest, proposal.ExecuteAfter); !errors.Is(err, ErrForbidden) {
		t.Fatalf("aborted canary authorized execution: %v", err)
	}
	path := t.TempDir() + "/state.json"
	if err = service.Save(path, proposal.ExecuteAfter); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	canaries := restored.ListCanaries()
	if len(canaries) != 1 || canaries[0].Status != CanaryAborted || canaries[0].AuditHash != record.AuditHash {
		t.Fatalf("restored aborted canary mismatch: %+v", canaries)
	}
}

func TestLoadRejectsTamperedCanaryWithValidSnapshotDigest(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	passTestCanary(t, service, proposal, strings.Repeat("e", 64))
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, proposal.ExecuteAfter); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		record := &envelope.Payload.Canaries[0]
		record.Result.Envelope.FailedSamples = 100
		record.Result.FailureBPS = 10000
		record.Result.Outcome = "failed"
		record.Result.AuditHash = canaryResultAudit(record.ID, record.Result)
		record.AuditHash = canaryAudit(record)
	})
	if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "stored canary result") {
		t.Fatalf("tampered canary was not rejected: %v", err)
	}
}
