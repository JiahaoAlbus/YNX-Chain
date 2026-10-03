package social

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMatrixBridgeMissingHistoricalIdentityNeverDerivesOrIssues(t *testing.T) {
	account := "ynx1" + strings.Repeat("a", 38)
	issued := 0
	bridge := MatrixBridge{Directory: &MatrixDirectory{identities: map[string]MatrixIdentity{}}, Authorize: func(*http.Request, []string) (string, error) { return account, nil }, Issue: func(context.Context, string, string, MatrixServer) (MatrixCredential, error) {
		issued++
		return MatrixCredential{}, nil
	}}
	for _, directory := range []*MatrixDirectory{nil, bridge.Directory} {
		bridge.Directory = directory
		response := httptest.NewRecorder()
		bridge.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/social/v3/matrix/session", strings.NewReader(`{"deviceId":"original-device"}`)))
		if response.Code != http.StatusServiceUnavailable || issued != 0 || strings.Contains(response.Body.String(), "@"+account) {
			t.Fatal("missing historical identity was derived or issued")
		}
	}
}

func TestMatrixBridgeRejectsResolverRetargetBeforeCredentialIssue(t *testing.T) {
	account := "ynx1" + strings.Repeat("b", 38)
	directory, err := ParseMatrixDirectory(strings.NewReader(`{"schemaVersion":"ynx-social-matrix-directory/v1","bindings":[{"account":"` + account + `","homeserver":"https://original.example.test/","serverName":"original.example.test","userId":"@historical-user:original.example.test"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	issued := false
	bridge := MatrixBridge{Directory: directory, Authorize: func(*http.Request, []string) (string, error) { return account, nil }, Resolve: func(context.Context, string) (MatrixServer, error) {
		return MatrixServer{BaseURL: "https://replacement.example.test/", ServerName: "replacement.example.test"}, nil
	}, Issue: func(context.Context, string, string, MatrixServer) (MatrixCredential, error) {
		issued = true
		return MatrixCredential{}, nil
	}}
	response := httptest.NewRecorder()
	bridge.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/social/v3/matrix/session", strings.NewReader(`{"deviceId":"original-device"}`)))
	if response.Code != http.StatusServiceUnavailable || issued {
		t.Fatal("resolver silently replaced historical HS before issuing")
	}
}
