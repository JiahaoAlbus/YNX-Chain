package main

import "testing"

func TestValidatePostgresTLSDSNRequiresVerifiedURITransport(t *testing.T) {
	valid := "postgresql://fabric:private@postgres.data-fabric.test:5432/ynx_fabric?sslmode=verify-full"
	if err := validatePostgresTLSDSN(valid); err != nil {
		t.Fatalf("verified PostgreSQL URI rejected: %v", err)
	}
	for _, dsn := range []string{
		"postgresql://postgres.data-fabric.test/ynx_fabric",
		"postgresql://postgres.data-fabric.test/ynx_fabric?sslmode=require",
		"postgresql://postgres.data-fabric.test/ynx_fabric?sslmode=verify-full&sslmode=disable",
		"postgresql:///ynx_fabric?sslmode=verify-full",
		"host=postgres.data-fabric.test sslmode=verify-full",
		" postgresql://postgres.data-fabric.test/ynx_fabric?sslmode=verify-full",
	} {
		if err := validatePostgresTLSDSN(dsn); err == nil {
			t.Fatalf("unsafe PostgreSQL DSN accepted: %q", dsn)
		}
	}
}
