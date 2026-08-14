package datafabric

import (
	"bytes"
	"testing"
	"time"
)

func TestSchemaRegistryDocumentIsDeterministicAndStrictlyReloadable(t *testing.T) {
	registry := DefaultSchemaRegistry()
	generatedAt := time.Date(2026, 7, 25, 8, 0, 0, 0, time.UTC)
	first, err := registry.MarshalDocument(generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	second, err := registry.MarshalDocument(generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) || len(first) == 0 || first[len(first)-1] != '\n' {
		t.Fatal("schema registry document is not byte-for-byte reproducible")
	}
	loaded, err := LoadSchemaRegistry(bytes.NewReader(first))
	if err != nil {
		t.Fatal(err)
	}
	definitions := loaded.Definitions("")
	if loaded.Version() != "2.0" || len(definitions) != 102 {
		t.Fatalf("unexpected registry snapshot: version=%s definitions=%d", loaded.Version(), len(definitions))
	}
	for _, definition := range definitions {
		if definition.Version == EnvelopeSchemaVersionV2 {
			expectedCommit, expectedRelease := "9fc1986067b92f3dd2ea2347223d94e94cc06de9", "data-fabric-contract-v2"
			if definition.Product == "calendar" {
				expectedCommit, expectedRelease = "f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2", "calendar-canonical-event-v1"
			}
			if definition.SourceCommit != expectedCommit || definition.Release != expectedRelease {
				t.Fatalf("v2 schema provenance is stale: %+v", definition)
			}
		}
	}
}

func TestSchemaRegistryDocumentRejectsNonUTCBuildTime(t *testing.T) {
	registry := DefaultSchemaRegistry()
	if _, err := registry.MarshalDocument(time.Now()); err == nil {
		t.Fatal("non-UTC schema registry build time was accepted")
	}
}
