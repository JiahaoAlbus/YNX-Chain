package productstore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRoundTripBackupAndTamperFailClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	want := struct {
		Value string `json:"value"`
	}{Value: "first"}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Value string `json:"value"`
	}
	if legacy, err := Load(path, &got); err != nil || legacy || got != want {
		t.Fatalf("load=(%v,%v,%+v)", legacy, err, got)
	}
	want.Value = "second"
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".bak"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	b = []byte(strings.Replace(string(b), "second", "broken", 1))
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path, &got); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("expected integrity failure, got %v", err)
	}
	if err := RestoreBackup(path, &got); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path, &got); err != nil || got.Value != "first" {
		t.Fatalf("recovery=%+v err=%v", got, err)
	}
}

func TestUnknownEnvelopeFieldFailsClosed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte(`{"envelopeVersion":1,"payload":{},"payloadSha256":"0000000000000000000000000000000000000000000000000000000000000000","extra":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if _, err := Load(path, &got); err == nil {
		t.Fatal("unknown field accepted")
	}
}
