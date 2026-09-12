package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type threadHTTPAuthority struct {
	actor string
	now   time.Time
}

func (a threadHTTPAuthority) Authorize(_ context.Context, _ *http.Request, _ []string) (productsessionv2.Session, error) {
	return productsessionv2.Session{ProductID: "docs", Account: a.actor, IssuedAt: a.now.Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: a.now.Add(time.Minute).Format(time.RFC3339Nano)}, nil
}

func TestDocsCommentHTTPPersistence(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	cfg := Config{StatePath: filepath.Join(root, "state.json"), ObjectDir: filepath.Join(root, "objects")}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	actor := "ynx1" + strings.Repeat("a", 38)
	doc, err := service.Create(context.Background(), actor, CreateObjectRequest{Product: "docs", Kind: KindDoc, Name: "thread.txt", MIME: "text/plain", Content: []byte("hello world")})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(service)
	if err := server.EnableProductSessionV2("https://wallet-auth.ynxweb4.com"); err != nil {
		t.Fatal(err)
	}
	server.v2["https://docs.ynxweb4.com"] = threadHTTPAuthority{actor, time.Now()}
	handler := server.Handler()
	request := func(method, path, key, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", "https://docs.ynxweb4.com")
		r.Header.Set(productsessionv2.ProofHeader, "explicit-test-double-not-a-wallet-proof")
		r.Header.Set("Content-Type", "application/json")
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	base := "/api/v1/objects/" + doc.ID + "/comments"
	body := `{"version":1,"body":"review","mentions":[],"anchor":{"start":0,"end":5,"quote":"hello"}}`
	response := request("POST", base, "new-thread-key-0001", body)
	if response.Code != 201 {
		t.Fatalf("create: %d %s", response.Code, response.Body.String())
	}
	var comment Comment
	if err := json.Unmarshal(response.Body.Bytes(), &comment); err != nil {
		t.Fatal(err)
	}
	if comment.ThreadID != comment.ID || comment.Anchor == nil || comment.Anchor.Quote != "hello" {
		t.Fatalf("thread: %+v", comment)
	}
	replyBody := `{"version":1,"body":"reply","mentions":[],"parentId":"` + comment.ID + `"}`
	if w := request("POST", base, "thread-reply-key-01", replyBody); w.Code != 201 {
		t.Fatalf("reply: %d %s", w.Code, w.Body.String())
	}
	if w := request("POST", base, "thread-reply-key-01", replyBody); w.Code != 201 || w.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("reply replay: %d", w.Code)
	}
	if w := request("POST", base+"/"+comment.ID+"/resolve", "resolve-thread-0001", `{"resolved":true}`); w.Code != 200 {
		t.Fatalf("resolve: %d %s", w.Code, w.Body.String())
	}
	if w := request("POST", base, "reply-after-close-01", replyBody); w.Code != 400 {
		t.Fatalf("resolved reply: %d", w.Code)
	}
	reloaded, err := New(cfg)
	if err != nil {
		t.Fatalf("thread cold-load: %v", err)
	}
	comments, err := reloaded.Comments(actor, doc.ID)
	if err != nil || len(comments) != 2 || comments[0].ResolvedAt == nil || comments[0].ResolvedBy != actor || comments[1].ThreadID != comment.ID {
		t.Fatalf("persisted threads: %+v %v", comments, err)
	}
	if w := request("GET", base, "", ""); w.Code != http.StatusOK {
		t.Fatalf("read: %d", w.Code)
	}
	copyResponse := request("POST", "/api/v1/objects/"+doc.ID+"/duplicate", "duplicate-object-0001", `{"name":"copied.txt","parentId":""}`)
	if copyResponse.Code != 201 {
		t.Fatalf("duplicate HTTP: %d %s", copyResponse.Code, copyResponse.Body.String())
	}
	var copied Object
	if err := json.Unmarshal(copyResponse.Body.Bytes(), &copied); err != nil {
		t.Fatal(err)
	}
	if copied.ID == doc.ID || copied.Version != 1 || copied.Hash != doc.Hash || copied.Product != "docs" || copied.StorageClass != doc.StorageClass {
		t.Fatalf("duplicate metadata: %+v", copied)
	}
	copyComments, err := service.Comments(actor, copied.ID)
	if err != nil || len(copyComments) != 0 {
		t.Fatalf("comments must not be duplicated: %+v %v", copyComments, err)
	}
	reloaded, err = New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if loaded, err := reloaded.Get(actor, copied.ID); err != nil || loaded.Hash != copied.Hash {
		t.Fatalf("duplicate cold-load: %+v %v", loaded, err)
	}
}
