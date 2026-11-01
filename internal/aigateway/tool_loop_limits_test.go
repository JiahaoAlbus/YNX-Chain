package aigateway

import (
	"testing"
	"time"
)

func TestP08ReviewLoopLimitsMatchCompiledRuntime(t *testing.T) {
	v := TaskToolLoopLimitsDATA()
	if v.ModelRounds != toolLoopRounds || v.ToolCalls != toolLoopCalls || v.RuntimeNanos != int64(toolLoopRuntimeBudget) || time.Duration(v.RuntimeNanos) != 2*time.Minute {
		t.Fatal("review ceiling differs from runtime")
	}
}
func TestP08ReviewModelDestinationNeverReturnsCredentialURL(t *testing.T) {
	for _, raw := range []string{"http://user:PRIVATE@127.0.0.1/v1", "http://127.0.0.1/v1?key=PRIVATE", "http://127.0.0.1/v1#PRIVATE"} {
		s := &Service{cfg: Config{ProviderURL: raw, Model: "PUBLIC"}}
		url, model := s.FixedTaskModelDestinationDATA()
		if url != "" || model != "" {
			t.Fatal("sensitive URL left review getter")
		}
	}
}
