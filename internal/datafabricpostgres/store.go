package datafabricpostgres

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/lib/pq"
)

// Store is the transactional PostgreSQL implementation of the authoritative
// event/Outbox, consumer Inbox, and immutable Billing Ledger write paths.
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) (*Store, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL database is required")
	}
	return &Store{db: db}, nil
}

// Append verifies the signed canonical envelope and commits it with its Outbox
// record in one atomic transaction. A transaction-scoped advisory partition
// lock plus the aggregate sequence row provide ordering without cross-partition
// serializable predicate conflicts.
func (s *Store) Append(ctx context.Context, event datafabric.EventEnvelope, verificationKey []byte) error {
	if err := event.Verify(verificationKey); err != nil {
		return err
	}
	envelope, err := json.Marshal(event)
	if err != nil {
		return err
	}
	source, err := json.Marshal(event.Source)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return fmt.Errorf("begin event transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, event.PartitionKey()); err != nil {
		return fmt.Errorf("lock aggregate ordering partition: %w", err)
	}
	var existingEnvelope []byte
	if err := tx.QueryRowContext(ctx, `SELECT canonical_envelope FROM ynx_fabric.events WHERE event_id=$1 FOR KEY SHARE`, event.EventID).Scan(&existingEnvelope); err == nil {
		existing, decodeErr := decodeStoredEnvelope(existingEnvelope)
		if decodeErr != nil || existing.Integrity.Digest != event.Integrity.Digest {
			return datafabric.ErrTampered
		}
		return datafabric.ErrDuplicate
	} else if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check canonical event identity: %w", err)
	}
	var committedSequence uint64
	err = tx.QueryRowContext(ctx, `
WITH advanced AS (
    UPDATE ynx_fabric.aggregate_sequences SET last_sequence=$4::bigint
    WHERE product=$1 AND service=$2 AND aggregate_id=$3 AND last_sequence+1=$4::bigint
    RETURNING last_sequence
), inserted AS (
    INSERT INTO ynx_fabric.aggregate_sequences(product,service,aggregate_id,last_sequence)
    SELECT $1,$2,$3,$4::bigint WHERE $4::bigint=1 AND NOT EXISTS (SELECT 1 FROM advanced)
    ON CONFLICT DO NOTHING
    RETURNING last_sequence
)
SELECT last_sequence FROM advanced UNION ALL SELECT last_sequence FROM inserted`, event.Product, event.Service, event.AggregateID, event.Sequence).Scan(&committedSequence)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: aggregate sequence is not the next committed value", datafabric.ErrOutOfOrder)
	}
	if err != nil {
		return fmt.Errorf("advance aggregate sequence: %w", err)
	}
	if committedSequence != event.Sequence {
		return fmt.Errorf("%w: aggregate sequence transition was inconsistent", datafabric.ErrOutOfOrder)
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ynx_fabric.events (
 event_id,event_type,schema_version,product,service,aggregate_id,actor_id,account_id,session_id,
 correlation_id,causation_id,sequence,occurred_at,effective_at,source_commit,source_release,
 integrity_key_id,integrity_digest,integrity_signature,privacy_classification,retention_class,audit_id,
 source_metadata,payload,canonical_envelope
) VALUES (
 $1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),NULLIF($9,''),$10,NULLIF($11,''),$12,$13,$14,$15,$16,
 $17,$18,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25::jsonb
)`, event.EventID, event.EventType, event.SchemaVersion, event.Product, event.Service, event.AggregateID,
		event.Actor.ActorID, event.Actor.AccountID, event.Actor.SessionID, event.CorrelationID, event.CausationID,
		event.Sequence, event.Timestamp, event.EffectiveAt, event.SourceCommit, event.SourceRelease,
		event.Integrity.KeyID, event.Integrity.Digest, event.Integrity.Signature, event.PrivacyClassification,
		event.RetentionClass, event.AuditID, source, []byte(event.Payload), envelope)
	if err != nil {
		return mapEventWriteError(err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ynx_fabric.outbox(event_id,partition_key,available_at) VALUES ($1,$2,$3)`, event.EventID, event.PartitionKey(), event.Timestamp)
	if err != nil {
		return fmt.Errorf("insert transactional Outbox: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return mapEventWriteError(err)
	}
	return nil
}

func mapEventWriteError(err error) error {
	var pqError *pq.Error
	if errors.As(err, &pqError) && pqError.Code == "23505" {
		if pqError.Constraint == "events_pkey" {
			return datafabric.ErrDuplicate
		}
		if strings.Contains(pqError.Constraint, "aggregate_id_sequence") || strings.Contains(pqError.Constraint, "product_aggregate") {
			return datafabric.ErrOutOfOrder
		}
	}
	return fmt.Errorf("write canonical event: %w", err)
}

