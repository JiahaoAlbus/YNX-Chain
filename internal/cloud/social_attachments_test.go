package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type socialAuthorizerFixture struct {
	now          func() time.Time
	denied       bool
	conversation string
	calls        int
}

func (a *socialAuthorizerFixture) Authorize(_ context.Context, r SocialAuthorizationRequest) (SocialObjectGrant, error) {
	a.calls++
	if a.denied {
		return SocialObjectGrant{}, ErrDenied
	}
	conversation := a.conversation
	if conversation == "" {
		conversation = "conversation-001"
	}
	upload := "upload-00000001"
	if r.Operation == "object.read" {
		upload = ""
	}
	return SocialObjectGrant{Version: 1, Product: "social", Audience: SocialObjectAudience, Subject: "private-social-account", DeviceID: "device-001", ConversationID: conversation, ObjectID: "object-00000001", UploadID: upload, Operation: r.Operation, ExpiresAt: a.now().Add(30 * time.Second)}, nil
}
func socialRequest(h http.Handler, method, route string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/v1/social-attachments"+route, bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer ynx-social-object-v1.test-only-fixture")
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func socialSetup(t *testing.T) (*SocialAttachmentStore, *socialAuthorizerFixture, *time.Time) {
	t.Helper()
	now := time.Date(2026, 9, 12, 0, 0, 0, 0, time.UTC)
	authority := &socialAuthorizerFixture{now: func() time.Time { return now }}
	store, err := NewSocialAttachmentStore(SocialAttachmentConfig{Root: filepath.Join(t.TempDir(), "ciphertext"), Authorizer: authority, Now: authority.now})
	if err != nil {
		t.Fatal(err)
	}
	return store, authority, &now
}
func socialCreate(t *testing.T, handler http.Handler, body []byte, hash string) {
	t.Helper()
	b, _ := json.Marshal(SocialUploadRequest{ObjectID: "object-00000001", UploadID: "upload-00000001", ConversationID: "conversation-001", TotalCiphertextBytes: int64(len(body)), SHA256: hash})
	w := socialRequest(handler, "POST", "/uploads", b, nil)
	if w.Code != 201 && w.Code != 200 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "private-social-account") || strings.Contains(w.Body.String(), "subject") {
		t.Fatal("private identity leaked")
	}
}
func socialParts(t *testing.T, h http.Handler, data []byte) {
	t.Helper()
	for offset, n := 0, 1; offset < len(data); n++ {
		end := offset + int(SocialPartBytes)
		if end > len(data) {
			end = len(data)
		}
		part := data[offset:end]
		w := socialRequest(h, "PUT", "/uploads/upload-00000001/parts/"+string(rune('0'+n)), part, map[string]string{"X-Ciphertext-SHA256": socialDigest(part)})
		if w.Code != 200 {
			t.Fatalf("part: %d %s", w.Code, w.Body.String())
		}
		offset = end
	}
}
func TestSocialCiphertextResumeCompleteRangeAndLiveRevocation(t *testing.T) {
	store, authority, _ := socialSetup(t)
	h := store.Handler()
	data := bytes.Repeat([]byte{0xc7}, int(SocialPartBytes)+37)
	socialCreate(t, h, data, socialDigest(data))
	first := data[:SocialPartBytes]
	w := socialRequest(h, "PUT", "/uploads/upload-00000001/parts/1", first, map[string]string{"X-Ciphertext-SHA256": socialDigest(first)})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	restarted, err := NewSocialAttachmentStore(store.cfg)
	if err != nil {
		t.Fatal(err)
	}
	h = restarted.Handler()
	w = socialRequest(h, "GET", "/uploads/upload-00000001", nil, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "acceptedParts") {
		t.Fatal(w.Body.String())
	}
	socialParts(t, h, data)
	w = socialRequest(h, "POST", "/uploads/upload-00000001/complete", nil, nil)
	if w.Code != 201 {
		t.Fatalf("complete: %d %s", w.Code, w.Body.String())
	}
	w = socialRequest(h, "POST", "/uploads/upload-00000001/complete", nil, nil)
	if w.Code != 200 {
		t.Fatal("completion is not idempotent")
	}
	w = socialRequest(h, "GET", "/objects/object-00000001", nil, map[string]string{"Range": "bytes=1048576-1048612"})
	if w.Code != 206 || !bytes.Equal(w.Body.Bytes(), data[SocialPartBytes:]) {
		t.Fatalf("range: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatal("private ciphertext response headers")
	}
	before := authority.calls
	authority.denied = true
	w = socialRequest(h, "GET", "/objects/object-00000001", nil, nil)
	if w.Code != 403 || authority.calls != before+1 {
		t.Fatal("revocation was cached or ignored")
	}
	authority.denied = false
	w = socialRequest(h, "DELETE", "/objects/object-00000001", nil, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"existingCopiesRevoked":false`) {
		t.Fatal(w.Body.String())
	}
}
func TestSocialCiphertextRejectsWrongPartsAndCompleteHash(t *testing.T) {
	store, _, _ := socialSetup(t)
	h := store.Handler()
	data := []byte("opaque ciphertext")
	socialCreate(t, h, data, strings.Repeat("0", 64))
	w := socialRequest(h, "PUT", "/uploads/upload-00000001/parts/1", data, map[string]string{"X-Ciphertext-SHA256": strings.Repeat("0", 64)})
	if w.Code != 400 {
		t.Fatal("wrong part hash accepted")
	}
	socialParts(t, h, data)
	other := bytes.Repeat([]byte("x"), len(data))
	w = socialRequest(h, "PUT", "/uploads/upload-00000001/parts/1", other, map[string]string{"X-Ciphertext-SHA256": socialDigest(other)})
	if w.Code != 409 {
		t.Fatal("part mutated")
	}
	w = socialRequest(h, "POST", "/uploads/upload-00000001/complete", nil, nil)
	if w.Code != 409 {
		t.Fatal("wrong whole-object hash accepted")
	}
}
func TestSocialCiphertextAuthorizationAndProductIsolation(t *testing.T) {
	store, authority, _ := socialSetup(t)
	h := store.Handler()
	data := []byte("ciphertext")
	socialCreate(t, h, data, socialDigest(data))
	w := socialRequest(h, "GET", "/uploads/upload-00000001", nil, map[string]string{"Authorization": "Bearer social-user-session"})
	if w.Code != 401 {
		t.Fatal("user session accepted as capability")
	}
	authority.conversation = "other-conversation"
	w = socialRequest(h, "GET", "/uploads/upload-00000001", nil, nil)
	if w.Code != 403 {
		t.Fatal("conversation binding ignored")
	}
	store.cfg.Authorizer = nil
	w = socialRequest(h, "GET", "/uploads/upload-00000001", nil, nil)
	if w.Code != 503 {
		t.Fatal("missing authorizer did not fail closed")
	}
}
func TestSocialCiphertextCancellationExpiryAndQuota(t *testing.T) {
	store, _, now := socialSetup(t)
	data := []byte("ciphertext")
	store.cfg.MaxStoredBytes = int64(len(data) - 1)
	b, _ := json.Marshal(SocialUploadRequest{ObjectID: "object-00000001", UploadID: "upload-00000001", ConversationID: "conversation-001", TotalCiphertextBytes: int64(len(data)), SHA256: socialDigest(data)})
	w := socialRequest(store.Handler(), "POST", "/uploads", b, nil)
	if w.Code != 413 {
		t.Fatal("quota ignored")
	}
	store.cfg.MaxStoredBytes = SocialCiphertextLimit
	h := store.Handler()
	socialCreate(t, h, data, socialDigest(data))
	socialParts(t, h, data)
	w = socialRequest(h, "DELETE", "/uploads/upload-00000001", nil, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = socialRequest(h, "POST", "/uploads/upload-00000001/complete", nil, nil)
	if w.Code != 409 {
		t.Fatal("cancelled upload completed")
	}
	*now = now.Add(25 * time.Hour)
	if err := store.Sweep(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(store.cfg.Root, "uploads", "upload-00000001")); !os.IsNotExist(err) {
		t.Fatal("expired upload remains")
	}
}
