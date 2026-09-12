package aigateway

import (
	"errors"
	"strings"
)

// Missing finish_reason is retained for legacy compatible providers. An
// explicit non-stop reason must never be promoted to a complete answer.
func validateProviderFinalAnswer(result providerResponse) error {
	if len(result.Choices) == 0 {
		return errors.New("AI provider returned no final answer")
	}
	choice := result.Choices[0]
	if choice.FinishReason != "" && choice.FinishReason != "stop" {
		return errors.New("AI provider did not finish a complete answer")
	}
	content := strings.TrimSpace(choice.Message.Content)
	lower := strings.ToLower(content)
	if content == "" || strings.Contains(lower, "<think>") || strings.Contains(lower, "</think>") ||
		strings.Contains(lower, "<analysis>") || strings.Contains(lower, "</analysis>") {
		return errors.New("AI provider returned no clean final answer")
	}
	if choice.Message.Role != "" && choice.Message.Role != "assistant" {
		return errors.New("AI provider returned an unexpected answer role")
	}
	return nil
}
