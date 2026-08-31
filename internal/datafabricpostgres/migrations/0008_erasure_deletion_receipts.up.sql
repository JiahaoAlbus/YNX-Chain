-- An erasure request retains only a pseudonym and retention-class totals. This
-- companion record proves the separate, non-authoritative analytics deletion
-- without retaining a raw account, event id, payload, or diagnostic message.
CREATE TABLE ynx_fabric.erasure_deletion_receipts (
    account_pseudonym text PRIMARY KEY REFERENCES ynx_fabric.erasure_requests(account_pseudonym) ON DELETE RESTRICT,
    audit_id text NOT NULL,
    requested_at timestamptz NOT NULL,
    derived_analytics_deleted bigint NOT NULL CHECK (derived_analytics_deleted >= 0),
    deletion_receipt char(64) NOT NULL CHECK (deletion_receipt ~ '^[0-9a-f]{64}$'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION ynx_fabric.verify_erasure_deletion_receipt_authority() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE authority_count bigint;
BEGIN
    SELECT count(*) INTO authority_count
    FROM ynx_fabric.erasure_requests request
    WHERE request.account_pseudonym = NEW.account_pseudonym
      AND request.audit_id = NEW.audit_id
      AND request.requested_at = NEW.requested_at;
    IF authority_count <> 1 THEN
        RAISE EXCEPTION 'erasure deletion receipt does not match immutable erasure authority' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER erasure_deletion_receipt_authority
AFTER INSERT ON ynx_fabric.erasure_deletion_receipts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_erasure_deletion_receipt_authority();

CREATE TRIGGER erasure_deletion_receipts_append_only BEFORE UPDATE OR DELETE ON ynx_fabric.erasure_deletion_receipts
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
