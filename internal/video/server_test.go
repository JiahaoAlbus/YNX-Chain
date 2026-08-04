package video

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

func TestServerAuthStrictParsingAndModeratorBoundary(t *testing.T) {
	s, _ := fixture(t, nil)
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": "ynx1owner"}}).Handler()
	requestCounter := 0
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		requestCounter++
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if method != http.MethodGet && method != http.MethodHead {
			r.Header.Set("Idempotency-Key", fmt.Sprintf("server-test-request-%04d", requestCounter))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request(http.MethodGet, "/health", "", ""); w.Code != http.StatusOK {
		t.Fatalf("health=%d", w.Code)
	}
	if w := request(http.MethodGet, "/v1/videos", "", ""); w.Code != http.StatusOK {
		t.Fatalf("public discovery=%d", w.Code)
	}
	if w := request(http.MethodGet, "/v1/history", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("private route missing auth=%d", w.Code)
	}
	if w := request(http.MethodPost, "/v1/channels", "owner-token", `{"handle":"a","name":"A","unknown":true}`); w.Code != http.StatusBadRequest {
		t.Fatalf("unknown field accepted=%d %s", w.Code, w.Body.String())
	}
	if w := request(http.MethodPost, "/v1/reports/rpt_missing/moderate", "owner-token", `{"decision":"dismissed","explanation":"reviewed"}`); w.Code != http.StatusForbidden {
		t.Fatalf("moderator boundary=%d", w.Code)
	}
}

func TestUploadRouteRequiresChecksumAndPersistsRights(t *testing.T) {
	s, channel := fixture(t, nil)
	digest := sha256.Sum256(testMP4)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range map[string]string{
		"channel_id":                channel.ID,
		"size":                      fmt.Sprint(len(testMP4)),
		"sha256":                    hex.EncodeToString(digest[:]),
		"title":                     "Route rights",
		"owned_content_declaration": "true",
		"rights_basis":              "licensed",
		"rights_source":             "licensor agreement 2026-07",
		"rights_license":            "bounded test license",
		"rights_territories":        "PT,HK",
		"rights_evidence_sha256":    hex.EncodeToString(digest[:]),
	} {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="media"; filename="owned.mp4"`)
	header.Set("Content-Type", "video/mp4")
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(testMP4); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/uploads", &body)
	r.Header.Set("Authorization", "Bearer owner-token")
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("Idempotency-Key", "server-upload-rights-0001")
	w := httptest.NewRecorder()
	NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": channel.Owner}}).Handler().ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"basis":"licensed"`) || !strings.Contains(w.Body.String(), `"territories":["PT","HK"]`) {
		t.Fatalf("rights-aware upload route failed: %d %s", w.Code, w.Body.String())
	}
}

func TestHealthFailsClosedWhenMediaDependenciesAreMissing(t *testing.T) {
	s, err := NewService(Config{Root: t.TempDir(), IntegrityKey: []byte("test-video-integrity-key-32-bytes!!"), Scanner: CommandScanner{Command: "ynx-missing-scanner"}, Processor: FFmpegProcessor{FFmpeg: "ynx-missing-ffmpeg"}})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	NewServer(s, StaticTokenAuth{}).Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), `"ok":false`) {
		t.Fatalf("unready media dependencies reported healthy: %d %s", w.Code, w.Body.String())
	}
}

