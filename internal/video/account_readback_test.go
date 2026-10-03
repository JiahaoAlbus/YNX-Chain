package video

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOriginalVideoAccountReadbackUsesAuthenticatedActor(t *testing.T) {
	service, _ := fixture(t, nil)
	handler := NewServer(service, StaticTokenAuth{Tokens: map[string]string{"a": "ynx1a", "b": "ynx1b"}}).Handler()
	for _, actor := range []string{"", "a", "b"} {
		req := httptest.NewRequest(http.MethodGet, "/v1/account", nil)
		if actor != "" {
			req.Header.Set("Authorization", "Bearer "+actor)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if actor == "" {
			if response.Code != 401 {
				t.Fatalf("guest account readback accepted: %d", response.Code)
			}
			continue
		}
		var result struct {
			SchemaVersion int    `json:"schemaVersion"`
			Account       string `json:"account"`
		}
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || result.SchemaVersion != 1 || result.Account != "ynx1"+actor {
			t.Fatalf("wrong actor readback: %d %s", response.Code, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private identity cached")
		}
	}
	if videoProductScopeV2("video", "GET", "/v1/account") != "video:account" {
		t.Fatal("account readback lost original account scope")
	}
}
