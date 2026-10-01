package social

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestCloudObjectRegistryPersistenceOwnershipAndIntegrity(t *testing.T) {
	s, now := testService(t)
	s.cfg.RateLimitMax = 100
	f := newFixture(t, 87)
	alice, err := s.Login(signedLogin(t, s, f, now))
	if err != nil {
		t.Fatal(err)
	}
	f = newFixture(t, 88)
	bob, err := s.Login(signedLogin(t, s, f, now))
	if err != nil {
		t.Fatal(err)
	}
	group := GroupConversation{ID: "group_registry_test", Members: []string{alice.Session.Account, bob.Session.Account}}
	s.state.Groups[group.ID] = group
	newServer := func() *Server {
		a, err := NewCloudObjectAuthority(s, strings.Repeat("m", 32))
		if err != nil {
			t.Fatal(err)
		}
		server, err := NewServerWithCloudObjects(s, nil, a)
		if err != nil {
			t.Fatal(err)
		}
		return server
	}
	server := newServer()
	call := func(token, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	input := `{"conversationId":"group_registry_test","idempotencyKey":"registry_test","totalCiphertextBytes":123,"sha256":"` + strings.Repeat("a", 64) + `"}`
	w := call(alice.Token, "/social/v1/cloud-objects", input)
	if w.Code != 201 {
		t.Fatalf("register %d %s", w.Code, w.Body)
	}
	first := append([]byte(nil), w.Body.Bytes()...)
	var record struct {
		ObjectID string `json:"objectId"`
	}
	if err := json.Unmarshal(first, &record); err != nil {
		t.Fatal(err)
	}
	server = newServer()
	w = call(alice.Token, "/social/v1/cloud-objects", input)
	if w.Code != 200 || !bytes.Equal(first, w.Body.Bytes()) {
		t.Fatalf("registry restart lost idempotency: %d %s", w.Code, w.Body)
	}
	w = call(alice.Token, "/social/v1/cloud-objects", strings.Replace(input, ":123", ":124", 1))
	if w.Code != 409 {
		t.Fatalf("changed immutable metadata accepted: %d", w.Code)
	}
	path := "/social/v1/cloud-objects/" + record.ObjectID + "/capability"
	for _, op := range []string{"upload.create", "upload.part", "object.delete"} {
		w = call(bob.Token, path, `{"operation":"`+op+`"}`)
		if w.Code != 403 && w.Code != 401 {
			t.Fatalf("recipient obtained %s: %d", op, w.Code)
		}
	}
	w = call(bob.Token, path, `{"operation":"object.read"}`)
	if w.Code != 200 {
		t.Fatalf("recipient read grant failed: %d %s", w.Code, w.Body)
	}
	group.Members = []string{alice.Session.Account}
	s.state.Groups[group.ID] = group
	w = call(bob.Token, path, `{"operation":"object.read"}`)
	if w.Code != 403 && w.Code != 401 {
		t.Fatalf("removed member minted grant: %d", w.Code)
	}
	registryPath := s.cfg.StatePath + ".cloud-objects.json"
	data, err := os.ReadFile(registryPath)
	if err != nil {
		t.Fatal(err)
	}
	data = bytes.Replace(data, []byte(`"totalCiphertextBytes":123`), []byte(`"totalCiphertextBytes":124`), 1)
	if err := os.WriteFile(registryPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	w = call(alice.Token, path, `{"operation":"upload.status"}`)
	if w.Code != 503 {
		t.Fatalf("tampered registry did not fail closed: %d", w.Code)
	}
}

func TestCloudAuthorityPrimaryIdentifiers(t *testing.T) {
	for _, op := range []string{"upload.create", "upload.status", "upload.part", "upload.complete", "upload.cancel", "object.read", "object.delete"} {
		g := CloudObjectGrant{CloudObjectBinding: CloudObjectBinding{Operation: op, ObjectID: "object_test", UploadID: "upload_test"}}
		if matchesCloudRequest(g, op, "", "") {
			t.Fatalf("missing primary accepted: %s", op)
		}
		if matchesCloudRequest(g, op, "other_object", "upload_test") || matchesCloudRequest(g, op, "object_test", "other_upload") {
			t.Fatalf("wrong optional identifier accepted: %s", op)
		}
		if matchesCloudRequest(g, "unknown", "object_test", "upload_test") {
			t.Fatal("operation substitution accepted")
		}
		if !matchesCloudRequest(g, op, "object_test", "upload_test") {
			t.Fatalf("complete binding rejected: %s", op)
		}
	}
}
