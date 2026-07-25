package datafabricpostgres

import (
	"strings"
	"testing"
)

func TestInitialMigrationContainsTransactionalIntegrityGuards(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil || len(files) != 2 {
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
	if err != nil || len(files) != 2 || !strings.Contains(files[1], "0002_event_envelope_v2.up.sql") {
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