func (s *Store) Event(ctx context.Context, eventID string) (datafabric.EventEnvelope, bool, error) {
	var encoded []byte
	if err := s.db.QueryRowContext(ctx, `SELECT canonical_envelope FROM ynx_fabric.events WHERE event_id=$1`, eventID).Scan(&encoded); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return datafabric.EventEnvelope{}, false, nil
		}
		return datafabric.EventEnvelope{}, false, err
	}
	event, err := decodeStoredEnvelope(encoded)
	return event, err == nil, err
}

func decodeStoredEnvelope(encoded []byte) (datafabric.EventEnvelope, error) {
	event, err := datafabric.DecodeEnvelopeStrict(bytes.NewReader(encoded))
	if err != nil {
		return datafabric.EventEnvelope{}, fmt.Errorf("stored canonical envelope failed validation: %w", err)
	}
	return event, nil
}

type ClaimedOutbox struct {
	EventID      string
	PartitionKey string
	Attempt      uint32
	AvailableAt  time.Time
	LeaseOwner   string
	LeaseUntil   time.Time
}

// ClaimOutbox atomically leases eligible records using SKIP LOCKED so multiple
// dispatcher instances can work concurrently without holding network calls in
// a database transaction.
func (s *Store) ClaimOutbox(ctx context.Context, owner string, now time.Time, lease time.Duration, limit int) ([]ClaimedOutbox, error) {
	if strings.TrimSpace(owner) == "" || now.IsZero() || now.Location() != time.UTC || lease <= 0 || limit <= 0 || limit > 1000 {
		return nil, errors.New("Outbox claim requires owner, UTC time, positive lease, and limit 1..1000")
	}
	leaseUntil := now.Add(lease)
	rows, err := s.db.QueryContext(ctx, `
WITH selected AS (
 SELECT event_id FROM ynx_fabric.outbox
 WHERE published_at IS NULL AND available_at <= $1 AND (lease_until IS NULL OR lease_until < $1)
 ORDER BY available_at,event_id FOR UPDATE SKIP LOCKED LIMIT $2
)
UPDATE ynx_fabric.outbox o SET lease_owner=$3,lease_until=$4
FROM selected WHERE o.event_id=selected.event_id
RETURNING o.event_id,o.partition_key,o.attempt,o.available_at,o.lease_owner,o.lease_until`, now, limit, owner, leaseUntil)
	if err != nil {
		return nil, fmt.Errorf("claim Outbox: %w", err)
	}
	defer rows.Close()
	var claimed []ClaimedOutbox
	for rows.Next() {
		var record ClaimedOutbox
		if err := rows.Scan(&record.EventID, &record.PartitionKey, &record.Attempt, &record.AvailableAt, &record.LeaseOwner, &record.LeaseUntil); err != nil {
			return nil, err
		}
		record.AvailableAt = record.AvailableAt.UTC()
		record.LeaseUntil = record.LeaseUntil.UTC()
		claimed = append(claimed, record)
	}
	return claimed, rows.Err()
}

func (s *Store) MarkPublished(ctx context.Context, eventID, owner string, at time.Time) error {
	if strings.TrimSpace(owner) == "" || at.IsZero() || at.Location() != time.UTC {
		return errors.New("publication acknowledgement requires owner and UTC time")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE ynx_fabric.outbox SET published_at=$3,lease_owner=NULL,lease_until=NULL,last_failure=NULL WHERE event_id=$1 AND lease_owner=$2 AND published_at IS NULL`, eventID, owner, at)
	if err != nil {
		return err
	}
	return requireOneRow(result, "Outbox publication lease")
}

func (s *Store) MarkPublishFailure(ctx context.Context, eventID, owner, failure string, at time.Time, maxAttempts uint32) error {
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(failure) == "" || at.IsZero() || at.Location() != time.UTC || maxAttempts == 0 {
		return errors.New("publication failure requires owner, reason, UTC time, and max attempts")
	}
	if len(failure) > 512 {
		failure = failure[:512]
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	var attempt uint32
	if err := tx.QueryRowContext(ctx, `SELECT attempt+1 FROM ynx_fabric.outbox WHERE event_id=$1 AND lease_owner=$2 AND published_at IS NULL FOR UPDATE`, eventID, owner).Scan(&attempt); err != nil {
		return fmt.Errorf("lock Outbox failure record: %w", err)
	}
	dead := attempt >= maxAttempts
	availableAt := at.Add(time.Second << min(attempt, 8))
	var publishedAt any
	if dead {
		publishedAt = at
	}
	result, err := tx.ExecContext(ctx, `UPDATE ynx_fabric.outbox SET attempt=$3,available_at=$4,published_at=$5,last_failure=$6,lease_owner=NULL,lease_until=NULL WHERE event_id=$1 AND lease_owner=$2`, eventID, owner, attempt, availableAt, publishedAt, failure)
	if err != nil {
		return err
	}
	if err := requireOneRow(result, "Outbox failure lease"); err != nil {
		return err
	}
	if dead {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.dead_letters(direction,event_id,attempts,failure,recorded_at) VALUES ('publish',$1,$2,$3,$4)`, eventID, attempt, failure, at); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func requireOneRow(result sql.Result, subject string) error {
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("%s is absent, stale, or owned by another dispatcher", subject)
	}
	return nil
}

