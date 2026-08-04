package main

import (
	"strings"
	"testing"
)

func TestRequiredBackupAuthenticationKey(t *testing.T) {
	t.Setenv(backupKeyEnv, "")
	if _, err := requiredBackupAuthenticationKey(); err == nil || !strings.Contains(err.Error(), backupKeyEnv) {
		t.Fatalf("missing backup authentication key was accepted: %v", err)
	}

	want := "ynx-finance-admin-test-backup-authentication-key-v1"
	t.Setenv(backupKeyEnv, want)
	got, err := requiredBackupAuthenticationKey()
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("backup authentication key changed: got %q", string(got))
	}
}
