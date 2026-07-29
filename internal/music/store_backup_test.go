package music

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSchemaV1GoldenMigratesAndPersistsV2(t *testing.T) {
	golden, err := os.ReadFile(filepath.Join("testdata", "state-v1-empty.json"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	statePath := filepath.Join(dir, "state.json")
	mediaDir := filepath.Join(dir, "media")
	if err := os.WriteFile(statePath, golden, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(mediaDir, 0o700); err != nil {
		t.Fatal(err)
	}
	state, exists, err := loadState(statePath, mediaDir)
	if err != nil {
		t.Fatal(err)
	}
	if !exists || state.SchemaVersion != currentStateSchemaVersion {
		t.Fatalf("golden schema v1 did not migrate: exists=%v schema=%d", exists, state.SchemaVersion)
	}
	persisted, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var header stateDocumentHeader
	if err := json.Unmarshal(persisted, &header); err != nil {
		t.Fatal(err)
	}
	if header.SchemaVersion != currentStateSchemaVersion {
		t.Fatalf("migrated state was not persisted: schema=%d", header.SchemaVersion)
	}
	if _, err := decodePersistedState(persisted); err != nil {
		t.Fatalf("persisted migrated state does not decode: %v", err)
	}
}

func TestSchemaMigrationFailsClosed(t *testing.T) {
	golden, err := os.ReadFile(filepath.Join("testdata", "state-v1-empty.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Run("future-version", func(t *testing.T) {
		future := bytes.Replace(golden, []byte(`"schemaVersion": 1`), []byte(`"schemaVersion": 99`), 1)
		if _, err := decodePersistedState(future); err == nil || !strings.Contains(err.Error(), "newer than supported") {
			t.Fatalf("future schema was accepted: %v", err)
		}
	})
	t.Run("tampered-v1", func(t *testing.T) {
		tampered := bytes.Replace(golden, []byte("705bc044"), []byte("805bc044"), 1)
		if _, err := decodePersistedState(tampered); err == nil || !strings.Contains(err.Error(), "schema v1 integrity verification failed") {
			t.Fatalf("tampered v1 state was accepted: %v", err)
		}
	})
	t.Run("migration-must-advance", func(t *testing.T) {
		registry := map[int]stateMigration{
			1: func(raw json.RawMessage) (json.RawMessage, error) { return raw, nil },
		}
		if _, err := migrateStateDocument(golden, registry); err == nil || !strings.Contains(err.Error(), "did not advance exactly one version") {
			t.Fatalf("non-advancing migration was accepted: %v", err)
		}
	})
}

func TestBackupRestoreRoundTrip(t *testing.T) {
	s := testService(t)
	creator := testAccount(t, 14)
	listener := testAccount(t, 15)
	track := publishTrack(t, s, creator, false)
	if _, err := s.UpsertProfile(listener, Profile{DisplayName: "Backup Listener", PrivateHistory: true}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SavePosition(listener, track.ID, "backup-session", 700, false); err != nil {
		t.Fatal(err)
	}
	backupDir := filepath.Join(t.TempDir(), "music-backup")
	manifest, err := s.CreateBackup(backupDir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.StateSchemaVersion != currentStateSchemaVersion || len(manifest.Media) != 1 || manifest.Media[0].Name != filepath.Base(track.AudioFile) {
		t.Fatalf("unexpected backup manifest: %#v", manifest)
	}
	if _, _, err := verifyBackup(backupDir); err != nil {
		t.Fatalf("created backup did not verify: %v", err)
	}

	restoreRoot := filepath.Join(t.TempDir(), "restored-data")
	statePath := filepath.Join(restoreRoot, "state.json")
	mediaDir := filepath.Join(restoreRoot, "media")
	if err := RestoreBackup(backupDir, statePath, mediaDir); err != nil {
		t.Fatal(err)
	}
	restored, err := New(Config{StatePath: statePath, MediaDir: mediaDir, MaxUploadBytes: 1 << 20, Now: time.Now})
	if err != nil {
		t.Fatal(err)
	}
	position, err := restored.Listener(listener)
	if err != nil || position.Positions[track.ID] != 700 {
		t.Fatalf("listener state did not restore: %#v err=%v", position, err)
	}
	mediaPath, mediaType, err := restored.Media(listener, track.ID, "audio")
	if err != nil || mediaType != "audio/wav" {
		t.Fatalf("restored media unavailable: path=%q type=%q err=%v", mediaPath, mediaType, err)
	}
	originalBytes, err := os.ReadFile(track.AudioFile)
	if err != nil {
		t.Fatal(err)
	}
	restoredBytes, err := os.ReadFile(mediaPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(originalBytes, restoredBytes) {
		t.Fatal("restored media bytes differ from source")
	}
	if _, err := s.CreateBackup(backupDir); err == nil || !strings.Contains(err.Error(), "must not already exist") {
		t.Fatalf("existing backup destination was overwritten: %v", err)
	}
}

func TestRestoreRejectsTamperedBackupAndDirtyDestination(t *testing.T) {
	s := testService(t)
	track := publishTrack(t, s, testAccount(t, 6), false)
	backupDir := filepath.Join(t.TempDir(), "music-backup")
	manifest, err := s.CreateBackup(backupDir)
	if err != nil {
		t.Fatal(err)
	}

	dirtyRoot := filepath.Join(t.TempDir(), "dirty")
	if err := os.MkdirAll(filepath.Join(dirtyRoot, "media"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := RestoreBackup(backupDir, filepath.Join(dirtyRoot, "state.json"), filepath.Join(dirtyRoot, "media")); err == nil || !strings.Contains(err.Error(), "must not already exist") {
		t.Fatalf("restore accepted a dirty destination: %v", err)
	}

	mediaPath := filepath.Join(backupDir, "media", manifest.Media[0].Name)
	media, err := os.ReadFile(mediaPath)
	if err != nil {
		t.Fatal(err)
	}
	media[len(media)-1] ^= 0xff
	if err := os.WriteFile(mediaPath, media, 0o600); err != nil {
		t.Fatal(err)
	}
	cleanRoot := filepath.Join(t.TempDir(), "clean")
	if err := RestoreBackup(backupDir, filepath.Join(cleanRoot, "state.json"), filepath.Join(cleanRoot, "media")); err == nil || (!strings.Contains(err.Error(), "SHA-256") && !strings.Contains(err.Error(), "digest")) {
		t.Fatalf("restore accepted tampered media for %s: %v", track.ID, err)
	}
}

type richV1Expectations struct {
	AllocationID        string `json:"allocationId"`
	ArtworkName         string `json:"artworkName"`
	AudioName           string `json:"audioName"`
	AuditEvents         int    `json:"auditEvents"`
	CaseEvidenceRef     string `json:"caseEvidenceRef"`
	CaseID              string `json:"caseId"`
	CaseKind            string `json:"caseKind"`
	CaseReason          string `json:"caseReason"`
	Creator             string `json:"creator"`
	HistoryEntries      int    `json:"historyEntries"`
	Listener            string `json:"listener"`
	PayIdempotencyKey   string `json:"payIdempotencyKey"`
	PlaylistID          string `json:"playlistId"`
	PositionMillis      int64  `json:"positionMillis"`
	SettlementID        string `json:"settlementId"`
	SettlementPayTo     string `json:"settlementPayTo"`
	TrackID             string `json:"trackId"`
	TrustIdempotencyKey string `json:"trustIdempotencyKey"`
	UsageID             string `json:"usageId"`
}

func copyRichFixtureFile(t *testing.T, source, destination string) []byte {
	t.Helper()
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRichSchemaV1GoldenMigrationBackupRestore(t *testing.T) {
	fixtureRoot := filepath.Join("testdata", "state-v1-rich")
	expectationData, err := os.ReadFile(filepath.Join(fixtureRoot, "expectations.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected richV1Expectations
	if err := json.Unmarshal(expectationData, &expected); err != nil {
		t.Fatal(err)
	}
	if expected.AuditEvents < 8 || expected.TrackID == "" || expected.SettlementID == "" || expected.CaseID == "" {
		t.Fatalf("rich fixture expectations are incomplete: %#v", expected)
	}

	dataRoot := t.TempDir()
	statePath := filepath.Join(dataRoot, "state.json")
	mediaDir := filepath.Join(dataRoot, "media")
	if err := os.Mkdir(mediaDir, 0o700); err != nil {
		t.Fatal(err)
	}
	copyRichFixtureFile(t, filepath.Join(fixtureRoot, "state.json"), statePath)
	audioFixture := copyRichFixtureFile(t, filepath.Join(fixtureRoot, "media", expected.AudioName), filepath.Join(mediaDir, expected.AudioName))
	artworkFixture := copyRichFixtureFile(t, filepath.Join(fixtureRoot, "media", expected.ArtworkName), filepath.Join(mediaDir, expected.ArtworkName))

	state, exists, err := loadState(statePath, mediaDir)
	if err != nil {
		t.Fatal(err)
	}
	if !exists || state.SchemaVersion != currentStateSchemaVersion {
		t.Fatalf("rich v1 fixture did not migrate: exists=%v schema=%d", exists, state.SchemaVersion)
	}
	if len(state.Audit) != expected.AuditEvents {
		t.Fatalf("audit chain changed during migration: got=%d want=%d", len(state.Audit), expected.AuditEvents)
	}
	track, ok := state.Tracks[expected.TrackID]
	if !ok || track.ReleaseState != "published" || filepath.Base(track.AudioFile) != expected.AudioName || filepath.Base(track.ArtworkFile) != expected.ArtworkName {
		t.Fatalf("track did not migrate with private media paths: %#v", track)
	}
	listener := state.Listeners[expected.Listener]
	if listener.Positions[expected.TrackID] != expected.PositionMillis || len(listener.History) != expected.HistoryEntries || listener.Favorites[0] != expected.TrackID || listener.Queue[0] != expected.TrackID {
		t.Fatalf("listener state did not migrate: %#v", listener)
	}
	if _, ok := state.Usage[expected.UsageID]; !ok {
		t.Fatalf("usage %s missing after migration", expected.UsageID)
	}
	if _, ok := state.Playlists[expected.PlaylistID]; !ok {
		t.Fatalf("playlist %s missing after migration", expected.PlaylistID)
	}
	if _, ok := state.Allocations[expected.AllocationID]; !ok {
		t.Fatalf("allocation %s missing after migration", expected.AllocationID)
	}
	if state.Idempotency["pay:"+expected.Creator+":"+expected.PayIdempotencyKey] != expected.SettlementID {
		t.Fatal("Pay replay claim did not migrate")
	}
	if state.Idempotency["trust:"+expected.Listener+":"+expected.TrustIdempotencyKey] != expected.CaseID {
		t.Fatal("Trust replay claim did not migrate")
	}

	persisted, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var header stateDocumentHeader
	if err := json.Unmarshal(persisted, &header); err != nil || header.SchemaVersion != currentStateSchemaVersion {
		t.Fatalf("rich migrated state was not persisted as schema v%d: header=%#v err=%v", currentStateSchemaVersion, header, err)
	}

	migrated, err := New(Config{StatePath: statePath, MediaDir: mediaDir, MaxUploadBytes: 1 << 20, Now: time.Now})
	if err != nil {
		t.Fatal(err)
	}
	migrated.mu.RLock()
	auditBeforeReplay := len(migrated.state.Audit)
	migrated.mu.RUnlock()
	settlement, err := migrated.SettlementIdempotent(expected.Creator, expected.PayIdempotencyKey, expected.AllocationID, expected.SettlementPayTo)
	if err != nil || settlement.ID != expected.SettlementID {
		t.Fatalf("Pay replay failed after migration: %#v err=%v", settlement, err)
	}
	trustCase, err := migrated.OpenCaseIdempotent(expected.Listener, expected.TrustIdempotencyKey, expected.CaseKind, expected.TrackID, expected.CaseReason, expected.CaseEvidenceRef)
	if err != nil || trustCase.ID != expected.CaseID {
		t.Fatalf("Trust replay failed after migration: %#v err=%v", trustCase, err)
	}
	migrated.mu.RLock()
	auditAfterReplay := len(migrated.state.Audit)
	migrated.mu.RUnlock()
	if auditAfterReplay != auditBeforeReplay {
		t.Fatalf("idempotent replay appended audit events: before=%d after=%d", auditBeforeReplay, auditAfterReplay)
	}

	backupDir := filepath.Join(t.TempDir(), "rich-v1-backup")
	manifest, err := migrated.CreateBackup(backupDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Media) != 2 || manifest.StateSchemaVersion != currentStateSchemaVersion {
		t.Fatalf("rich backup manifest is incomplete: %#v", manifest)
	}
	restoreRoot := filepath.Join(t.TempDir(), "rich-v1-restored")
	restoredStatePath := filepath.Join(restoreRoot, "state.json")
	restoredMediaDir := filepath.Join(restoreRoot, "media")
	if err := RestoreBackup(backupDir, restoredStatePath, restoredMediaDir); err != nil {
		t.Fatal(err)
	}
	restored, err := New(Config{StatePath: restoredStatePath, MediaDir: restoredMediaDir, MaxUploadBytes: 1 << 20, Now: time.Now})
	if err != nil {
		t.Fatal(err)
	}
	restoredListener, err := restored.Listener(expected.Listener)
	if err != nil || restoredListener.Positions[expected.TrackID] != expected.PositionMillis || len(restoredListener.History) != expected.HistoryEntries {
		t.Fatalf("listener did not survive restore: %#v err=%v", restoredListener, err)
	}
	restoredAudioPath, _, err := restored.Media(expected.Creator, expected.TrackID, "audio")
	if err != nil {
		t.Fatal(err)
	}
	restoredArtworkPath, _, err := restored.Media(expected.Creator, expected.TrackID, "artwork")
	if err != nil {
		t.Fatal(err)
	}
	restoredAudio, err := os.ReadFile(restoredAudioPath)
	if err != nil {
		t.Fatal(err)
	}
	restoredArtwork, err := os.ReadFile(restoredArtworkPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(audioFixture, restoredAudio) || !bytes.Equal(artworkFixture, restoredArtwork) {
		t.Fatal("rich fixture media changed across migration, backup, and restore")
	}
	settlement, err = restored.SettlementIdempotent(expected.Creator, expected.PayIdempotencyKey, expected.AllocationID, expected.SettlementPayTo)
	if err != nil || settlement.ID != expected.SettlementID {
		t.Fatalf("Pay replay failed after restore: %#v err=%v", settlement, err)
	}
	trustCase, err = restored.OpenCaseIdempotent(expected.Listener, expected.TrustIdempotencyKey, expected.CaseKind, expected.TrackID, expected.CaseReason, expected.CaseEvidenceRef)
	if err != nil || trustCase.ID != expected.CaseID {
		t.Fatalf("Trust replay failed after restore: %#v err=%v", trustCase, err)
	}
}
