package indexer

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicStatusDoesNotExposeInternalSyncFailure(t *testing.T) {
	idx, err := New(Config{
		RPCURL:    "http://127.0.0.1:1/private-chain-rpc",
		StorePath: t.TempDir() + "/index.json",
	})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(idx)
	if _, err := server.SyncOnce(context.Background()); err == nil {
		t.Fatal("expected the private chain dependency to be unavailable")
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	for _, path := range []string{"/health", "/ynx/overview", "/sync"} {
		method := http.MethodGet
		if path == "/sync" {
			method = http.MethodPost
		}
		request, err := http.NewRequest(method, httpServer.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		text := string(body)
		for _, secret := range []string{"127.0.0.1", "private-chain-rpc", "connection refused"} {
			if strings.Contains(text, secret) {
				t.Fatalf("%s exposed internal failure detail %q: %s", path, secret, text)
			}
		}
		if response.StatusCode < 400 || (!strings.Contains(text, `"code"`) && !strings.Contains(text, `"lastErrorCode":"chain_rpc_unavailable"`)) {
			t.Fatalf("%s did not fail closed with a bounded status: code=%d body=%s", path, response.StatusCode, text)
		}
	}
}
