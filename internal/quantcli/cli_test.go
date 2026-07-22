package quantcli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

func TestReadsAndExplicitlyApprovedMutations(t *testing.T) {
	var method, path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()
	var out bytes.Buffer
	cli := CLI{BaseURL: server.URL, Client: server.Client(), Out: &out}
	if err := cli.Run([]string{"health"}); err != nil || method != "GET" || path != "/health" || !strings.Contains(out.String(), `"ok"`) {
		t.Fatalf("read method=%s path=%s err=%v out=%s", method, path, err, out.String())
	}
	if err := cli.Run([]string{"kill", "operator test"}); err != ErrUsage {
		t.Fatalf("unapproved=%v", err)
	}
	if err := cli.Run([]string{"kill", "--approve", "operator test"}); err != nil || method != "POST" || path != "/v1/risk/kill" {
		t.Fatalf("kill method=%s path=%s err=%v", method, path, err)
	}
}

func TestBackupRequiresApprovalAndProducesVerifiedRecord(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")
	backupPath := filepath.Join(root, "backup.json")
	service, _ := quantlab.New(quantlab.Config{StatePath: statePath})
	if _, err := service.Kill("CLI backup fixture"); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	cli := CLI{StatePath: statePath, Out: &out}
	if err := cli.Run([]string{"backup", backupPath}); err != ErrUsage {
		t.Fatalf("unapproved=%v", err)
	}
	if err := cli.Run([]string{"backup", "--approve", backupPath}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"sha256"`) || !strings.Contains(out.String(), `"schema": 1`) {
		t.Fatalf("record=%s", out.String())
	}
}

func TestDeleteLocalDataRequiresExactConfirmation(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")
	service, _ := quantlab.New(quantlab.Config{StatePath: statePath})
	if _, err := service.Kill("CLI deletion fixture"); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	cli := CLI{StatePath: statePath, Out: &out}
	if err := cli.Run([]string{"delete-local-data", "--approve", "delete"}); err != quantlab.ErrForbidden {
		t.Fatalf("weak confirmation=%v", err)
	}
	if err := cli.Run([]string{"delete-local-data", "--approve", "DELETE ALL LOCAL QUANT DATA"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"previousDigest"`) {
		t.Fatalf("record=%s", out.String())
	}
}

func TestMutationRejectsNonLoopback(t *testing.T) {
	cli := CLI{BaseURL: "https://quant.example.invalid"}
	if err := cli.Run([]string{"kill", "--approve", "operator test"}); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("err=%v", err)
	}
}
