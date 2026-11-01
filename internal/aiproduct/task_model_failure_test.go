package aiproduct

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestP08ModelFailureCauseSurvivesColdResultWithoutReplay(t *testing.T) {
	for _, c := range []struct {
		status     int
		code, want string
	}{{401, "", "MODEL_PROVIDER_AUTH_REJECTED"}, {429, "insufficient_quota", "MODEL_PROVIDER_QUOTA_EXHAUSTED"}, {429, "rate_limit_exceeded", "MODEL_PROVIDER_RATE_LIMITED"}, {429, "unknown", "MODEL_PROVIDER_RATE_OR_QUOTA_REJECTED"}, {503, "", "MODEL_PROVIDER_SERVICE_REJECTED"}} {
		t.Run(c.want, func(t *testing.T) {
			f := newP08ModelFixture(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(c.status)
				_, _ = w.Write([]byte(`{"error":{"code":"` + c.code + `","message":"PUBLIC-never-store-provider-detail"}}`))
			})
			input := f.request()
			result, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, input)
			if err == nil || result.Status != "UNKNOWN" || result.Content != "" || result.FirstCause != c.want || f.requests.Load() != 1 {
				t.Fatalf("provider diagnosis: %+v %v", result, err)
			}
			reopened, err := NewStore(f.server.store.path, f.key)
			if err != nil {
				t.Fatal(err)
			}
			server := &Server{store: reopened}
			r := httptest.NewRequest(http.MethodGet, "/api/tasks/"+f.task.ID+"/runs/"+input.RunID, nil)
			r.SetPathValue("id", f.task.ID)
			r.SetPathValue("runId", input.RunID)
			w := httptest.NewRecorder()
			server.handleTaskModelRunRead(w, r, f.session)
			if w.Code != 200 || !strings.Contains(w.Body.String(), c.want) || f.requests.Load() != 1 {
				t.Fatal("cold read lost original nonsecret provider cause or replayed model")
			}
			raw, _ := os.ReadFile(reopened.path)
			if strings.Contains(string(raw), "PUBLIC-never-store-provider-detail") {
				t.Fatal("provider body leaked into durable status")
			}
			f.server.store = reopened
			if _, err = f.server.runTaskModel(context.Background(), f.session, f.task.ID, input); !errors.Is(err, errTaskEffectUnresolved) || f.requests.Load() != 1 {
				t.Fatal("diagnosis authorized a blind retry")
			}
		})
	}
}

func TestP08LocalModelNormalTaskCompositionWithoutProviderKey(t *testing.T) {
	f := newP08ModelFixture(t)
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"PUBLIC","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("task constructor forwarded a dummy credential")
		}
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"PUBLIC local task model answer"}}]}`))
	}))
	defer peer.Close()
	service, err := NewTaskModelService(TaskModelConfig{ChainURL: peer.URL, ProviderURL: peer.URL, ProviderAuth: "none-loopback", Model: "PUBLIC-installed-local-model", AccessAPIKey: "PUBLIC-existing-gateway", UpstreamKey: "PUBLIC-existing-upstream"})
	if err != nil {
		t.Fatal(err)
	}
	f.server.taskModel = service
	answer, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
	if err != nil || answer.Status != "COMPLETED" || answer.Content != "PUBLIC local task model answer" || answer.Model != "PUBLIC-installed-local-model" {
		t.Fatalf("normal local model composition: %+v %v", answer, err)
	}
}
