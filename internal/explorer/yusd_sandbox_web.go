package explorer

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
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/yusdsandbox"
)

const yusdSandboxMaxResponseBytes = 1 << 20

var yusdSandboxSourceCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type YUSDSandboxProjection struct {
	baseURL string
	client  *http.Client
}

type yusdSandboxHealth struct {
	Service                 string         `json:"service"`
	TestnetOnly             bool           `json:"testnetOnly"`
	RealityValue            bool           `json:"realityValue"`
	ExternalReserveAttested bool           `json:"externalReserveAttested"`
	ExternalExecution       bool           `json:"externalExecutionEnabled"`
	ProductionReady         bool           `json:"productionReady"`
	Failure                 bool           `json:"failure"`
	Build                   buildinfo.Info `json:"build"`
}

type YUSDSandboxPublicSnapshot struct {
	Snapshot yusdsandbox.Snapshot `json:"snapshot"`
	Build    buildinfo.Info       `json:"build"`
}

func NewYUSDSandboxProjection(rawURL string, timeout time.Duration) (*YUSDSandboxProjection, error) {
	rawURL = strings.TrimSpace(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" ||
		parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("YUSD Sandbox upstream must be an absolute loopback HTTP origin without credentials, path, query or fragment")
	}
	if port, err := strconv.ParseUint(parsed.Port(), 10, 16); err != nil || port == 0 {
		return nil, errors.New("YUSD Sandbox upstream port is invalid")
	}
	if timeout < time.Second || timeout > 15*time.Second {
		return nil, errors.New("YUSD Sandbox upstream timeout must be between one and fifteen seconds")
	}
	return &YUSDSandboxProjection{
		baseURL: strings.TrimSuffix(rawURL, "/"),
		client: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return errors.New("YUSD Sandbox upstream redirects are disabled")
			},
		},
	}, nil
}

func (s *Server) SetYUSDSandboxProjection(projection *YUSDSandboxProjection) {
	s.yusdSandboxProjection = projection
}

func (s *Server) handleYUSDSandbox(w http.ResponseWriter, r *http.Request) {
	requestID := economicsRequestID(r)
	traceID := economicsTraceID(r)
	w.Header().Set("X-Request-ID", requestID)
	w.Header().Set("X-Trace-ID", traceID)
	w.Header().Set("Cache-Control", "no-store")
	base := map[string]any{
		"schemaVersion": 1, "source": "ynx-yusd-sandbox-explorer-adapter", "version": 1,
		"requestId": requestID, "traceId": traceID, "sourceCommit": s.build.Commit,
		"adapterReleaseClass": s.stableReserveReleaseClass, "release": s.stableReserveRelease,
	}
	if s.yusdSandboxProjection == nil {
		base["asOf"] = nil
		base["coverage"] = "unavailable"
		base["confidence"] = "unavailable"
		base["failure"] = true
		base["failureCodes"] = []string{"YNX_YUSD_SANDBOX_UNAVAILABLE"}
		writeJSON(w, http.StatusServiceUnavailable, base)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	public, err := s.yusdSandboxProjection.Fetch(ctx, time.Now().UTC())
	if err != nil {
		base["asOf"] = nil
		base["coverage"] = "unavailable"
		base["confidence"] = "unavailable"
		base["failure"] = true
		base["failureCodes"] = []string{"YNX_YUSD_SANDBOX_UNAVAILABLE"}
		writeJSON(w, http.StatusServiceUnavailable, base)
		return
	}
	failureCodes := []string{}
	if !public.Snapshot.Solvent {
		failureCodes = append(failureCodes, "YNX_YUSD_SANDBOX_INSOLVENT")
	}
	if !public.Snapshot.Reconciled {
		failureCodes = append(failureCodes, "YNX_YUSD_SANDBOX_UNRECONCILED")
	}
	base["asOf"] = public.Snapshot.AsOf
	base["coverage"] = "testnet-sandbox-reserve-supply-pending-redemptions-and-controls"
	base["confidence"] = "integrity-checked-sandbox-ledger-no-external-reserve-attestation-no-real-value"
	base["failure"] = len(failureCodes) != 0
	base["failureCodes"] = failureCodes
	base["sandbox"] = public.Snapshot
	base["sandboxBuild"] = public.Build
	writeJSON(w, http.StatusOK, base)
}

func (p *YUSDSandboxProjection) Fetch(ctx context.Context, now time.Time) (YUSDSandboxPublicSnapshot, error) {
	var health yusdSandboxHealth
	if err := p.getJSON(ctx, "/health", &health); err != nil {
		return YUSDSandboxPublicSnapshot{}, err
	}
	var snapshot yusdsandbox.Snapshot
	if err := p.getJSON(ctx, "/yusd/snapshot", &snapshot); err != nil {
		return YUSDSandboxPublicSnapshot{}, err
	}
	if err := validateYUSDSandboxPublicSnapshot(health, snapshot, now); err != nil {
		return YUSDSandboxPublicSnapshot{}, err
	}
	return YUSDSandboxPublicSnapshot{Snapshot: snapshot, Build: buildinfo.Normalize(health.Build)}, nil
}

func (p *YUSDSandboxProjection) getJSON(ctx context.Context, path string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "ynx-explorerd-yusd-adapter/1")
	response, err := p.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "application/json") {
		return errors.New("YUSD Sandbox upstream returned an invalid response contract")
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, yusdSandboxMaxResponseBytes+1))
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("YUSD Sandbox upstream returned multiple JSON values")
	}
	return nil
}

