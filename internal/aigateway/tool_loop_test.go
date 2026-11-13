package aigateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type toolLoopExecutorFixture func(context.Context, ToolCall) (ToolExecution, error)

func (f toolLoopExecutorFixture) ExecuteTool(ctx context.Context, call ToolCall) (ToolExecution, error) {
	return f(ctx, call)
}

func toolLoopFixture(t *testing.T, provider http.HandlerFunc) (*Service, *atomic.Int32) {
	t.Helper()
	calls := new(atomic.Int32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"fixture","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		calls.Add(1)
		if r.URL.Path != "/chat/completions" || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer fixture-provider-credential" || r.Header.Get("X-Request-ID") != "fixture-request" {
			t.Error("transport changed original endpoint, credentials or request linkage")
			http.Error(w, "invalid fixture request", 400)
			return
		}
		provider(w, r)
	}))
	t.Cleanup(server.Close)
	s, err := New(Config{ChainURL: server.URL, ProviderURL: server.URL, Model: "fixture-model", ProviderAPIKey: "fixture-provider-credential", AccessAPIKey: "fixture-access", UpstreamKey: "fixture-upstream"})
	if err != nil {
		t.Fatal(err)
	}
	return s, calls
}

func toolLoopDefinitions() []ToolDefinition {
	return []ToolDefinition{{Name: "read_record", Description: "Service-owned read adapter", Parameters: json.RawMessage(`{"type":"object","properties":{"id":{"type":"string"}},"required":["id"],"additionalProperties":false}`)}}
}

func toolLoopCall(id, name, args string) ToolCall {
	call := ToolCall{ID: id, Type: "function"}
	call.Function.Name, call.Function.Arguments = name, args
	return call
}

func toolLoopReply(w http.ResponseWriter, calls []ToolCall, content, reason string) {
	_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
		"finish_reason": reason, "message": toolLoopMessage{Role: "assistant", Content: content, ToolCalls: calls},
	}}})
}

func toolLoopFixtureAdmission(context.Context, string, string, []byte) error { return nil }

func TestToolLoopHTTPResultLinkage(t *testing.T) {
	args := `{ "id" : "record-a" }`
	receipt := []byte("{\"receipt\":\"actual adapter bytes\",\"text\":\"中文\\nline\"}\n")
	expectedCall := toolLoopCall("provider-call-original", "read_record", args)
	var rounds atomic.Int32
	s, requests := toolLoopFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body toolLoopRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body.Model != "fixture-model" || len(body.Tools) != 1 || body.Tools[0].Function.Name != "read_record" || body.Tools[0].Type != "function" {
			t.Error("model or service allowlist changed")
		}
		if rounds.Add(1) == 1 {
			toolLoopReply(w, []ToolCall{expectedCall}, "", "tool_calls")
			return
		}
		last := body.Messages[len(body.Messages)-1]
		previous := body.Messages[len(body.Messages)-2]
		if last.Role != "tool" || last.ToolCallID != expectedCall.ID || !bytes.Equal([]byte(last.Content), receipt) || len(previous.ToolCalls) != 1 || previous.ToolCalls[0] != expectedCall {
			t.Errorf("provider did not get original call and actual bytes: %+v %+v", previous, last)
		}
		toolLoopReply(w, nil, "Actual provider final answer.", "stop")
	})
	executions, admissions := 0, 0
	executor := toolLoopExecutorFixture(func(_ context.Context, call ToolCall) (ToolExecution, error) {
		executions++
		if call != expectedCall {
			t.Errorf("original call ID/arguments changed: %+v", call)
		}
		return ToolExecution{Status: "COMPLETED", Content: receipt}, nil
	})
	admit := func(_ context.Context, destination, model string, body []byte) error {
		admissions++
		if destination != s.cfg.ProviderURL+"/chat/completions" || model != s.cfg.Model || bytes.Contains(body, []byte(s.cfg.ProviderAPIKey)) {
			t.Error("wrong admission binding")
		}
		if admissions == 2 && !bytes.Contains(body, []byte("actual adapter bytes")) {
			t.Error("result disclosure bypassed admission")
		}
		clear(body) // Admission cannot mutate the exact bytes subsequently sent.
		return nil
	}
	result, err := s.CompleteWithTools(context.Background(), "fixture-session", "read selected record", "fixture-request", toolLoopDefinitions(), executor, admit)
	if err != nil || result.Status != "COMPLETED" || result.Content != "Actual provider final answer." || executions != 1 || admissions != 2 || requests.Load() != 2 || len(result.Steps) != 1 || !bytes.Equal(result.Steps[0].Result.Content, receipt) {
		t.Fatalf("unexpected real HTTP loop result: %+v, %v, executions=%d admissions=%d requests=%d", result, err, executions, admissions, requests.Load())
	}
}

