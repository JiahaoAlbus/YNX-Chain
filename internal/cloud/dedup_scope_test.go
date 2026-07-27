package cloud

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContentAddressedDedupIsOwnerAndProductIsolated(t *testing.T) {
	dir := t.TempDir()
	s, err := New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects")})
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("same-private-content")
	cloudA, err := s.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "a.bin", Content: body})
	if err != nil {
		t.Fatal(err)
	}
	cloudB, err := s.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "b.bin", Content: body})
	if err != nil {
		t.Fatal(err)
	}
	docs, err := s.Create(context.Background(), owner, CreateObjectRequest{Product: "docs", Kind: KindDoc, Name: "same.txt", Content: body})
	if err != nil {
		t.Fatal(err)
	}
	otherOwner, err := s.Create(context.Background(), viewer, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "same.bin", Content: body})
	if err != nil {
		t.Fatal(err)
	}

	cloudAVersions, _ := s.Versions(owner, cloudA.ID)
	cloudBVersions, _ := s.Versions(owner, cloudB.ID)
	docsVersions, _ := s.Versions(owner, docs.ID)
	otherVersions, _ := s.Versions(viewer, otherOwner.ID)
	cloudRef := cloudAVersions[0].BlobPath
	if cloudRef != cloudBVersions[0].BlobPath {
		t.Fatalf("same owner/product content was not deduplicated: %q %q", cloudRef, cloudBVersions[0].BlobPath)
	}
	if cloudRef == docsVersions[0].BlobPath || cloudRef == otherVersions[0].BlobPath || docsVersions[0].BlobPath == otherVersions[0].BlobPath {
		t.Fatalf("cross-boundary content shared a physical ref: cloud=%q docs=%q other=%q", cloudRef, docsVersions[0].BlobPath, otherVersions[0].BlobPath)
	}
	for _, ref := range []string{cloudRef, docsVersions[0].BlobPath, otherVersions[0].BlobPath} {
		if strings.Contains(ref, owner) || strings.Contains(ref, viewer) {
			t.Fatalf("raw account leaked into storage ref: %q", ref)
		}
		if _, err := os.Stat(ref); err != nil {
			t.Fatalf("scoped blob missing: %q %v", ref, err)
		}
	}

	cloudUsed, _ := s.Quota(owner, "cloud")
	docsUsed, _ := s.Quota(owner, "docs")
	if cloudUsed != int64(len(body)) || docsUsed != int64(len(body)) || s.usedLocked(owner) != int64(2*len(body)) {
		t.Fatalf("product-isolated quota mismatch: cloud=%d docs=%d total=%d", cloudUsed, docsUsed, s.usedLocked(owner))
	}

	for _, object := range []Object{cloudA, cloudB} {
		if _, err := s.SetTrash(owner, object.ID, true); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteObject(owner, object.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(cloudRef); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unreferenced Cloud scoped blob retained: %v", err)
	}
	if _, err := os.Stat(docsVersions[0].BlobPath); err != nil {
		t.Fatalf("Cloud deletion affected Docs scoped blob: %v", err)
	}
	if _, err := os.Stat(otherVersions[0].BlobPath); err != nil {
		t.Fatalf("Cloud deletion affected another owner scoped blob: %v", err)
	}
}

func TestDocumentVersionsUseExactProductScopedBytes(t *testing.T) {
	s := testService(t, nil)
	doc, err := s.Create(context.Background(), owner, CreateObjectRequest{Product: "docs", Kind: KindDoc, Name: "doc.txt", MIME: "text/plain", Content: []byte("v1")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveDocument(context.Background(), owner, doc.ID, SaveDocumentRequest{BaseVersion: 1, Content: []byte("v2")}); err != nil {
		t.Fatal(err)
	}
	versions, err := s.Versions(owner, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 || versions[0].Size != 2 || versions[1].Size != 2 {
		t.Fatalf("unexpected version sizes: %#v", versions)
	}
	used, _ := s.Quota(owner, "docs")
	if used != 4 {
		t.Fatalf("unexpected Docs storage bytes: %d", used)
	}
}

func TestLocalObjectStoreRejectsCrossRootAndMalformedScopedDeletion(t *testing.T) {
	root := t.TempDir()
	store := LocalObjectStore{Root: root}
	body := []byte("bounded")
	hash := hashBytes(body)
	scope := objectStorageScope(owner, "cloud")
	ref, err := store.PutScoped(context.Background(), scope, hash, body)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), filepath.Join(root, "scoped", scope, hash), hash); err == nil {
		t.Fatal("malformed scoped deletion path accepted")
	}
	if _, err := os.Stat(ref); err != nil {
		t.Fatalf("valid scoped blob changed after rejected delete: %v", err)
	}
	outside := filepath.Join(t.TempDir(), hash)
	if err := os.WriteFile(outside, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), outside, hash); err == nil {
		t.Fatal("cross-root deletion accepted")
	}
}
