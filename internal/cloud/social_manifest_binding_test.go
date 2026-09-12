package cloud

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type manifestBindingAuthority struct{ now time.Time }

func (a manifestBindingAuthority) Authorize(_ context.Context, r SocialAuthorizationRequest) (SocialObjectGrant, error) {
	return SocialObjectGrant{Version: 1, Product: "social", Audience: SocialObjectAudience,
		Subject: "recipient", DeviceID: "recipient-device", ConversationID: "conversation",
		ObjectID: "object-123456", UploadID: "upload-123456", Operation: r.Operation,
		ExpiresAt: a.now.Add(time.Minute)}, nil
}

func TestSocialManifestBinding(t *testing.T) {
	for _, category := range []string{"uploads", "objects"} {
		t.Run(category, func(t *testing.T) {
			now := time.Now()
			root := t.TempDir()
			if err := os.Chmod(root, 0700); err != nil {
				t.Fatal(err)
			}
			store, err := NewSocialAttachmentStore(SocialAttachmentConfig{
				Root: root, Authorizer: manifestBindingAuthority{now}, Now: func() time.Time { return now },
			})
			if err != nil {
				t.Fatal(err)
			}
			id := "upload-123456"
			subject := "recipient"
			if category == "objects" {
				id = "object-123456"
				subject = "original-uploader"
			}
			dir := filepath.Join(root, category, id)
			if err := os.Mkdir(dir, 0700); err != nil {
				t.Fatal(err)
			}
			m := socialUpload{SocialUploadRequest: SocialUploadRequest{
				ObjectID: "object-123456", UploadID: "upload-123456", ConversationID: "conversation",
				TotalCiphertextBytes: 3, SHA256: socialDigest([]byte("abc")),
			}, Subject: subject, Status: "complete", Parts: map[int]socialPart{},
				CreatedAt: now, ExpiresAt: now.Add(time.Hour), UploadExpiresAt: now.Add(time.Hour)}
			if err := socialSave(dir, m); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "ciphertext"), []byte("abc"), 0600); err != nil {
				t.Fatal(err)
			}
			request := func() *httptest.ResponseRecorder {
				r := httptest.NewRequest(http.MethodGet, "/api/v1/social-attachments/"+category+"/"+id, nil)
				r.Header.Set("Authorization", "Bearer ynx-social-object-v1.test-capability")
				w := httptest.NewRecorder()
				store.Handler().ServeHTTP(w, r)
				return w
			}
			if w := request(); w.Code != http.StatusOK {
				t.Fatalf("valid binding: %d %s", w.Code, w.Body.String())
			}
			if category == "uploads" {
				m.UploadID = "different-upload"
			} else {
				m.ObjectID = "different-object"
			}
			if err := socialSave(dir, m); err != nil {
				t.Fatal(err)
			}
			if w := request(); w.Code != http.StatusForbidden {
				t.Fatalf("changed manifest binding: %d %s", w.Code, w.Body.String())
			}
		})
	}
}
