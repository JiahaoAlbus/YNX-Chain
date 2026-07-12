package mutationfreeze

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestRuntimeMutationFreezePreservesReadsAndRestoresWrites(t *testing.T) {
	marker := t.TempDir() + "/freeze.json"
	var receivedBody string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, _ := io.ReadAll(r.Body)
		receivedBody = string(payload)
		w.WriteHeader(http.StatusNoContent)
	})
	handler := Wrap(next, marker)

	assertStatus(t, handler, http.MethodPost, "/governance/requests", `{}`, http.StatusNoContent)
	if err := os.WriteFile(marker, []byte(`{"transactionId":"test"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	assertStatus(t, handler, http.MethodGet, "/status", "", http.StatusNoContent)
	assertStatus(t, handler, http.MethodPost, "/governance/requests", `{}`, http.StatusServiceUnavailable)
	assertStatus(t, handler, http.MethodPost, "/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":[]}`, http.StatusServiceUnavailable)
	readPayload := `{"jsonrpc":"2.0","id":2,"method":"eth_getTransactionReceipt","params":["0x00"]}`
	assertStatus(t, handler, http.MethodPost, "/evm", readPayload, http.StatusNoContent)
	if receivedBody != readPayload {
		t.Fatalf("read-only EVM body was not restored: %q", receivedBody)
	}
	assertStatus(t, handler, http.MethodPost, "/evm", `{bad`, http.StatusServiceUnavailable)
	assertStatus(t, handler, http.MethodPost, "/v1/chat/completions", `{}`, http.StatusNoContent)
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	assertStatus(t, handler, http.MethodPost, "/trust/appeals", `{}`, http.StatusNoContent)
}

func TestFromEnvDefaultsDisabled(t *testing.T) {
	t.Setenv(EnvFile, "")
	handler := FromEnv(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) }))
	assertStatus(t, handler, http.MethodPost, "/transactions/broadcast", `{}`, http.StatusAccepted)
}

func assertStatus(t *testing.T, handler http.Handler, method, path, body string, want int) {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != want {
		t.Fatalf("%s %s returned %d, want %d: %s", method, path, recorder.Code, want, recorder.Body.String())
	}
	if want == http.StatusServiceUnavailable {
		if recorder.Header().Get("X-YNX-Mutation-Frozen") != "true" || recorder.Header().Get("Retry-After") != "5" {
			t.Fatalf("freeze response is missing retry headers: %v", recorder.Header())
		}
	}
}
