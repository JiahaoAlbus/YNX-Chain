package datafabric

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRedeliveryPreviewExecuteRetryAndInboxDeduplication(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.pay.redelivery.0001", 1)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	applied, err := store.ApplyProjection("ledger.v1", event.EventID, func(EventEnvelope, map[string]string) (string, error) {
		return event.Integrity.Digest, nil
	})
	if err != nil || !applied {
		t.Fatalf("initial effect failed: applied=%t err=%v", applied, err)
	}
	publishedAt := event.Timestamp.Add(time.Second)
	if err := store.MarkPublished(event.EventID, publishedAt); err != nil {
		t.Fatal(err)
	}
	scope := RedeliveryScope{Product: "pay", EventType: event.EventType, AggregateID: event.AggregateID, Limit: 10}
	preview, err := store.PreviewRedelivery(RedeliveryReplay, scope, publishedAt.Add(time.Second))
	if err != nil || preview.CandidateCount != 1 || preview.Candidates[0].DeliveryStatus != "published" || preview.ScopeHash == "" {
		t.Fatalf("invalid replay preview: %+v err=%v", preview, err)
	}
	command := RedeliveryCommand{
		RequestID: "request.redelivery.0001", IdempotencyKey: "idempotency.redelivery.0001", Mode: RedeliveryReplay,
		Scope: scope, PreviewHash: preview.ScopeHash, Reason: "operator-approved broker redelivery after verified outage",
		ApprovalID: "approval.redelivery.0001", ApprovalStatus: "approved", Confirmed: true,
		AuditID: "audit.redelivery.0001", RequestedBy: "account.operator.0001", RequestedAt: publishedAt.Add(2 * time.Second),
		ControlVersion: "1.0", SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
	}
	run, err := store.ExecuteRedelivery(command, publishedAt.Add(3*time.Second))
	if err != nil || run.EnqueuedCount != 1 || run.SkippedPending != 0 || run.Status != "completed" || len(run.EventIDs) != 1 {
		t.Fatalf("redelivery execution failed: %+v err=%v", run, err)
	}
	if pending := store.PendingOutbox(publishedAt.Add(4*time.Second), 10); len(pending) != 1 || pending[0].EventID != event.EventID {
		t.Fatalf("redelivery did not enqueue canonical Outbox record: %+v", pending)
	}
	publisher := &recordingPublisher{}
	dispatcher := Dispatcher{Store: store, Publisher: publisher, BatchSize: 10, MaxAttempts: 3, Now: func() time.Time { return publishedAt.Add(4 * time.Second) }}
	if report, err := dispatcher.DispatchOnce(context.Background()); err != nil || report.Published != 1 {
		t.Fatalf("redelivered event was not published: %+v err=%v", report, err)
	}
	applied, err = store.ApplyProjection("ledger.v1", event.EventID, func(EventEnvelope, map[string]string) (string, error) {
		t.Fatal("duplicate consumer effect callback must not run")
		return "", nil
	})
	if err != nil || applied {
		t.Fatalf("Inbox did not suppress duplicate effect: applied=%t err=%v", applied, err)
	}
	command.RequestID = "request.redelivery.retry.0001"
	command.RequestedAt = command.RequestedAt.Add(time.Minute)
	retried, err := store.ExecuteRedelivery(command, publishedAt.Add(5*time.Second))
	if err != nil || retried.RunID != run.RunID || len(store.RedeliveryRuns()) != 1 {
		t.Fatalf("idempotent retry did not return prior run: %+v err=%v", retried, err)
	}
}

