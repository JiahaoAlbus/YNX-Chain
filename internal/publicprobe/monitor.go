package publicprobe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const maxResponseBytes = 1 << 20

var sourceCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type Config struct {
	StableReserveURL string
	Interval         time.Duration
	Timeout          time.Duration
	AllowHTTP        bool
}

type Result struct {
	CheckedAt         time.Time `json:"checkedAt"`
	RouteAvailable    bool      `json:"routeAvailable"`
	ProviderAvailable bool      `json:"providerAvailable"`
	ReserveFailure    bool      `json:"reserveFailure"`
	HTTPStatus        int       `json:"httpStatus"`
	SourceCommit      string    `json:"sourceCommit,omitempty"`
	FailureCodes      []string  `json:"failureCodes,omitempty"`
	ErrorCode         string    `json:"errorCode,omitempty"`
}

type Snapshot struct {
	Result
	Observed               bool      `json:"observed"`
	Fresh                  bool      `json:"fresh"`
	ConsecutiveFailures    uint64    `json:"consecutiveFailures"`
	LastSuccessAt          time.Time `json:"lastSuccessAt,omitempty"`
	ProbeIntervalSeconds   float64   `json:"probeIntervalSeconds"`
	StableReservePublicURL string    `json:"stableReservePublicUrl"`
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
	return nil
}

func New(config Config) (*Monitor, error) {
	config.StableReserveURL = strings.TrimSpace(config.StableReserveURL)
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
	m.mu.Lock()
	m.result = result
	m.observed = true
	if result.RouteAvailable {
		m.consecutiveFailures = 0
		m.lastSuccessAt = result.CheckedAt
	} else {
		m.consecutiveFailures++
	}
	m.mu.Unlock()
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
	}
}

func (m *Monitor) Handler(build buildinfo.Info) http.Handler {
	build = buildinfo.Normalize(build)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		snapshot := m.Snapshot(time.Now().UTC())
		status := http.StatusOK
		if !snapshot.Observed || !snapshot.Fresh || !snapshot.RouteAvailable {
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
	fmt.Fprintf(&output, "# HELP ynx_economics_monitor_build_info Build identity for the public economics monitor.\n# TYPE ynx_economics_monitor_build_info gauge\nynx_economics_monitor_build_info{commit=\"%s\",release=\"%s\"} 1\n", prometheusLabel(build.Commit), prometheusLabel(build.Release))
	if snapshot.SourceCommit != "" {
		fmt.Fprintf(&output, "# HELP ynx_public_stable_reserve_source_commit_info Public Explorer source commit observed by the probe.\n# TYPE ynx_public_stable_reserve_source_commit_info gauge\nynx_public_stable_reserve_source_commit_info{source_commit=\"%s\"} 1\n", prometheusLabel(snapshot.SourceCommit))
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
