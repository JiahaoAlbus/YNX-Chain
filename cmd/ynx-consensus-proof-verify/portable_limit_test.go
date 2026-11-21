//go:build unix

package main

import "testing"

func TestPortableCatalogAdmitsOriginal448941MigrationLength(t *testing.T) {
	f := newPortableTestFixture(t, false)
	for i := range f.catalog.Files {
		if f.catalog.Files[i].Path == "context/migration.json" {
			f.catalog.Files[i].Bytes = "70298614"
		}
	}
	if _, err := decodePortableCatalog(transactionJSON(t, f.catalog), false); err != nil {
		t.Fatalf("retained migration length rejected before reading: %v", err)
	}
}
