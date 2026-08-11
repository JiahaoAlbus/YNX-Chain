package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDocsHTTPProductBoundaryThreadsAndExportEvidence(t *testing.T) {
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)
	service := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	folder, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "docs", Kind: KindFolder, Name: "Docs space"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "docs", ParentID: folder.ID, Kind: KindDoc, Name: "Boundary", MIME: "text/plain", Content: []byte("Hello boundary")})
	if err != nil {
		t.Fatal(err)
	}

	makeSession := func(product, nonce string, scopes []string) string {
		t.Helper()
		envelope := testWalletEnvelope(t, service, product, nonce, scopes)
		token, _, err := service.CreateSession(context.Background(), envelope)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	cloudToken := makeSession("cloud", "cloud-boundary", []string{"ai.use", "audit.read", "files.read", "files.write", "permissions.manage"})
	docsToken := makeSession("docs", "docs-boundary", []string{"ai.use", "audit.read", "comments.write", "documents.read", "documents.write", "sharing.manage"})
	handler := NewServer(service).Handler()

	do := func(method, path, token string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var requestBody *bytes.Reader
		if body == nil {
			requestBody = bytes.NewReader(nil)
		} else {
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			requestBody = bytes.NewReader(encoded)
		}
		request := httptest.NewRequest(method, path, requestBody)
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	for _, request := range []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/api/v1/objects/" + doc.ID, nil},
		{http.MethodGet, "/api/v1/objects/" + doc.ID + "/content", nil},
		{http.MethodPut, "/api/v1/objects/" + doc.ID + "/document", map[string]any{"baseVersion": 1, "content": []byte("wrong product")}},
		{http.MethodGet, "/api/v1/objects/" + doc.ID + "/export?format=json", nil},
		{http.MethodPost, "/api/v1/objects/" + folder.ID + "/grants", map[string]any{"principal": viewer, "role": "viewer"}},
		{http.MethodPost, "/api/v1/ai/jobs", map[string]any{"mode": "summarize", "instruction": "Summarize", "objectIds": []string{doc.ID}, "versions": []int{1}, "consent": true}},
	} {
		response := do(request.method, request.path, cloudToken, request.body)
		if response.Code != http.StatusForbidden {
			t.Fatalf("cloud boundary %s %s: %d %s", request.method, request.path, response.Code, response.Body.String())
		}
	}

	response := do(http.MethodGet, "/api/v1/objects", cloudToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("cloud list: %d %s", response.Code, response.Body.String())
	}
	var cloudPage ObjectPage
	if err := json.NewDecoder(response.Body).Decode(&cloudPage); err != nil {
		t.Fatal(err)
	}
	for _, object := range cloudPage.Items {
		if object.Kind == KindDoc || object.ID == doc.ID {
			t.Fatalf("cloud list leaked Docs object: %#v", object)
		}
	}

	newName := "Boundary renamed"
	response = do(http.MethodPatch, "/api/v1/objects/"+doc.ID, docsToken, map[string]any{"name": newName})
	if response.Code != http.StatusOK {
		t.Fatalf("docs rename: %d %s", response.Code, response.Body.String())
	}
	var updated Object
	if err := json.NewDecoder(response.Body).Decode(&updated); err != nil || updated.Name != newName {
		t.Fatalf("renamed response: %#v %v", updated, err)
	}

	response = do(http.MethodGet, "/api/v1/objects/"+doc.ID+"/export?format=html&version=1", docsToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("docs export: %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-YNX-Source-SHA256") != doc.Hash || response.Header().Get("X-Content-SHA256") != hashBytes(response.Body.Bytes()) || response.Header().Get("X-YNX-Document-Version") != "1" {
		t.Fatalf("export evidence headers: %#v", response.Header())
	}
	if !strings.Contains(response.Body.String(), "Hello boundary") || !strings.Contains(response.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("export body or disposition: %s %#v", response.Body.String(), response.Header())
	}

	response = do(http.MethodPost, "/api/v1/objects/"+doc.ID+"/grants", docsToken, map[string]any{"principal": viewer, "role": "viewer"})
	if response.Code != http.StatusCreated {
		t.Fatalf("docs grant: %d %s", response.Code, response.Body.String())
	}
	var grant Grant
	if err := json.NewDecoder(response.Body).Decode(&grant); err != nil || grant.Principal != viewer || grant.Role != "viewer" {
		t.Fatalf("grant response: %#v %v", grant, err)
	}
	response = do(http.MethodDelete, "/api/v1/objects/"+doc.ID+"/grants/"+grant.ID, docsToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("docs grant revoke: %d %s", response.Code, response.Body.String())
	}

	response = do(http.MethodPost, "/api/v1/objects/"+doc.ID+"/links", docsToken, map[string]any{"role": "viewer", "expiresAt": now.Add(7 * 24 * time.Hour)})
	if response.Code != http.StatusCreated {
		t.Fatalf("docs share link: %d %s", response.Code, response.Body.String())
	}
	var linkEnvelope struct {
		Link  ShareLink `json:"link"`
		Token string    `json:"token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&linkEnvelope); err != nil || linkEnvelope.Token == "" || linkEnvelope.Link.ObjectID != doc.ID {
		t.Fatalf("link response: %#v %v", linkEnvelope, err)
	}
	response = do(http.MethodGet, "/api/v1/shares/"+linkEnvelope.Token+"/content", "", nil)
	if response.Code != http.StatusOK || response.Body.String() != "Hello boundary" {
		t.Fatalf("docs share resolution: %d %s", response.Code, response.Body.String())
	}
	response = do(http.MethodDelete, "/api/v1/objects/"+doc.ID+"/links/"+linkEnvelope.Link.ID, docsToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("docs link revoke: %d %s", response.Code, response.Body.String())
	}
	response = do(http.MethodGet, "/api/v1/shares/"+linkEnvelope.Token, "", nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("revoked link still resolves: %d %s", response.Code, response.Body.String())
	}

	response = do(http.MethodPost, "/api/v1/objects/"+doc.ID+"/comments", docsToken, map[string]any{"version": 1, "body": "Review greeting", "anchor": map[string]any{"start": 0, "end": 5, "quote": "Hello"}})
	if response.Code != http.StatusCreated {
		t.Fatalf("comment create: %d %s", response.Code, response.Body.String())
	}
	var thread Comment
	if err := json.NewDecoder(response.Body).Decode(&thread); err != nil || thread.ThreadID != thread.ID || thread.Anchor == nil || thread.Anchor.Quote != "Hello" {
		t.Fatalf("comment response: %#v %v", thread, err)
	}
	response = do(http.MethodPost, "/api/v1/objects/"+doc.ID+"/comments/"+thread.ThreadID+"/resolution", docsToken, map[string]any{"resolved": true})
	if response.Code != http.StatusOK {
		t.Fatalf("comment resolve: %d %s", response.Code, response.Body.String())
	}
	var resolved Comment
	if err := json.NewDecoder(response.Body).Decode(&resolved); err != nil || resolved.ResolvedAt == nil || resolved.ResolvedBy != owner {
		t.Fatalf("resolved response: %#v %v", resolved, err)
	}

	response = do(http.MethodGet, "/api/v1/audit", cloudToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("cloud audit: %d %s", response.Code, response.Body.String())
	}
	var cloudAudit []AuditEvent
	if err := json.NewDecoder(response.Body).Decode(&cloudAudit); err != nil {
		t.Fatal(err)
	}
	for _, event := range cloudAudit {
		if event.ObjectID == doc.ID || strings.HasPrefix(event.Action, "document.") || strings.HasPrefix(event.Action, "comment.") {
			t.Fatalf("cloud audit leaked Docs event: %#v", event)
		}
	}

	response = do(http.MethodGet, "/api/v1/audit", docsToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("docs audit: %d %s", response.Code, response.Body.String())
	}
	var docsAudit []AuditEvent
	if err := json.NewDecoder(response.Body).Decode(&docsAudit); err != nil {
		t.Fatal(err)
	}
	seenExport, seenResolve := false, false
	for _, event := range docsAudit {
		seenExport = seenExport || event.Action == "document.export"
		seenResolve = seenResolve || event.Action == "comment.resolve"
	}
	if !seenExport || !seenResolve {
		t.Fatalf("Docs audit missing evidence: %#v", docsAudit)
	}
}
