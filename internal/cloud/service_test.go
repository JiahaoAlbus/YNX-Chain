package cloud

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const owner = "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp7h6v"
const viewer = "ynx1pppppppppppppppppppppppppppppppp5f3cz"

type acceptWallet struct{}

func (acceptWallet) Verify(_ context.Context, e WalletSessionEnvelope) (CentralSessionClaims, error) {
	a := e.WalletApproval
	return CentralSessionClaims{VerifierVersion: "wallet-auth-v1", SessionBinding: strings.Repeat("b", 64), ProductClientID: a.ProductClientID, BundleID: a.BundleID, ProductDeviceAlgorithm: a.ProductDeviceAlgorithm, RequestDigest: a.RequestDigest, Account: a.Account, Scopes: a.GrantedScopes, IssuedAt: a.IssuedAt, ExpiresAt: a.ExpiresAt}, nil
}

func testWalletEnvelope(t *testing.T, s *Service, product, nonce string, scopes []string) WalletSessionEnvelope {
	t.Helper()
	now := s.cfg.Now().UTC().Truncate(time.Millisecond)
	client, bundle, callback := "ynx-cloud-mobile-v1", "com.ynxweb4.cloud", "ynxcloud://wallet-auth/callback"
	if product == "docs" {
		client, bundle, callback = "ynx-docs-mobile-v1", "com.ynxweb4.docs", "ynxdocs://wallet-auth/callback"
	}
	if len(nonce) < 32 {
		nonce += strings.Repeat("x", 32-len(nonce))
	}
	r := WalletAuthorizationRequest{Version: "1", Nonce: nonce, ChainID: ChainID, RequestingProduct: product, ProductClientID: client, BundleID: bundle, ProductDeviceAlgorithm: "p256-sha256", ProductDeviceKey: "AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv", Callback: callback, Scopes: scopes, Purpose: "Use explicitly authorized YNX content on this device.", IssuedAt: now.Add(-time.Second).Format("2006-01-02T15:04:05.000Z"), ExpiresAt: now.Add(4 * time.Minute).Format("2006-01-02T15:04:05.000Z")}
	digest, err := authorizationDigest(r)
	if err != nil {
		t.Fatal(err)
	}
	a := WalletApproval{Version: "1", RequestDigest: digest, Nonce: r.Nonce, ChainID: r.ChainID, RequestingProduct: r.RequestingProduct, ProductClientID: r.ProductClientID, BundleID: r.BundleID, ProductDeviceAlgorithm: r.ProductDeviceAlgorithm, ProductDeviceKey: r.ProductDeviceKey, Callback: r.Callback, Account: owner, AccountPublicKey: strings.Repeat("0", 66), GrantedScopes: r.Scopes, Purpose: r.Purpose, IssuedAt: now.Format("2006-01-02T15:04:05.000Z"), ExpiresAt: r.ExpiresAt, WalletSignature: strings.Repeat("0", 128)}
	c, err := s.CreateWalletChallenge(r, a)
	if err != nil {
		t.Fatal(err)
	}
	return WalletSessionEnvelope{AuthorizationRequest: r, WalletApproval: a, GatewayCompletion: GatewayCompletion{Challenge: c, DeviceSignature: strings.Repeat("A", 96)}}
}

type fakeAI struct{}

func (fakeAI) Status(context.Context) (string, string, bool) {
	return "test-gateway", "test-model", true
}
func (fakeAI) Complete(_ context.Context, _ string, c []AIContext) (string, error) {
	return "Grounded in " + c[0].Name, nil
}

