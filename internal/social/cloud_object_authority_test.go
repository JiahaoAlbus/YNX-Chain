package social

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCloudAuthorityLiveRevocationAndExactBinding(t *testing.T) {
	s, now := testService(t)
	f := newFixture(t, 83)
	login, err := s.Login(signedLogin(t, s, f, now))
	if err != nil {
		t.Fatal(err)
	}
	group := GroupConversation{ID: "group_cloud_authority", Members: []string{login.Session.Account}}
	s.state.Groups[group.ID] = group
	machine := strings.Repeat("m", 32)
	a, err := NewCloudObjectAuthority(s, machine)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServerWithCloudObjects(s, nil, a)
	if err != nil {
		t.Fatal(err)
	}
	binding := CloudObjectBinding{ConversationID: group.ID, ObjectID: "object_cloud_test", Operation: "object.read"}
	token, grant, err := a.Issue(login.Session, binding)
	if err != nil {
		t.Fatal(err)
	}
	if grant.Audience != cloudObjectAudience || grant.UploadID != "" || strings.Contains(token, login.Session.Account) {
		t.Fatal("invalid grant boundary")
	}
	call := func(auth, operation, object, upload string) int {
		body, _ := json.Marshal(map[string]any{"version": 1, "capability": token, "operation": operation, "objectId": object, "uploadId": upload})
		r := httptest.NewRequest(http.MethodPost, "/internal/cloud-objects/authorize", bytes.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+auth)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w.Code
	}
	if got := call(machine, binding.Operation, binding.ObjectID, ""); got != 200 {
		t.Fatalf("valid grant: %d", got)
	}
	if got := call(login.Token, binding.Operation, binding.ObjectID, ""); got != 401 {
		t.Fatalf("Social token accepted: %d", got)
	}
	for _, change := range []CloudObjectBinding{
		{Operation: "object.delete", ObjectID: binding.ObjectID},
		{Operation: binding.Operation, ObjectID: "other_object"},
		{Operation: binding.Operation, ObjectID: binding.ObjectID, UploadID: "other_upload"},
	} {
		if got := call(machine, change.Operation, change.ObjectID, change.UploadID); got != 403 {
			t.Fatalf("changed binding accepted: %d", got)
		}
	}
	device := s.state.Devices[login.Session.DeviceID]
	device.Status = "revoked"
	s.state.Devices[device.ID] = device
	if got := call(machine, binding.Operation, binding.ObjectID, ""); got != 403 {
		t.Fatalf("revoked device: %d", got)
	}
	device.Status = "active"
	s.state.Devices[device.ID] = device
	group.Members = nil
	s.state.Groups[group.ID] = group
	if got := call(machine, binding.Operation, binding.ObjectID, ""); got != 403 {
		t.Fatalf("removed member: %d", got)
	}
	group.Members = []string{login.Session.Account}
	s.state.Groups[group.ID] = group
	s.cfg.Now = func() time.Time { return now.Add(3 * time.Minute) }
	if got := call(machine, binding.Operation, binding.ObjectID, ""); got != 403 {
		t.Fatalf("expired capability: %d", got)
	}
	s.cfg.Now = func() time.Time { return now }
	if err := s.RevokeSession(login.Session); err != nil {
		t.Fatal(err)
	}
	if got := call(machine, binding.Operation, binding.ObjectID, ""); got != 403 {
		t.Fatalf("revoked session: %d", got)
	}
}

func TestCloudAuthorityDisabledAndBindingValidation(t *testing.T) {
	s, _ := testService(t)
	if _, err := NewCloudObjectAuthority(s, "short"); err == nil {
		t.Fatal("weak machine credential accepted")
	}
	r := httptest.NewRequest(http.MethodPost, "/internal/cloud-objects/authorize", nil)
	w := httptest.NewRecorder()
	NewServer(s, nil).Handler().ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatalf("authority enabled by default: %d", w.Code)
	}
	for _, operation := range []string{"upload.create", "upload.status", "upload.part", "upload.complete", "upload.cancel", "object.delete"} {
		binding := CloudObjectBinding{ConversationID: "group_test", ObjectID: "object_test", Operation: operation}
		if validCloudBinding(binding) {
			t.Fatalf("missing upload accepted: %s", operation)
		}
		binding.UploadID = "upload_test"
		if !validCloudBinding(binding) {
			t.Fatalf("valid binding rejected: %s", operation)
		}
	}
}
