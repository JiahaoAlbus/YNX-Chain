package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDocsObjectOperationsThreadsAndExports(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	s := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	ctx := context.Background()

	workspace, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFolder, Name: "Workspace"})
	if err != nil {
		t.Fatal(err)
	}
	archive, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFolder, Name: "Archive"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := s.Create(ctx, owner, CreateObjectRequest{ParentID: workspace.ID, Kind: KindDoc, Name: "Draft", MIME: "text/plain", Content: []byte("Hello <world>")})
	if err != nil {
		t.Fatal(err)
	}

	renamed := "Launch notes"
	parent := archive.ID
	updated, err := s.UpdateObject(owner, doc.ID, UpdateObjectRequest{Name: &renamed, ParentID: &parent})
	if err != nil || updated.Name != renamed || updated.ParentID != archive.ID {
		t.Fatalf("update object: %#v %v", updated, err)
	}

	grant, err := s.Grant(owner, archive.ID, viewer, "editor", nil)
	if err != nil {
		t.Fatal(err)
	}
	root := ""
	if _, err := s.UpdateObject(viewer, doc.ID, UpdateObjectRequest{ParentID: &root}); !errors.Is(err, ErrDenied) {
		t.Fatalf("non-owner moved shared object: %v", err)
	}

	nested, err := s.Create(ctx, owner, CreateObjectRequest{ParentID: workspace.ID, Kind: KindFolder, Name: "Nested"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateObject(owner, workspace.ID, UpdateObjectRequest{ParentID: &nested.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("folder cycle was accepted: %v", err)
	}
	if _, err := s.DuplicateObject(owner, archive.ID, DuplicateObjectRequest{ParentID: archive.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("folder duplicated into itself: %v", err)
	}

	anchor := &CommentAnchor{Start: 0, End: 5, Quote: "Hello"}
	thread, err := s.AddCommentThread(owner, doc.ID, 1, "Review this opening", []string{viewer}, "", anchor)
	if err != nil || thread.ThreadID != thread.ID || thread.Anchor == nil || thread.Anchor.Quote != "Hello" {
		t.Fatalf("anchored thread: %#v %v", thread, err)
	}
	if _, err := s.AddCommentThread(owner, doc.ID, 1, "tampered", nil, "", &CommentAnchor{Start: 0, End: 5, Quote: "Wrong"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("tampered anchor accepted: %v", err)
	}
	reply, err := s.AddCommentThread(viewer, doc.ID, 1, "Acknowledged", nil, thread.ID, nil)
	if err != nil || reply.ThreadID != thread.ID || reply.ParentID != thread.ID {
		t.Fatalf("thread reply: %#v %v", reply, err)
	}
	resolved, err := s.ResolveComment(owner, doc.ID, thread.ID, true)
	if err != nil || resolved.ResolvedAt == nil || resolved.ResolvedBy != owner {
		t.Fatalf("resolve: %#v %v", resolved, err)
	}
	if _, err := s.AddCommentThread(viewer, doc.ID, 1, "late reply", nil, thread.ID, nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("reply to resolved thread accepted: %v", err)
	}
	if _, err := s.ResolveComment(owner, doc.ID, thread.ID, false); err != nil {
		t.Fatal(err)
	}

	duplicate, err := s.DuplicateObject(owner, archive.ID, DuplicateObjectRequest{Name: "Archive copy"})
	if err != nil || duplicate.Owner != owner || duplicate.ParentID != "" || duplicate.Name != "Archive copy" {
		t.Fatalf("duplicate root: %#v %v", duplicate, err)
	}
	children, err := s.List(owner, ListOptions{ParentID: duplicate.ID})
	if err != nil || len(children) != 1 {
		t.Fatalf("duplicate children: %#v %v", children, err)
	}
	_, duplicatedBody, err := s.Content(owner, children[0].ID, 0)
	if err != nil || string(duplicatedBody) != "Hello <world>" || children[0].Version != 1 {
		t.Fatalf("duplicate content: %q %#v %v", duplicatedBody, children[0], err)
	}
	comments, err := s.Comments(owner, children[0].ID)
	if err != nil || len(comments) != 0 {
		t.Fatalf("duplicate leaked comments: %#v %v", comments, err)
	}
	if _, _, err := s.Content(viewer, children[0].ID, 0); !errors.Is(err, ErrDenied) {
		t.Fatalf("duplicate leaked source ACL: %v", err)
	}

	formats := []string{"text", "markdown", "html", "json"}
	for _, format := range formats {
		exported, err := s.ExportDocument(owner, doc.ID, format, 1)
		if err != nil {
			t.Fatalf("export %s: %v", format, err)
		}
		if exported.SourceHash != doc.Hash || exported.SHA256 != hashBytes(exported.Body) || exported.Version != 1 {
			t.Fatalf("export evidence %s: %#v", format, exported)
		}
		switch format {
		case "text", "markdown":
			if string(exported.Body) != "Hello <world>" {
				t.Fatalf("export content %s: %q", format, exported.Body)
			}
		case "html":
			if !strings.Contains(string(exported.Body), "Hello &lt;world&gt;") || strings.Contains(string(exported.Body), "Hello <world>") {
				t.Fatalf("unsafe html export: %s", exported.Body)
			}
		case "json":
			var envelope map[string]any
			if err := json.Unmarshal(exported.Body, &envelope); err != nil || envelope["content"] != "Hello <world>" || envelope["sourceHash"] != doc.Hash {
				t.Fatalf("json export: %#v %v", envelope, err)
			}
		}
	}

	if _, err := s.RevokeGrant(owner, archive.ID, grant.ID); err != nil {
		t.Fatal(err)
	}
}

func TestDuplicateObjectRollsBackWhenPersistenceFails(t *testing.T) {
	s := testService(t, nil)
	ctx := context.Background()
	folder, err := s.Create(ctx, owner, CreateObjectRequest{Kind: KindFolder, Name: "Source"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, owner, CreateObjectRequest{ParentID: folder.ID, Kind: KindDoc, Name: "Doc", MIME: "text/plain", Content: []byte("durable")}); err != nil {
		t.Fatal(err)
	}
	objectsBefore := len(s.state.Objects)
	versionsBefore := len(s.state.Versions)
	auditBefore := len(s.state.Audit)
	s.cfg.StatePath = t.TempDir()

	if _, err := s.DuplicateObject(owner, folder.ID, DuplicateObjectRequest{Name: "Copy"}); err == nil {
		t.Fatal("duplicate unexpectedly succeeded with an unwritable state target")
	}
	if len(s.state.Objects) != objectsBefore || len(s.state.Versions) != versionsBefore || len(s.state.Audit) != auditBefore {
		t.Fatalf("failed duplicate changed state: objects %d/%d versions %d/%d audit %d/%d", len(s.state.Objects), objectsBefore, len(s.state.Versions), versionsBefore, len(s.state.Audit), auditBefore)
	}
}

func TestCloudStateV1MigratesCommentThreadsToV2(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "state.json")
	state := newState()
	state.SchemaVersion = 1
	state.Comments["obj_legacy"] = []Comment{{ID: "comment_legacy", ObjectID: "obj_legacy", Version: 1, Author: owner, Body: "legacy", CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}}
	if err := saveState(statePath, &state); err != nil {
		t.Fatal(err)
	}

	service, err := New(Config{StatePath: statePath, ObjectDir: filepath.Join(dir, "objects"), WalletVerifier: acceptWallet{}, AIProvider: fakeAI{}})
	if err != nil {
		t.Fatal(err)
	}
	if service.state.SchemaVersion != CurrentStateSchemaVersion {
		t.Fatalf("schema version = %d", service.state.SchemaVersion)
	}
	comments := service.state.Comments["obj_legacy"]
	if len(comments) != 1 || comments[0].ThreadID != comments[0].ID {
		t.Fatalf("legacy thread migration: %#v", comments)
	}

	reloaded, err := loadState(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.SchemaVersion != CurrentStateSchemaVersion || reloaded.Comments["obj_legacy"][0].ThreadID != "comment_legacy" {
		t.Fatalf("migration was not persisted: %#v", reloaded.Comments["obj_legacy"])
	}
}
