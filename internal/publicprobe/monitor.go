package publicprobe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/yusdsandbox"
)

const maxResponseBytes = 1 << 20

var sourceCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type Config struct {
	StableReserveURL string
	YUSDSandboxURL   string
	Interval         time.Duration
	Timeout          time.Duration
	AllowHTTP        bool
}

type Result struct {
	CheckedAt         time.Time         `json:"checkedAt"`
	RouteAvailable    bool              `json:"routeAvailable"`
	ProviderAvailable bool              `json:"providerAvailable"`
	ReserveFailure    bool              `json:"reserveFailure"`
	HTTPStatus        int               `json:"httpStatus"`
	SourceCommit      string            `json:"sourceCommit,omitempty"`
	FailureCodes      []string          `json:"failureCodes,omitempty"`
	ErrorCode         string            `json:"errorCode,omitempty"`
	YUSDSandbox       YUSDSandboxResult `json:"yusdSandbox"`
}

type YUSDSandboxResult struct {
	RouteAvailable         bool     `json:"routeAvailable"`
	Solvent                bool     `json:"solvent"`
	Reconciled             bool     `json:"reconciled"`
	HTTPStatus             int      `json:"httpStatus"`
	SourceCommit           string   `json:"sourceCommit,omitempty"`
	SandboxSourceCommit    string   `json:"sandboxSourceCommit,omitempty"`
	ReserveUnits           uint64   `json:"reserveUnits"`
	SupplyUnits            uint64   `json:"supplyUnits"`
	PendingRedemptionUnits uint64   `json:"pendingRedemptionUnits"`
	FailureCodes           []string `json:"failureCodes,omitempty"`
	ErrorCode              string   `json:"errorCode,omitempty"`
}

type Snapshot struct {
	Result
	Observed               bool      `json:"observed"`
	Fresh                  bool      `json:"fresh"`
	ConsecutiveFailures    uint64    `json:"consecutiveFailures"`
	LastSuccessAt          time.Time `json:"lastSuccessAt,omitempty"`
	ProbeIntervalSeconds   float64   `json:"probeIntervalSeconds"`
	StableReservePublicURL string    `json:"stableReservePublicUrl"`
	YUSDSandboxPublicURL   string    `json:"yusdSandboxPublicUrl,omitempty"`
}

type Monitor struct {
	config Config
	client *http.Client

	mu                  sync.RWMutex
	result              Result
	observed            bool
	consecutiveFailures uint64
	lastSuccessAt       time.Time
}

type reserveResponse struct {
	Failure             bool            `json:"failure"`
	FailureCodes        []string        `json:"failureCodes"`
	SourceCommit        string          `json:"sourceCommit"`
	AdapterReleaseClass string          `json:"adapterReleaseClass"`
	Release             releaseResponse `json:"release"`
	Reserve             json.RawMessage `json:"reserve"`
}

type yusdSandboxResponse struct {
	Failure             bool                 `json:"failure"`
	FailureCodes        []string             `json:"failureCodes"`
	SourceCommit        string               `json:"sourceCommit"`
	AdapterReleaseClass string               `json:"adapterReleaseClass"`
	Release             releaseResponse      `json:"release"`
	Sandbox             yusdsandbox.Snapshot `json:"sandbox"`
	SandboxBuild        buildinfo.Info       `json:"sandboxBuild"`
}

type releaseResponse struct {
	DeployedPublic bool `json:"deployedPublic"`
}

func ValidateConfig(config Config) error {
	if config.Interval < time.Second || config.Interval > 10*time.Minute {
		return errors.New("probe interval must be between one second and ten minutes")
	}
	if config.Timeout < time.Second || config.Timeout > config.Interval {
		return errors.New("probe timeout must be between one second and the probe interval")
	}
	parsed, err := url.Parse(strings.TrimSpace(config.StableReserveURL))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		parsed.Path != "/api/stable/reserve" {
		return errors.New("stable reserve URL must be an absolute URL ending at /api/stable/reserve without credentials, query or fragment")
	}
	if parsed.Scheme != "https" && !(config.AllowHTTP && parsed.Scheme == "http") {
		return errors.New("stable reserve URL must use HTTPS")
	}
	if strings.TrimSpace(config.YUSDSandboxURL) != "" {
		yusd, err := url.Parse(strings.TrimSpace(config.YUSDSandboxURL))
		if err != nil || yusd.Host == "" || yusd.User != nil || yusd.RawQuery != "" || yusd.Fragment != "" ||
			yusd.Path != "/api/stable/yusd-sandbox" {
			return errors.New("YUSD Sandbox URL must be an absolute URL ending at /api/stable/yusd-sandbox without credentials, query or fragment")
		}
		if yusd.Scheme != parsed.Scheme || yusd.Host != parsed.Host {
			return errors.New("YUSD Sandbox URL must use the same public HTTPS origin as the Stable Reserve URL")
		}
	}
	return nil
}

