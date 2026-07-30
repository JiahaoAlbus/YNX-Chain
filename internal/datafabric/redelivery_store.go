package datafabric

import (
	"errors"
	"sort"
	"time"
)

func (s *Store) PreviewRedelivery(mode RedeliveryMode, scope RedeliveryScope, at time.Time) (RedeliveryPreview, error) {
	if at.IsZero() || at.Location() != time.UTC {
		return RedeliveryPreview{}, errors.New("redelivery preview time must be UTC")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buildRedeliveryPreviewLocked(mode, scope, at)
}

func (s *Store) ExecuteRedelivery(command RedeliveryCommand, at time.Time) (RedeliveryRun, error) {
	if err := command.Validate(); err != nil {
		return RedeliveryRun{}, err
	}
	if at.IsZero() || at.Location() != time.UTC {
		return RedeliveryRun{}, errors.New("redelivery execution time must be UTC")
	}
	requestHash, err := RedeliveryRequestHash(command)
	if err != nil {
		return RedeliveryRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, exists := s.state.RedeliveryRuns[command.IdempotencyKey]; exists {
		if existing.RequestHash != requestHash {
			return RedeliveryRun{}, Reject(CodeRedeliveryIdempotencyConflict, "idempotency key was already used for a different redelivery command", map[string]string{"idempotencyKey": command.IdempotencyKey, "runId": existing.RunID})
		}
		return cloneRedeliveryRun(existing), nil
	}
	preview, err := s.buildRedeliveryPreviewLocked(command.Mode, command.Scope, at)
	if err != nil {
		return RedeliveryRun{}, err
	}
	if preview.ScopeHash != command.PreviewHash {
		return RedeliveryRun{}, Reject(CodeRedeliveryPreviewStale, "redelivery preview no longer matches authoritative delivery state", map[string]string{"expectedPreviewHash": preview.ScopeHash, "providedPreviewHash": command.PreviewHash})
	}
	if preview.CandidateCount == 0 {
		return RedeliveryRun{}, Reject(CodeRedeliveryNoCandidates, "redelivery scope has no eligible canonical events", map[string]string{"previewHash": preview.ScopeHash})
	}
	next := cloneState(s.state)
	run := RedeliveryRun{
		RunID: RedeliveryRunID(command.IdempotencyKey), RequestID: command.RequestID, IdempotencyKey: command.IdempotencyKey,
		RequestHash: requestHash, Mode: command.Mode, Scope: command.Scope, PreviewHash: command.PreviewHash,
		Reason: command.Reason, ApprovalID: command.ApprovalID, ApprovalStatus: command.ApprovalStatus,
		AuditID: command.AuditID, RequestedBy: command.RequestedBy, ControlVersion: command.ControlVersion,
		SourceCommit: command.SourceCommit, SourceRelease: command.SourceRelease,
		Status: "completed", CandidateCount: preview.CandidateCount, StartedAt: at, CompletedAt: at,
	}
	outboxByEvent := make(map[string]int, len(next.Outbox))
	for index := range next.Outbox {
		outboxByEvent[next.Outbox[index].EventID] = index
	}
	for _, candidate := range preview.Candidates {
		index, exists := outboxByEvent[candidate.EventID]
		if !exists {
			return RedeliveryRun{}, errors.New("redelivery candidate has no transactional Outbox record")
		}
		record := &next.Outbox[index]
		if candidate.DeliveryStatus == "pending" {
			run.SkippedPending++
			continue
		}
		record.Attempt = 0
		record.AvailableAt = at
		record.PublishedAt = time.Time{}
		record.LastFailure = ""
		run.EnqueuedCount++
		run.EventIDs = append(run.EventIDs, candidate.EventID)
		for deadLetterIndex := range next.DeadLetters {
			deadLetter := &next.DeadLetters[deadLetterIndex]
			if deadLetter.EventID == candidate.EventID && deadLetter.Consumer == "" && deadLetter.RequeuedAt.IsZero() {
				deadLetter.RequeuedAt = at
				deadLetter.RequeueAuditID = command.AuditID
			}
		}
	}
	next.RedeliveryRuns[command.IdempotencyKey] = cloneRedeliveryRun(run)
	if err := s.commit(next); err != nil {
		return RedeliveryRun{}, err
	}
	return cloneRedeliveryRun(run), nil
}

func (s *Store) RedeliveryRuns() []RedeliveryRun {
	s.mu.Lock()
	defer s.mu.Unlock()
	runs := make([]RedeliveryRun, 0, len(s.state.RedeliveryRuns))
	for _, run := range s.state.RedeliveryRuns {
		runs = append(runs, cloneRedeliveryRun(run))
	}
	sort.Slice(runs, func(i, j int) bool {
		if runs[i].CompletedAt.Equal(runs[j].CompletedAt) {
			return runs[i].RunID < runs[j].RunID
		}
		return runs[i].CompletedAt.Before(runs[j].CompletedAt)
	})
	return runs
}

func (s *Store) buildRedeliveryPreviewLocked(mode RedeliveryMode, scope RedeliveryScope, at time.Time) (RedeliveryPreview, error) {
	if mode != RedeliveryReplay && mode != RedeliveryBackfill {
		return RedeliveryPreview{}, errors.New("redelivery mode is invalid")
	}
	if err := scope.Validate(); err != nil {
		return RedeliveryPreview{}, err
	}
	outbox := make(map[string]OutboxRecord, len(s.state.Outbox))
	for _, record := range s.state.Outbox {
		outbox[record.EventID] = record
	}
	activeDeadLetters := make(map[string]bool)
	for _, record := range s.state.DeadLetters {
		if record.Consumer == "" && record.RequeuedAt.IsZero() {
			activeDeadLetters[record.EventID] = true
		}
	}
	var candidates []RedeliveryCandidate
	for _, event := range s.state.Events {
		if !MatchRedeliveryScope(event, scope) {
			continue
		}
		record, exists := outbox[event.EventID]
		if !exists {
			return RedeliveryPreview{}, errors.New("canonical event has no transactional Outbox record")
		}
		status := "published"
		if activeDeadLetters[event.EventID] {
			status = "dead-letter"
		} else if record.PublishedAt.IsZero() {
			status = "pending"
		}
		if mode == RedeliveryReplay && status == "pending" {
			continue
		}
		occurredAt := event.Timestamp
		if !event.OccurredAt.IsZero() {
			occurredAt = event.OccurredAt
		}
		candidates = append(candidates, RedeliveryCandidate{
			EventID: event.EventID, EventType: event.EventType, SchemaVersion: event.SchemaVersion,
			AggregateType: event.AggregateType, AggregateID: event.AggregateID, Sequence: event.Sequence,
			OccurredAt: occurredAt, IntegrityHash: event.Integrity.Digest, DeliveryStatus: status,
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].OccurredAt.Equal(candidates[j].OccurredAt) {
			return candidates[i].EventID < candidates[j].EventID
		}
		return candidates[i].OccurredAt.Before(candidates[j].OccurredAt)
	})
	truncated := len(candidates) > scope.Limit
	if truncated {
		candidates = candidates[:scope.Limit]
	}
	return FinalizeRedeliveryPreview(mode, scope, candidates, truncated, at)
}

func cloneRedeliveryRun(run RedeliveryRun) RedeliveryRun {
	copy := run
	copy.EventIDs = append([]string(nil), run.EventIDs...)
	return copy
}
