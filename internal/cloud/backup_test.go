package cloud

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestBackupRestoreDrillPreservesDurableStateAndDropsEphemeralCredentials(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 27, 18, 0, 0, 0, time.UTC)
	s := testService(t, func(cfg *Config) { cfg.Now = func() time.Time { return now } })

	folder, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFolder, Name: "Recovery"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := s.Create(ctx, owner, CreateObjectRequest{ParentID: folder.ID, Kind: KindDoc, Name: "Drill", MIME: "text/plain", Content: []byte("version one")})
	if err != nil {
		t.Fatal(err)
	}
	v2, err := s.SaveDocument(ctx, owner, doc.ID, SaveDocumentRequest{BaseVersion: 1, Content: []byte("version two")})
	if err != nil {
		t.Fatal(err)
	}
	expires := now.Add(time.Hour)
	grant, err := s.Grant(owner, folder.ID, viewer, "editor", &expires)
	if err != nil {
		t.Fatal(err)
	}
	comment, err := s.AddCommentThread(owner, doc.ID, 2, "Preserve this thread", []string{viewer}, "", &CommentAnchor{Start: 0, End: 7, Quote: "version"})
	if err != nil {
		t.Fatal(err)
	}

	ephemeralID := hashBytes([]byte(t.Name()))
	s.mu.Lock()
	s.state.Sessions[ephemeralID] = Session{TokenHash: ephemeralID, Account: owner, Product: "docs", Scopes: []string{"docs.read"}, ExpiresAt: now.Add(time.Hour)}
	s.state.Nonces[t.Name()] = now.Add(time.Hour)
	s.state.Presence[doc.ID+"|"+owner] = Presence{ObjectID: doc.ID, Actor: owner, Label: "Editing", ExpiresAt: now.Add(time.Minute)}
	s.state.AIJobs["job_interrupted"] = AIJob{ID: "job_interrupted", Actor: owner, Mode: "summary", ObjectIDs: []string{doc.ID}, Versions: []int{2}, Instruction: "Summarize", Provider: "test-gateway", Model: "test-model", Status: "running", ConsentAt: now}
	s.mu.Unlock()

	root := t.TempDir()
	backupDir := filepath.Join(root, "backup")
	started := time.Now()
	manifest, err := s.CreateBackup(ctx, backupDir)
	backupDuration := time.Since(started)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.BackupID == "" || manifest.StateSchemaVersion != currentSchemaVersion || len(manifest.Objects) != 2 || manifest.ObjectBytes != int64(len("version one")+len("version two")) {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
	if !manifest.SessionsExcluded || !manifest.NoncesExcluded || !manifest.PresenceExcluded || !manifest.InterruptedAIJobsFailed || manifest.ProductionDurabilityClaim {
		t.Fatalf("unsafe manifest claims: %#v", manifest)
	}
	if manifest.EncryptionClass != "none-local-operator-only" || manifest.SigningClass != "none-local-integrity-only" {
		t.Fatalf("incorrect backup security class: %#v", manifest)
	}
	if !validSHA256(manifest.StateSHA256) || !validSHA256(manifest.StateIntegrityHash) || !validSHA256(manifest.RootSHA256) {
		t.Fatalf("invalid manifest hashes: %#v", manifest)
	}
	for _, path := range []string{backupDir, filepath.Join(backupDir, "objects")} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("backup directory permissions %s: %#v %v", path, info, err)
		}
	}
	for _, name := range []string{backupManifestFile, backupManifestHash, backupStateFile} {
		info, err := os.Stat(filepath.Join(backupDir, name))
		if err != nil || info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("backup file permissions %s: %#v %v", name, info, err)
		}
	}
	for _, object := range manifest.Objects {
		info, err := os.Stat(filepath.Join(backupDir, filepath.FromSlash(object.RelativePath)))
		if err != nil || info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("backup object permissions %s: %#v %v", object.Hash, info, err)
		}
	}

	restoreRoot := filepath.Join(root, "restored")
	restoreCfg := Config{
		StatePath:      filepath.Join(restoreRoot, "state.json"),
		ObjectDir:      filepath.Join(restoreRoot, "objects"),
		WalletVerifier: acceptWallet{},
		AIProvider:     fakeAI{},
		Now:            func() time.Time { return now.Add(time.Minute) },
	}
	started = time.Now()
	restored, report, err := RestoreBackup(ctx, backupDir, restoreCfg)
	restoreDuration := time.Since(started)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Ready || report.BackupID != manifest.BackupID || report.ObjectsVerified != 2 || report.BytesVerified != manifest.ObjectBytes {
		t.Fatalf("unexpected restore report: %#v", report)
	}
	if report.SessionsRestored != 0 || report.PresenceRestored != 0 || report.SourceStateIntegrity != manifest.StateIntegrityHash || !validSHA256(report.RestoredStateIntegrity) {
		t.Fatalf("unsafe restore report: %#v", report)
	}
	if backupDuration <= 0 || restoreDuration <= 0 {
		t.Fatalf("invalid drill durations: backup=%s restore=%s", backupDuration, restoreDuration)
	}

	if _, body, err := restored.Content(owner, doc.ID, 1); err != nil || string(body) != "version one" {
		t.Fatalf("restored v1: %q %v", body, err)
	}
	if metadata, body, err := restored.Content(owner, doc.ID, 0); err != nil || metadata.Version != v2.Version || string(body) != "version two" {
		t.Fatalf("restored current: %#v %q %v", metadata, body, err)
	}
	comments, err := restored.Comments(owner, doc.ID)
	if err != nil || len(comments) != 1 || comments[0].ID != comment.ID || comments[0].ThreadID != comment.ID {
		t.Fatalf("restored comments: %#v %v", comments, err)
	}
	grants, err := restored.Grants(owner, folder.ID)
	if err != nil || len(grants) != 1 || grants[0].ID != grant.ID {
		t.Fatalf("restored grants: %#v %v", grants, err)
	}
	if len(restored.state.Sessions) != 0 || len(restored.state.Nonces) != 0 || len(restored.state.Presence) != 0 {
		t.Fatalf("ephemeral state restored: sessions=%d nonces=%d presence=%d", len(restored.state.Sessions), len(restored.state.Nonces), len(restored.state.Presence))
	}
	job := restored.state.AIJobs["job_interrupted"]
	if job.Status != "failed" || !strings.Contains(job.Error, "fresh context consent") {
		t.Fatalf("interrupted AI job was not failed closed: %#v", job)
	}

	restarted, err := New(restoreCfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, body, err := restarted.Content(owner, doc.ID, 0); err != nil || string(body) != "version two" {
		t.Fatalf("cold restart after restore: %q %v", body, err)
	}
	if _, _, err := RestoreBackup(ctx, backupDir, restoreCfg); err == nil || !strings.Contains(err.Error(), "restore state path already exists") {
		t.Fatalf("restore overwrote existing state: %v", err)
	}
}