func New(config Config) (*Monitor, error) {
	config.StableReserveURL = strings.TrimSpace(config.StableReserveURL)
	config.YUSDSandboxURL = strings.TrimSpace(config.YUSDSandboxURL)
	if err := ValidateConfig(config); err != nil {
		return nil, err
	}
	monitor := &Monitor{config: config}
	monitor.client = &http.Client{
		Timeout: config.Timeout,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("public probe redirect limit exceeded")
			}
			if request.URL.Scheme != "https" && !(config.AllowHTTP && request.URL.Scheme == "http") {
				return errors.New("public probe redirect changed to an unsafe scheme")
			}
			origin, _ := url.Parse(config.StableReserveURL)
			if request.URL.Host != origin.Host {
				return errors.New("public probe redirect changed origin")
			}
			return nil
		},
	}
	return monitor, nil
}

func (m *Monitor) Run(ctx context.Context) {
	m.ProbeOnce(ctx)
	ticker := time.NewTicker(m.config.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.ProbeOnce(ctx)
		}
	}
}

func (m *Monitor) ProbeOnce(ctx context.Context) Result {
	result := m.probe(ctx)
	if m.config.YUSDSandboxURL != "" {
		result.YUSDSandbox = m.probeYUSDSandbox(ctx)
	}
	m.mu.Lock()
	m.result = result
	m.observed = true
	if result.RouteAvailable && (m.config.YUSDSandboxURL == "" || result.YUSDSandbox.RouteAvailable) {
		m.consecutiveFailures = 0
		m.lastSuccessAt = result.CheckedAt
	} else {
		m.consecutiveFailures++
	}
	m.mu.Unlock()
	return result
}

func (m *Monitor) probeYUSDSandbox(ctx context.Context) YUSDSandboxResult {
	result := YUSDSandboxResult{}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, m.config.YUSDSandboxURL, nil)
	if err != nil {
		result.ErrorCode = "request_build_failed"
		return result
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "ynx-economics-monitord/1")
	response, err := m.client.Do(request)
	if err != nil {
		result.ErrorCode = "transport_failed"
		return result
	}
	defer response.Body.Close()
	result.HTTPStatus = response.StatusCode
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		result.ErrorCode = "response_read_failed"
		return result
	}
	if len(body) > maxResponseBytes {
		result.ErrorCode = "response_too_large"
		return result
	}
	var payload yusdSandboxResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		result.ErrorCode = "response_invalid_json"
		return result
	}
	payload.SourceCommit = strings.TrimSpace(payload.SourceCommit)
	payload.SandboxBuild = buildinfo.Normalize(payload.SandboxBuild)
	if response.StatusCode != http.StatusOK || payload.AdapterReleaseClass != "public_testnet" ||
		!payload.Release.DeployedPublic || !sourceCommitPattern.MatchString(payload.SourceCommit) ||
		!sourceCommitPattern.MatchString(payload.SandboxBuild.Commit) ||
		!strings.HasPrefix(payload.SandboxBuild.Release, "ynx-yusd-sandbox-") {
		result.ErrorCode = "release_truth_invalid"
		return result
	}
	sandbox := payload.Sandbox
	if sandbox.SchemaVersion != 1 || sandbox.Product != "YUSD Sandbox" || sandbox.Network != "YNX Testnet" ||
		sandbox.Symbol != "YUSD" || sandbox.Decimals != 6 || sandbox.RealityValue ||
		sandbox.ExternalReserveAttested || sandbox.GuaranteedPeg || sandbox.Failure ||
		sandbox.AsOf.IsZero() || time.Since(sandbox.AsOf) > time.Minute || sandbox.AsOf.After(time.Now().UTC().Add(time.Minute)) ||
		(sandbox.ProviderStatus != "available" && sandbox.ProviderStatus != "outage") ||
		sandbox.ProviderOutage != (sandbox.ProviderStatus == "outage") ||
		payload.Failure != (len(payload.FailureCodes) != 0) ||
		sandbox.SupplyUnits > math.MaxUint64-sandbox.PendingRedemptionUnits {
		result.ErrorCode = "sandbox_truth_invalid"
		return result
	}
	required := sandbox.SupplyUnits + sandbox.PendingRedemptionUnits
	excess := uint64(0)
	if sandbox.ReserveUnits >= required {
		excess = sandbox.ReserveUnits - required
	}
	if sandbox.RequiredBackingUnits != required || sandbox.Solvent != (sandbox.ReserveUnits >= required) ||
		sandbox.ExcessReserveUnits != excess {
		result.ErrorCode = "sandbox_reconciliation_invalid"
		return result
	}
	result.RouteAvailable = true
	result.Solvent = sandbox.Solvent
	result.Reconciled = sandbox.Reconciled
	result.SourceCommit = payload.SourceCommit
	result.SandboxSourceCommit = payload.SandboxBuild.Commit
	result.ReserveUnits = sandbox.ReserveUnits
	result.SupplyUnits = sandbox.SupplyUnits
	result.PendingRedemptionUnits = sandbox.PendingRedemptionUnits
	result.FailureCodes = append([]string(nil), payload.FailureCodes...)
	return result
}

