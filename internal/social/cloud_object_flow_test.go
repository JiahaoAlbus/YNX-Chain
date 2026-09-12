//go:build social_cloud_integration

package social

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
)

// Run with the exact Cloud owner's social_attachments.go supplied by go overlay.
// Uses real HTTP authorizer callbacks, not a fake Cloud grant implementation.
func TestCloudObjectCrossServiceResumeAndRecipientRead(t *testing.T) {
	s, now := testService(t)
	s.cfg.RateLimitMax = 100
	login := func(seed byte) LoginResult {
		f := newFixture(t, seed)
		result, err := s.Login(signedLogin(t, s, f, now))
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	alice, bob := login(85), login(86)
	group := GroupConversation{ID: "group_cloud_flow", Members: []string{alice.Session.Account, bob.Session.Account}}
	s.state.Groups[group.ID] = group
	machine := strings.Repeat("m", 32)
	authority, err := NewCloudObjectAuthority(s, machine)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServerWithCloudObjects(s, nil, authority)
	if err != nil {
		t.Fatal(err)
	}
	socialHTTP := httptest.NewTLSServer(server.Handler())
	defer socialHTTP.Close()
	call := func(client *http.Client, method, url, token string, body []byte, headers map[string]string) (int, []byte) {
		r, err := http.NewRequest(method, url, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			r.Header.Set(key, value)
		}
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, data
	}
	// Synthetic ciphertext exercises storage transport; cryptographic rendering
	// acceptance is a separate client check, not claimed by this backend test.
	ciphertext := bytes.Repeat([]byte{0xa7}, int(cloud.SocialPartBytes)+37)
	hash := func(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
	registration, _ := json.Marshal(map[string]any{"conversationId": group.ID, "idempotencyKey": "attachment_flow_test", "totalCiphertextBytes": len(ciphertext), "sha256": hash(ciphertext)})
	status, body := call(socialHTTP.Client(), "POST", socialHTTP.URL+"/social/v1/cloud-objects", alice.Token, registration, nil)
	if status != 201 {
		t.Fatalf("register %d: %s", status, body)
	}
	var record cloud.SocialUploadRequest
	if err := json.Unmarshal(body, &record); err != nil {
		t.Fatal(err)
	}
	status, retried := call(socialHTTP.Client(), "POST", socialHTTP.URL+"/social/v1/cloud-objects", alice.Token, registration, nil)
	if status != 200 || !bytes.Equal(body, retried) {
		t.Fatalf("registration not idempotent: %d %s", status, retried)
	}
	root := filepath.Join(t.TempDir(), "ciphertext")
	config := cloud.SocialAttachmentConfig{Root: root, Authorizer: cloud.RemoteSocialObjectAuthorizer{BaseURL: socialHTTP.URL, Token: machine, Client: socialHTTP.Client()}, Now: s.cfg.Now}
	store, err := cloud.NewSocialAttachmentStore(config)
	if err != nil {
		t.Fatal(err)
	}
	cloudHTTP := httptest.NewServer(store.Handler())
	defer func() { cloudHTTP.Close() }()
	capability := func(session LoginResult, op string) string {
		payload, _ := json.Marshal(map[string]string{"operation": op})
		status, data := call(socialHTTP.Client(), "POST", socialHTTP.URL+"/social/v1/cloud-objects/"+record.ObjectID+"/capability", session.Token, payload, nil)
		if status != 200 {
			t.Fatalf("mint %s %d: %s", op, status, data)
		}
		var result struct {
			Capability string `json:"capability"`
		}
		if err := json.Unmarshal(data, &result); err != nil {
			t.Fatal(err)
		}
		return result.Capability
	}
	base := func() string { return cloudHTTP.URL + "/api/v1/social-attachments" }
	input, _ := json.Marshal(record)
	status, body = call(http.DefaultClient, "POST", base()+"/uploads", capability(alice, "upload.create"), input, nil)
	if status != 201 {
		t.Fatalf("create %d: %s", status, body)
	}
	part := ciphertext[:int(cloud.SocialPartBytes)]
	status, body = call(http.DefaultClient, "PUT", base()+"/uploads/"+record.UploadID+"/parts/1", capability(alice, "upload.part"), part, map[string]string{"X-Ciphertext-SHA256": hash(part)})
	if status != 200 {
		t.Fatalf("first part %d: %s", status, body)
	}
	cloudHTTP.Close()
	store, err = cloud.NewSocialAttachmentStore(config)
	if err != nil {
		t.Fatal(err)
	}
	cloudHTTP = httptest.NewServer(store.Handler())
	status, body = call(http.DefaultClient, "GET", base()+"/uploads/"+record.UploadID, capability(alice, "upload.status"), nil, nil)
	if status != 200 || !bytes.Contains(body, []byte(`"partNumber":1`)) {
		t.Fatalf("restart status %d: %s", status, body)
	}
	part = ciphertext[int(cloud.SocialPartBytes):]
	status, body = call(http.DefaultClient, "PUT", base()+"/uploads/"+record.UploadID+"/parts/2", capability(alice, "upload.part"), part, map[string]string{"X-Ciphertext-SHA256": hash(part)})
	if status != 200 {
		t.Fatalf("second part %d: %s", status, body)
	}
	status, body = call(http.DefaultClient, "POST", base()+"/uploads/"+record.UploadID+"/complete", capability(alice, "upload.complete"), nil, nil)
	if status != 201 {
		t.Fatalf("complete %d: %s", status, body)
	}
	readToken := capability(bob, "object.read")
	status, body = call(http.DefaultClient, "GET", base()+"/objects/"+record.ObjectID, readToken, nil, nil)
	if status != 200 || !bytes.Equal(body, ciphertext) {
		t.Fatalf("recipient ciphertext differs: %d", status)
	}
	status, body = call(http.DefaultClient, "GET", base()+"/objects/"+record.ObjectID, readToken, nil, map[string]string{"Range": "bytes=1-15"})
	if status != 206 || !bytes.Equal(body, ciphertext[1:16]) {
		t.Fatalf("range mismatch: %d", status)
	}
	group.Members = []string{alice.Session.Account}
	s.state.Groups[group.ID] = group
	status, _ = call(http.DefaultClient, "GET", base()+"/objects/"+record.ObjectID, readToken, nil, nil)
	if status != 403 {
		t.Fatalf("removed member's existing grant accepted: %d", status)
	}
	status, body = call(http.DefaultClient, "DELETE", base()+"/objects/"+record.ObjectID, capability(alice, "object.delete"), nil, nil)
	if status != 200 {
		t.Fatalf("delete %d: %s", status, body)
	}
	// A distinct unfinished upload exercises explicit cancellation, not deletion.
	registration, _ = json.Marshal(map[string]any{"conversationId": group.ID, "idempotencyKey": "attachment_cancel_test", "totalCiphertextBytes": len(ciphertext), "sha256": hash(ciphertext)})
	status, body = call(socialHTTP.Client(), "POST", socialHTTP.URL+"/social/v1/cloud-objects", alice.Token, registration, nil)
	if status != 201 {
		t.Fatalf("cancel registration %d: %s", status, body)
	}
	if err := json.Unmarshal(body, &record); err != nil {
		t.Fatal(err)
	}
	input, _ = json.Marshal(record)
	status, body = call(http.DefaultClient, "POST", base()+"/uploads", capability(alice, "upload.create"), input, nil)
	if status != 201 {
		t.Fatalf("cancel create %d: %s", status, body)
	}
	status, body = call(http.DefaultClient, "DELETE", base()+"/uploads/"+record.UploadID, capability(alice, "upload.cancel"), nil, nil)
	if status != 200 {
		t.Fatalf("cancel %d: %s", status, body)
	}
	status, _ = call(http.DefaultClient, "POST", base()+"/uploads/"+record.UploadID+"/complete", capability(alice, "upload.complete"), nil, nil)
	if status != 409 {
		t.Fatalf("cancelled upload completed: %d", status)
	}
}