func TestPublicDiscoveryDoesNotRequireWalletButPrivateRoutesDo(t *testing.T) {
	s, channel := fixture(t, nil)
	video := upload(t, s, channel, "Public discovery")
	if err := s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	server := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": channel.Owner}})
	request := func(method, path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	if w := request(http.MethodGet, "/v1/videos", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), video.ID) {
		t.Fatalf("public discovery failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(http.MethodGet, "/v1/videos/"+video.ID, ""); w.Code != http.StatusOK {
		t.Fatalf("public watch metadata failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(http.MethodGet, "/v1/history", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("private history did not fail closed: %d %s", w.Code, w.Body.String())
	}
}

func TestPublishedMediaIsPublicButPrivateMediaIsNot(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Public media")
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": c.Owner}}).Handler()
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/media/"+v.ObjectKey, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request(); w.Code != http.StatusForbidden {
		t.Fatalf("private media leaked: %d", w.Code)
	}
	if err := s.Publish(c.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	if w := request(); w.Code != http.StatusOK || w.Body.Len() == 0 {
		t.Fatalf("published media unavailable without bearer: %d", w.Code)
	}
}

func TestAIStreamEndpointEmitsReviewState(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "AI stream")
	job, err := s.PrepareAI(c.Owner, v.ID, "summary", []string{"metadata"})
	if err != nil {
		t.Fatal(err)
	}
	h := NewServer(s, StaticTokenAuth{Tokens: map[string]string{"owner-token": c.Owner}}).Handler()
	r := httptest.NewRequest(http.MethodPost, "/v1/ai/jobs/"+job.ID+"/stream", nil)
	r.Header.Set("Authorization", "Bearer owner-token")
	r.Header.Set("Idempotency-Key", "server-ai-stream-0001")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"state":"starting"`) || !strings.Contains(w.Body.String(), `"state":"review_required"`) {
		t.Fatalf("stream response incomplete: %d %s", w.Code, w.Body.String())
	}
}

func TestWriteIdempotencyReplaysAfterRestartAndRejectsMutation(t *testing.T) {
	s, channel := fixture(t, nil)
	video := upload(t, s, channel, "Idempotency")
	if err := s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	request := func(handler http.Handler, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/v1/videos/"+video.ID+"/comments", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer owner-token")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "persisted-comment-request-0001")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	auth := StaticTokenAuth{Tokens: map[string]string{"owner-token": channel.Owner}}
	first := request(NewServer(s, auth).Handler(), `{"body":"one persisted comment"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first write failed: %d %s", first.Code, first.Body.String())
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	second := request(NewServer(restarted, auth).Handler(), `{"body":"one persisted comment"}`)
	if second.Code != first.Code || second.Body.String() != first.Body.String() {
		t.Fatalf("replay mismatch: first=%d %q second=%d %q", first.Code, first.Body.String(), second.Code, second.Body.String())
	}
	comments, err := restarted.Comments(channel.Owner, video.ID)
	if err != nil || len(comments) != 1 {
		t.Fatalf("idempotent replay duplicated effect: %d %v", len(comments), err)
	}
	changed := request(NewServer(restarted, auth).Handler(), `{"body":"changed payload"}`)
	if changed.Code != http.StatusConflict {
		t.Fatalf("changed request reused key: %d %s", changed.Code, changed.Body.String())
	}
}

func TestCreatorTeamAndRightsHTTPBoundaries(t *testing.T) {
	s, channel := fixture(t, nil)
	video := uploadWithoutRights(t, s, channel, "HTTP rights")
	auth := StaticTokenAuth{
		Tokens: map[string]string{
			"owner-session":     channel.Owner,
			"editor-session":    testEditorAccount,
			"moderator-session": testModeratorAccount,
		},
		Moderators: map[string]bool{testModeratorAccount: true},
	}
	handler := NewServer(s, auth).Handler()
	counter := 0
	request := func(method, path, session, body string) *httptest.ResponseRecorder {
		counter++
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if session != "" {
			r.Header.Set("Authorization", "Bearer "+session)
		}
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if method != http.MethodGet && method != http.MethodHead {
			r.Header.Set("Idempotency-Key", fmt.Sprintf("creator-http-%04d", counter))
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}

	inviteResponse := request(http.MethodPost, "/v1/channels/"+channel.ID+"/team/invites", "owner-session", fmt.Sprintf(`{"account":"%s","role":"editor"}`, testEditorAccount))
	if inviteResponse.Code != http.StatusOK {
		t.Fatalf("invite route failed: %d %s", inviteResponse.Code, inviteResponse.Body.String())
	}
	if strings.Contains(inviteResponse.Body.String(), `"Account"`) || !strings.Contains(inviteResponse.Body.String(), `"account"`) {
		t.Fatalf("team API did not use canonical snake_case JSON: %s", inviteResponse.Body.String())
	}
	var invite TeamInvite
	if err := json.Unmarshal(inviteResponse.Body.Bytes(), &invite); err != nil || invite.ID == "" {
		t.Fatalf("invite response invalid: %+v %v", invite, err)
	}
	if response := request(http.MethodPost, "/v1/team/invites/"+invite.ID+"/accept", "editor-session", ""); response.Code != http.StatusOK {
		t.Fatalf("accept route failed: %d %s", response.Code, response.Body.String())
	}
	teamResponse := request(http.MethodGet, "/v1/channels/"+channel.ID+"/team", "editor-session", "")
	if teamResponse.Code != http.StatusOK || !strings.Contains(teamResponse.Body.String(), testEditorAccount) || strings.Contains(teamResponse.Body.String(), invite.ID) {
		t.Fatalf("member team view leaked invite or omitted member: %d %s", teamResponse.Code, teamResponse.Body.String())
	}

	rightsBody := fmt.Sprintf(`{"basis":"owned","territories":["worldwide"],"evidence_sha256":"%s","source_sha256":"%s","contributor_splits":[{"account":"%s","basis_points":10000}]}`, strings.Repeat("f", 64), video.SHA256, channel.Owner)
	rightsResponse := request(http.MethodPost, "/v1/videos/"+video.ID+"/rights", "editor-session", rightsBody)
	if rightsResponse.Code != http.StatusOK {
		t.Fatalf("rights route failed: %d %s", rightsResponse.Code, rightsResponse.Body.String())
	}
	if strings.Contains(rightsResponse.Body.String(), `"VideoID"`) || !strings.Contains(rightsResponse.Body.String(), `"video_id"`) {
		t.Fatalf("rights API did not use canonical snake_case JSON: %s", rightsResponse.Body.String())
	}
	var declaration RightsDeclaration
	if err := json.Unmarshal(rightsResponse.Body.Bytes(), &declaration); err != nil || declaration.ID == "" {
		t.Fatalf("rights response invalid: %+v %v", declaration, err)
	}
	if response := request(http.MethodPost, "/v1/rights/"+declaration.ID+"/review", "owner-session", `{"accepted":true,"reason":"owner cannot self-verify"}`); response.Code != http.StatusForbidden {
		t.Fatalf("owner bypassed independent rights review: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPost, "/v1/rights/"+declaration.ID+"/review", "moderator-session", `{"accepted":true,"reason":"evidence verified"}`); response.Code != http.StatusOK {
		t.Fatalf("moderator rights review failed: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPost, "/v1/videos/"+video.ID+"/publish", "editor-session", `{"visibility":"public"}`); response.Code != http.StatusOK {
		t.Fatalf("editor publish route failed: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodDelete, "/v1/channels/"+channel.ID+"/team/"+testEditorAccount, "owner-session", ""); response.Code != http.StatusOK {
		t.Fatalf("revoke route failed: %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPost, "/v1/videos/"+video.ID+"/metadata", "editor-session", `{"title":"revoked","description":""}`); response.Code != http.StatusForbidden {
		t.Fatalf("revoked editor retained HTTP authority: %d %s", response.Code, response.Body.String())
	}
}

func TestPublicationLifecycleHTTPContract(t *testing.T) {
	now := time.Date(2026, 7, 29, 4, 0, 0, 0, time.UTC)
	s, channel := fixture(t, func(cfg *Config) {
		cfg.Now = func() time.Time { return now }
	})
	acceptRole(t, s, channel.Owner, channel.ID, testEditorAccount, CreatorRoleEditor)
	acceptRole(t, s, channel.Owner, channel.ID, testModeratorAccount, CreatorRoleModerator)
	video := uploadWithoutRights(t, s, channel, "HTTP lifecycle")
	declaration := declareTestRights(t, s, channel.Owner, video)
	if _, err := s.ReviewRights(testModeratorAccount, declaration.ID, true, "verified"); err != nil {
		t.Fatal(err)
	}

	auth := StaticTokenAuth{Tokens: map[string]string{
		"owner-session":     channel.Owner,
		"editor-session":    testEditorAccount,
		"moderator-session": testModeratorAccount,
	}}
	handler := NewServer(s, auth).Handler()
	counter := 0
	request := func(path, session, body string) *httptest.ResponseRecorder {
		counter++
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+session)
		r.Header.Set("Idempotency-Key", fmt.Sprintf("lifecycle-http-%04d", counter))
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	assertWorkflow := func(response *httptest.ResponseRecorder, expected WorkflowState) {
		t.Helper()
		if response.Code != http.StatusOK {
			t.Fatalf("lifecycle route failed: %d %s", response.Code, response.Body.String())
		}
		var out Video
		if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil || out.WorkflowState != expected || out.Version == 0 || len(out.Versions) == 0 {
			t.Fatalf("lifecycle response lost version evidence: %+v %v body=%s", out, err, response.Body.String())
		}
	}

	assertWorkflow(request("/v1/videos/"+video.ID+"/submit-review", "editor-session", ""), WorkflowInReview)
	assertWorkflow(request("/v1/videos/"+video.ID+"/review-publication", "moderator-session", `{"approved":true,"reason":"approved"}`), WorkflowApproved)
	scheduledAt := now.Add(time.Hour)
	assertWorkflow(request("/v1/videos/"+video.ID+"/schedule", "editor-session", fmt.Sprintf(`{"visibility":"public","scheduled_at":"%s"}`, scheduledAt.Format(time.RFC3339))), WorkflowScheduled)
	if response := request("/v1/videos/"+video.ID+"/publish-due", "editor-session", ""); response.Code != http.StatusBadRequest {
		t.Fatalf("HTTP lifecycle published before due time: %d %s", response.Code, response.Body.String())
	}
	now = now.Add(2 * time.Hour)
	assertWorkflow(request("/v1/videos/"+video.ID+"/publish-due", "editor-session", ""), WorkflowPublished)
	assertWorkflow(request("/v1/videos/"+video.ID+"/unpublish", "owner-session", ""), WorkflowUnpublished)
}
