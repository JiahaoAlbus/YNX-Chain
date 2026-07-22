package datafabric

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const storeSchemaVersion = 1

type OutboxRecord struct {
	EventID      string    `json:"eventId"`
	PartitionKey string    `json:"partitionKey"`
	Attempt      uint32    `json:"attempt"`
	AvailableAt  time.Time `json:"availableAt"`
	PublishedAt  time.Time `json:"publishedAt,omitempty"`
	LastFailure  string    `json:"lastFailure,omitempty"`
}

type InboxRecord struct {
	Consumer    string    `json:"consumer"`
	EventID     string    `json:"eventId"`
	ProcessedAt time.Time `json:"processedAt"`
	EffectHash  string    `json:"effectHash"`
}

type DeadLetter struct {
	Consumer   string    `json:"consumer"`
	EventID    string    `json:"eventId"`
	Attempts   uint32    `json:"attempts"`
	Failure    string    `json:"failure"`
	RecordedAt time.Time `json:"recordedAt"`
}

type persistedState struct {
	SchemaVersion   int                      `json:"schemaVersion"`
	Events          []EventEnvelope          `json:"events"`
	Outbox          []OutboxRecord           `json:"outbox"`
	Inbox           map[string]InboxRecord   `json:"inbox"`
	Projections     map[string]string        `json:"projections"`
	DeadLetters     []DeadLetter             `json:"deadLetters"`
	Ledger          []JournalEntry           `json:"ledger"`
	Sagas           []SagaInstance           `json:"sagas"`
	Reconciliations []ReconciliationRun      `json:"reconciliations"`
	ErasureRequests map[string]ErasureRecord `json:"erasureRequests"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	state persistedState
}

type StoreStats struct {
	Events                   uint64  `json:"events"`
	OutboxPending            uint64  `json:"outboxPending"`
	OutboxOldestUnix         float64 `json:"outboxOldestUnix"`
	InboxEffects             uint64  `json:"inboxEffects"`
	DeadLetters              uint64  `json:"deadLetters"`
	JournalEntries           uint64  `json:"journalEntries"`
	SagasRunning             uint64  `json:"sagasRunning"`
	SagasRecovery            uint64  `json:"sagasRecovery"`
	Reconciliations          uint64  `json:"reconciliations"`
	ReconciliationMismatches uint64  `json:"reconciliationMismatches"`
	ErasureRequests          uint64  `json:"erasureRequests"`
	AnalyticsFacts           uint64  `json:"analyticsFacts"`
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, state: newState()}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := s.commit(s.state); err != nil {
			return nil, fmt.Errorf("initialize data fabric store: %w", err)
		}
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read data fabric store: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&s.state); err != nil {
		return nil, fmt.Errorf("decode data fabric store: %w", err)
	}
	if err := ensureEOF(decoder); err != nil {
		return nil, fmt.Errorf("decode data fabric store: %w", err)
	}
	if s.state.SchemaVersion != storeSchemaVersion || s.state.Inbox == nil || s.state.Projections == nil {
		return nil, errors.New("data fabric store schema is unsupported or incomplete")
	}
	if s.state.ErasureRequests == nil {
		s.state.ErasureRequests = map[string]ErasureRecord{}
		if err := s.commit(s.state); err != nil {
			return nil, fmt.Errorf("initialize privacy state: %w", err)
		}
	}
	return s, nil
}

func newState() persistedState {
	return persistedState{SchemaVersion: storeSchemaVersion, Inbox: map[string]InboxRecord{}, Projections: map[string]string{}, ErasureRequests: map[string]ErasureRecord{}}
}

// Append commits the authoritative event and its outbox record with one atomic
// file replacement. Publishing is intentionally a separate retryable action.
func (s *Store) Append(event EventEnvelope, key []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := event.Verify(key); err != nil {
		return err
	}
	for _, existing := range s.state.Events {
		if existing.EventID == event.EventID {
			if existing.Integrity.Digest == event.Integrity.Digest {
				return ErrDuplicate
			}
			return ErrTampered
		}
	}
	var last uint64
	for _, existing := range s.state.Events {
		if existing.Product == event.Product && existing.Service == event.Service && existing.AggregateID == event.AggregateID && existing.Sequence > last {
			last = existing.Sequence
		}
	}
	if event.Sequence != last+1 {
		return fmt.Errorf("%w: aggregate expects sequence %d, got %d", ErrOutOfOrder, last+1, event.Sequence)
	}
	next := cloneState(s.state)
	next.Events = append(next.Events, event)
	next.Outbox = append(next.Outbox, OutboxRecord{EventID: event.EventID, PartitionKey: event.PartitionKey(), AvailableAt: time.Now().UTC()})
	return s.commit(next)
}

func (s *Store) PendingOutbox(now time.Time, limit int) []OutboxRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	var records []OutboxRecord
	for _, record := range s.state.Outbox {
		if record.PublishedAt.IsZero() && !record.AvailableAt.After(now) {
			records = append(records, record)
		}
	}
	sort.Slice(records, func(i, j int) bool { return records[i].AvailableAt.Before(records[j].AvailableAt) })
	if limit > 0 && len(records) > limit {
		records = records[:limit]
	}
	return records
}

func (s *Store) MarkPublished(eventID string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	for i := range next.Outbox {
		if next.Outbox[i].EventID == eventID {
			next.Outbox[i].PublishedAt = at.UTC()
			next.Outbox[i].LastFailure = ""
			return s.commit(next)
		}
	}
	return os.ErrNotExist
}

func (s *Store) MarkPublishFailure(eventID, failure string, now time.Time, maxAttempts uint32) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	for i := range next.Outbox {
		record := &next.Outbox[i]
		if record.EventID != eventID {
			continue
		}
		record.Attempt++
		record.LastFailure = failure
		delay := time.Second << min(record.Attempt, 8)
		record.AvailableAt = now.UTC().Add(delay)
		if record.Attempt >= maxAttempts {
			next.DeadLetters = append(next.DeadLetters, DeadLetter{EventID: eventID, Attempts: record.Attempt, Failure: failure, RecordedAt: now.UTC()})
			record.PublishedAt = now.UTC()
		}
		return s.commit(next)
	}
	return os.ErrNotExist
}

// ApplyProjection gives an idempotent consumer an exactly-once local state
// transition: the projection effect and inbox marker share the same commit.
func (s *Store) ApplyProjection(consumer, eventID string, apply func(EventEnvelope, map[string]string) (string, error)) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := consumer + ":" + eventID
	if _, exists := s.state.Inbox[key]; exists {
		return false, nil
	}
	var event EventEnvelope
	found := false
	for _, candidate := range s.state.Events {
		if candidate.EventID == eventID {
			event, found = candidate, true
			break
		}
	}
	if !found {
		return false, os.ErrNotExist
	}
	next := cloneState(s.state)
	effectHash, err := apply(event, next.Projections)
	if err != nil {
		return false, err
	}
	if effectHash == "" {
		return false, errors.New("consumer effect hash is required")
	}
	next.Inbox[key] = InboxRecord{Consumer: consumer, EventID: eventID, ProcessedAt: time.Now().UTC(), EffectHash: effectHash}
	if err := s.commit(next); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) Events() []EventEnvelope {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]EventEnvelope(nil), s.state.Events...)
}

func (s *Store) Event(id string) (EventEnvelope, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, event := range s.state.Events {
		if event.EventID == id {
			return event, true
		}
	}
	return EventEnvelope{}, false
}

func (s *Store) DeadLetters() []DeadLetter {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]DeadLetter(nil), s.state.DeadLetters...)
}

func (s *Store) RequeueDeadLetter(eventID string, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	found := false
	kept := next.DeadLetters[:0]
	for _, record := range next.DeadLetters {
		if record.EventID == eventID && record.Consumer == "" {
			found = true
			continue
		}
		kept = append(kept, record)
	}
	if !found {
		return os.ErrNotExist
	}
	next.DeadLetters = kept
	for i := range next.Outbox {
		if next.Outbox[i].EventID == eventID {
			next.Outbox[i].Attempt = 0
			next.Outbox[i].AvailableAt = now.UTC()
			next.Outbox[i].PublishedAt = time.Time{}
			next.Outbox[i].LastFailure = ""
			return s.commit(next)
		}
	}
	return errors.New("dead-letter event has no outbox record")
}

type ReplayReport struct {
	Scanned    uint64 `json:"scanned"`
	Applied    uint64 `json:"applied"`
	Skipped    uint64 `json:"skipped"`
	Suppressed uint64 `json:"suppressed"`
}

func (s *Store) ReplayProjection(consumer string, afterSequence uint64, limit int, apply func(EventEnvelope, map[string]string) (string, error)) (ReplayReport, error) {
	if consumer == "" || limit < 0 {
		return ReplayReport{}, errors.New("consumer is required and limit cannot be negative")
	}
	events := s.Events()
	var report ReplayReport
	for index, event := range events {
		if uint64(index+1) <= afterSequence {
			continue
		}
		if limit > 0 && int(report.Scanned) >= limit {
			break
		}
		report.Scanned++
		applied, err := s.ApplyProjection(consumer, event.EventID, apply)
		if err != nil {
			return report, err
		}
		if applied {
			report.Applied++
		} else {
			report.Skipped++
		}
	}
	return report, nil
}

func (s *Store) ReplayAnalyticsProjection(consumer string, afterSequence uint64, limit int, privacyKey []byte, apply func(EventEnvelope, map[string]string) (string, error)) (ReplayReport, error) {
	if !strings.HasPrefix(consumer, "analytics.") || len(privacyKey) < 32 {
		return ReplayReport{}, errors.New("analytics replay requires an analytics consumer and privacy key")
	}
	events := s.Events()
	var report ReplayReport
	for index, event := range events {
		if uint64(index+1) <= afterSequence {
			continue
		}
		if limit > 0 && int(report.Scanned) >= limit {
			break
		}
		report.Scanned++
		if event.Actor.AccountID != "" && s.SubjectSuppressed(event.Actor.AccountID, privacyKey) {
			report.Suppressed++
			continue
		}
		applied, err := s.ApplyProjection(consumer, event.EventID, apply)
		if err != nil {
			return report, err
		}
		if applied {
			report.Applied++
		} else {
			report.Skipped++
		}
	}
	return report, nil
}

func (s *Store) Projection(key string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.Projections[key]
}

func (s *Store) Stats() StoreStats {
	s.mu.Lock()
	defer s.mu.Unlock()
	stats := StoreStats{Events: uint64(len(s.state.Events)), InboxEffects: uint64(len(s.state.Inbox)), DeadLetters: uint64(len(s.state.DeadLetters)), JournalEntries: uint64(len(s.state.Ledger)), Reconciliations: uint64(len(s.state.Reconciliations)), ErasureRequests: uint64(len(s.state.ErasureRequests))}
	for _, record := range s.state.Outbox {
		if record.PublishedAt.IsZero() {
			stats.OutboxPending++
			candidate := float64(record.AvailableAt.UnixNano()) / float64(time.Second)
			if stats.OutboxOldestUnix == 0 || candidate < stats.OutboxOldestUnix {
				stats.OutboxOldestUnix = candidate
			}
		}
	}
	for _, run := range s.state.Reconciliations {
		if run.Status != "matched" {
			stats.ReconciliationMismatches++
		}
	}
	for _, saga := range s.state.Sagas {
		switch saga.Status {
		case SagaRunning:
			stats.SagasRunning++
		case SagaCompensating, SagaManualRecovery:
			stats.SagasRecovery++
		}
	}
	return stats
}

func (s *Store) commit(next persistedState) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".data-fabric-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(s.path))
	if err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	if err := directory.Close(); err != nil {
		return err
	}
	s.state = next
	return nil
}

func cloneState(state persistedState) persistedState {
	data, _ := json.Marshal(state)
	var result persistedState
	_ = json.Unmarshal(data, &result)
	return result
}
