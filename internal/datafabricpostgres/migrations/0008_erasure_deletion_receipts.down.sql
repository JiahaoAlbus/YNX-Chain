DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ynx_fabric.erasure_deletion_receipts) THEN
        RAISE EXCEPTION 'cannot roll back erasure deletion receipts while audit history exists' USING ERRCODE = '55000';
    END IF;
END;
$$;

DROP TABLE ynx_fabric.erasure_deletion_receipts;
DROP FUNCTION ynx_fabric.verify_erasure_deletion_receipt_authority();
