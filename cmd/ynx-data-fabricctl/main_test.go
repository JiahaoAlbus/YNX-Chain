package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestExportSchemaRegistryWritesVerifiedArtifactAndRefusesSilentOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema-registry-v2.json")
	arguments := []string{"--output", path, "--generated-at", "2026-07-25T08:00:00Z"}
	if err := exportSchemaRegistry(arguments); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := datafabric.LoadSchemaRegistry(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if registry.Version() != "2.0" || len(registry.Definitions("")) != 102 {
		t.Fatalf("exported registry is incomplete: version=%s definitions=%d", registry.Version(), len(registry.Definitions("")))
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("unexpected registry permissions: %o", info.Mode().Perm())
	}
	if err := exportSchemaRegistry(arguments); err == nil {
		t.Fatal("schema registry export silently overwrote an existing artifact")
	}
	if err := exportSchemaRegistry(append(arguments, "--overwrite")); err != nil {
		t.Fatal(err)
	}
}

func TestWriteAtomicPublicFileRejectsSymlinkOutput(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.json")
	if err := os.WriteFile(target, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directory, "registry.json")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink creation is unavailable: %v", err)
	}
	if err := writeAtomicPublicFile(link, []byte("{\"registryVersion\":\"2.0\"}\n"), true); err == nil {
		t.Fatal("schema registry exporter accepted a symlink output")
	}
}
