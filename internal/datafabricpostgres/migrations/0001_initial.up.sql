CREATE SCHEMA IF NOT EXISTS ynx_fabric;

CREATE TABLE IF NOT EXISTS ynx_fabric.schema_migrations (
    version bigint PRIMARY KEY,
    checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ynx_fabric.events (
    event_id text PRIMARY KEY,
    event_type text NOT NULL,
    schema_version text NOT NULL CHECK (schema_version = '1.0'),
    product text NOT NULL,
    service text NOT NULL,
    aggregate_id text NOT NULL,
    actor_id text NOT NULL,
    account_id text,
    session_id text,
    correlation_id text NOT NULL,
    causation_id text,
    sequence bigint NOT NULL CHECK (sequence > 0),
    occurred_at timestamptz NOT NULL,
    effective_at timestamptz NOT NULL,
    source_commit text NOT NULL,
    source_release text NOT NULL,
    integrity_key_id text NOT NULL,
    integrity_digest text NOT NULL CHECK (integrity_digest ~ '^[0-9a-f]{64}$'),
    integrity_signature text NOT NULL CHECK (integrity_signature ~ '^[0-9a-f]{64}$'),
    privacy_classification text NOT NULL CHECK (privacy_classification IN ('public','internal','confidential','restricted')),
    retention_class text NOT NULL CHECK (retention_class IN ('transient','operational','financial-7y','audit-7y','legal-hold')),
    audit_id text NOT NULL,
    source_metadata jsonb NOT NULL CHECK (jsonb_typeof(source_metadata) = 'object'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    canonical_envelope jsonb NOT NULL CHECK (jsonb_typeof(canonical_envelope) = 'object'),
    ingested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (product, service, aggregate_id, sequence)
);

CREATE INDEX events_correlation_idx ON ynx_fabric.events (correlation_id, occurred_at);
CREATE INDEX events_account_idx ON ynx_fabric.events (account_id, occurred_at) WHERE account_id IS NOT NULL;
CREATE INDEX events_type_time_idx ON ynx_fabric.events (event_type, occurred_at);

CREATE TABLE ynx_fabric.aggregate_sequences (
    product text NOT NULL,
    service text NOT NULL,
    aggregate_id text NOT NULL,
    last_sequence bigint NOT NULL CHECK (last_sequence > 0),
    PRIMARY KEY (product, service, aggregate_id)
);

CREATE TABLE ynx_fabric.outbox (
    event_id text PRIMARY KEY REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    partition_key text NOT NULL,
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at timestamptz,
    last_failure text,
    lease_owner text,
    lease_until timestamptz,
    CHECK (length(coalesce(last_failure, '')) <= 512)
);

CREATE INDEX outbox_dispatch_idx ON ynx_fabric.outbox (available_at, event_id) WHERE published_at IS NULL;

CREATE TABLE ynx_fabric.inbox (
    consumer text NOT NULL,
    event_id text NOT NULL REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    effect_hash text NOT NULL,
    PRIMARY KEY (consumer, event_id)
);

CREATE TABLE ynx_fabric.dead_letters (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    direction text NOT NULL CHECK (direction IN ('publish','consume')),
    consumer text,
    event_id text NOT NULL REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    attempts integer NOT NULL CHECK (attempts > 0),
    failure text NOT NULL CHECK (length(failure) <= 512),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    requeued_at timestamptz,
    requeue_audit_id text
);

CREATE TABLE ynx_fabric.journal_entries (
    entry_id text PRIMARY KEY,
    correlation_id text NOT NULL,
    event_id text NOT NULL REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    effective_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL,
    description text NOT NULL,
    correction_of text REFERENCES ynx_fabric.journal_entries(entry_id) ON DELETE RESTRICT,
    revenue_recognition_boundary text NOT NULL,
    source_commit text NOT NULL,
    source_release text NOT NULL,
    audit_id text NOT NULL,
    fee_consent_id text,
    fee_schedule_version text,
    fee_accepted_at timestamptz,
    fee_maximum_amount_minor bigint,
    fee_basis text,
    CHECK ((fee_consent_id IS NULL) = (fee_schedule_version IS NULL)),
    CHECK ((fee_consent_id IS NULL) = (fee_accepted_at IS NULL)),
    CHECK ((fee_consent_id IS NULL) = (fee_maximum_amount_minor IS NULL)),
    CHECK ((fee_consent_id IS NULL) = (fee_basis IS NULL)),
    CHECK (fee_accepted_at IS NULL OR fee_accepted_at <= recorded_at),
    CHECK (fee_maximum_amount_minor IS NULL OR fee_maximum_amount_minor > 0)
);

CREATE INDEX journal_event_idx ON ynx_fabric.journal_entries (event_id);
CREATE INDEX journal_correlation_idx ON ynx_fabric.journal_entries (correlation_id, recorded_at);

CREATE TABLE ynx_fabric.postings (
    posting_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entry_id text NOT NULL REFERENCES ynx_fabric.journal_entries(entry_id) ON DELETE RESTRICT,
    account_id text NOT NULL,
    asset text NOT NULL,
    currency text NOT NULL,
    side text NOT NULL CHECK (side IN ('debit','credit')),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    category text NOT NULL CHECK (category IN (
        'user-charge','provider-cost','protocol-revenue','gas','venue-fee','burn','treasury','insurance','refund',
        'dispute-reserve','merchant-net','creator-net','builder-net','provider-net','quant-compute','quant-data',
        'quant-management-fee','quant-performance-fee','stablecoin-settlement','bridge-settlement','subscription','compute-data-fee'
    ))
);

CREATE INDEX postings_account_idx ON ynx_fabric.postings (account_id, asset, currency, posting_id);
CREATE INDEX postings_entry_idx ON ynx_fabric.postings (entry_id);

CREATE TABLE ynx_fabric.sagas (
    saga_id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN (
        'wallet-session-revoke','pay-invoice-receipt-refund','shop-order-inventory-payment-fulfillment',
        'merchant-webhook-reconciliation-settlement','exchange-order-fill-funding-fee','dex-swap-lp-vault',
        'quant-mandate-pnl-fee-kill-switch','trust-case-appeal-correction','resource-usage-settlement',
        'cloud-usage-billing','ai-usage-cost','mail-delivery','creator-revenue'
    )),
    product text NOT NULL,
    aggregate_id text NOT NULL,
    correlation_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('running','compensating','compensated','completed','manual-recovery')),
    user_visible_status text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deadline timestamptz NOT NULL,
    audit_id text NOT NULL,
    failure text,
    CHECK (deadline > created_at),
    CHECK (updated_at >= created_at),
    CHECK (
        (status = 'running' AND user_visible_status = 'processing' AND failure IS NULL) OR
        (status = 'completed' AND user_visible_status = 'completed' AND failure IS NULL) OR
        (status = 'compensating' AND user_visible_status = 'recovery-in-progress' AND failure IS NOT NULL) OR
        (status = 'compensated' AND user_visible_status = 'recovered') OR
        (status = 'manual-recovery' AND user_visible_status = 'action-required' AND failure IS NOT NULL)
    ),
    CHECK (product = CASE kind
        WHEN 'wallet-session-revoke' THEN 'wallet' WHEN 'pay-invoice-receipt-refund' THEN 'pay'
        WHEN 'shop-order-inventory-payment-fulfillment' THEN 'shop' WHEN 'merchant-webhook-reconciliation-settlement' THEN 'merchant'
        WHEN 'exchange-order-fill-funding-fee' THEN 'exchange' WHEN 'dex-swap-lp-vault' THEN 'dex'
        WHEN 'quant-mandate-pnl-fee-kill-switch' THEN 'quant' WHEN 'trust-case-appeal-correction' THEN 'trust'
        WHEN 'resource-usage-settlement' THEN 'resource' WHEN 'cloud-usage-billing' THEN 'cloud'
        WHEN 'ai-usage-cost' THEN 'ai' WHEN 'mail-delivery' THEN 'mail' WHEN 'creator-revenue' THEN 'creator'
        ELSE NULL END)
);

