package main

import (
	"bytes"
	"context"
	"database/sql"
	"testing"
	"time"
)

func TestResilienceEventIsDeterministicSignedAndOrdered(t *testing.T) {
	key := deterministicKey("event", "0123456789abcdef0123456789abcdef01234567")
	now := time.Date(2026, 8, 14, 1, 2, 3, 4, time.UTC)
	first := resilienceEvent("hot", 7, now, "0123456789abcdef0123456789abcdef01234567", "resilience-test", "key.postgres.resilience.0001", key)
	second := resilienceEvent("hot", 7, now, "0123456789abcdef0123456789abcdef01234567", "resilience-test", "key.postgres.resilience.0001", key)
	if first.EventID != second.EventID || first.Sequence != 7 || first.AggregateID != "aggregate.capacity.hot" || first.PartitionKey() != second.PartitionKey() {
		t.Fatalf("event identity or partition is unstable: first=%+v second=%+v", first, second)
	}
	if first.Integrity != second.Integrity || first.Verify(key) != nil {
		t.Fatal("deterministic resilience event did not retain a valid integrity proof")
	}
	if bytes.Equal(key, deterministicKey("privacy", "0123456789abcdef0123456789abcdef01234567")) {
		t.Fatal("event and privacy key domains collided")
	}
}

func TestLatencySummaryDoesNotMutateInput(t *testing.T) {
	values := []time.Duration{3 * time.Millisecond, time.Millisecond, 2 * time.Millisecond}
	summary := summarize(values)
	if values[0] != 3*time.Millisecond || summary.P50Milliseconds != 2 || summary.MaxMilliseconds != 3 {
		t.Fatalf("latency summary is invalid or mutated input: values=%v summary=%+v", values, summary)
	}
}

func TestCommitValidationIsExactLowercaseHex(t *testing.T) {
	if !isCommit("0123456789abcdef0123456789abcdef01234567") || isCommit("0123456789ABCDEF0123456789ABCDEF01234567") || isCommit("01234567") {
		t.Fatal("commit validation accepted a non-canonical value")
	}
}

func TestDatabaseIdentityDoesNotRetrySeedFailure(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/unreachable?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, _, attempts, identityErr := databaseIdentity(ctx, db, false); identityErr == nil || attempts != 1 {
		t.Fatalf("seed connection failure was not bounded to one attempt: attempts=%d err=%v", attempts, identityErr)
	}
}
