package aigateway

import (
	"net/url"
	"strings"
)

// ToolLoopLimitsDATA describes compiled PRODUCT safety ceilings only. These
// counts are not a monetary budget, a Grant cap, remaining credit or permission.
type ToolLoopLimitsDATA struct {
	ModelRounds  int   `json:"modelRounds"`
	ToolCalls    int   `json:"toolCalls"`
	RuntimeNanos int64 `json:"runtimeNanos"`
}

func TaskToolLoopLimitsDATA() ToolLoopLimitsDATA {
	return ToolLoopLimitsDATA{ModelRounds: toolLoopRounds, ToolCalls: toolLoopCalls, RuntimeNanos: int64(toolLoopRuntimeBudget)}
}

// FixedTaskModelDestinationDATA returns only the fixed configured destination.
// It performs no network/key/file IO and proves no provider availability or
// disclosure authority. No BYOK selection or credential leaves the Service.
func (s *Service) FixedTaskModelDestinationDATA() (providerURL, model string) {
	if s == nil {
		return "", ""
	}
	u, err := url.Parse(s.cfg.ProviderURL)
	if err != nil || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(s.cfg.ProviderURL, "#") {
		return "", ""
	}
	return s.cfg.ProviderURL, s.cfg.Model
}
