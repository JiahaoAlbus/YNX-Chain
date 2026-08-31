package datafabricpostgres

import (
	"strings"
	"testing"
)

func TestInitialMigrationContainsTransactionalIntegrityGuards(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 {
		t.Fatalf("unexpected migration set: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	sql := string(body)
	for _, required := range []string{
		"UNIQUE (product, service, aggregate_id, sequence)",
		"CREATE TABLE ynx_fabric.aggregate_sequences",
		"CREATE CONSTRAINT TRIGGER postings_balanced",
		"CREATE CONSTRAINT TRIGGER journal_complete",
		"DEFERRABLE INITIALLY DEFERRED",
		"journal_event_authority",
		"CREATE TRIGGER journal_correction_time",
		"events_append_only",
		"journal_entries_append_only",
		"PRIMARY KEY (consumer, event_id)",
		"correction_of text REFERENCES ynx_fabric.journal_entries",
		"fee_maximum_amount_minor",
		"CREATE TRIGGER saga_transition_guard",
		"immutable Saga authority or monotonic time was changed",
		"CREATE TRIGGER saga_step_transition_guard",
		"Saga step event does not match Saga product and correlation authority",
		"CREATE CONSTRAINT TRIGGER reconciliation_run_truth",
		"reconciliation status or coverage contradicts findings",
		"CREATE TRIGGER reconciliation_runs_append_only",
		"CREATE TRIGGER erasure_requests_append_only",
		"CREATE TABLE ynx_analytics.event_facts",
		"analytics_event_facts_no_update",
		"account_pseudonym",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration is missing integrity guard %q", required)
		}
	}
	for _, prohibited := range []string{"TODO", "FIXME", "DROP SCHEMA", "CASCADE"} {
		if strings.Contains(sql, prohibited) {
			t.Fatalf("migration contains prohibited text %q", prohibited)
		}
	}
}

func TestEnvelopeV2MigrationAndRollbackAreGuarded(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 || !strings.Contains(files[1], "0002_event_envelope_v2.up.sql") {
		t.Fatalf("v2 migration is missing: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[1])
	if err != nil {
		t.Fatal(err)
	}
	up := string(body)
	for _, required := range []string{"schema_version IN ('1.0', '2.0')", "aggregate_type", "events_product_service_aggregate_sequence_key", "PRIMARY KEY (product, service, aggregate_type, aggregate_id)"} {
		if !strings.Contains(up, required) {
			t.Fatalf("v2 migration is missing %q", required)
		}
	}
	down, err := RollbackMigration(2)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"cannot roll back event envelope v2 while v2 events exist", "cannot roll back event envelope v2 because aggregate identities would collide", "CHECK (schema_version = '1.0')"} {
		if !strings.Contains(string(down), required) {
			t.Fatalf("v2 rollback is missing guard %q", required)
		}
	}
	if _, err := RollbackMigration(9999); err == nil {
		t.Fatal("unknown rollback migration was accepted")
	}
}

func TestRedeliveryMigrationIsAppendOnlyAndRollbackGuarded(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 || !strings.Contains(files[2], "0003_redelivery_control_plane.up.sql") {
		t.Fatalf("redelivery migration is missing: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[2])
	if err != nil {
		t.Fatal(err)
	}
	up := string(body)
	for _, required := range []string{
		"CREATE TABLE ynx_fabric.redelivery_runs",
		"CREATE TABLE ynx_fabric.redelivery_run_events",
		"candidate_count = enqueued_count + skipped_pending",
		"redelivery_runs_append_only",
		"redelivery_run_events_append_only",
		"dead_letters_requeue_audit_check",
		"approval_status text NOT NULL CHECK (approval_status = 'approved')",
		"confirmed boolean NOT NULL CHECK (confirmed)",
		"source_commit char(40)",
	} {
		if !strings.Contains(up, required) {
			t.Fatalf("redelivery migration is missing %q", required)
		}
	}
	down, err := RollbackMigration(3)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(down), "cannot roll back redelivery control plane while audit history exists") {
		t.Fatal("redelivery rollback does not preserve audit history")
	}
}

func TestImmutableLedgerCorrectionMigrationIsAtomicAndRollbackGuarded(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 || !strings.Contains(files[3], "0004_immutable_ledger_corrections.up.sql") {
		t.Fatalf("ledger correction migration is missing: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[3])
	if err != nil {
		t.Fatal(err)
	}
	up := string(body)
	for _, required := range []string{
		"CREATE UNIQUE INDEX journal_one_reversal_per_entry",
		"prior_correction_of IS NOT NULL",
		"journal reversal cannot attach fee consent",
		"EXCEPT ALL",
		"CREATE CONSTRAINT TRIGGER journal_correction_exact",
		"CREATE CONSTRAINT TRIGGER postings_correction_exact",
		"DEFERRABLE INITIALLY DEFERRED",
	} {
		if !strings.Contains(up, required) {
			t.Fatalf("ledger correction migration is missing %q", required)
		}
	}
	down, err := RollbackMigration(4)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(down), "cannot roll back immutable ledger corrections while correction history exists") {
		t.Fatal("ledger correction rollback can discard enforced history")
	}
}

func TestSagaRecoveryMigrationHasLeasesAndRollbackGuard(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 || !strings.Contains(files[4], "0005_saga_recovery_runtime.up.sql") {
		t.Fatalf("Saga recovery migration is missing: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[4])
	if err != nil {
		t.Fatal(err)
	}
	up := string(body)
	for _, required := range []string{
		"recovery_task_id",
		"recovery_lease_owner",
		"recovery_acquired_at",
		"recovery_lease_until",
		"recovery_attempt",
		"saga_recovery_lease_complete",
		"saga_recovery_lease_status",
		"CREATE INDEX sagas_recovery_claim_idx",
		"CREATE UNIQUE INDEX sagas_recovery_task_id_unique",
	} {
		if !strings.Contains(up, required) {
			t.Fatalf("Saga recovery migration is missing %q", required)
		}
	}
	down, err := RollbackMigration(5)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(down), "cannot roll back Saga recovery runtime while recovery audit history exists") {
		t.Fatal("Saga recovery rollback can discard audit history")
	}
}

func TestUsageBillingMigrationIsAtomicImmutableAndRollbackGuarded(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 || !strings.Contains(files[5], "0006_usage_billing_runtime.up.sql") {
		t.Fatalf("usage Billing migration is missing: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[5])
	if err != nil {
		t.Fatal(err)
	}
	up := string(body)
	for _, required := range []string{
		"CREATE TABLE ynx_fabric.billing_rate_plans",
		"CREATE TABLE ynx_fabric.billing_settlements",
		"usage_event_id text NOT NULL UNIQUE",
		"journal_entry_id text NOT NULL UNIQUE",
		"billing_rate_plans_append_only",
		"billing_settlement_authority",
		"e.payload->>'quantity'",
		"ceil(NEW.quantity::numeric / plan_units_per_block::numeric)",
		"Billing Journal contradicts rated gross revenue or provider cost",
		"billing_settlements_append_only",
	} {
		if !strings.Contains(up, required) {
			t.Fatalf("usage Billing migration is missing %q", required)
		}
	}
	down, err := RollbackMigration(6)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(down), "cannot roll back usage Billing runtime while rate or settlement history exists") {
		t.Fatal("usage Billing rollback can discard immutable history")
	}
}

func TestConnectionDiagnosticsMigrationIsPrivacySafeAndRollbackGuarded(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 || !strings.Contains(files[6], "0007_connection_event_diagnostics.up.sql") {
		t.Fatalf("connection diagnostics migration is missing: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[6])
	if err != nil {
		t.Fatal(err)
	}
	up := string(body)
	for _, required := range []string{"CREATE TABLE ynx_fabric.connection_diagnostics", "metric text NOT NULL", "dimension text NOT NULL", "count bigint NOT NULL", "PRIMARY KEY (metric, dimension)"} {
		if !strings.Contains(up, required) {
			t.Fatalf("connection diagnostics migration is missing %q", required)
		}
	}
	down, err := RollbackMigration(7)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(down), "cannot roll back connection diagnostics while aggregate evidence exists") {
		t.Fatal("connection diagnostics rollback can discard aggregate evidence")
	}
}

func TestErasureDeletionReceiptMigrationIsAtomicAndRollbackGuarded(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 8 || !strings.Contains(files[7], "0008_erasure_deletion_receipts.up.sql") {
		t.Fatalf("erasure deletion receipt migration is missing: %v %v", files, err)
	}
	body, err := migrations.ReadFile(files[7])
	if err != nil {
		t.Fatal(err)
	}
	up := string(body)
	for _, required := range []string{
		"CREATE TABLE ynx_fabric.erasure_deletion_receipts",
		"derived_analytics_deleted bigint NOT NULL CHECK (derived_analytics_deleted >= 0)",
		"deletion_receipt char(64) NOT NULL CHECK (deletion_receipt ~ '^[0-9a-f]{64}$')",
		"erasure deletion receipt does not match immutable erasure authority",
		"CREATE CONSTRAINT TRIGGER erasure_deletion_receipt_authority",
		"CREATE TRIGGER erasure_deletion_receipts_append_only",
	} {
		if !strings.Contains(up, required) {
			t.Fatalf("erasure deletion receipt migration is missing %q", required)
		}
	}
	down, err := RollbackMigration(8)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(down), "cannot roll back erasure deletion receipts while audit history exists") {
		t.Fatal("erasure deletion receipt rollback can discard audit history")
	}
}

func TestMigrationVersionParsing(t *testing.T) {
	if version, err := migrationVersion("migrations/0001_initial.up.sql"); err != nil || version != 1 {
		t.Fatalf("valid migration version rejected: version=%d err=%v", version, err)
	}
	for _, invalid := range []string{"migrations/nope.sql", "migrations/0_bad.up.sql", "migrations/x_bad.up.sql"} {
		if _, err := migrationVersion(invalid); err == nil {
			t.Fatalf("invalid migration filename accepted: %s", invalid)
		}
	}
}
