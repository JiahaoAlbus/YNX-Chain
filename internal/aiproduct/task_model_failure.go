package aiproduct

import (
	"context"
	"errors"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

// Stable, non-sensitive diagnosis only. It never changes UNKNOWN to a known
// remote outcome, authorizes retry, stores provider response text or replaces
// an earlier first cause. HTTP rejection is independent of Source admission.
func taskModelFailureCause(err error) string {
	var provider *aigateway.ProviderHTTPError
	switch {
	case errors.As(err, &provider):
		switch provider.StatusCode {
		case http.StatusTooManyRequests:
			switch provider.Category {
			case "quota_exhausted":
				return "MODEL_PROVIDER_QUOTA_EXHAUSTED"
			case "rate_limited":
				return "MODEL_PROVIDER_RATE_LIMITED"
			default:
				return "MODEL_PROVIDER_RATE_OR_QUOTA_REJECTED"
			}
		case http.StatusUnauthorized, http.StatusForbidden:
			return "MODEL_PROVIDER_AUTH_REJECTED"
		default:
			if provider.StatusCode >= 500 {
				return "MODEL_PROVIDER_SERVICE_REJECTED"
			}
			return "MODEL_PROVIDER_REQUEST_REJECTED"
		}
	case errors.Is(err, ErrTaskPagesSourceNotSupplied):
		return "MODEL_BROWSER_READER_CODE_NOT_SUPPLIED"
	case errors.Is(err, ErrTaskPagesSourceUnavailable):
		return "MODEL_BROWSER_SOURCE_NOT_SUPPLIED"
	case errors.Is(err, context.DeadlineExceeded):
		return "MODEL_OR_TOOL_DEADLINE_EXCEEDED"
	case errors.Is(err, context.Canceled):
		return "MODEL_OR_TOOL_CALL_CANCELLED"
	default:
		return "MODEL_OR_TOOL_RUN_UNRESOLVED"
	}
}
