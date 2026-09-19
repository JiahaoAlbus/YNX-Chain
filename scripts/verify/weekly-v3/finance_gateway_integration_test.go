//go:build weekly_v3_integration

package finance

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Exercises the existing real Gateway HTTP client, not a fakeAI implementation.
// The remote model side is an explicitly synthetic loopback SSE responder.
// Structured job acceptance is a separate test added after owner API freeze.
func TestWeeklyV3GatewayHTTPClientConsumesFragmentedDraft(t *testing.T) {
	provider := &HTTPAIProvider{URL: os.Getenv("WEEKLY_GATEWAY_VALID"), APIKey: "public-local-gateway-fixture-not-a-secret"}
	name, model, available, err := provider.Status(context.Background())
	if err != nil || !available || name != "YNX AI Gateway" || !strings.Contains(model, "fixture-not-a-model") {
		t.Fatalf("real Gateway health contract: %s %s %v %v", name, model, available, err)
	}
	request := AIRequest{Kind: "draft_broker_order", Account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", Permission: "draft-only; never execute", OutputLocale: "en", Context: map[string]any{"brokerIntent": map[string]string{"symbol": "ACME", "side": "buy", "qty": "2", "limitPrice": "125.34"}}}
	var text strings.Builder
	chunks := 0
	result, err := provider.Stream(context.Background(), request, func(delta string) { chunks++; text.WriteString(delta) })
	if err != nil {
		t.Fatal(err)
	}
	draft, ok := result["orderDraft"].(map[string]any)
	if !ok || draft["symbol"] != "ACME" || draft["qty"] != "2" || draft["limitPrice"] != "125.34" || result["draftOnly"] != true || chunks < 2 {
		t.Fatalf("fragmented public fixture draft not preserved: %+v chunks=%d", result, chunks)
	}
}

func TestWeeklyV3GatewayHTTPClientErrorsStayExplicit(t *testing.T) {
	for _, scenario := range []string{"UNAUTHORIZED", "RATE_LIMITED", "MALFORMED_SSE"} {
		t.Run(scenario, func(t *testing.T) {
			provider := &HTTPAIProvider{URL: os.Getenv("WEEKLY_GATEWAY_" + scenario), APIKey: "public-local-gateway-fixture-not-a-secret"}
			result, err := provider.Stream(context.Background(), AIRequest{Kind: "draft_broker_order", Account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", Permission: "draft-only; never execute", OutputLocale: "en"}, func(string) {})
			if err == nil || result != nil {
				t.Fatalf("Gateway failure became a usable draft: %+v %v", result, err)
			}
		})
	}
}
