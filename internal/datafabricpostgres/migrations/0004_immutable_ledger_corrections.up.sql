CREATE UNIQUE INDEX journal_one_reversal_per_entry
ON ynx_fabric.journal_entries (correction_of)
WHERE correction_of IS NOT NULL;

CREATE OR REPLACE FUNCTION ynx_fabric.verify_journal_correction_time() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    prior_recorded_at timestamptz;
    prior_correlation_id text;
    prior_correction_of text;
BEGIN
    IF NEW.correction_of IS NOT NULL THEN
        SELECT recorded_at, correlation_id, correction_of
        INTO prior_recorded_at, prior_correlation_id, prior_correction_of
        FROM ynx_fabric.journal_entries
        WHERE entry_id = NEW.correction_of;
        IF prior_recorded_at IS NULL OR NEW.recorded_at < prior_recorded_at THEN
            RAISE EXCEPTION 'journal correction must reference already-recorded history' USING ERRCODE = '23514';
        END IF;
        IF prior_correction_of IS NOT NULL OR NEW.correlation_id IS DISTINCT FROM prior_correlation_id THEN
            RAISE EXCEPTION 'journal correction target or correlation is invalid' USING ERRCODE = '23514';
        END IF;
        IF NEW.fee_consent_id IS NOT NULL OR NEW.fee_schedule_version IS NOT NULL
           OR NEW.fee_accepted_at IS NOT NULL OR NEW.fee_maximum_amount_minor IS NOT NULL
           OR NEW.fee_basis IS NOT NULL THEN
            RAISE EXCEPTION 'journal reversal cannot attach fee consent' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ynx_fabric.verify_journal_exact_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target_entry text := NEW.entry_id;
    correction_target text;
BEGIN
    SELECT correction_of INTO correction_target
    FROM ynx_fabric.journal_entries
    WHERE entry_id = target_entry;
    IF correction_target IS NULL THEN
        RETURN NULL;
    END IF;
    IF EXISTS (
        (
            SELECT account_id, asset, currency,
                   CASE side WHEN 'debit' THEN 'credit' ELSE 'debit' END AS side,
                   amount_minor, category
            FROM ynx_fabric.postings
            WHERE entry_id = correction_target
            EXCEPT ALL
            SELECT account_id, asset, currency, side, amount_minor, category
            FROM ynx_fabric.postings
            WHERE entry_id = target_entry
        )
        UNION ALL
        (
            SELECT account_id, asset, currency, side, amount_minor, category
            FROM ynx_fabric.postings
            WHERE entry_id = target_entry
            EXCEPT ALL
            SELECT account_id, asset, currency,
                   CASE side WHEN 'debit' THEN 'credit' ELSE 'debit' END AS side,
                   amount_minor, category
            FROM ynx_fabric.postings
            WHERE entry_id = correction_target
        )
    ) THEN
        RAISE EXCEPTION 'journal correction is not an exact reversal' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_correction_exact
AFTER INSERT ON ynx_fabric.journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_journal_exact_reversal();

CREATE CONSTRAINT TRIGGER postings_correction_exact
AFTER INSERT ON ynx_fabric.postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_journal_exact_reversal();
