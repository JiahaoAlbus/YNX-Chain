package aiproduct

import (
	"strings"
	"testing"
)

func TestConsumeProviderSSEHandlesCRLFAndPartialFinalFrame(t *testing.T) {
	stream := ": keepalive\r\nevent: metadata\r\ndata: {\"requestId\":\"request-1\"}\r\n\r\nevent: token\r\ndata: {\"text\":\"hello\"}\r\n\r\nevent: done\r\ndata: {}"
	var tokens strings.Builder
	result, err := consumeProviderSSE(strings.NewReader(stream), func(token string) { tokens.WriteString(token) })
	if err != nil || result.RequestID != "request-1" || tokens.String() != "hello" {
		t.Fatalf("unexpected provider stream result=%+v tokens=%q err=%v", result, tokens.String(), err)
	}
}

func TestConsumeProviderSSERejectsUntruthfulTerminalStates(t *testing.T) {
	tests := map[string]string{
		"malformed token": "event: metadata\ndata: {\"requestId\":\"request-1\"}\n\nevent: token\ndata: nope\n\nevent: done\ndata: {}\n\n",
		"missing done":    "event: metadata\ndata: {\"requestId\":\"request-1\"}\n\nevent: token\ndata: {\"text\":\"partial\"}\n\n",
		"post terminal":   "event: metadata\ndata: {\"requestId\":\"request-1\"}\n\nevent: done\ndata: {}\n\nevent: token\ndata: {\"text\":\"false success\"}\n\n",
		"provider error":  "event: metadata\ndata: {\"requestId\":\"request-1\"}\n\nevent: error\ndata: {\"error\":\"quota\"}\n\n",
	}
	for name, stream := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := consumeProviderSSE(strings.NewReader(stream), func(string) {}); err == nil {
				t.Fatal("invalid provider stream was accepted")
			}
		})
	}
}
