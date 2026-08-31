package datafabricpostgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

const AnalyticsEventConsumer = "ynx-analytics-event-facts-v1"

var analyticsRetentionAuditID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)

type AnalyticsProjectionResult struct {
	Applied    bool
	Suppressed bool
}

type AnalyticsEventFact struct {
	EventID               string
	EventType             string
	Product               string
	Service               string
	OccurredAt            time.Time
	EffectiveAt           time.Time
	AccountPseudonym      string
	SourceName            string
	SourceAsOf            time.Time
	SourceVersion         string
	SourceStatus          string
	SourceConfidence      *float64
	SourceCoverage        *float64
	PrivacyClassification string
	RetentionClass        string
	SourceCommit          string
	SourceRelease         string
	DerivedAt             time.Time
}

// AnalyticsRetentionSweep is the immutable, bounded audit result of deleting
// expired derived analytics facts. It deliberately contains no event IDs,
// account pseudonyms, payloads, or authoritative-record counts.
type AnalyticsRetentionSweep struct {
	AuditID            string
	ExecutedAt         time.Time
	TransientBefore    time.Time
	OperationalBefore  time.Time
	TransientDeleted   uint64
	OperationalDeleted uint64
}

// SweepExpiredAnalytics deletes only payload-free derived analytics facts in
// the transient and operational retention classes. Callers must supply the
// approved UTC cutoffs explicitly; this repository does not invent a timer,
// policy duration, or a deletion schedule. Authoritative events, Outbox,
// Inbox, Ledger, audit, financial, audit-7y, and legal-hold records are never
// selected by this operation.
func (s *Store) SweepExpiredAnalytics(ctx context.Context, auditID string, now, transientBefore, operationalBefore time.Time) (AnalyticsRetentionSweep, error) {
	if !analyticsRetentionAuditID.MatchString(auditID) || now.IsZero() || now.Location() != time.UTC || transientBefore.IsZero() || transientBefore.Location() != time.UTC || operationalBefore.IsZero() || operationalBefore.Location() != time.UTC || transientBefore.After(now) || operationalBefore.After(now) {
		return AnalyticsRetentionSweep{}, errors.New("analytics retention sweep requires an audit ID, UTC execution time, and non-future UTC cutoffs")
	}
	// PostgreSQL timestamptz preserves microseconds. Canonicalize the caller's
	// audit tuple before both the insert and an idempotent replay comparison.
	now = now.UTC().Truncate(time.Microsecond)
	transientBefore = transientBefore.UTC().Truncate(time.Microsecond)
	operationalBefore = operationalBefore.UTC().Truncate(time.Microsecond)
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return AnalyticsRetentionSweep{}, fmt.Errorf("begin analytics retention sweep: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	result := AnalyticsRetentionSweep{AuditID: auditID, ExecutedAt: now, TransientBefore: transientBefore, OperationalBefore: operationalBefore}
	existing, exists, err := analyticsRetentionSweep(ctx, tx, auditID)
	if err != nil {
		return AnalyticsRetentionSweep{}, fmt.Errorf("read analytics retention sweep audit: %w", err)
	}
	if exists {
		if !existing.ExecutedAt.Equal(now) || !existing.TransientBefore.Equal(transientBefore) || !existing.OperationalBefore.Equal(operationalBefore) {
			return AnalyticsRetentionSweep{}, errors.New("analytics retention sweep audit ID conflicts with prior parameters")
		}
		if err := tx.Commit(); err != nil {
			return AnalyticsRetentionSweep{}, fmt.Errorf("commit replayed analytics retention sweep: %w", err)
		}
		return existing, nil
	}
	err = tx.QueryRowContext(ctx, `
WITH deleted AS (
    DELETE FROM ynx_analytics.event_facts
    WHERE (retention_class='transient' AND occurred_at < $1)
       OR (retention_class='operational' AND occurred_at < $2)
    RETURNING retention_class
), recorded AS (
    INSERT INTO ynx_analytics.retention_sweeps(
        audit_id,executed_at,transient_before,operational_before,transient_deleted,operational_deleted
    )
    SELECT $3,$4,$1,$2,
        count(*) FILTER (WHERE retention_class='transient'),
        count(*) FILTER (WHERE retention_class='operational')
    FROM deleted
    RETURNING transient_deleted,operational_deleted
)
SELECT transient_deleted,operational_deleted FROM recorded`, transientBefore, operationalBefore, auditID, now).Scan(&result.TransientDeleted, &result.OperationalDeleted)
	if err != nil {
		return AnalyticsRetentionSweep{}, fmt.Errorf("delete expired derived analytics facts and record audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return AnalyticsRetentionSweep{}, fmt.Errorf("commit analytics retention sweep: %w", err)
	}
	return result, nil
}

func analyticsRetentionSweep(ctx context.Context, queryer sqlQueryer, auditID string) (AnalyticsRetentionSweep, bool, error) {
	var result AnalyticsRetentionSweep
	err := queryer.QueryRowContext(ctx, `SELECT audit_id,executed_at,transient_before,operational_before,transient_deleted,operational_deleted FROM ynx_analytics.retention_sweeps WHERE audit_id=$1 FOR KEY SHARE`, auditID).Scan(
		&result.AuditID, &result.ExecutedAt, &result.TransientBefore, &result.OperationalBefore, &result.TransientDeleted, &result.OperationalDeleted,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return AnalyticsRetentionSweep{}, false, nil
	}
	if err != nil {
		return AnalyticsRetentionSweep{}, false, err
	}
	result.ExecutedAt = result.ExecutedAt.UTC()
	result.TransientBefore = result.TransientBefore.UTC()
	result.OperationalBefore = result.OperationalBefore.UTC()
	return result, true, nil
}

// ApplyAnalyticsEvent projects one payload-free event fact and its Inbox
// marker in one transaction. An erased subject still receives an Inbox marker
// so redelivery cannot recreate the deleted analytical projection.
func (s *Store) ApplyAnalyticsEvent(ctx context.Context, eventID string, privacyKey []byte, derivedAt time.Time) (AnalyticsProjectionResult, error) {
	if len(privacyKey) < 32 || derivedAt.IsZero() || derivedAt.Location() != time.UTC {
		return AnalyticsProjectionResult{}, errors.New("analytics projection requires a privacy key and UTC derivation time")
	}
	suppressed := false
	applied, err := s.ApplyProjection(ctx, AnalyticsEventConsumer, eventID, func(ctx context.Context, tx *sql.Tx, event datafabric.EventEnvelope) (string, error) {
		if derivedAt.Before(event.Timestamp) {
			return "", errors.New("analytics derivation cannot predate the event")
		}
		pseudonym := ""
		if event.Actor.AccountID != "" {
			var err error
			pseudonym, err = datafabric.SubjectPseudonym(event.Actor.AccountID, privacyKey)
			if err != nil {
				return "", err
			}
			var erased bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM ynx_fabric.erasure_requests WHERE account_pseudonym=$1)`, pseudonym).Scan(&erased); err != nil {
				return "", err
			}
			if erased {
				suppressed = true
				return "suppressed:" + event.Integrity.Digest, nil
			}
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO ynx_analytics.event_facts(event_id,event_type,product,service,occurred_at,effective_at,account_pseudonym,source_name,source_as_of,source_version,source_status,source_confidence,source_coverage,privacy_classification,retention_class,source_commit,source_release,derived_at) VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, event.EventID, event.EventType, event.Product, event.Service, event.Timestamp, event.EffectiveAt, pseudonym, event.Source.Source, event.Source.AsOf, event.Source.Version, event.Source.Status, event.Source.Confidence, event.Source.Coverage, event.PrivacyClassification, event.RetentionClass, event.SourceCommit, event.SourceRelease, derivedAt)
		if err != nil {
			return "", fmt.Errorf("insert analytics event fact: %w", err)
		}
		return event.Integrity.Digest, nil
	})
	return AnalyticsProjectionResult{Applied: applied, Suppressed: suppressed}, err
}

func (s *Store) AnalyticsEventFacts(ctx context.Context) ([]AnalyticsEventFact, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT event_id,event_type,product,service,occurred_at,effective_at,COALESCE(account_pseudonym,''),source_name,source_as_of,source_version,source_status,source_confidence,source_coverage,privacy_classification,retention_class,source_commit,source_release,derived_at FROM ynx_analytics.event_facts ORDER BY occurred_at,event_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var facts []AnalyticsEventFact
	for rows.Next() {
		var fact AnalyticsEventFact
		var confidence, coverage sql.NullFloat64
		if err := rows.Scan(&fact.EventID, &fact.EventType, &fact.Product, &fact.Service, &fact.OccurredAt, &fact.EffectiveAt, &fact.AccountPseudonym, &fact.SourceName, &fact.SourceAsOf, &fact.SourceVersion, &fact.SourceStatus, &confidence, &coverage, &fact.PrivacyClassification, &fact.RetentionClass, &fact.SourceCommit, &fact.SourceRelease, &fact.DerivedAt); err != nil {
			return nil, err
		}
		fact.OccurredAt = fact.OccurredAt.UTC()
		fact.EffectiveAt = fact.EffectiveAt.UTC()
		fact.SourceAsOf = fact.SourceAsOf.UTC()
		fact.DerivedAt = fact.DerivedAt.UTC()
		if confidence.Valid {
			value := confidence.Float64
			fact.SourceConfidence = &value
		}
		if coverage.Valid {
			value := coverage.Float64
			fact.SourceCoverage = &value
		}
		if err := validateAnalyticsFact(fact); err != nil {
			return nil, fmt.Errorf("analytics fact %s failed validation: %w", fact.EventID, err)
		}
		facts = append(facts, fact)
	}
	return facts, rows.Err()
}

func validateAnalyticsFact(fact AnalyticsEventFact) error {
	if strings.TrimSpace(fact.EventID) == "" || strings.TrimSpace(fact.EventType) == "" || strings.TrimSpace(fact.Product) == "" || strings.TrimSpace(fact.Service) == "" || fact.OccurredAt.Location() != time.UTC || fact.EffectiveAt.Location() != time.UTC || fact.SourceAsOf.Location() != time.UTC || fact.DerivedAt.Location() != time.UTC {
		return errors.New("stored analytics event fact is incomplete")
	}
	return nil
}