func validateYUSDSandboxPublicSnapshot(health yusdSandboxHealth, snapshot yusdsandbox.Snapshot, now time.Time) error {
	build := buildinfo.Normalize(health.Build)
	if health.Service != "ynx-yusd-sandboxd" || !health.TestnetOnly || health.RealityValue ||
		health.ExternalReserveAttested || health.ExternalExecution || health.ProductionReady || health.Failure ||
		!yusdSandboxSourceCommitPattern.MatchString(build.Commit) || !strings.HasPrefix(build.Release, "ynx-yusd-sandbox-") {
		return errors.New("YUSD Sandbox health truth is invalid")
	}
	if snapshot.SchemaVersion != 1 || snapshot.Product != "YUSD Sandbox" || snapshot.Network != "YNX Testnet" ||
		snapshot.Symbol != "YUSD" || snapshot.Decimals != 6 || snapshot.Source != "ynx-yusd-sandbox-persistent-ledger" ||
		snapshot.Version != 1 || snapshot.RealityValue || snapshot.ExternalReserveAttested || snapshot.GuaranteedPeg ||
		snapshot.Failure || snapshot.AsOf.IsZero() || snapshot.AsOf.After(now.Add(time.Minute)) ||
		now.Sub(snapshot.AsOf) > time.Minute || (snapshot.ProviderStatus != "available" && snapshot.ProviderStatus != "outage") ||
		snapshot.ProviderOutage != (snapshot.ProviderStatus == "outage") {
		return errors.New("YUSD Sandbox snapshot truth is invalid")
	}
	if snapshot.SupplyUnits > math.MaxUint64-snapshot.PendingRedemptionUnits {
		return errors.New("YUSD Sandbox backing arithmetic overflows")
	}
	required := snapshot.SupplyUnits + snapshot.PendingRedemptionUnits
	if snapshot.RequiredBackingUnits != required || snapshot.Solvent != (snapshot.ReserveUnits >= required) {
		return errors.New("YUSD Sandbox reserve reconciliation is invalid")
	}
	excess := uint64(0)
	if snapshot.ReserveUnits >= required {
		excess = snapshot.ReserveUnits - required
	}
	if snapshot.ExcessReserveUnits != excess {
		return fmt.Errorf("YUSD Sandbox excess reserve is invalid")
	}
	return nil
}
