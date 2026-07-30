package datafabricpostgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/lib/pq"
)

const billingRatePlanColumns = `
plan_id,version,product,meter,unit,units_per_block,user_price_minor,provider_cost_minor,
asset,currency,charge_category,revenue_recognition_boundary,effective_from,effective_until,
source_commit,source_release,audit_id`

const billingSettlementColumns = `
settlement_id,usage_event_id,rate_plan_id,rate_plan_version,product,meter,unit,quantity,
billable_blocks,user_charge_minor,provider_cost_minor,asset,currency,journal_entry_id,
recorded_at,audit_id,source_commit,source_release,status`

func (s *Store) RegisterBillingRatePlan(ctx context.Context, plan datafabric.BillingRatePlan) error {
	if err := plan.Validate(); err != nil {
		return err
	}
	var effectiveUntil any
	if !plan.EffectiveUntil.IsZero() {
		effectiveUntil = plan.EffectiveUntil
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO ynx_fabric.billing_rate_plans (
 plan_id,version,product,meter,unit,units_per_block,user_price_minor,provider_cost_minor,
 asset,currency,charge_category,revenue_recognition_boundary,effective_from,effective_until,
 source_commit,source_release,audit_id
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		plan.PlanID, plan.Version, plan.Product, plan.Meter, plan.Unit, plan.UnitsPerBlock,
		plan.UserPriceMinor, plan.ProviderCostMinor, plan.Asset, plan.Currency, plan.ChargeCategory,
		plan.RevenueBoundary, plan.EffectiveFrom, effectiveUntil, plan.SourceCommit, plan.SourceRelease, plan.AuditID)
	if err != nil {
		return mapBillingPlanError(err, plan.PlanID, plan.Version)
	}
	return nil
}

func (s *Store) BillingRatePlans(ctx context.Context) ([]datafabric.BillingRatePlan, error) {
	return billingRatePlansFromQueryer(ctx, s.db)
}

func billingRatePlansFromQueryer(ctx context.Context, queryer sqlQueryer) ([]datafabric.BillingRatePlan, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT `+billingRatePlanColumns+` FROM ynx_fabric.billing_rate_plans ORDER BY plan_id,version`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var plans []datafabric.BillingRatePlan
	for rows.Next() {
		plan, err := scanBillingRatePlan(rows)
		if err != nil {
			return nil, err
		}
		plans = append(plans, plan)
	}
	return plans, rows.Err()
}

func (s *Store) BillingSettlements(ctx context.Context) ([]datafabric.BillingSettlement, error) {
	return billingSettlementsFromQueryer(ctx, s.db)
}

func billingSettlementsFromQueryer(ctx context.Context, queryer sqlQueryer) ([]datafabric.BillingSettlement, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT `+billingSettlementColumns+` FROM ynx_fabric.billing_settlements ORDER BY recorded_at,settlement_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var settlements []datafabric.BillingSettlement
	for rows.Next() {
		var settlement datafabric.BillingSettlement
		if err := rows.Scan(
			&settlement.SettlementID, &settlement.UsageEventID, &settlement.RatePlanID,
			&settlement.RatePlanVersion, &settlement.Product, &settlement.Meter, &settlement.Unit,
			&settlement.Quantity, &settlement.BillableBlocks, &settlement.UserChargeMinor,
			&settlement.ProviderCostMinor, &settlement.Asset, &settlement.Currency,
			&settlement.JournalEntryID, &settlement.RecordedAt, &settlement.AuditID,
			&settlement.SourceCommit, &settlement.SourceRelease, &settlement.Status,
		); err != nil {
			return nil, err
		}
		settlement.RecordedAt = settlement.RecordedAt.UTC()
		settlements = append(settlements, settlement)
	}
	return settlements, rows.Err()
}

func (s *Store) BillingSettlement(ctx context.Context, id string) (datafabric.BillingSettlement, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+billingSettlementColumns+` FROM ynx_fabric.billing_settlements WHERE settlement_id=$1`, id)
	var settlement datafabric.BillingSettlement
	err := row.Scan(
		&settlement.SettlementID, &settlement.UsageEventID, &settlement.RatePlanID,
		&settlement.RatePlanVersion, &settlement.Product, &settlement.Meter, &settlement.Unit,
		&settlement.Quantity, &settlement.BillableBlocks, &settlement.UserChargeMinor,
		&settlement.ProviderCostMinor, &settlement.Asset, &settlement.Currency,
		&settlement.JournalEntryID, &settlement.RecordedAt, &settlement.AuditID,
		&settlement.SourceCommit, &settlement.SourceRelease, &settlement.Status,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return datafabric.BillingSettlement{}, false, nil
	}
	if err != nil {
		return datafabric.BillingSettlement{}, false, err
	}
	settlement.RecordedAt = settlement.RecordedAt.UTC()
	return settlement, true, nil
}

func (s *Store) SettleUsage(ctx context.Context, request datafabric.BillingSettlementRequest) (datafabric.BillingSettlement, error) {
	if err := request.Validate(); err != nil {
		return datafabric.BillingSettlement{}, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return datafabric.BillingSettlement{}, err
	}
	defer tx.Rollback() //nolint:errcheck

	var existingSettlement string
	err = tx.QueryRowContext(ctx, `SELECT settlement_id FROM ynx_fabric.billing_settlements WHERE usage_event_id=$1 FOR KEY SHARE`, request.UsageEventID).Scan(&existingSettlement)
	if err == nil {
		return datafabric.BillingSettlement{}, datafabric.Reject(datafabric.CodeBillingAlreadySettled, "Canonical usage event is already settled", map[string]string{"settlementId": existingSettlement, "eventId": request.UsageEventID})
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return datafabric.BillingSettlement{}, err
	}

	plan, exists, err := loadBillingRatePlanForShare(ctx, tx, request.RatePlanID, request.RatePlanVersion)
	if err != nil {
		return datafabric.BillingSettlement{}, err
	}
	if !exists {
		return datafabric.BillingSettlement{}, datafabric.Reject(datafabric.CodeBillingRatePlanNotFound, "Billing rate plan version is not registered", map[string]string{"planId": request.RatePlanID, "version": request.RatePlanVersion})
	}
	var encodedEvent []byte
	err = tx.QueryRowContext(ctx, `SELECT canonical_envelope FROM ynx_fabric.events WHERE event_id=$1 FOR KEY SHARE`, request.UsageEventID).Scan(&encodedEvent)
	if errors.Is(err, sql.ErrNoRows) {
		return datafabric.BillingSettlement{}, datafabric.Reject(datafabric.CodeBillingUsageInvalid, "Billing references an unknown canonical usage event", map[string]string{"eventId": request.UsageEventID})
	}
	if err != nil {
		return datafabric.BillingSettlement{}, err
	}
	event, err := decodeStoredEnvelope(encodedEvent)
	if err != nil {
		return datafabric.BillingSettlement{}, err
	}
	settlement, entry, err := datafabric.BuildBillingSettlement(plan, event, request)
	if err != nil {
		return datafabric.BillingSettlement{}, err
	}
	if err := insertJournal(ctx, tx, entry); err != nil {
		return datafabric.BillingSettlement{}, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO ynx_fabric.billing_settlements (
 settlement_id,usage_event_id,rate_plan_id,rate_plan_version,product,meter,unit,quantity,
 billable_blocks,user_charge_minor,provider_cost_minor,asset,currency,journal_entry_id,
 recorded_at,audit_id,source_commit,source_release,status
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		settlement.SettlementID, settlement.UsageEventID, settlement.RatePlanID,
		settlement.RatePlanVersion, settlement.Product, settlement.Meter, settlement.Unit,
		settlement.Quantity, settlement.BillableBlocks, settlement.UserChargeMinor,
		settlement.ProviderCostMinor, settlement.Asset, settlement.Currency,
		settlement.JournalEntryID, settlement.RecordedAt, settlement.AuditID,
		settlement.SourceCommit, settlement.SourceRelease, settlement.Status)
	if err != nil {
		return datafabric.BillingSettlement{}, mapBillingSettlementError(err, request)
	}
	if err := tx.Commit(); err != nil {
		return datafabric.BillingSettlement{}, mapBillingSettlementError(err, request)
	}
	return settlement, nil
}

func loadBillingRatePlanForShare(ctx context.Context, queryer sqlQueryer, planID, version string) (datafabric.BillingRatePlan, bool, error) {
	row := queryer.QueryRowContext(ctx, `SELECT `+billingRatePlanColumns+` FROM ynx_fabric.billing_rate_plans WHERE plan_id=$1 AND version=$2 FOR KEY SHARE`, planID, version)
	plan, err := scanBillingRatePlan(row)
	if errors.Is(err, sql.ErrNoRows) {
		return datafabric.BillingRatePlan{}, false, nil
	}
	return plan, err == nil, err
}

type rowScanner interface {
	Scan(...any) error
}

func scanBillingRatePlan(row rowScanner) (datafabric.BillingRatePlan, error) {
	var plan datafabric.BillingRatePlan
	var effectiveUntil sql.NullTime
	err := row.Scan(
		&plan.PlanID, &plan.Version, &plan.Product, &plan.Meter, &plan.Unit,
		&plan.UnitsPerBlock, &plan.UserPriceMinor, &plan.ProviderCostMinor,
		&plan.Asset, &plan.Currency, &plan.ChargeCategory, &plan.RevenueBoundary,
		&plan.EffectiveFrom, &effectiveUntil, &plan.SourceCommit, &plan.SourceRelease, &plan.AuditID,
	)
	if err != nil {
		return datafabric.BillingRatePlan{}, err
	}
	plan.EffectiveFrom = plan.EffectiveFrom.UTC()
	if effectiveUntil.Valid {
		plan.EffectiveUntil = effectiveUntil.Time.UTC()
	}
	return plan, nil
}

func mapBillingPlanError(err error, planID, version string) error {
	var pqError *pq.Error
	if errors.As(err, &pqError) && pqError.Code == "23505" {
		return datafabric.Reject(datafabric.CodeBillingRatePlanDuplicate, "Billing rate plan version is immutable and already registered", map[string]string{"planId": planID, "version": version})
	}
	return fmt.Errorf("register Billing rate plan: %w", err)
}

func mapBillingSettlementError(err error, request datafabric.BillingSettlementRequest) error {
	var pqError *pq.Error
	if errors.As(err, &pqError) {
		switch pqError.Code {
		case "23505":
			return datafabric.Reject(datafabric.CodeBillingAlreadySettled, "Canonical usage event is already settled", map[string]string{"settlementId": request.SettlementID, "eventId": request.UsageEventID})
		case "23503", "23514":
			return datafabric.Reject(datafabric.CodeBillingAuthorityMismatch, "Billing database authority rejected settlement", map[string]string{"settlementId": request.SettlementID, "eventId": request.UsageEventID})
		}
	}
	return fmt.Errorf("settle usage Billing: %w", err)
}
