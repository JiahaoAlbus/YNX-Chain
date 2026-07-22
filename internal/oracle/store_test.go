package oracle

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStoreRejectsReplayAndPersistsIntegrity(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	path := filepath.Join(t.TempDir(), "oracle-state.json")
	key := []byte(strings.Repeat("k", 32))
	store, err := OpenStore(path, key, "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	first := source.observation(t, 1, 1_000_000, now)
	created, err := store.Ingest(first, source.provider)
	if err != nil || !created {
		t.Fatalf("ingest created=%v err=%v", created, err)
	}
	state := store.Snapshot()
	if state.StoreVersion != StoreVersion || len(state.NormalizedEvents) != 1 || state.NormalizedEvents[0].ObservationID != first.ID || len(state.NormalizedEvents[0].Hash) != 64 {
		t.Fatalf("normalized event missing: %+v", state)
	}
	created, err = store.Ingest(first, source.provider)
	if err != nil || created {
		t.Fatalf("idempotent replay created=%v err=%v", created, err)
	}
	replayed := source.observation(t, 1, 1_000_001, now.Add(time.Second))
	replayed.ID = "different-id"
	data, _ := replayed.signingBytes()
	replayed.SignatureHex = signHex(source.private, data)
	replayed.Hash, _ = replayed.CalculatedHash()
	if _, err := store.Ingest(replayed, source.provider); err == nil {
		t.Fatal("sequence replay accepted")
	}

	reopened, err := OpenStore(path, key, "ynx-oracle-testnet-v1")
	if err != nil || len(reopened.Snapshot().Observations) != 1 {
		t.Fatalf("reopen err=%v state=%+v", err, reopened.Snapshot())
	}
	dataOnDisk, _ := os.ReadFile(path)
	dataOnDisk[len(dataOnDisk)/2] ^= 1
	if err := os.WriteFile(path, dataOnDisk, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(path, key, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("tampered state accepted")
	}
}

func TestCorrectionPreservesOriginalAndHistoricalReplay(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	store, err := OpenStore(filepath.Join(t.TempDir(), "oracle-state.json"), []byte(strings.Repeat("k", 32)), "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	original := source.observation(t, 1, 1_000_000, now)
	if _, err := store.Ingest(original, source.provider); err != nil {
		t.Fatal(err)
	}
	corrected := source.observation(t, 2, 1_001_000, now)
	corrected.ID = "source-a-corrected"
	data, _ := corrected.signingBytes()
	corrected.SignatureHex = signHex(source.private, data)
	corrected.Hash, _ = corrected.CalculatedHash()
	correction := Correction{Schema: SchemaVersion, ID: "correction-1", OriginalID: original.ID, Corrected: corrected,
		Reason: "provider published a documented decimal normalization correction", EffectiveAt: now.Add(time.Hour),
		Actor: "oracle-governance-test", AuditID: "audit-correction-1", CreatedAt: now.Add(30 * time.Minute)}
	if err := store.Correct(correction, source.provider); err != nil {
		t.Fatal(err)
	}
	before := store.Replay("YNXT/YUSD_TEST", SpotPrice, now.Add(59*time.Minute))
	after := store.Replay("YNXT/YUSD_TEST", SpotPrice, now.Add(2*time.Hour))
	if len(before) != 1 || before[0].Value != original.Value || len(after) != 1 || after[0].Value != corrected.Value {
		t.Fatalf("before=%+v after=%+v", before, after)
	}
	snapshot := store.Snapshot()
	if len(snapshot.Observations) != 1 || len(snapshot.Corrections) != 1 || snapshot.Observations[0].Value != original.Value {
		t.Fatalf("correction overwrote history: %+v", snapshot)
	}
	if len(snapshot.NormalizedEvents) != 2 || snapshot.NormalizedEvents[1].CorrectionID != correction.ID || snapshot.NormalizedEvents[1].ObservationID != corrected.ID {
		t.Fatalf("corrected normalized event missing: %+v", snapshot.NormalizedEvents)
	}
}

func TestBackupRestoreDrill(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	directory := t.TempDir()
	key := []byte(strings.Repeat("k", 32))
	store, _ := OpenStore(filepath.Join(directory, "live.json"), key, "ynx-oracle-testnet-v1")
	if _, err := store.Ingest(source.observation(t, 1, 1_000_000, now), source.provider); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(directory, "backup", "oracle.json")
	if err := store.Backup(backup); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenStore(backup, key, "ynx-oracle-testnet-v1")
	if err != nil || restored.Snapshot().EventChainHash != store.Snapshot().EventChainHash {
		t.Fatalf("restore drill err=%v restored=%+v", err, restored)
	}
}

func TestV1StoreMigratesWithBackupAndReopen(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	path := filepath.Join(t.TempDir(), "legacy.json")
	key := []byte(strings.Repeat("k", 32))
	legacyStore, _ := OpenStore(filepath.Join(t.TempDir(), "unused.json"), key, "ynx-oracle-testnet-v1")
	observation := source.observation(t, 1, 1_000_000, now)
	legacy := storeState{Schema: SchemaVersion, Generation: 1, NonceDomain: "ynx-oracle-testnet-v1",
		LatestSequences: map[string]uint64{observation.ReporterID: 1}, Observations: []Observation{observation}, Corrections: []Correction{}}
	legacy.EventChainHash = legacyEventChain(legacy.Observations, legacy.Corrections)
	data, err := legacyStore.envelope(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := OpenStore(path, key, "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	state := migrated.Snapshot()
	if state.StoreVersion != StoreVersion || len(state.NormalizedEvents) != 1 || state.Generation != 2 {
		t.Fatalf("migration incomplete: %+v", state)
	}
	if _, err := os.Stat(path + ".v1.backup"); err != nil {
		t.Fatalf("migration backup: %v", err)
	}
	if _, err := OpenStore(path, key, "ynx-oracle-testnet-v1"); err != nil {
		t.Fatalf("reopen migrated state: %v", err)
	}
}

func TestV2StoreMigratesStructuredEffectiveTimeWithBackup(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	path := filepath.Join(t.TempDir(), "v2.json")
	key := []byte(strings.Repeat("k", 32))
	helper, _ := OpenStore(filepath.Join(t.TempDir(), "unused.json"), key, "ynx-oracle-testnet-v1")
	observation := source.observation(t, 1, 1_000_000, now)
	normalized := normalizeObservation(observation, "", observation.ObservedAt)
	normalized.EffectiveAt = time.Time{}
	normalizedCopy := normalized
	normalizedCopy.Hash = ""
	normalizedData, _ := json.Marshal(normalizedCopy)
	digest := sha256.Sum256(normalizedData)
	normalized.Hash = hex.EncodeToString(digest[:])
	v2 := storeState{Schema: SchemaVersion, StoreVersion: 2, Generation: 2, NonceDomain: "ynx-oracle-testnet-v1",
		LatestSequences: map[string]uint64{observation.ReporterID: 1}, Observations: []Observation{observation}, Corrections: []Correction{},
		NormalizedEvents: []NormalizedEvent{normalized}, AggregateEvents: []AggregateEvent{}, ControlEvents: []ControlEvent{}}
	v2.EventChainHash = eventChain(v2)
	data, err := helper.envelope(v2)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := OpenStore(path, key, "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	state := migrated.Snapshot()
	if state.StoreVersion != StoreVersion || state.Generation != 3 || len(state.NormalizedEvents) != 1 || !state.NormalizedEvents[0].EffectiveAt.Equal(observation.ObservedAt) {
		t.Fatalf("v3 state=%+v", state)
	}
	if _, err := os.Stat(path + ".v2.backup"); err != nil {
		t.Fatalf("v2 backup: %v", err)
	}
	if _, err := OpenStore(path, key, "ynx-oracle-testnet-v1"); err != nil {
		t.Fatalf("reopen v3: %v", err)
	}
}

func TestEmergencyControlEventsAreDurableAndReplaySafe(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.json")
	key := []byte(strings.Repeat("k", 32))
	store, _ := OpenStore(path, key, "ynx-oracle-testnet-v1")
	pause := ControlEvent{Schema: SchemaVersion, ID: "control-pause-1", Action: "pause", Reason: "cross-source divergence incident", Actor: "oracle-governance", AuditID: "audit-pause-1", EffectiveAt: now, CreatedAt: now}
	pause.Hash = pause.calculatedHash()
	if err := store.ApplyControl(pause); err != nil {
		t.Fatal(err)
	}
	if err := store.ApplyControl(pause); err == nil {
		t.Fatal("control replay accepted")
	}
	paused, reason, auditID := store.ControlState(now)
	if !paused || reason != pause.Reason || auditID != pause.AuditID {
		t.Fatalf("pause state=%v %q %q", paused, reason, auditID)
	}
	reopened, err := OpenStore(path, key, "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	if paused, _, _ := reopened.ControlState(now); !paused {
		t.Fatal("pause lost after restart")
	}
	resume := ControlEvent{Schema: SchemaVersion, ID: "control-resume-1", Action: "resume", Reason: "independent sources recovered and incident review approved", Actor: "oracle-governance", AuditID: "audit-resume-1", EffectiveAt: now.Add(time.Minute), CreatedAt: now.Add(time.Minute)}
	resume.Hash = resume.calculatedHash()
	if err := reopened.ApplyControl(resume); err != nil {
		t.Fatal(err)
	}
	if paused, _, _ := reopened.ControlState(now.Add(time.Minute)); paused {
		t.Fatal("resume did not clear pause")
	}
}

func TestDEXReorgReplacementFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), []byte(strings.Repeat("k", 32)), "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	first := structuredBase(source, 1, DEXPoolState, now)
	first.PoolState = &PoolState{ChainID: "ynx-testnet", Pool: "pool-1", Token0: "YNXT", Token1: "YUSD_TEST", Reserve0: "100", Reserve1: "100", BlockNumber: 100, BlockHash: strings.Repeat("a", 64)}
	first = source.signed(t, first)
	if _, err := store.Ingest(first, source.provider); err != nil {
		t.Fatal(err)
	}
	replacement := structuredBase(source, 2, DEXPoolState, now.Add(time.Second))
	replacement.PoolState = &PoolState{ChainID: "ynx-testnet", Pool: "pool-1", Token0: "YNXT", Token1: "YUSD_TEST", Reserve0: "101", Reserve1: "99", BlockNumber: 100, BlockHash: strings.Repeat("b", 64)}
	replacement = source.signed(t, replacement)
	if _, err := store.Ingest(replacement, source.provider); err == nil || !strings.Contains(err.Error(), "correction") {
		t.Fatalf("same-height replacement accepted: %v", err)
	}
	if len(store.Snapshot().Observations) != 1 {
		t.Fatal("reorg candidate mutated immutable history")
	}
}

func signHex(private []byte, data []byte) string {
	return hexEncode(ed25519.Sign(ed25519.PrivateKey(private), data))
}

func hexEncode(value []byte) string { return hex.EncodeToString(value) }
