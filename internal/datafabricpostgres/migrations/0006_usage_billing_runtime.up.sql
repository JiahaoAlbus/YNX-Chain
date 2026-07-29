CREATE TABLE ynx_fabric.billing_rate_plans (
    plan_id text NOT NULL,
    version text NOT NULL,
    product text NOT NULL CHECK (product IN ('resource','cloud','ai')),
    meter text NOT NULL,
    unit text NOT NULL,
    units_per_block bigint NOT NULL CHECK (units_per_block > 0),
    user_price_minor bigint NOT NULL CHECK (user_price_minor >= 0),
    provider_cost_minor bigint NOT NULL CHECK (provider_cost_minor >= 0),
    asset text NOT NULL,
    currency text NOT NULL,
    charge_category text NOT NULL CHECK (charge_category IN ('user-charge','subscription','compute-data-fee','quant-compute','quant-data')),
    revenue_recognition_boundary text NOT NULL,
    effective_from timestamptz NOT NULL,
    effective_until timestamptz,
    source_commit text NOT NULL,
    source_release text NOT NULL,
    audit_id text NOT NULL,
    PRIMARY KEY (plan_id, version),
    CHECK (user_price_minor > 0 OR provider_cost_minor > 0),
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TRIGGER billing_rate_plans_append_only
BEFORE UPDATE OR DELETE ON ynx_fabric.billing_rate_plans
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();

CREATE TABLE ynx_fabric.billing_settlements (
    settlement_id text PRIMARY KEY,
    usage_event_id text NOT NULL UNIQUE REFERENCES ynx_fabric.events(event_id) ON DELETE RESTRICT,
    rate_plan_id text NOT NULL,
    rate_plan_version text NOT NULL,
    product text NOT NULL,
    meter text NOT NULL,
    unit text NOT NULL,
    quantity bigint NOT NULL CHECK (quantity > 0),
    billable_blocks bigint NOT NULL CHECK (billable_blocks > 0),
    user_charge_minor bigint NOT NULL CHECK (user_charge_minor >= 0),
    provider_cost_minor bigint NOT NULL CHECK (provider_cost_minor >= 0),
    asset text NOT NULL,
    currency text NOT NULL,
    journal_entry_id text NOT NULL UNIQUE REFERENCES ynx_fabric.journal_entries(entry_id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL,
    audit_id text NOT NULL,
    source_commit text NOT NULL,
    source_release text NOT NULL,
    status text NOT NULL CHECK (status = 'posted'),
    FOREIGN KEY (rate_plan_id, rate_plan_version)
        REFERENCES ynx_fabric.billing_rate_plans(plan_id, version) ON DELETE RESTRICT
);

CREATE INDEX billing_settlements_product_time_idx
ON ynx_fabric.billing_settlements (product, recorded_at, settlement_id);

CREATE OR REPLACE FUNCTION ynx_fabric.verify_billing_settlement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    event_product text;
    stored_event_type text;
    event_account text;
    event_meter text;
    event_unit text;
    event_quantity bigint;
    event_usage_start timestamptz;
    event_usage_end timestamptz;
    journal_event text;
    journal_recorded_at timestamptz;
    journal_audit_id text;
    journal_source_commit text;
    journal_source_release text;
    journal_revenue_boundary text;
    journal_fee_schedule_version text;
    journal_fee_accepted_at timestamptz;
    plan_product text;
    plan_meter text;
    plan_unit text;
    plan_units_per_block bigint;
    plan_user_price_minor bigint;
    plan_provider_cost_minor bigint;
    plan_asset text;
    plan_currency text;
    plan_charge_category text;
    plan_revenue_boundary text;
    plan_effective_from timestamptz;
    plan_effective_until timestamptz;
    invalid_postings bigint;
    user_debits numeric;
    revenue_credits numeric;
    cost_debits numeric;
    provider_credits numeric;
BEGIN
    SELECT e.product,e.event_type,e.account_id,e.payload->>'meter',e.payload->>'unit',
           (e.payload->>'quantity')::bigint,(e.payload->>'usageStart')::timestamptz,(e.payload->>'usageEnd')::timestamptz
    INTO event_product,stored_event_type,event_account,event_meter,event_unit,event_quantity,event_usage_start,event_usage_end
    FROM ynx_fabric.events e WHERE e.event_id=NEW.usage_event_id;
    SELECT event_id,recorded_at,audit_id,source_commit,source_release,revenue_recognition_boundary,
           fee_schedule_version,fee_accepted_at
    INTO journal_event,journal_recorded_at,journal_audit_id,journal_source_commit,journal_source_release,journal_revenue_boundary,
         journal_fee_schedule_version,journal_fee_accepted_at
    FROM ynx_fabric.journal_entries WHERE entry_id=NEW.journal_entry_id;
    SELECT product,meter,unit,units_per_block,user_price_minor,provider_cost_minor,asset,currency,
           charge_category,revenue_recognition_boundary,effective_from,effective_until
    INTO plan_product,plan_meter,plan_unit,plan_units_per_block,plan_user_price_minor,plan_provider_cost_minor,
         plan_asset,plan_currency,plan_charge_category,plan_revenue_boundary,plan_effective_from,plan_effective_until
    FROM ynx_fabric.billing_rate_plans
    WHERE plan_id=NEW.rate_plan_id AND version=NEW.rate_plan_version;
    IF event_product IS DISTINCT FROM NEW.product OR plan_product IS DISTINCT FROM NEW.product
       OR stored_event_type IS DISTINCT FROM NEW.product || '.usage.recorded'
       OR event_meter IS DISTINCT FROM NEW.meter OR event_unit IS DISTINCT FROM NEW.unit
       OR event_quantity IS DISTINCT FROM NEW.quantity
       OR event_usage_start IS NULL OR event_usage_end IS NULL OR event_usage_start >= event_usage_end
       OR event_usage_end < plan_effective_from OR NEW.recorded_at < event_usage_end
       OR (plan_effective_until IS NOT NULL AND event_usage_end >= plan_effective_until)
       OR journal_event IS DISTINCT FROM NEW.usage_event_id
       OR journal_recorded_at IS DISTINCT FROM NEW.recorded_at
       OR journal_audit_id IS DISTINCT FROM NEW.audit_id
       OR journal_source_commit IS DISTINCT FROM NEW.source_commit
       OR journal_source_release IS DISTINCT FROM NEW.source_release
       OR journal_revenue_boundary IS DISTINCT FROM plan_revenue_boundary
       OR (NEW.user_charge_minor > 0 AND (
           journal_fee_schedule_version IS DISTINCT FROM NEW.rate_plan_version
           OR journal_fee_accepted_at IS NULL OR journal_fee_accepted_at > event_usage_start
       ))
       OR plan_meter IS DISTINCT FROM NEW.meter OR plan_unit IS DISTINCT FROM NEW.unit
       OR plan_asset IS DISTINCT FROM NEW.asset OR plan_currency IS DISTINCT FROM NEW.currency
       OR NEW.billable_blocks::numeric <> ceil(NEW.quantity::numeric / plan_units_per_block::numeric)
       OR NEW.user_charge_minor::numeric <> NEW.billable_blocks::numeric * plan_user_price_minor::numeric
       OR NEW.provider_cost_minor::numeric <> NEW.billable_blocks::numeric * plan_provider_cost_minor::numeric THEN
        RAISE EXCEPTION 'Billing settlement contradicts event, rate plan, or Journal authority' USING ERRCODE = '23514';
    END IF;
    SELECT
        count(*) FILTER (WHERE NOT (
            (side='debit' AND category=plan_charge_category AND account_id=event_account)
            OR (side='credit' AND category='protocol-revenue')
            OR (side='debit' AND category='provider-cost')
            OR (side='credit' AND category='provider-net')
        )),
        coalesce(sum(amount_minor) FILTER (WHERE side='debit' AND category=plan_charge_category AND account_id=event_account),0),
        coalesce(sum(amount_minor) FILTER (WHERE side='credit' AND category='protocol-revenue'),0),
        coalesce(sum(amount_minor) FILTER (WHERE side='debit' AND category='provider-cost'),0),
        coalesce(sum(amount_minor) FILTER (WHERE side='credit' AND category='provider-net'),0)
    INTO invalid_postings,user_debits,revenue_credits,cost_debits,provider_credits
    FROM ynx_fabric.postings WHERE entry_id=NEW.journal_entry_id;
    IF invalid_postings <> 0
       OR user_debits <> NEW.user_charge_minor OR revenue_credits <> NEW.user_charge_minor
       OR cost_debits <> NEW.provider_cost_minor OR provider_credits <> NEW.provider_cost_minor THEN
        RAISE EXCEPTION 'Billing Journal contradicts rated gross revenue or provider cost' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER billing_settlement_authority
BEFORE INSERT ON ynx_fabric.billing_settlements
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.verify_billing_settlement();

CREATE TRIGGER billing_settlements_append_only
BEFORE UPDATE OR DELETE ON ynx_fabric.billing_settlements
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
