package cloud

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type readAuthorityFixture struct {
	now     time.Time
	calls   int
	scopes  []string
	failure error
}

func (a *readAuthorityFixture) Authorize(_ context.Context, _ *http.Request, scopes []string) (productsessionv2.Session, error) {
	a.calls++
	a.scopes = append([]string(nil), scopes...)
	return productsessionv2.Session{ProductID: "docs", Account: "reader", ClientID: "ynx-docs-mobile-v1",
		IssuedAt: a.now.Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: a.now.Add(time.Minute).Format(time.RFC3339Nano)}, a.failure
}

func TestProductSessionReadRoutes(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	service, err := New(Config{StatePath: filepath.Join(root, "state.json"), ObjectDir: filepath.Join(root, "objects"), Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(service)
	if err := server.EnableProductSessionV2("https://wallet-auth.ynxweb4.com"); err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	request := func(method, path, origin, proof string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Origin", origin)
		r.Header.Set("Authorization", "Bearer must-not-fallback")
		if proof != "" {
			r.Header.Set(productsessionv2.ProofHeader, proof)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/api/v1/objects", "https://docs.ynxweb4.com", ""); w.Code != 401 {
		t.Fatalf("missing proof: %d %s", w.Code, w.Body.String())
	}
	if w := request("GET", "/api/v1/objects", "https://docs.ynxweb4.com", "invalid"); w.Code != 401 {
		t.Fatalf("invalid proof: %d %s", w.Code, w.Body.String())
	}
	if w := request("GET", "/api/v1/objects", "https://unregistered.example", "invalid"); w.Code != 403 {
		t.Fatalf("origin: %d", w.Code)
	}
	fixture := &readAuthorityFixture{now: now}
	server.v2["https://docs.ynxweb4.com"] = fixture
	for i := 0; i < 2; i++ {
		if w := request("GET", "/api/v1/objects?view=recent&q=notes", "https://docs.ynxweb4.com", "fixture"); w.Code != 200 {
			t.Fatalf("read: %d %s", w.Code, w.Body.String())
		}
	}
	if fixture.calls != 2 || !reflect.DeepEqual(fixture.scopes, []string{"docs.read", "files.read"}) {
		t.Fatalf("fresh exact authorization: calls=%d scopes=%v", fixture.calls, fixture.scopes)
	}
	for _, path := range []string{"/api/v1/objects/missing", "/api/v1/objects/missing/content", "/api/v1/objects?parentId=missing"} {
		if w := request("GET", path, "https://docs.ynxweb4.com", "fixture"); w.Code != 403 {
			t.Fatalf("object boundary %s: %d %s", path, w.Code, w.Body.String())
		}
	}
	before := fixture.calls
	if w := request("POST", "/api/v1/objects", "https://docs.ynxweb4.com", "fixture"); w.Code != 403 {
		t.Fatalf("write: %d", w.Code)
	}
	if fixture.calls != before {
		t.Fatal("disabled write consumed proof")
	}
	fixture.failure = &productsessionv2.Error{Code: "SESSION_INACTIVE", Status: 401}
	if w := request("GET", "/api/v1/objects", "https://docs.ynxweb4.com", "fixture"); w.Code != 401 {
		t.Fatalf("revoked: %d", w.Code)
	}
	fixture.failure = &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: 503}
	if w := request("GET", "/api/v1/objects", "https://docs.ynxweb4.com", "fixture"); w.Code != 503 {
		t.Fatalf("unavailable: %d", w.Code)
	}
}