type ProjectionTx func(context.Context, *sql.Tx, datafabric.EventEnvelope) (string, error)

// ApplyProjection commits the consumer's business effect and Inbox marker in
// the same serializable transaction. Callbacks must perform every effect using
// the provided transaction, never the parent *sql.DB.
func (s *Store) ApplyProjection(ctx context.Context, consumer, eventID string, apply ProjectionTx) (bool, error) {
	if strings.TrimSpace(consumer) == "" || strings.TrimSpace(eventID) == "" || apply == nil {
		return false, errors.New("consumer, eventId, and transactional projection are required")
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return false, err
	}
	defer tx.Rollback() //nolint:errcheck
	var encoded []byte
	if err := tx.QueryRowContext(ctx, `SELECT canonical_envelope FROM ynx_fabric.events WHERE event_id=$1`, eventID).Scan(&encoded); err != nil {
		return false, err
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM ynx_fabric.inbox WHERE consumer=$1 AND event_id=$2)`, consumer, eventID).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	event, err := decodeStoredEnvelope(encoded)
	if err != nil {
		return false, err
	}
	effectHash, err := apply(ctx, tx, event)
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(effectHash) == "" || len(effectHash) > 256 {
		return false, errors.New("projection effect hash is required and must not exceed 256 bytes")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.inbox(consumer,event_id,effect_hash) VALUES ($1,$2,$3)`, consumer, eventID, effectHash); err != nil {
		var pqError *pq.Error
		if errors.As(err, &pqError) && pqError.Code == "23505" {
			return false, nil
		}
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// PostJournal writes a complete immutable double-entry journal transaction.
// Deferred database triggers re-check balance, fee consent, event authority,
// and canonical account ownership at commit.
func (s *Store) PostJournal(ctx context.Context, entry datafabric.JournalEntry) error {
	if err := entry.Validate(); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	var consentID, schedule, basis any
	var acceptedAt, maximum any
	if entry.FeeConsent != nil {
		consentID, schedule, basis = entry.FeeConsent.ConsentID, entry.FeeConsent.FeeScheduleVersion, entry.FeeConsent.Basis
		acceptedAt, maximum = entry.FeeConsent.AcceptedAt, entry.FeeConsent.MaximumAmountMinor
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ynx_fabric.journal_entries (
 entry_id,correlation_id,event_id,effective_at,recorded_at,description,correction_of,
 revenue_recognition_boundary,source_commit,source_release,audit_id,fee_consent_id,
 fee_schedule_version,fee_accepted_at,fee_maximum_amount_minor,fee_basis
) VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		entry.EntryID, entry.CorrelationID, entry.EventID, entry.EffectiveAt, entry.RecordedAt, entry.Description,
		entry.CorrectionOf, entry.RevenueBoundary, entry.SourceCommit, entry.SourceRelease, entry.AuditID,
		consentID, schedule, acceptedAt, maximum, basis)
	if err != nil {
		return mapJournalError(err)
	}
	for _, posting := range entry.Postings {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.postings(entry_id,account_id,asset,currency,side,amount_minor,category) VALUES ($1,$2,$3,$4,$5,$6,$7)`, entry.EntryID, posting.AccountID, posting.Asset, posting.Currency, posting.Side, posting.Amount, posting.Category); err != nil {
			return mapJournalError(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return mapJournalError(err)
	}
	return nil
}

func mapJournalError(err error) error {
	var pqError *pq.Error
	if errors.As(err, &pqError) {
		switch pqError.Code {
		case "23505":
			return datafabric.ErrDuplicate
		case "23503", "23514":
			return fmt.Errorf("journal database invariant rejected: %w", err)
		}
	}
	return fmt.Errorf("write journal: %w", err)
}

func min(a, b uint32) uint32 {
	if a < b {
		return a
	}
	return b
}
