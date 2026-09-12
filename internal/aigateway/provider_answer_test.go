package aigateway

import (
	"encoding/json"
	"testing"
)

func TestProviderFinalAnswerRejectsIncompleteOrThinkingOutput(t *testing.T) {
	for _, tc := range []struct {
		name, reason, content, role string
		valid                       bool
	}{
		{"complete", "stop", "A complete answer.", "assistant", true},
		{"legacy", "", "Legacy compatible answer.", "", true},
		{"truncated", "length", "Partial answer", "assistant", false},
		{"filtered", "content_filter", "Filtered", "assistant", false},
		{"tool", "tool_calls", "Call a tool", "assistant", false},
		{"thinking", "stop", "<think>Draft</think>Answer", "assistant", false},
		{"analysis", "stop", "<analysis>Draft", "assistant", false},
		{"empty", "stop", " ", "assistant", false},
		{"role", "stop", "Untrusted", "system", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": tc.reason, "message": map[string]string{"role": tc.role, "content": tc.content}}}})
			var result providerResponse
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatal(err)
			}
			if err := validateProviderFinalAnswer(result); (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
}
