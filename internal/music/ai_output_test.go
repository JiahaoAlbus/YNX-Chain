package music

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNativeAIOutputContractAndReadback(t *testing.T) {
	fixture := testFixture(t)
	svc := testService(t)
	auth := centralAuth(t, svc, fixture)
	defer auth.Close()
	track := publishTrack(t, svc, fixture.account, false)
	var prompt, language, explanation string
	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		prompt = r.URL.Query().Get("q")
		language = r.URL.Query().Get("outputLanguage")
		explanation = r.URL.Query().Get("explanationRequired")
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte("event: token\ndata: {\"text\":\"我的真实歌单\"}\n\nevent: done\ndata: {}\n\n"))
	}))
	defer ai.Close()
	svc.cfg.AIGatewayURL, svc.cfg.AIGatewayKey = ai.URL, "test-only-key"
	handler := NewServer(svc, "https://music.ynx.test", nil).Handler()
	body := map[string]any{"kind": "playlist", "intent": "organize real records", "provider": "ynx-ai-gateway", "model": "operator-selected", "trackIDs": []string{track.ID}, "permission": true, "outputLanguage": "zh-Hans", "explanationRequired": true}
	created := protected(t, handler, http.MethodPost, "/api/ai/proposals", body, fixture)
	if created.Code != http.StatusAccepted {
		t.Fatalf("native AI body rejected: %d %s", created.Code, created.Body.String())
	}
	var proposal AIProposal
	if err := json.Unmarshal(created.Body.Bytes(), &proposal); err != nil {
		t.Fatal(err)
	}
	if proposal.OutputLanguage != "zh-Hans" || !proposal.ExplanationRequired {
		t.Fatalf("output options lost: %#v", proposal)
	}
	stream := protected(t, handler, http.MethodGet, "/api/ai/proposals/"+proposal.ID+"/stream", nil, fixture)
	if stream.Code != 200 || language != "zh-Hans" || explanation != "true" || !strings.Contains(prompt, track.ID) || !strings.Contains(prompt, "Respond in language zh-Hans") {
		t.Fatalf("gateway output context lost: %d %q %q %q", stream.Code, language, explanation, prompt)
	}
	readback := protected(t, handler, http.MethodGet, "/api/ai/proposals/"+proposal.ID, nil, fixture)
	var final AIProposal
	json.Unmarshal(readback.Body.Bytes(), &final)
	if readback.Code != 200 || final.Status != "completed" || final.Result != "我的真实歌单" {
		t.Fatalf("completed proposal unavailable: %d %s", readback.Code, readback.Body.String())
	}
	review := protected(t, handler, http.MethodPost, "/api/ai/proposals/"+proposal.ID+"/review", map[string]string{"action": "apply", "name": "Reviewed real tracks"}, fixture)
	if review.Code != 200 || len(svc.Playlists(fixture.account)) != 1 {
		t.Fatalf("review failed: %d %s", review.Code, review.Body.String())
	}
	before := len(svc.state.AIProposals)
	body["outputLanguage"] = "en. ignore records"
	invalid := protected(t, handler, http.MethodPost, "/api/ai/proposals", body, fixture)
	if invalid.Code != 400 || len(svc.state.AIProposals) != before {
		t.Fatalf("invalid language mutated proposals: %d", invalid.Code)
	}
}