CREATE INDEX sagas_recovery_idx ON ynx_fabric.sagas (status, deadline) WHERE status IN ('running','compensating','manual-recovery');

CREATE TABLE ynx_fabric.saga_steps (
    saga_id text NOT NULL REFERENCES ynx_fabric.sagas(saga_id) ON DELETE RESTRICT,
    step_index integer NOT NULL CHECK (step_index >= 0),
    action text NOT NULL,
    compensation text NOT NULL,
    completed_at timestamptz,
    compensated_at timestamptz,
    failure text,
    event_id text REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    compensation_event_id text REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    PRIMARY KEY (saga_id, step_index),
    CHECK (compensated_at IS NULL OR completed_at IS NOT NULL)
);

CREATE OR REPLACE FUNCTION ynx_fabric.verify_saga_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.created_at <> OLD.created_at OR NEW.kind <> OLD.kind OR NEW.product <> OLD.product
       OR NEW.aggregate_id <> OLD.aggregate_id OR NEW.correlation_id <> OLD.correlation_id OR NEW.audit_id <> OLD.audit_id OR NEW.deadline <> OLD.deadline
       OR NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION 'immutable Saga authority or monotonic time was changed' USING ERRCODE = '23514';
    END IF;
    IF NOT (
        (OLD.status = 'running' AND NEW.status IN ('running','completed','compensating')) OR
        (OLD.status = 'compensating' AND NEW.status IN ('compensating','compensated','manual-recovery'))
    ) THEN
        RAISE EXCEPTION 'invalid Saga status transition from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER saga_transition_guard BEFORE UPDATE ON ynx_fabric.sagas
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_saga_transition();

