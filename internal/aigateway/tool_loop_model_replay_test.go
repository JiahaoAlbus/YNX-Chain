package aigateway

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestToolLoopUnconfirmedModelCheckpointCannotResend(t *testing.T) {
	for _, afterTool := range []bool{false, true} {
		name := "first_model"
		if afterTool {
			name = "after_completed_tool"
		}
		t.Run(name, func(t *testing.T) {
			rounds, executions, admissions := 0, 0, 0
			s, requests := toolLoopFixture(t, func(w http.ResponseWriter, r *http.Request) {
				rounds++
				if afterTool && rounds == 1 {
					toolLoopReply(w, []ToolCall{toolLoopCall("original-call", "read_record", `{"id":"PUBLIC-original"}`)}, "", "tool_calls")
					return
				}
				http.Error(w, "PUBLIC response not usable", http.StatusServiceUnavailable)
			})
			executor := toolLoopExecutorFixture(func(context.Context, ToolCall) (ToolExecution, error) {
				executions++
				return ToolExecution{Status: ToolCompleted, Content: []byte(`{"PUBLIC":"original receipt"}`)}, nil
			})
			admit := func(context.Context, string, string, []byte) error { admissions++; return nil }
			failed, err := s.CompleteWithTools(context.Background(), "fixture-session", "PUBLIC request", "fixture-request", toolLoopDefinitions(), executor, admit)
			if err == nil || len(failed.Checkpoint) == 0 {
				t.Fatal("missing original failure/checkpoint")
			}
			beforeRequests, beforeExecutions, beforeAdmissions := requests.Load(), executions, admissions
			restarted, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			result, err := restarted.ResumeWithTools(context.Background(), "fixture-session", "fixture-request", failed.Checkpoint, toolLoopDefinitions(), executor, admit)
			if err == nil || !strings.Contains(err.Error(), "model response") || result.Content != "" || requests.Load() != beforeRequests || executions != beforeExecutions || admissions != beforeAdmissions {
				t.Fatalf("unconfirmed provider checkpoint replayed: err=%v model=%d->%d tools=%d->%d admission=%d->%d", err, beforeRequests, requests.Load(), beforeExecutions, executions, beforeAdmissions, admissions)
			}
		})
	}
}