func (m *Monitor) probe(ctx context.Context) Result {
	result := Result{CheckedAt: time.Now().UTC()}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, m.config.StableReserveURL, nil)
	if err != nil {
		result.ErrorCode = "request_build_failed"
		return result
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "ynx-economics-monitord/1")
	response, err := m.client.Do(request)
	if err != nil {
		result.ErrorCode = "transport_failed"
		return result
	}
	defer response.Body.Close()
	result.HTTPStatus = response.StatusCode
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		result.ErrorCode = "response_read_failed"
		return result
	}
	if len(body) > maxResponseBytes {
		result.ErrorCode = "response_too_large"
		return result
	}
	var payload reserveResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		result.ErrorCode = "response_invalid_json"
		return result
	}
	payload.SourceCommit = strings.TrimSpace(payload.SourceCommit)
	if payload.AdapterReleaseClass != "public_testnet" || !payload.Release.DeployedPublic ||
		!sourceCommitPattern.MatchString(payload.SourceCommit) {
		result.ErrorCode = "release_truth_invalid"
		return result
	}
	result.SourceCommit = payload.SourceCommit
	result.ReserveFailure = payload.Failure
	result.FailureCodes = append([]string(nil), payload.FailureCodes...)
	switch response.StatusCode {
	case http.StatusOK:
		if len(payload.Reserve) == 0 || string(payload.Reserve) == "null" {
			result.ErrorCode = "provider_payload_missing"
			return result
		}
		result.RouteAvailable = true
		result.ProviderAvailable = true
	case http.StatusServiceUnavailable:
		if !payload.Failure || !contains(payload.FailureCodes, "YNX_STABLE_RESERVE_UNAVAILABLE") {
			result.ErrorCode = "unavailable_contract_invalid"
			return result
		}
		result.RouteAvailable = true
	default:
		result.ErrorCode = "unexpected_http_status"
	}
	return result
}

func (m *Monitor) Snapshot(now time.Time) Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	fresh := m.observed && !m.result.CheckedAt.IsZero() && now.UTC().Sub(m.result.CheckedAt) <= 3*m.config.Interval
	return Snapshot{
		Result:                 m.result,
		Observed:               m.observed,
		Fresh:                  fresh,
		ConsecutiveFailures:    m.consecutiveFailures,
		LastSuccessAt:          m.lastSuccessAt,
		ProbeIntervalSeconds:   m.config.Interval.Seconds(),
		StableReservePublicURL: m.config.StableReserveURL,
		YUSDSandboxPublicURL:   m.config.YUSDSandboxURL,
	}
}

func (m *Monitor) Handler(build buildinfo.Info) http.Handler {
	build = buildinfo.Normalize(build)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		snapshot := m.Snapshot(time.Now().UTC())
		status := http.StatusOK
		if !snapshot.Observed || !snapshot.Fresh || !snapshot.RouteAvailable ||
			(m.config.YUSDSandboxURL != "" && !snapshot.YUSDSandbox.RouteAvailable) {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, map[string]any{
			"ok": status == http.StatusOK, "service": "ynx-economics-monitord",
			"build": build, "probe": snapshot,
		})
	})
	mux.HandleFunc("GET /version", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"service": "ynx-economics-monitord", "build": build})
	})
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		snapshot := m.Snapshot(time.Now().UTC())
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		fmt.Fprint(w, prometheus(snapshot, build))
	})
	return mux
}