CREATE OR REPLACE FUNCTION ynx_fabric.verify_saga_step_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE authority_count bigint;
BEGIN
    IF NEW.saga_id <> OLD.saga_id OR NEW.step_index <> OLD.step_index OR NEW.action <> OLD.action OR NEW.compensation <> OLD.compensation THEN
        RAISE EXCEPTION 'canonical Saga step definition is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.completed_at IS NOT NULL AND (NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.event_id IS DISTINCT FROM OLD.event_id) THEN
        RAISE EXCEPTION 'completed Saga step cannot be rewritten' USING ERRCODE = '23514';
    END IF;
    IF OLD.compensated_at IS NOT NULL AND (NEW.compensated_at IS DISTINCT FROM OLD.compensated_at OR NEW.compensation_event_id IS DISTINCT FROM OLD.compensation_event_id) THEN
        RAISE EXCEPTION 'compensated Saga step cannot be rewritten' USING ERRCODE = '23514';
    END IF;
    IF (NEW.completed_at IS NULL) <> (NEW.event_id IS NULL) OR (NEW.compensated_at IS NULL) <> (NEW.compensation_event_id IS NULL) THEN
        RAISE EXCEPTION 'Saga step time and event authority must be recorded together' USING ERRCODE = '23514';
    END IF;
    IF NEW.event_id IS NOT NULL AND OLD.event_id IS NULL THEN
        SELECT count(*) INTO authority_count FROM ynx_fabric.events e JOIN ynx_fabric.sagas s ON s.saga_id=NEW.saga_id
        WHERE e.event_id=NEW.event_id AND e.product=s.product AND e.correlation_id=s.correlation_id;
        IF authority_count <> 1 THEN
            RAISE EXCEPTION 'Saga step event does not match Saga product and correlation authority' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.compensation_event_id IS NOT NULL AND OLD.compensation_event_id IS NULL THEN
        SELECT count(*) INTO authority_count FROM ynx_fabric.events e JOIN ynx_fabric.sagas s ON s.saga_id=NEW.saga_id
        WHERE e.event_id=NEW.compensation_event_id AND e.product=s.product AND e.correlation_id=s.correlation_id;
        IF authority_count <> 1 THEN
            RAISE EXCEPTION 'Saga compensation event does not match Saga product and correlation authority' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER saga_step_transition_guard BEFORE UPDATE ON ynx_fabric.saga_steps
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_saga_step_transition();

CREATE TABLE ynx_fabric.reconciliation_runs (
    run_id text PRIMARY KEY,
    journal_entry_id text NOT NULL REFERENCES ynx_fabric.journal_entries(entry_id) ON DELETE RESTRICT,
    product text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('matched','mismatch','incomplete')),
    coverage double precision NOT NULL CHECK (coverage >= 0 AND coverage <= 1),
    audit_id text NOT NULL,
    source_commit text NOT NULL,
    source_release text NOT NULL,
    CHECK (completed_at >= started_at)
);

CREATE TABLE ynx_fabric.reconciliation_findings (
    run_id text NOT NULL REFERENCES ynx_fabric.reconciliation_runs(run_id) ON DELETE RESTRICT,
    finding_index integer NOT NULL CHECK (finding_index >= 0),
    source text NOT NULL CHECK (source IN ('chain','pay','exchange','dex','quant','provider')),
    reference_id text,
    asset text,
    currency text,
    expected_minor bigint NOT NULL,
    observed_minor bigint NOT NULL,
    difference_minor bigint NOT NULL,
    status text NOT NULL CHECK (status IN ('matched','mismatch','unavailable')),
    failure text,
    PRIMARY KEY (run_id, finding_index),
    CHECK (difference_minor = observed_minor - expected_minor),
    CHECK ((status = 'unavailable') = (failure IS NOT NULL))
);

