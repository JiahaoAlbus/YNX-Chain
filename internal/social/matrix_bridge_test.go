package social

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMatrixBridgeBindingAndRejection(t *testing.T) {
	account := "ynx1" + strings.Repeat("a", 38)
	const historicalUser = "@original-historical-user:qa.test"
	user := historicalUser
	device := "YNX-test-device"
	granted := true
	hs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic-local-test-token" {
			w.WriteHeader(401)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"user_id": user, "device_id": device})
	}))
	defer hs.Close()
	directory := &MatrixDirectory{identities: map[string]MatrixIdentity{account: {Account: account, Homeserver: hs.URL + "/", ServerName: "qa.test", UserID: historicalUser}}}
	bridge := MatrixBridge{LocalQA: true, Directory: directory, Authorize: func(r *http.Request, scopes []string) (string, error) {
		if len(scopes) != 2 || !granted {
			return "", errors.New("denied")
		}
		return account, nil
	}, Resolve: func(context.Context, string) (MatrixServer, error) { return MatrixServer{hs.URL + "/", "qa.test"}, nil }, Issue: func(context.Context, string, string, MatrixServer) (MatrixCredential, error) {
		return MatrixCredential{"synthetic-local-test-token", time.Now().Add(time.Minute)}, nil
	}}
	call := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		bridge.ServeHTTP(w, httptest.NewRequest("POST", "/social/v3/matrix/session", strings.NewReader(body)))
		return w
	}
	if w := call(`{"deviceId":"YNX-test-device"}`); w.Code != 200 {
		t.Fatal(w.Code)
	}
	user = "@attacker:qa.test"
	if w := call(`{"deviceId":"YNX-test-device"}`); w.Code != 401 || strings.Contains(w.Body.String(), "synthetic-local-test-token") {
		t.Fatal("issuer substitution accepted or token disclosed")
	}
	user = historicalUser
	granted = false
	if w := call(`{"deviceId":"YNX-test-device"}`); w.Code != 401 {
		t.Fatal("unapproved identity accepted")
	}
	granted = true
	if w := call(`{"deviceId":"YNX-test-device","account":"attacker"}`); w.Code != 400 {
		t.Fatal("client account accepted")
	}
	bridge.LocalQA = false
	if w := call(`{"deviceId":"YNX-test-device"}`); w.Code != 503 {
		t.Fatal("insecure production server accepted")
	}
}
