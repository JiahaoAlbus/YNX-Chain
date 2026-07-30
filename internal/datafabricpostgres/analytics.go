package datafabricpostgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

const AnalyticsEventConsumer = "ynx-analytics-event-facts-v1"

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