CREATE OR REPLACE FUNCTION ynx_fabric.verify_reconciliation_truth() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target_run text := coalesce(NEW.run_id, OLD.run_id);
    stored_status text;
    stored_coverage double precision;
    calculated_status text;
    calculated_coverage double precision;
BEGIN
    SELECT status,coverage INTO stored_status,stored_coverage FROM ynx_fabric.reconciliation_runs WHERE run_id=target_run;
    SELECT CASE WHEN bool_or(source_mismatch) THEN 'mismatch' WHEN bool_or(source_unavailable) THEN 'incomplete' ELSE 'matched' END,
           count(*) FILTER (WHERE source_matched)::double precision / NULLIF(count(*),0)
    INTO calculated_status,calculated_coverage
    FROM (
        SELECT source,
               bool_and(status='matched') AS source_matched,
               bool_or(status='mismatch') AS source_mismatch,
               bool_or(status='unavailable') AS source_unavailable
        FROM ynx_fabric.reconciliation_findings
        WHERE run_id=target_run
        GROUP BY source
    ) source_results;
    IF calculated_status IS NULL OR calculated_coverage IS NULL OR stored_status <> calculated_status OR abs(stored_coverage-calculated_coverage) > 0.000000001 THEN
        RAISE EXCEPTION 'reconciliation status or coverage contradicts findings' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER reconciliation_run_truth
AFTER INSERT ON ynx_fabric.reconciliation_runs DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_reconciliation_truth();
CREATE CONSTRAINT TRIGGER reconciliation_finding_truth
AFTER INSERT ON ynx_fabric.reconciliation_findings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_reconciliation_truth();

CREATE TABLE ynx_fabric.erasure_requests (
    account_pseudonym text PRIMARY KEY CHECK (account_pseudonym ~ '^[0-9a-f]{64}$'),
    audit_id text NOT NULL,
    requested_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status = 'analytics-suppressed-authoritative-retention-applied'),
    operational_records bigint NOT NULL CHECK (operational_records >= 0),
    financial_records_retained bigint NOT NULL CHECK (financial_records_retained >= 0),
    audit_records_retained bigint NOT NULL CHECK (audit_records_retained >= 0),
    legal_hold_records_retained bigint NOT NULL CHECK (legal_hold_records_retained >= 0)
);

CREATE SCHEMA IF NOT EXISTS ynx_analytics;

-- Derived warehouse-ready facts intentionally exclude payload, actor, session,
-- raw account, aggregate, correlation, causation, signature, and audit fields.
-- They are not authoritative and may be deleted for subject erasure.
CREATE TABLE ynx_analytics.event_facts (
    event_id text PRIMARY KEY REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    product text NOT NULL,
    service text NOT NULL,
    occurred_at timestamptz NOT NULL,
    effective_at timestamptz NOT NULL,
    account_pseudonym text CHECK (account_pseudonym IS NULL OR account_pseudonym ~ '^[0-9a-f]{64}$'),
    source_name text NOT NULL,
    source_as_of timestamptz NOT NULL,
    source_version text NOT NULL,
    source_status text NOT NULL CHECK (source_status IN ('authoritative','third-party','estimated','ai-inferred','cached','user-input','unavailable')),
    source_confidence double precision CHECK (source_confidence IS NULL OR source_confidence BETWEEN 0 AND 1),
    source_coverage double precision CHECK (source_coverage IS NULL OR source_coverage BETWEEN 0 AND 1),
    privacy_classification text NOT NULL CHECK (privacy_classification IN ('public','internal','confidential','restricted')),
    retention_class text NOT NULL CHECK (retention_class IN ('transient','operational','financial-7y','audit-7y','legal-hold')),
    source_commit text NOT NULL,
    source_release text NOT NULL,
    derived_at timestamptz NOT NULL,
    CHECK (derived_at >= occurred_at)
);

CREATE INDEX analytics_event_product_time_idx ON ynx_analytics.event_facts (product, occurred_at, event_type);
CREATE INDEX analytics_event_subject_time_idx ON ynx_analytics.event_facts (account_pseudonym, occurred_at) WHERE account_pseudonym IS NOT NULL;

