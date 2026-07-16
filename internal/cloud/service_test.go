package cloud

import (
	"context"
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

func (acceptWallet) Verify(context.Context, WalletAssertion) error { return nil }

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

func TestNativeWalletBindingsRejectSubstitutionAndReplay(t *testing.T) {
	s := testService(t, nil)
	ctx := context.Background()
	expires := time.Now().UTC().Add(4 * time.Minute).Format(time.RFC3339)
	cases := []WalletAssertion{
		{Product: "cloud", ClientID: "ynx-cloud-mobile-v1", BundleID: "com.ynxweb4.cloud", Callback: "ynxcloud://wallet-auth/callback", Account: owner, ChainID: ChainID, Scopes: []string{"files.read"}, Nonce: "native-cloud", ExpiresAt: expires, DevicePublicKey: "p256-cloud", Signature: "wallet-cloud"},
		{Product: "docs", ClientID: "ynx-docs-mobile-v1", BundleID: "com.ynxweb4.docs", Callback: "ynxdocs://wallet-auth/callback", Account: owner, ChainID: ChainID, Scopes: []string{"docs.read"}, Nonce: "native-docs", ExpiresAt: expires, DevicePublicKey: "p256-docs", Signature: "wallet-docs"},
	}
	for _, assertion := range cases {
		if _, _, err := s.CreateSession(ctx, assertion); err != nil {
			t.Fatalf("valid native binding rejected for %s: %v", assertion.Product, err)
		}
		if _, _, err := s.CreateSession(ctx, assertion); err == nil || !strings.Contains(err.Error(), "replay") {
			t.Fatalf("native replay accepted for %s: %v", assertion.Product, err)
		}
		tampered := assertion
		tampered.Nonce += "-tampered"
		tampered.BundleID = "com.attacker.substitute"
		if _, _, err := s.CreateSession(ctx, tampered); !errors.Is(err, ErrInvalid) {
			t.Fatalf("bundle substitution was not rejected for %s: %v", assertion.Product, err)
		}
		tampered.BundleID = assertion.BundleID
		tampered.Callback = "attacker://wallet-auth/callback"
		if _, _, err := s.CreateSession(ctx, tampered); !errors.Is(err, ErrInvalid) {
			t.Fatalf("callback substitution was not rejected for %s: %v", assertion.Product, err)
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
	assertion := WalletAssertion{Product: "cloud", ClientID: "com.ynx.cloud.web", BundleID: "com.ynx.cloud.web", Callback: "/cloud/auth/callback", Account: owner, ChainID: ChainID, Scopes: []string{"files.read"}, Nonce: "one", ExpiresAt: now.Add(4 * time.Minute).Format(time.RFC3339), DevicePublicKey: "device", Signature: "sig"}
	token2, _, err := s.CreateSession(ctx, assertion)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(token2); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeSession(token2); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CreateSession(ctx, assertion); err == nil {
		t.Fatal("Wallet assertion replay must fail")
	}
	if _, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFile, Name: "evil.txt", MIME: "text/plain", Content: []byte("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")}); err == nil {
		t.Fatal("malware interface should reject")
	}
}