func prometheus(snapshot Snapshot, build buildinfo.Info) string {
	boolValue := func(value bool) int {
		if value {
			return 1
		}
		return 0
	}
	lastProbe := int64(0)
	if !snapshot.CheckedAt.IsZero() {
		lastProbe = snapshot.CheckedAt.Unix()
	}
	lastSuccess := int64(0)
	if !snapshot.LastSuccessAt.IsZero() {
		lastSuccess = snapshot.LastSuccessAt.Unix()
	}
	var output strings.Builder
	fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_probe_success Whether the public route returned a valid public Testnet reserve contract.\n# TYPE ynx_public_stable_reserve_probe_success gauge\nynx_public_stable_reserve_probe_success %d\n", boolValue(snapshot.RouteAvailable && snapshot.Fresh))
	fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_provider_available Whether the public route exposes a current provider-signed reserve attestation.\n# TYPE ynx_public_stable_reserve_provider_available gauge\nynx_public_stable_reserve_provider_available %d\n", boolValue(snapshot.ProviderAvailable && snapshot.Fresh))
	fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_http_status_code Last public reserve HTTP status code.\n# TYPE ynx_public_stable_reserve_http_status_code gauge\nynx_public_stable_reserve_http_status_code %d\n", snapshot.HTTPStatus)
	fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_consecutive_failures Consecutive public route probe failures.\n# TYPE ynx_public_stable_reserve_consecutive_failures gauge\nynx_public_stable_reserve_consecutive_failures %d\n", snapshot.ConsecutiveFailures)
	fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_last_probe_timestamp_seconds Last public route probe time.\n# TYPE ynx_public_stable_reserve_last_probe_timestamp_seconds gauge\nynx_public_stable_reserve_last_probe_timestamp_seconds %d\n", lastProbe)
	fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_last_success_timestamp_seconds Last successful public route probe time.\n# TYPE ynx_public_stable_reserve_last_success_timestamp_seconds gauge\nynx_public_stable_reserve_last_success_timestamp_seconds %d\n", lastSuccess)
	fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_probe_success Whether the public Explorer route returned a valid no-real-value YUSD Sandbox contract.\n# TYPE ynx_public_yusd_sandbox_probe_success gauge\nynx_public_yusd_sandbox_probe_success %d\n", boolValue(snapshot.YUSDSandbox.RouteAvailable && snapshot.Fresh))
	fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_solvent Whether the public YUSD Sandbox reports reserve solvency.\n# TYPE ynx_public_yusd_sandbox_solvent gauge\nynx_public_yusd_sandbox_solvent %d\n", boolValue(snapshot.YUSDSandbox.Solvent && snapshot.Fresh))
	fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_reconciled Whether the public YUSD Sandbox reports reconciled supply.\n# TYPE ynx_public_yusd_sandbox_reconciled gauge\nynx_public_yusd_sandbox_reconciled %d\n", boolValue(snapshot.YUSDSandbox.Reconciled && snapshot.Fresh))
	fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_http_status_code Last public YUSD Sandbox HTTP status code.\n# TYPE ynx_public_yusd_sandbox_http_status_code gauge\nynx_public_yusd_sandbox_http_status_code %d\n", snapshot.YUSDSandbox.HTTPStatus)
	fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_reserve_units Public Testnet sandbox reserve units.\n# TYPE ynx_public_yusd_sandbox_reserve_units gauge\nynx_public_yusd_sandbox_reserve_units %d\n", snapshot.YUSDSandbox.ReserveUnits)
	fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_supply_units Public Testnet sandbox supply units.\n# TYPE ynx_public_yusd_sandbox_supply_units gauge\nynx_public_yusd_sandbox_supply_units %d\n", snapshot.YUSDSandbox.SupplyUnits)
	fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_pending_redemption_units Public Testnet sandbox pending redemption units.\n# TYPE ynx_public_yusd_sandbox_pending_redemption_units gauge\nynx_public_yusd_sandbox_pending_redemption_units %d\n", snapshot.YUSDSandbox.PendingRedemptionUnits)
	fmt.Fprintf(&output, "# HELP ynx_economics_monitor_build_info Build identity for the public economics monitor.\n# TYPE ynx_economics_monitor_build_info gauge\nynx_economics_monitor_build_info{commit=\"%s\",release=\"%s\"} 1\n", prometheusLabel(build.Commit), prometheusLabel(build.Release))
	if snapshot.SourceCommit != "" {
		fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_source_commit_info Public Explorer source commit observed by the probe.\n# TYPE ynx_public_stable_reserve_source_commit_info gauge\nynx_public_stable_reserve_source_commit_info{source_commit=\"%s\"} 1\n", prometheusLabel(snapshot.SourceCommit))
	}
	if snapshot.YUSDSandbox.SandboxSourceCommit != "" {
		fmt.Fprintf(&output, "# HELP ynx_public_yusd_sandbox_source_commit_info Public YUSD Sandbox runtime source commit observed through Explorer.\n# TYPE ynx_public_yusd_sandbox_source_commit_info gauge\nynx_public_yusd_sandbox_source_commit_info{source_commit=\"%s\"} 1\n", prometheusLabel(snapshot.YUSDSandbox.SandboxSourceCommit))
	}
	return output.String()
}

func prometheusLabel(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, "\n", `\n`)
	return strings.ReplaceAll(value, `"`, `\"`)
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (r Result) String() string {
	return "routeAvailable=" + strconv.FormatBool(r.RouteAvailable) +
		" providerAvailable=" + strconv.FormatBool(r.ProviderAvailable) +
		" httpStatus=" + strconv.Itoa(r.HTTPStatus)
}