CREATE OR REPLACE FUNCTION ynx_fabric.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; use a correction record', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.events
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.journal_entries
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.postings
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
CREATE TRIGGER inbox_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.inbox
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
CREATE TRIGGER reconciliation_runs_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.reconciliation_runs
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
CREATE TRIGGER reconciliation_findings_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.reconciliation_findings
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
CREATE TRIGGER erasure_requests_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.erasure_requests
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
CREATE TRIGGER analytics_event_facts_no_update BEFORE UPDATE ON ynx_analytics.event_facts
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();

CREATE OR REPLACE FUNCTION ynx_fabric.verify_journal_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target_entry text := coalesce(NEW.entry_id, OLD.entry_id);
    posting_count bigint;
    imbalance_count bigint;
    consent_debits bigint;
    consent_limit bigint;
    wrong_consent_accounts bigint;
BEGIN
    SELECT count(*) INTO posting_count FROM ynx_fabric.postings WHERE entry_id = target_entry;
    IF posting_count < 2 THEN
        RAISE EXCEPTION 'journal % requires at least two postings', target_entry USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO imbalance_count FROM (
        SELECT asset, currency
        FROM ynx_fabric.postings
        WHERE entry_id = target_entry
        GROUP BY asset, currency
        HAVING sum(CASE side WHEN 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
    ) balances;
    IF imbalance_count <> 0 THEN
        RAISE EXCEPTION 'journal % is not balanced by asset and currency', target_entry USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(sum(amount_minor), 0) INTO consent_debits
    FROM ynx_fabric.postings
    WHERE entry_id = target_entry AND side = 'debit' AND category IN (
        'user-charge','gas','venue-fee','quant-compute','quant-data','quant-management-fee','quant-performance-fee','subscription','compute-data-fee'
    );
    SELECT fee_maximum_amount_minor INTO consent_limit FROM ynx_fabric.journal_entries WHERE entry_id = target_entry;
    IF consent_debits > 0 AND (consent_limit IS NULL OR consent_limit < consent_debits) THEN
        RAISE EXCEPTION 'journal % lacks bounded fee consent', target_entry USING ERRCODE = '23514';
    ELSIF consent_debits = 0 AND consent_limit IS NOT NULL THEN
        RAISE EXCEPTION 'journal % has fee consent without consent-bound debits', target_entry USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO wrong_consent_accounts
    FROM ynx_fabric.postings p
    JOIN ynx_fabric.journal_entries j ON j.entry_id = p.entry_id
    JOIN ynx_fabric.events e ON e.event_id = j.event_id
    WHERE p.entry_id = target_entry AND p.side = 'debit'
      AND p.category IN ('user-charge','gas','venue-fee','quant-compute','quant-data','quant-management-fee','quant-performance-fee','subscription','compute-data-fee')
      AND p.account_id IS DISTINCT FROM e.account_id;
    IF wrong_consent_accounts <> 0 THEN
        RAISE EXCEPTION 'journal % consent-bound debit does not belong to canonical event account', target_entry USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER postings_balanced
AFTER INSERT ON ynx_fabric.postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_journal_balance();

CREATE CONSTRAINT TRIGGER journal_complete
AFTER INSERT ON ynx_fabric.journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_journal_balance();

CREATE OR REPLACE FUNCTION ynx_fabric.verify_journal_event_authority() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE event_correlation text;
BEGIN
    SELECT correlation_id INTO event_correlation FROM ynx_fabric.events WHERE event_id = NEW.event_id;
    IF event_correlation IS DISTINCT FROM NEW.correlation_id THEN
        RAISE EXCEPTION 'journal correlation does not match canonical event' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER journal_event_authority BEFORE INSERT ON ynx_fabric.journal_entries
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_journal_event_authority();

CREATE OR REPLACE FUNCTION ynx_fabric.verify_journal_correction_time() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE prior_recorded_at timestamptz;
BEGIN
    IF NEW.correction_of IS NOT NULL THEN
        SELECT recorded_at INTO prior_recorded_at FROM ynx_fabric.journal_entries WHERE entry_id=NEW.correction_of;
        IF prior_recorded_at IS NULL OR NEW.recorded_at < prior_recorded_at THEN
            RAISE EXCEPTION 'journal correction must reference already-recorded history' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER journal_correction_time BEFORE INSERT ON ynx_fabric.journal_entries
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_journal_correction_time();