func TestBackupDeduplicatesImmutableContentAndRejectsMissingObject(t *testing.T) {
	ctx := context.Background()
	s := testService(t, nil)
	first, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindDoc, Name: "First", MIME: "text/plain", Content: []byte("same bytes")})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindDoc, Name: "Second", MIME: "text/plain", Content: []byte("same bytes")})
	if err != nil {
		t.Fatal(err)
	}
	if first.Hash != second.Hash {
		t.Fatalf("fixture did not share immutable content: %s %s", first.Hash, second.Hash)
	}
	backupDir := filepath.Join(t.TempDir(), "deduplicated")
	manifest, err := s.CreateBackup(ctx, backupDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Objects) != 1 || manifest.ObjectBytes != int64(len("same bytes")) {
		t.Fatalf("backup did not deduplicate immutable content: %#v", manifest)
	}

	broken := testService(t, nil)
	doc, err := broken.Create(ctx, owner, CreateObjectRequest{Kind: KindDoc, Name: "Missing", MIME: "text/plain", Content: []byte("missing")})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(broken.state.Versions[doc.ID][0].BlobPath); err != nil {
		t.Fatal(err)
	}
	failedDestination := filepath.Join(t.TempDir(), "failed")
	if _, err := broken.CreateBackup(ctx, failedDestination); err == nil {
		t.Fatal("backup succeeded with a missing object")
	}
	if _, err := os.Stat(failedDestination); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed backup left committed destination: %v", err)
	}
}