func testService(t *testing.T, modify func(*Config)) *Service {
	t.Helper()
	dir := t.TempDir()
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), WalletVerifier: acceptWallet{}, AIProvider: fakeAI{}}
	if modify != nil {
		modify(&cfg)
	}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestFileLifecyclePermissionsVersionsAndAI(t *testing.T) {
	s := testService(t, nil)
	ctx := context.Background()
	folder, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFolder, Name: "Legal"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := s.Create(ctx, owner, CreateObjectRequest{ParentID: folder.ID, Kind: KindDoc, Name: "Terms.txt", MIME: "text/plain", Content: []byte("version one")})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Content(viewer, doc.ID, 0); !errors.Is(err, ErrDenied) {
		t.Fatalf("ungranted viewer read: %v", err)
	}
	expires := time.Now().UTC().Add(time.Hour)
	grant, err := s.Grant(owner, folder.ID, viewer, "editor", &expires)
	if err != nil {
		t.Fatal(err)
	}
	if _, body, err := s.Content(viewer, doc.ID, 0); err != nil || string(body) != "version one" {
		t.Fatalf("inherited read failed: %q %v", body, err)
	}
	v2, err := s.SaveDocument(ctx, viewer, doc.ID, SaveDocumentRequest{BaseVersion: 1, Content: []byte("version two")})
	if err != nil || v2.Version != 2 {
		t.Fatalf("save: %#v %v", v2, err)
	}
	if _, err := s.SaveDocument(ctx, owner, doc.ID, SaveDocumentRequest{BaseVersion: 1, Content: []byte("stale")}); err == nil {
		t.Fatal("expected conflict")
	}
	if _, err := s.AddComment(viewer, doc.ID, 2, "Please review", []string{owner}); err != nil {
		t.Fatal(err)
	}
	job, err := s.CreateAIJob(ctx, owner, "summarize", "Summarize", []string{doc.ID}, []int{2}, true)
	if err != nil || job.Status != "queued" || len(job.Citations) != 1 {
		t.Fatalf("AI job: %#v %v", job, err)
	}
	for i := 0; i < 100; i++ {
		job, err = s.GetAIJob(owner, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if job.Status == "review" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if job.Status != "review" {
		t.Fatalf("AI job did not reach review: %#v", job)
	}
	if _, err := s.ReviewAI(owner, job.ID, "applied"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RevokeGrant(owner, folder.ID, grant.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Content(viewer, doc.ID, 0); !errors.Is(err, ErrDenied) {
		t.Fatalf("revoked viewer read: %v", err)
	}
	if _, err := s.SetTrash(owner, doc.ID, true); err != nil {
		t.Fatal(err)
	}
	trash, err := s.List(owner, ListOptions{View: "trash"})
	if err != nil || len(trash) != 1 {
		t.Fatalf("trash: %v %#v", err, trash)
	}
	if _, err := s.SetTrash(owner, doc.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RestoreVersion(owner, doc.ID, 1); err != nil {
		t.Fatal(err)
	}
}

func TestMultipartResumeIntegrityCancelAndArtifact(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), WalletVerifier: acceptWallet{}, AIProvider: fakeAI{}, QuotaBytes: MaxMultipartBytes}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	p1, p2 := []byte("resumable "), []byte("dataset")
	all := append(append([]byte{}, p1...), p2...)
	u, err := s.InitiateMultipart(owner, CreateObjectRequest{Kind: KindFile, Name: "prices.parquet", MIME: "application/octet-stream", Artifact: &Artifact{Type: "dataset", Product: "quant", Retention: "standard"}}, int64(len(all)), hashBytes(all))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PutMultipartPart(context.Background(), owner, u.ID, 1, p1, hashBytes(p1)); err != nil {
		t.Fatal(err)
	}
	// Restart proves upload state and part references are durable enough to resume.
	s, err = New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := s.GetMultipart(owner, u.ID)
	if err != nil || len(resumed.Parts) != 1 || resumed.Status != "active" {
		t.Fatalf("resume: %#v %v", resumed, err)
	}
	if _, err = s.PutMultipartPart(context.Background(), owner, u.ID, 2, p2, hashBytes(p2)); err != nil {
		t.Fatal(err)
	}
	obj, err := s.CompleteMultipart(context.Background(), owner, u.ID, []int{1, 2})
	if err != nil {
		t.Fatal(err)
	}
	if obj.Hash != hashBytes(all) || obj.Artifact == nil || obj.Artifact.Type != "dataset" || obj.Artifact.Product != "quant" {
		t.Fatalf("artifact: %#v", obj)
	}
	if _, body, err := s.Content(owner, obj.ID, 0); err != nil || !bytes.Equal(body, all) {
		t.Fatalf("content: %q %v", body, err)
	}
	if _, err := s.GetMultipart(owner, u.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("completed upload retained: %v", err)
	}

	cancel, err := s.InitiateMultipart(owner, CreateObjectRequest{Kind: KindFile, Name: "cancel.bin"}, 1, hashBytes([]byte("x")))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelMultipart(viewer, cancel.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("foreign cancel: %v", err)
	}
	if err := s.CancelMultipart(owner, cancel.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetMultipart(owner, cancel.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cancel retained: %v", err)
	}

	bad, err := s.InitiateMultipart(owner, CreateObjectRequest{Kind: KindFile, Name: "bad.bin"}, 2, hashBytes([]byte("ok")))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutMultipartPart(context.Background(), owner, bad.ID, 1, []byte("no"), hashBytes([]byte("no"))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteMultipart(context.Background(), owner, bad.ID, []int{1}); err == nil {
		t.Fatal("expected final hash mismatch")
	}
	if resumed, err := s.GetMultipart(owner, bad.ID); err != nil || resumed.Status != "active" {
		t.Fatalf("failed completion must remain resumable: %#v %v", resumed, err)
	}
}

func TestPortableExportAndLegalHold(t *testing.T) {
	s := testService(t, nil)
	ctx := context.Background()
	obj, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFile, Name: "strategy.bin", Content: []byte("v1"), Artifact: &Artifact{Type: "strategy", Product: "quant", Retention: "standard"}})
	if err != nil {
		t.Fatal(err)
	}
	archive, manifest, err := s.ExportOwnedData(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Owner != owner || manifest.Source != "ynx-cloudd" || len(manifest.Objects) != 1 || len(manifest.Files) != 1 || manifest.Files[0].Hash != obj.Hash {
		t.Fatalf("manifest: %#v", manifest)
	}
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	seenManifest, seenBody := false, false
	for _, f := range zr.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		var b bytes.Buffer
		if _, err = b.ReadFrom(r); err != nil {
			t.Fatal(err)
		}
		_ = r.Close()
		switch f.Name {
		case "manifest.json":
			var decoded ExportManifest
			if err := json.Unmarshal(b.Bytes(), &decoded); err != nil || decoded.Owner != owner {
				t.Fatalf("decoded manifest: %#v %v", decoded, err)
			}
			seenManifest = true
		case manifest.Files[0].Path:
			if b.String() != "v1" {
				t.Fatalf("export body %q", b.String())
			}
			seenBody = true
		}
	}
	if !seenManifest || !seenBody {
		t.Fatalf("archive entries manifest=%v body=%v", seenManifest, seenBody)
	}
	hold, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFile, Name: "hold.bin", Content: []byte("held"), Artifact: &Artifact{Type: "audit-archive", Product: "trust", Retention: "legal-hold"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SetTrash(owner, hold.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteObject(owner, hold.ID); err == nil || !strings.Contains(err.Error(), "legal hold") {
		t.Fatalf("legal hold deletion: %v", err)
	}
}

type deleteFailStore struct{ LocalObjectStore }

func (s deleteFailStore) Delete(context.Context, string, string) error {
	return errors.New("provider unavailable")
}

func TestPhysicalDeleteReferenceCountingAndPendingTruth(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects")}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "a", Content: []byte("same")})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "b", Content: []byte("same")})
	if err != nil {
		t.Fatal(err)
	}
	versions, _ := s.Versions(owner, a.ID)
	blob := versions[0].BlobPath
	if _, err = s.SetTrash(owner, a.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteObject(owner, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(blob); err != nil {
		t.Fatalf("deduplicated blob deleted while referenced: %v", err)
	}
	if _, err = s.SetTrash(owner, b.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteObject(owner, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(blob); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("final unreferenced blob retained: %v", err)
	}
	deletions, err := s.BlobDeletions(owner)
	if err != nil || len(deletions) != 1 || deletions[0].Status != "completed" || deletions[0].Ref != "" {
		t.Fatalf("completed deletion evidence: %#v %v", deletions, err)
	}

	dir = t.TempDir()
	local := LocalObjectStore{Root: filepath.Join(dir, "objects")}
	s, err = New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: local.Root, ObjectStore: deleteFailStore{local}})
	if err != nil {
		t.Fatal(err)
	}
	a, err = s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "pending", Content: []byte("erase")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SetTrash(owner, a.ID, true); err != nil {
		t.Fatal(err)
	}
	err = s.DeleteObject(owner, a.ID)
	var pending DeletionPendingError
	if !errors.As(err, &pending) || pending.Count != 1 {
		t.Fatalf("pending result: %v", err)
	}
	deletions, err = s.BlobDeletions(owner)
	if err != nil || len(deletions) != 1 || deletions[0].Status != "pending" || deletions[0].LastError == "" {
		t.Fatalf("pending evidence: %#v %v", deletions, err)
	}
	retried, err := s.RetryBlobDeletion(context.Background(), owner, deletions[0].ID)
	if err != nil || retried.Status != "pending" || retried.Attempts != 2 || retried.Ref != "" {
		t.Fatalf("retry evidence: %#v %v", retried, err)
	}
	if _, err := s.RetryBlobDeletion(context.Background(), viewer, deletions[0].ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("foreign retry: %v", err)
	}
}

func TestNativeWalletBindingsRejectSubstitutionAndReplay(t *testing.T) {
	s := testService(t, nil)
	ctx := context.Background()
	for _, product := range []string{"cloud", "docs"} {
		scopes := []string{"files.read"}
		if product == "docs" {
			scopes = []string{"documents.write"}
		}
		envelope := testWalletEnvelope(t, s, product, "native-"+product, scopes)
		if _, _, err := s.CreateSession(ctx, envelope); err != nil {
			t.Fatalf("valid native binding rejected for %s: %v", product, err)
		}
		if _, _, err := s.CreateSession(ctx, envelope); err == nil || !strings.Contains(err.Error(), "replay") {
			t.Fatalf("native replay accepted for %s: %v", product, err)
		}
		tampered := testWalletEnvelope(t, s, product, "tamper-bundle-"+product, scopes)
		tampered.AuthorizationRequest.BundleID = "com.attacker.substitute"
		if _, _, err := s.CreateSession(ctx, tampered); !errors.Is(err, ErrInvalid) {
			t.Fatalf("bundle substitution was not rejected for %s: %v", product, err)
		}
		tampered = testWalletEnvelope(t, s, product, "tamper-callback-"+product, scopes)
		tampered.AuthorizationRequest.Callback = "attacker://wallet-auth/callback"
		if _, _, err := s.CreateSession(ctx, tampered); !errors.Is(err, ErrInvalid) {
			t.Fatalf("callback substitution was not rejected for %s: %v", product, err)
		}
	}
}

func TestRestartIntegrityQuotaAndEncryptedAIBoundary(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), QuotaBytes: 32, WalletVerifier: acceptWallet{}, AIProvider: fakeAI{}}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	file, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "a.txt", MIME: "text/plain", Content: []byte("persistent")})
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	_, body, err := restarted.Content(owner, file.ID, 1)
	if err != nil || string(body) != "persistent" {
		t.Fatalf("restart: %q %v", body, err)
	}
	if _, err := restarted.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "large.txt", MIME: "text/plain", Content: []byte(strings.Repeat("x", 30))}); err == nil {
		t.Fatal("quota should reject")
	}
	encrypted, err := restarted.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "private.bin", MIME: "application/octet-stream", Content: []byte("ciphertext"), Encryption: Encryption{ClientSide: true, Algorithm: "AES-256-GCM", RecoveryPolicy: "user-held recovery package"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.CreateAIJob(context.Background(), owner, "summarize", "read", []string{encrypted.ID}, []int{1}, true); err == nil {
		t.Fatal("encrypted file must not enter AI")
	}
	versions, _ := restarted.Versions(owner, file.ID)
	if err := os.WriteFile(versions[0].BlobPath, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := restarted.Content(owner, file.ID, 1); err == nil {
		t.Fatal("tampered object should fail integrity")
	}
}

func TestPermanentDeleteAndRecoveryBackupRoundTrip(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "live")
	s, err := New(Config{StatePath: filepath.Join(data, "state.json"), ObjectDir: filepath.Join(data, "objects"), WalletVerifier: acceptWallet{}})
	if err != nil {
		t.Fatal(err)
	}
	file, err := s.Create(context.Background(), owner, CreateObjectRequest{Kind: KindFile, Name: "recovery.txt", MIME: "text/plain", Content: []byte("recover me")})
	if err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(dir, "backup")
	manifest, err := CreateRecoveryBackup(data, backup, s.cfg.ObjectStore.Boundary(), time.Now())
	if err != nil || len(manifest.Files) < 2 {
		t.Fatalf("backup: %#v %v", manifest, err)
	}
	restored := filepath.Join(dir, "restored")
	if _, err := RestoreRecoveryBackup(backup, restored); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(Config{StatePath: filepath.Join(restored, "state.json"), ObjectDir: filepath.Join(restored, "objects"), WalletVerifier: acceptWallet{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, body, err := reopened.Content(owner, file.ID, 1); err != nil || string(body) != "recover me" {
		t.Fatalf("restored content %q %v", body, err)
	}
	if _, err := s.SetTrash(owner, file.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteObject(viewer, file.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("non-owner delete %v", err)
	}
	if err := s.DeleteObject(owner, file.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(owner, file.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted object remained: %v", err)
	}
	manifestPath := filepath.Join(backup, "recovery-manifest.json")
	body, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, append(body, []byte("tamper")...), 0o600); err != nil {
		t.Fatal(err)
	}
	// Extra trailing JSON is rejected by the strict recovery decoder.
	if _, err := VerifyRecoveryBackup(backup); err == nil {
		t.Fatal("tampered recovery manifest accepted")
	}
}

func TestAccessLinkSessionAndMalwareBounds(t *testing.T) {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	s := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	ctx := context.Background()
	file, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFile, Name: "note.txt", MIME: "text/plain", Content: []byte("ok")})
	if err != nil {
		t.Fatal(err)
	}
	req, err := s.RequestAccess(viewer, file.ID, "viewer", "review")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DecideAccess(owner, req.ID, "approved"); err != nil {
		t.Fatal(err)
	}
	link, token, err := s.CreateLink(owner, file.ID, "viewer", now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveLink(token); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RevokeLink(owner, file.ID, link.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveLink(token); !errors.Is(err, ErrDenied) {
		t.Fatalf("revoked link: %v", err)
	}
	envelope := testWalletEnvelope(t, s, "cloud", "one", []string{"files.read"})
	token2, _, err := s.CreateSession(ctx, envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(token2); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeSession(token2); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CreateSession(ctx, envelope); err == nil {
		t.Fatal("Wallet assertion replay must fail")
	}
	if _, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFile, Name: "evil.txt", MIME: "text/plain", Content: []byte("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")}); err == nil {
		t.Fatal("malware interface should reject")
	}
}