func TestRedeliveryRejectsStalePreviewAndIdempotencyConflict(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.pay.redelivery.stale.0001", 1)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkPublished(event.EventID, event.Timestamp.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	scope := RedeliveryScope{Product: "pay", AggregateID: event.AggregateID, Limit: 1}
	preview, err := store.PreviewRedelivery(RedeliveryReplay, scope, event.Timestamp.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	command := RedeliveryCommand{
		RequestID: "request.redelivery.stale.0001", IdempotencyKey: "idempotency.redelivery.stale.0001", Mode: RedeliveryReplay,
		Scope: scope, PreviewHash: strings.Repeat("0", 64), Reason: "approved test of stale preview rejection",
		ApprovalID: "approval.redelivery.stale.0001", ApprovalStatus: "approved", Confirmed: true,
		AuditID: "audit.redelivery.stale.0001", RequestedBy: "account.operator.0001", RequestedAt: event.Timestamp.Add(3 * time.Second),
		ControlVersion: "1.0", SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
	}
	if _, err := store.ExecuteRedelivery(command, event.Timestamp.Add(4*time.Second)); ErrorCodeOf(err) != CodeRedeliveryPreviewStale {
		t.Fatalf("stale preview was accepted: %v", err)
	}
	command.PreviewHash = preview.ScopeHash
	run, err := store.ExecuteRedelivery(command, event.Timestamp.Add(5*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	command.Reason = "different operation with reused idempotency key"
	if _, err := store.ExecuteRedelivery(command, event.Timestamp.Add(6*time.Second)); ErrorCodeOf(err) != CodeRedeliveryIdempotencyConflict {
		t.Fatalf("idempotency conflict was accepted after run %s: %v", run.RunID, err)
	}
}

func TestReplayIncludesDeadLetterAndPreservesItsAuditHistory(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.pay.redelivery.deadletter.0001", 1)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	publisher := &recordingPublisher{fail: true}
	dispatcher := Dispatcher{Store: store, Publisher: publisher, BatchSize: 10, MaxAttempts: 2, Now: func() time.Time { return now }}
	if report, err := dispatcher.DispatchOnce(context.Background()); err != nil || report.Failed != 1 {
		t.Fatalf("first publish failure did not enter bounded retry: %+v err=%v", report, err)
	}
	now = now.Add(10 * time.Second)
	if report, err := dispatcher.DispatchOnce(context.Background()); err != nil || report.DeadLetter != 1 || store.Stats().DeadLetters != 1 {
		t.Fatalf("publish failure did not enter DLQ: %+v err=%v", report, err)
	}
	scope := RedeliveryScope{Product: "pay", AggregateID: event.AggregateID, Limit: 10}
	preview, err := store.PreviewRedelivery(RedeliveryReplay, scope, now.Add(time.Second))
	if err != nil || preview.CandidateCount != 1 || preview.Candidates[0].DeliveryStatus != "dead-letter" {
		t.Fatalf("DLQ event was not eligible for replay: %+v err=%v", preview, err)
	}
	command := RedeliveryCommand{
		RequestID: "request.redelivery.deadletter.0001", IdempotencyKey: "idempotency.redelivery.deadletter.0001",
		Mode: RedeliveryReplay, Scope: scope, PreviewHash: preview.ScopeHash, Reason: "approved replay of isolated poison delivery after remediation",
		ApprovalID: "approval.redelivery.deadletter.0001", ApprovalStatus: "approved", Confirmed: true,
		AuditID: "audit.redelivery.deadletter.0001", RequestedBy: "account.operator.0001", RequestedAt: now.Add(2 * time.Second),
		ControlVersion: "1.0", SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
	}
	run, err := store.ExecuteRedelivery(command, now.Add(3*time.Second))
	deadLetters := store.DeadLetters()
	if err != nil || run.EnqueuedCount != 1 || store.Stats().DeadLetters != 0 || len(deadLetters) != 1 || deadLetters[0].RequeueAuditID != command.AuditID || deadLetters[0].RequeuedAt.IsZero() {
		t.Fatalf("DLQ replay did not preserve audited history: run=%+v deadLetters=%+v err=%v", run, deadLetters, err)
	}
}

func TestBackfillPreviewIncludesPendingButExecutionDoesNotDuplicateOutbox(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.pay.backfill.pending.0001", 1)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	scope := RedeliveryScope{Product: "pay", EventType: event.EventType, Limit: 10}
	at := time.Now().UTC()
	preview, err := store.PreviewRedelivery(RedeliveryBackfill, scope, at)
	if err != nil || preview.CandidateCount != 1 || preview.Candidates[0].DeliveryStatus != "pending" {
		t.Fatalf("pending backfill preview is invalid: %+v err=%v", preview, err)
	}
	command := RedeliveryCommand{
		RequestID: "request.backfill.0001", IdempotencyKey: "idempotency.backfill.0001", Mode: RedeliveryBackfill,
		Scope: scope, PreviewHash: preview.ScopeHash, Reason: "approved historical consumer backfill",
		ApprovalID: "approval.backfill.0001", ApprovalStatus: "approved", Confirmed: true,
		AuditID: "audit.backfill.0001", RequestedBy: "account.operator.0001", RequestedAt: at,
		ControlVersion: "1.0", SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
	}
	run, err := store.ExecuteRedelivery(command, at.Add(time.Second))
	if err != nil || run.EnqueuedCount != 0 || run.SkippedPending != 1 || len(store.PendingOutbox(at.Add(time.Minute), 10)) != 1 {
		t.Fatalf("pending Outbox was duplicated by backfill: %+v err=%v", run, err)
	}
}
