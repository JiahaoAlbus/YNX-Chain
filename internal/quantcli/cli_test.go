package quantcli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func TestMutationRejectsNonLoopback(t *testing.T) {
	cli := CLI{BaseURL: "https://quant.example.invalid"}
	if err := cli.Run([]string{"kill", "--approve", "operator test"}); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("err=%v", err)
	}
}
