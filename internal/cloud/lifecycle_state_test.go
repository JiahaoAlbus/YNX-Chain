package cloud

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestLifecycleStateRejectsInvalidVersionClassWithValidIntegrity(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects")}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "invalid-tier.bin", Content: []byte("x")})
	if err != nil {
		t.Fatal(err)
	}
	state := service.state
	versions := state.Versions[object.ID]
	versions[0].StorageClass = StorageClass("unknown-tier")
	state.Versions[object.ID] = versions
	state.Objects[object.ID] = Object{ID: object.ID, Product: object.Product, Owner: object.Owner, Kind: object.Kind, Name: object.Name, Size: object.Size, Hash: object.Hash, Version: object.Version, CreatedAt: object.CreatedAt, UpdatedAt: object.UpdatedAt, ScanStatus: object.ScanStatus, StorageClass: StorageClass("unknown-tier"), StorageClassVersion: 1, StorageReadMode: StorageReadImmediate}
	if err := saveState(cfg.StatePath, &state); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "storage lifecycle") {
		t.Fatalf("invalid lifecycle class was accepted: %v", err)
	}
}

func TestLifecycleStateRejectsPendingTransitionWithCompletionEvidence(t *testing.T) {
	dir := t.TempDir()
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}}
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "transition.bin", Content: []byte("transition")})
	if err != nil {
		t.Fatal(err)
	}
	transition, err := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassCold)
	if err != nil {
		t.Fatal(err)
	}
	state := service.state
	transition.Status = "pending"
	state.StorageTransitions[transition.ID] = transition
	if err := saveState(cfg.StatePath, &state); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "invalid pending truth") {
		t.Fatalf("pending transition with completion evidence was accepted: %v", err)
	}
}

func TestLifecycleStateRejectsMaterialObjectWithoutVersion(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects")}
	state := newState()
	state.Objects["missing-version"] = Object{
		ID:                  "missing-version",
		Product:             "cloud",
		Owner:               owner,
		Kind:                KindFile,
		Name:                "missing.bin",
		Size:                1,
		Hash:                hashBytes([]byte("x")),
		Version:             1,
		StorageClass:        StorageClassHot,
		StorageClassVersion: 1,
		StorageReadMode:     StorageReadImmediate,
	}
	if err := saveState(cfg.StatePath, &state); err != nil {
		t.Fatal(err)
	}
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "current storage version missing") {
		t.Fatalf("material object without version was accepted: %v", err)
	}
}
