package datafabric

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCommittedSchemaRegistryArtifactMatchesRuntimeSource(t *testing.T) {
	path := filepath.Join("..", "..", "schemas", "data-fabric", "schema-registry-v2.json")
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document SchemaRegistryDocument
	if err := json.Unmarshal(committed, &document); err != nil {
		t.Fatal(err)
	}
	generated, err := DefaultSchemaRegistry().MarshalDocument(document.GeneratedAt)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(committed, generated) {
		t.Fatal("committed schema registry artifact drifted from the runtime source")
	}
	loaded, err := LoadSchemaRegistry(bytes.NewReader(committed))
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Version() != DefaultSchemaRegistry().Version() {
		t.Fatalf("artifact registry version mismatch: %s", loaded.Version())
	}
}
