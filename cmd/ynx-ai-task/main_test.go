package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIndependentTaskCLIActualReadAndMutationJournal(t *testing.T) {
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		if r.Header.Get("X-YNX-Product-Session-Proof-V2") != "PUBLIC-private-proof" {
			t.Error("proof not conveyed")
		}
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"id":"task_original","status":"DRAFT"}`))
	}))
	defer peer.Close()
	var out, diagnostics bytes.Buffer
	if err := run(context.Background(), []string{"-daemon", peer.URL}, &out, &diagnostics); err != nil || !strings.Contains(out.String(), `"ok":true`) {
		t.Fatal(err)
	}
	directory := t.TempDir()
	proof := filepath.Join(directory, "proof")
	body := filepath.Join(directory, "request")
	_ = os.WriteFile(proof, []byte("PUBLIC-private-proof\n"), 0600)
	_ = os.WriteFile(body, []byte(`{"conversationId":"conv_original"}`), 0600)
	args := []string{"-action", "task-create", "-daemon", peer.URL, "-proof-file", proof, "-data-file", body, "-journal", filepath.Join(directory, "journal"), "-operation", "original-create"}
	out.Reset()
	diagnostics.Reset()
	if err := run(context.Background(), args, &out, &diagnostics); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(diagnostics.String(), "PUBLIC-private-proof") || strings.Contains(diagnostics.String(), "conv_original") {
		t.Fatal("credential/body in diagnostics")
	}
	if err := run(context.Background(), args, &out, &diagnostics); err == nil {
		t.Fatal("CLI resent original create")
	}
	out.Reset()
	if err := run(context.Background(), []string{"-action", "operation-show", "-journal", filepath.Join(directory, "journal"), "-operation", "original-create"}, &out, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var record map[string]any
	if json.Unmarshal(out.Bytes(), &record) != nil || record["taskId"] != "task_original" || record["state"] != "RESPONSE_RECEIVED" {
		t.Fatal("lost original task lookup")
	}
}
func TestIndependentTaskCLILocalInspectionNeverNetwork(t *testing.T) {
	path := filepath.Join(t.TempDir(), "actual.txt")
	_ = os.WriteFile(path, []byte("real file"), 0600)
	var out, diagnostics bytes.Buffer
	if err := run(context.Background(), []string{"-action", "inspect-file", "-file", path, "-daemon", "not-a-server"}, &out, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if json.Unmarshal(out.Bytes(), &result) != nil || result["bytes"] != float64(9) || result["taskGrant"] != false || result["modelDisclosed"] != false {
		t.Fatal("local file result confused with task authority")
	}
}
