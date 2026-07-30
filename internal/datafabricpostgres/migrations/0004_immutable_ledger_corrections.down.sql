DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ynx_fabric.journal_entries WHERE correction_of IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot roll back immutable ledger corrections while correction history exists';
    END IF;
END;
$$;

DROP TRIGGER postings_correction_exact ON ynx_fabric.postings;
DROP TRIGGER journal_correction_exact ON ynx_fabric.journal_entries;
DROP FUNCTION ynx_fabric.verify_journal_exact_reversal();
DROP INDEX ynx_fabric.journal_one_reversal_per_entry;

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
