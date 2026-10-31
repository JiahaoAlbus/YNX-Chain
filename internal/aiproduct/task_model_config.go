package aiproduct

import (
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

// TaskModelConfig is the explicit, fixed-provider task subset of gatewayd's
// original aigateway.Config. The original composition supplies credentials;
// this constructor never reads environment variables, key files or secrets.
// Signer/BFT and BYOK selection operands deliberately do not exist here.
type TaskModelConfig struct {
	ChainURL       string
	ProviderURL    string
	ProviderAPIKey string `json:"-"`
	Model          string
	AccessAPIKey   string `json:"-"`
	UpstreamKey    string `json:"-"`
	UpstreamMode   string
	AuditLog       string
	Window         time.Duration
	MaxRequests    int
}

// NewTaskModelService returns the ORIGINAL Service, not a second chat engine.
// Empty mode retains gatewayd's authoritative default; all model/endpoints and
// required credentials must be explicit. BFT is refused before aigateway.New
// can load any signing material. Rate/audit defaults remain owned by New.
//
// Construction checks configuration only, performs no network/file I/O and
// does not prove a Chain, Source or disclosure is admitted. The real Service
// reads its configured Chain's /status at execution. Task runtime composition
// and each send/final-return disclosure remain the existing loop's responsibility.
func NewTaskModelService(cfg TaskModelConfig) (*aigateway.Service, error) {
	mode := strings.ToLower(strings.TrimSpace(cfg.UpstreamMode))
	if mode == "" {
		mode = aigateway.UpstreamAuthoritative
	}
	if mode != aigateway.UpstreamAuthoritative {
		return nil, errors.New("task model requires authoritative upstream; BFT signing is not supported by this constructor")
	}
	// These are base destinations, not URLs carrying credentials, query state
	// or fragment aliases. Do not include their values in configuration errors.
	for _, raw := range []string{cfg.ChainURL, cfg.ProviderURL} {
		if strings.TrimSpace(raw) == "" {
			continue
		} // Original New owns missing-field errors.
		parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
		if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.Opaque != "" {
			return nil, errors.New("task model base URL must not include credentials, query or fragment")
		}
	}
	return aigateway.New(aigateway.Config{
		ChainURL: cfg.ChainURL, ProviderURL: cfg.ProviderURL,
		ProviderAPIKey: cfg.ProviderAPIKey, Model: cfg.Model,
		AccessAPIKey: cfg.AccessAPIKey, UpstreamKey: cfg.UpstreamKey,
		UpstreamMode: mode, AuditLog: cfg.AuditLog,
		Window: cfg.Window, MaxRequests: cfg.MaxRequests,
	})
}
