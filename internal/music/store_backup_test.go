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