func TestRestoreRejectsTamperSymlinkBroadPermissionsAndExistingTarget(t *testing.T) {
	newFixture := func(t *testing.T) (string, BackupManifest) {
		t.Helper()
		s := testService(t, nil)
		if _, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindDoc, Name: "Fixture", MIME: "text/plain", Content: []byte("integrity")}); err != nil {
			t.Fatal(err)
		}
		backupDir := filepath.Join(t.TempDir(), "backup")
		manifest, err := s.CreateBackup(context.Background(), backupDir)
		if err != nil {
			t.Fatal(err)
		}
		return backupDir, manifest
	}
	freshCfg := func(t *testing.T) Config {
		t.Helper()
		root := t.TempDir()
		return Config{StatePath: filepath.Join(root, "state.json"), ObjectDir: filepath.Join(root, "objects"), WalletVerifier: acceptWallet{}, AIProvider: fakeAI{}}
	}

	t.Run("object tamper", func(t *testing.T) {
		backupDir, manifest := newFixture(t)
		objectPath := filepath.Join(backupDir, filepath.FromSlash(manifest.Objects[0].RelativePath))
		if err := os.WriteFile(objectPath, []byte("tampered!"), 0o600); err != nil {
			t.Fatal(err)
		}
		cfg := freshCfg(t)
		if _, _, err := RestoreBackup(context.Background(), backupDir, cfg); err == nil || !strings.Contains(err.Error(), "integrity verification failed") {
			t.Fatalf("tampered object accepted: %v", err)
		}
		if _, err := os.Stat(cfg.StatePath); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("tampered restore wrote state: %v", err)
		}
	})

	t.Run("manifest tamper", func(t *testing.T) {
		backupDir, _ := newFixture(t)
		manifestPath := filepath.Join(backupDir, backupManifestFile)
		body, err := os.ReadFile(manifestPath)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(manifestPath, append(body, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := RestoreBackup(context.Background(), backupDir, freshCfg(t)); err == nil || !strings.Contains(err.Error(), "manifest integrity") {
			t.Fatalf("tampered manifest accepted: %v", err)
		}
	})

	t.Run("broad permissions", func(t *testing.T) {
		backupDir, manifest := newFixture(t)
		objectPath := filepath.Join(backupDir, filepath.FromSlash(manifest.Objects[0].RelativePath))
		if err := os.Chmod(objectPath, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, _, err := RestoreBackup(context.Background(), backupDir, freshCfg(t)); err == nil || !strings.Contains(err.Error(), "permissions are too broad") {
			t.Fatalf("broad object permissions accepted: %v", err)
		}
	})

	t.Run("symlink object", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("symlink semantics require elevated Windows privileges")
		}
		backupDir, manifest := newFixture(t)
		objectPath := filepath.Join(backupDir, filepath.FromSlash(manifest.Objects[0].RelativePath))
		external := filepath.Join(t.TempDir(), "external")
		if err := os.WriteFile(external, []byte("integrity"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(objectPath); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(external, objectPath); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		if _, _, err := RestoreBackup(context.Background(), backupDir, freshCfg(t)); err == nil || !strings.Contains(err.Error(), "regular file") {
			t.Fatalf("symlink object accepted: %v", err)
		}
	})

	t.Run("existing state target", func(t *testing.T) {
		backupDir, _ := newFixture(t)
		cfg := freshCfg(t)
		if err := os.WriteFile(cfg.StatePath, []byte("preserve-existing-state"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := RestoreBackup(context.Background(), backupDir, cfg); err == nil || !strings.Contains(err.Error(), "already exists") {
			t.Fatalf("existing state target overwritten: %v", err)
		}
		body, err := os.ReadFile(cfg.StatePath)
		if err != nil || string(body) != "preserve-existing-state" {
			t.Fatalf("existing state changed: %q %v", body, err)
		}
	})
}
