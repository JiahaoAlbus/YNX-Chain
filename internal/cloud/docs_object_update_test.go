package cloud

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDocsObjectUpdateProductAndCycle(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{StatePath: filepath.Join(root, "state.json"), ObjectDir: filepath.Join(root, "objects")})
	if err != nil {
		t.Fatal(err)
	}
	actor := "ynx1" + strings.Repeat("a", 38)
	create := func(product, name, parent string) Object {
		object, err := s.Create(context.Background(), actor, CreateObjectRequest{Product: product, Kind: KindFolder, Name: name, ParentID: parent})
		if err != nil {
			t.Fatal(err)
		}
		return object
	}
	doc := create("docs", "Docs", "")
	child := create("docs", "Child", doc.ID)
	cloud := create("cloud", "Cloud", "")
	if _, err := s.UpdateObject(actor, doc.ID, UpdateObjectRequest{ParentID: &cloud.ID}); !errors.Is(err, ErrDenied) {
		t.Fatalf("cross-product move: %v", err)
	}
	if _, err := s.UpdateObject(actor, doc.ID, UpdateObjectRequest{ParentID: &child.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("descendant move: %v", err)
	}
	name := "Renamed"
	updated, err := s.UpdateObject(actor, child.ID, UpdateObjectRequest{Name: &name})
	if err != nil || updated.Name != name || updated.Product != "docs" || updated.ParentID != doc.ID {
		t.Fatalf("rename: %+v %v", updated, err)
	}
	parent := ""
	updated, err = s.UpdateObject(actor, child.ID, UpdateObjectRequest{ParentID: &parent})
	if err != nil || updated.ParentID != "" {
		t.Fatalf("move root: %+v %v", updated, err)
	}
	if _, err := s.UpdateObject("another-account", child.ID, UpdateObjectRequest{Name: &name}); !errors.Is(err, ErrDenied) {
		t.Fatalf("other actor: %v", err)
	}
	if _, err := s.Create(context.Background(), actor, CreateObjectRequest{Product: "docs", Kind: KindFolder, Name: "Wrong parent", ParentID: cloud.ID}); !errors.Is(err, ErrDenied) {
		t.Fatalf("cross-product create: %v", err)
	}
	note, err := s.Create(context.Background(), actor, CreateObjectRequest{Product: "docs", Kind: KindDoc, Name: "note.txt", ParentID: doc.ID, MIME: "text/plain", Content: []byte("first")})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.SaveDocument(context.Background(), actor, note.ID, SaveDocumentRequest{BaseVersion: note.Version, Content: []byte("second")})
	if err != nil || saved.Version != note.Version+1 {
		t.Fatalf("save: %+v %v", saved, err)
	}
	_, err = s.SaveDocument(context.Background(), actor, note.ID, SaveDocumentRequest{BaseVersion: note.Version, Content: []byte("stale")})
	var conflict ConflictError
	if !errors.As(err, &conflict) || conflict.Current.Version != saved.Version {
		t.Fatalf("version conflict: %v", err)
	}
	reloaded, err := New(Config{StatePath: filepath.Join(root, "state.json"), ObjectDir: filepath.Join(root, "objects")})
	if err != nil {
		t.Fatalf("schema7 Docs folder cold-load: %v", err)
	}
	loaded, err := reloaded.Get(actor, note.ID)
	if err != nil || loaded.Version != saved.Version || loaded.Product != "docs" || loaded.ParentID != doc.ID {
		t.Fatalf("cold-loaded doc: %+v %v", loaded, err)
	}
}