func TestToolLoopHTTP429(t *testing.T) {
	s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "17")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"code":"rate_limit_exceeded"}}`))
	})
	executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
		t.Error("executed on 429")
		return ToolExecution{}, nil
	})
	result, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
	var failure *ProviderHTTPError
	if !errors.As(err, &failure) || failure.StatusCode != 429 || failure.Category != "rate_limited" || failure.RetryAfter != "17" || result.Content != "" || requests.Load() != 1 {
		t.Fatalf("429 lost or fake answer: %+v, %v", result, err)
	}
}

func TestToolLoopPendingStops(t *testing.T) {
	for _, status := range []ToolStatus{ToolNeedsApproval, ToolUnknown, "executor_error"} {
		t.Run(string(status), func(t *testing.T) {
			s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
				toolLoopReply(w, []ToolCall{toolLoopCall("first", "read_record", `{"id":"a"}`), toolLoopCall("second", "read_record", `{"id":"b"}`)}, "", "tool_calls")
			})
			executions := 0
			firstCause := errors.New("fixture uncertain remote receipt")
			executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
				executions++
				if status == "executor_error" {
					return ToolExecution{Status: "UNKNOWN", Content: []byte("original operation")}, firstCause
				}
				return ToolExecution{Status: status, Content: []byte("original operation")}, nil
			})
			result, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
			want := status
			if status == "executor_error" {
				want = "UNKNOWN"
				if !errors.Is(err, firstCause) {
					t.Fatalf("lost first cause: %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if result.Status != want || result.Content != "" || requests.Load() != 1 || executions != 1 || len(result.Steps) != 1 || result.Steps[0].Call.ID != "first" {
				t.Fatalf("pending operation was continued/repeated: %+v requests=%d executions=%d", result, requests.Load(), executions)
			}
		})
	}
}

func TestToolLoopRejectsInvalidProviderCalls(t *testing.T) {
	valid := toolLoopCall("call-a", "read_record", `{"id":"a"}`)
	for _, tc := range []struct {
		name   string
		calls  []ToolCall
		reason string
	}{
		{"unknown_tool", []ToolCall{toolLoopCall("a", "pay", `{"id":"a"}`)}, "tool_calls"},
		{"malformed_arguments", []ToolCall{toolLoopCall("a", "read_record", `{`)}, "tool_calls"},
		{"wrong_type", []ToolCall{toolLoopCall("a", "read_record", `{"id":7}`)}, "tool_calls"},
		{"missing_required", []ToolCall{toolLoopCall("a", "read_record", `{}`)}, "tool_calls"},
		{"model_supplied_risk", []ToolCall{toolLoopCall("a", "read_record", `{"id":"a","risk":"read"}`)}, "tool_calls"},
		{"duplicate_argument_keys", []ToolCall{toolLoopCall("a", "read_record", `{"id":"a","id":"b"}`)}, "tool_calls"},
		{"duplicate_call_ids", []ToolCall{valid, valid}, "tool_calls"},
		{"validate_entire_batch_first", []ToolCall{valid, toolLoopCall("b", "not-listed", `{}`)}, "tool_calls"},
		{"missing_id", []ToolCall{toolLoopCall("", "read_record", `{"id":"a"}`)}, "tool_calls"},
		{"truncated_calls", []ToolCall{valid}, "length"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) { toolLoopReply(w, tc.calls, "", tc.reason) })
			executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
				t.Error("executed invalid model call")
				return ToolExecution{}, nil
			})
			result, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
			if err == nil || result.Content != "" || len(result.Steps) != 0 {
				t.Fatalf("invalid call accepted: %+v %v", result, err)
			}
		})
	}
}

func TestToolLoopBoundsAndReplay(t *testing.T) {
	for _, mode := range []string{"rounds", "call_count", "repeated_id", "response_body", "trailing_json", "duplicate_response_key", "thinking_final", "oversize_result"} {
		t.Run(mode, func(t *testing.T) {
			var count atomic.Int32
			s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
				n := count.Add(1)
				switch mode {
				case "response_body":
					_, _ = w.Write([]byte(strings.Repeat(" ", maxBodyBytes+1)))
					return
				case "trailing_json":
					_, _ = w.Write([]byte(`{"choices":[]} {}`))
					return
				case "duplicate_response_key":
					_, _ = w.Write([]byte(`{"choices":[],"choices":[]}`))
					return
				case "thinking_final":
					toolLoopReply(w, nil, "<think>internal</think>fake", "stop")
					return
				}
				id := fmt.Sprintf("call-%d", n)
				if mode == "repeated_id" {
					id = "same-original-call"
				}
				calls := []ToolCall{toolLoopCall(id, "read_record", `{"id":"a"}`)}
				if mode == "call_count" {
					for i := 1; i <= toolLoopCalls; i++ {
						calls = append(calls, toolLoopCall(fmt.Sprint(i), "read_record", `{"id":"a"}`))
					}
				}
				toolLoopReply(w, calls, "", "tool_calls")
			})
			executions := 0
			executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
				executions++
				if mode == "oversize_result" {
					return ToolExecution{Status: "COMPLETED", Content: bytes.Repeat([]byte("x"), toolResultBytes+1)}, nil
				}
				return ToolExecution{Status: "COMPLETED", Content: []byte("actual receipt")}, nil
			})
			result, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
			if err == nil || result.Content != "" {
				t.Fatalf("unbounded or fake completion: %+v %v", result, err)
			}
			switch mode {
			case "rounds":
				if !errors.Is(err, ErrToolLoopLimit) || requests.Load() != toolLoopRounds || executions != toolLoopRounds-1 {
					t.Fatalf("round bound requests=%d effects=%d error=%v", requests.Load(), executions, err)
				}
			case "repeated_id":
				if executions != 1 || requests.Load() != 2 {
					t.Fatal("original tool call was replayed")
				}
			case "oversize_result":
				if result.Status != "UNKNOWN" || len(result.Steps) != 1 || result.Steps[0].Call.ID == "" || executions != 1 || requests.Load() != 1 {
					t.Fatal("oversize receipt lost effect identity or continued")
				}
			default:
				if executions != 0 || requests.Load() != 1 {
					t.Fatal("invalid response caused side effect or retry")
				}
			}
		})
	}
}

func TestToolLoopAdmissionAndSchema(t *testing.T) {
	for _, mode := range []string{"no_admission", "cancelled", "oversize_query", "unsupported_schema", "bad_schema", "second_disclosure_denied"} {
		t.Run(mode, func(t *testing.T) {
			s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
				toolLoopReply(w, []ToolCall{toolLoopCall("original", "read_record", `{"id":"a"}`)}, "", "tool_calls")
			})
			tools := toolLoopDefinitions()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			query := "query"
			admit := ToolModelAdmission(toolLoopFixtureAdmission)
			denied := errors.New("fixture disclosure not authorized")
			admissions, executions := 0, 0
			switch mode {
			case "no_admission":
				admit = nil
			case "cancelled":
				cancel()
			case "oversize_query":
				query = strings.Repeat("a", maxBodyBytes+1)
			case "unsupported_schema":
				tools[0].Parameters = json.RawMessage(`{"type":"object","additionalProperties":false,"enum":[{}]}`)
			case "bad_schema":
				tools[0].Parameters = json.RawMessage(`{"type":"object","additionalProperties":true}`)
			case "second_disclosure_denied":
				admit = func(context.Context, string, string, []byte) error {
					admissions++
					if admissions == 2 {
						return denied
					}
					return nil
				}
			}
			executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
				executions++
				return ToolExecution{Status: "COMPLETED", Content: []byte("private tool result")}, nil
			})
			result, err := s.CompleteWithTools(ctx, "fixture-session", query, "fixture-request", tools, executor, admit)
			if err == nil || result.Content != "" {
				t.Fatalf("invalid admission/schema accepted: %+v %v", result, err)
			}
			if mode == "second_disclosure_denied" {
				if !errors.Is(err, denied) || requests.Load() != 1 || executions != 1 || len(result.Steps) != 1 {
					t.Fatal("new private result inherited disclosure or lost original effect")
				}
			} else if requests.Load() != 0 || executions != 0 {
				t.Fatal("invalid input reached provider or executor")
			}
		})
	}
}

func TestToolLoopOversizeReceiptPreservesFirstCause(t *testing.T) {
	s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		toolLoopReply(w, []ToolCall{toolLoopCall("original-unknown-op", "read_record", `{"id":"a"}`)}, "", "tool_calls")
	})
	firstCause := errors.New("fixture original remote result unavailable")
	executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
		return ToolExecution{Status: ToolUnknown, Content: bytes.Repeat([]byte("x"), toolResultBytes+1)}, firstCause
	})
	result, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
	if !errors.Is(err, firstCause) || !errors.Is(err, ErrToolLoopLimit) || result.Status != ToolUnknown || result.Content != "" || len(result.Steps) != 1 || result.Steps[0].Call.ID != "original-unknown-op" || requests.Load() != 1 {
		t.Fatalf("lost original operation/error or continued: %+v, %v", result, err)
	}
}

func TestToolLoopHTTPCancellation(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	s, requests := toolLoopFixture(t, func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
		t.Error("executed after cancelled provider request")
		return ToolExecution{}, nil
	})
	done := make(chan error, 1)
	go func() {
		result, err := s.CompleteWithTools(ctx, "fixture-session", "query", "fixture-request", toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
		if result.Content != "" {
			done <- errors.New("cancelled request invented final content")
			return
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("fixture HTTP request never started")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) || requests.Load() != 1 {
			t.Fatalf("cancellation lost or retried: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("provider transport ignored caller cancellation")
	}
}

func TestToolLoopResumeDurableOriginalBatch(t *testing.T) {
	for _, mode := range []string{"approval_first", "unknown_first", "approval_second"} {
		t.Run(mode, func(t *testing.T) {
			original := []ToolCall{toolLoopCall("original-a", "read_record", `{ "id" : "a" }`), toolLoopCall("original-b", "read_record", `{"id":"b"}`)}
			var rounds atomic.Int32
			s, requests := toolLoopFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if rounds.Add(1) == 1 {
					toolLoopReply(w, original, "original assistant batch", "tool_calls")
					return
				}
				var body toolLoopRequest
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				n := len(body.Messages)
				if n < 6 {
					t.Error("resume lost original transcript")
					return
				}
				assistant, a, b := body.Messages[n-3], body.Messages[n-2], body.Messages[n-1]
				if len(assistant.ToolCalls) != 2 || assistant.ToolCalls[0] != original[0] || assistant.ToolCalls[1] != original[1] || assistant.Content != "original assistant batch" ||
					a.Role != "tool" || a.ToolCallID != original[0].ID || a.Content != "real-completed-a\n" || b.Role != "tool" || b.ToolCallID != original[1].ID || b.Content != "real-completed-b\n" {
					t.Errorf("resumed provider did not receive exact original batch/results: %+v", body.Messages)
				}
				toolLoopReply(w, nil, "Provider final after durable resume.", "stop")
			})
			pendingID, pendingStatus := original[0].ID, ToolNeedsApproval
			if mode == "approval_second" {
				pendingID = original[1].ID
			}
			if mode == "unknown_first" {
				pendingStatus = ToolUnknown
			}
			initial := toolLoopExecutorFixture(func(_ context.Context, call ToolCall) (ToolExecution, error) {
				if call.ID == pendingID {
					return ToolExecution{Status: pendingStatus, Content: []byte("original durable binding")}, nil
				}
				return ToolExecution{Status: ToolCompleted, Content: []byte("real-completed-a\n")}, nil
			})
			paused, err := s.CompleteWithTools(context.Background(), "fixture-session", "selected query", "fixture-request", toolLoopDefinitions(), initial, toolLoopFixtureAdmission)
			if err != nil || paused.Status != pendingStatus || len(paused.Checkpoint) == 0 || requests.Load() != 1 {
				t.Fatalf("not checkpointed: %+v %v", paused, err)
			}
			publicJSON, err := json.Marshal(paused)
			if err != nil || bytes.Contains(publicJSON, []byte("Checkpoint")) || bytes.Contains(publicJSON, []byte("providerURL")) {
				t.Fatal("private checkpoint leaked through default result JSON")
			}
			for _, credential := range []string{s.cfg.ProviderAPIKey, s.cfg.AccessAPIKey, s.cfg.UpstreamKey} {
				if bytes.Contains(paused.Checkpoint, []byte(credential)) {
					t.Fatal("checkpoint serialized configured API credential")
				}
			}
			// Test file persistence/reload only. Parent owns production encryption.
			path := filepath.Join(t.TempDir(), "private-checkpoint.json")
			if err := os.WriteFile(path, paused.Checkpoint, 0600); err != nil {
				t.Fatal(err)
			}
			checkpoint, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			restarted, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			var resumedIDs []string
			executor := toolLoopExecutorFixture(func(_ context.Context, call ToolCall) (ToolExecution, error) {
				resumedIDs = append(resumedIDs, call.ID)
				if len(resumedIDs) == 1 && call.ID != pendingID {
					t.Error("resume did not query/execute exact original pending call first")
				}
				if call != original[0] && call != original[1] {
					t.Error("resume changed original arguments or call ID")
				}
				if call.ID == original[0].ID {
					return ToolExecution{Status: ToolCompleted, Content: []byte("real-completed-a\n")}, nil
				}
				return ToolExecution{Status: ToolCompleted, Content: []byte("real-completed-b\n")}, nil
			})
			admissions := 0
			admit := func(_ context.Context, destination, model string, body []byte) error {
				admissions++
				if destination != s.cfg.ProviderURL || model != s.cfg.Model || !bytes.Contains(body, []byte("real-completed-b")) {
					t.Error("resumed result disclosure did not get fresh exact-byte admission")
				}
				return nil
			}
			result, err := restarted.ResumeWithTools(context.Background(), "fixture-session", "fixture-request", checkpoint, toolLoopDefinitions(), executor, admit)
			wantCalls := 2
			if mode == "approval_second" {
				wantCalls = 1
			}
			if err != nil || result.Status != ToolCompleted || result.Content != "Provider final after durable resume." || len(result.Checkpoint) != 0 || len(result.Steps) != 2 || requests.Load() != 2 || len(resumedIDs) != wantCalls || admissions != 1 {
				t.Fatalf("durable resume failed or re-executed completed work: %+v %v calls=%v requests=%d", result, err, resumedIDs, requests.Load())
			}
		})
	}
}

func TestToolLoopResumeRejectsPinsAndCorruption(t *testing.T) {
	s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		toolLoopReply(w, []ToolCall{toolLoopCall("original", "read_record", `{"id":"a"}`)}, "", "tool_calls")
	})
	pending := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
		return ToolExecution{Status: ToolNeedsApproval}, nil
	})
	paused, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), pending, toolLoopFixtureAdmission)
	if err != nil || len(paused.Checkpoint) == 0 {
		t.Fatalf("checkpoint setup failed: %v", err)
	}
	for _, mode := range []string{"provider", "model", "chain", "session", "request", "schema", "version", "cursor", "seen", "rounds", "calls", "time", "steps", "arguments", "wire_field", "oversize"} {
		t.Run(mode, func(t *testing.T) {
			restarted, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			session, request := "fixture-session", "fixture-request"
			tools := toolLoopDefinitions()
			var state toolLoopCheckpoint
			if err := json.Unmarshal(paused.Checkpoint, &state); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "provider":
				restarted.cfg.ProviderURL += "/other"
			case "model":
				restarted.cfg.Model = "another-model"
			case "chain":
				restarted.cfg.ChainURL += "/other"
			case "session":
				session = "another-session"
			case "request":
				request = "another-request"
			case "schema":
				tools[0].Description = "changed catalog"
			case "version":
				state.Version++
			case "cursor":
				state.Cursor++
			case "seen":
				state.SeenIDs = nil
			case "rounds":
				state.Rounds = 0
			case "calls":
				state.Calls = 0
			case "time":
				state.RemainingNanos = int64(3 * time.Minute)
			case "steps":
				state.Steps[0].Call.ID = "another-id"
			case "arguments":
				state.Payload.Messages[3].ToolCalls[0].Function.Arguments = `{"id":3}`
			}
			checkpoint, err := json.Marshal(state)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "wire_field" {
				checkpoint = append([]byte(`{"unsupported":true,`), checkpoint[1:]...)
			}
			if mode == "oversize" {
				checkpoint = bytes.Repeat([]byte(" "), toolCheckpointBytes+1)
			}
			executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
				t.Error("invalid checkpoint reached executor")
				return ToolExecution{}, nil
			})
			admit := func(context.Context, string, string, []byte) error {
				t.Error("invalid checkpoint reached model admission")
				return nil
			}
			result, err := restarted.ResumeWithTools(context.Background(), session, request, checkpoint, tools, executor, admit)
			if err == nil || result.Content != "" || len(result.Checkpoint) != 0 || requests.Load() != 1 {
				t.Fatalf("invalid checkpoint accepted: %+v %v", result, err)
			}
		})
	}
}

func TestToolLoopResumeCumulativeCallBudget(t *testing.T) {
	s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		toolLoopReply(w, []ToolCall{toolLoopCall("original-unknown", "read_record", `{"id":"a"}`)}, "", "tool_calls")
	})
	queries := 0
	executor := toolLoopExecutorFixture(func(_ context.Context, call ToolCall) (ToolExecution, error) {
		queries++ // Fixture represents reconciliation of the same durable op.
		if call.ID != "original-unknown" {
			t.Error("UNKNOWN resume minted a new operation")
		}
		return ToolExecution{Status: ToolUnknown}, nil
	})
	result, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
	if err != nil {
		t.Fatal(err)
	}
	previousTime := int64(2 * time.Minute)
	for queries < toolLoopCalls {
		var state toolLoopCheckpoint
		if err := json.Unmarshal(result.Checkpoint, &state); err != nil {
			t.Fatal(err)
		}
		if state.Calls != queries || state.Rounds != 1 || state.RemainingNanos >= previousTime {
			t.Fatalf("restored budget reset: %+v", state)
		}
		previousTime = state.RemainingNanos
		restarted, err := New(s.cfg)
		if err != nil {
			t.Fatal(err)
		}
		result, err = restarted.ResumeWithTools(context.Background(), "fixture-session", "fixture-request", result.Checkpoint, toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
		if err != nil || result.Status != ToolUnknown {
			t.Fatalf("UNKNOWN query resume failed: %v", err)
		}
	}
	result, err = s.ResumeWithTools(context.Background(), "fixture-session", "fixture-request", result.Checkpoint, toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
	if !errors.Is(err, ErrToolLoopLimit) || queries != toolLoopCalls || requests.Load() != 1 || result.Content != "" {
		t.Fatalf("call budget reset on restore: calls=%d requests=%d err=%v", queries, requests.Load(), err)
	}
}

func TestToolLoopResumeCumulativeRoundBudget(t *testing.T) {
	var round atomic.Int32
	s, requests := toolLoopFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		n := round.Add(1)
		toolLoopReply(w, []ToolCall{toolLoopCall(fmt.Sprintf("original-%d", n), "read_record", `{"id":"a"}`)}, "", "tool_calls")
	})
	executions := 0
	initial := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
		executions++
		return ToolExecution{Status: ToolNeedsApproval}, nil
	})
	result, err := s.CompleteWithTools(context.Background(), "fixture-session", "query", "fixture-request", toolLoopDefinitions(), initial, toolLoopFixtureAdmission)
	if err != nil {
		t.Fatal(err)
	}
	for err == nil {
		var state toolLoopCheckpoint
		if e := json.Unmarshal(result.Checkpoint, &state); e != nil {
			t.Fatal(e)
		}
		original := state.Steps[len(state.Steps)-1].Call.ID
		executor := toolLoopExecutorFixture(func(_ context.Context, call ToolCall) (ToolExecution, error) {
			executions++
			if call.ID == original {
				return ToolExecution{Status: ToolCompleted, Content: []byte("actual result")}, nil
			}
			return ToolExecution{Status: ToolNeedsApproval}, nil
		})
		restarted, e := New(s.cfg)
		if e != nil {
			t.Fatal(e)
		}
		result, err = restarted.ResumeWithTools(context.Background(), "fixture-session", "fixture-request", result.Checkpoint, toolLoopDefinitions(), executor, toolLoopFixtureAdmission)
		if requests.Load() > toolLoopRounds {
			t.Fatal("unbounded restored rounds")
		}
	}
	if !errors.Is(err, ErrToolLoopLimit) || requests.Load() != toolLoopRounds || executions != 2*(toolLoopRounds-1) {
		t.Fatalf("round budget reset: requests=%d effects=%d error=%v", requests.Load(), executions, err)
	}
	before := executions
	_, err = s.ResumeWithTools(context.Background(), "fixture-session", "fixture-request", result.Checkpoint, toolLoopDefinitions(), initial, toolLoopFixtureAdmission)
	if !errors.Is(err, ErrToolLoopLimit) || requests.Load() != toolLoopRounds || executions != before {
		t.Fatal("exhausted model budget restarted")
	}
}
