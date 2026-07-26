DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ynx_fabric.billing_settlements)
       OR EXISTS (SELECT 1 FROM ynx_fabric.billing_rate_plans) THEN
        RAISE EXCEPTION 'cannot roll back usage Billing runtime while rate or settlement history exists';
    END IF;
END;
$$;

DROP TRIGGER billing_settlements_append_only ON ynx_fabric.billing_settlements;
DROP TRIGGER billing_settlement_authority ON ynx_fabric.billing_settlements;
DROP FUNCTION ynx_fabric.verify_billing_settlement();
DROP TABLE ynx_fabric.billing_settlements;
DROP TRIGGER billing_rate_plans_append_only ON ynx_fabric.billing_rate_plans;
DROP TABLE ynx_fabric.billing_rate_plans;
