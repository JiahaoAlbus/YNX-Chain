package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type EndpointAuthorityGate interface {
	Authorize(context.Context) error
}

type EndpointAuthorityBrowserConfigProvider interface {
	BrowserConfig(context.Context) ([]byte, error)
}

type EndpointAuthorityHistoryCheckpoint struct {
	RootVersion   int64  `json:"rootVersion"`
	Sequence      int64  `json:"sequence"`
	PayloadSHA256 string `json:"payloadSha256"`
}
type EndpointAuthorityBrowserHistoryProvider interface {
	BrowserHistory(context.Context, EndpointAuthorityHistoryCheckpoint) ([]byte, error)
}

type EndpointAuthorityBrowserRootAnchorProvider interface {
	BrowserRootAnchor(context.Context, EndpointAuthorityHistoryCheckpoint) ([]byte, error)
}

type NodeEndpointAuthorityConfig struct {
	NodeBinary, Script, TrustRootFile, ManifestFile, CheckpointFile, TrustedTimeFile string
	Timeout                                                                          time.Duration
	Diagnostic                                                                       func(EndpointAuthorityDiagnostic)
}

type nodeEndpointAuthority struct {
	config    NodeEndpointAuthorityConfig
	slots     chan struct{}
	browserMu sync.Mutex
}
type unavailableEndpointAuthority struct{ code string }

func (g unavailableEndpointAuthority) Authorize(context.Context) error {
	return &productsessionv2.Error{Code: g.code, Status: 503}
}

func NewNodeEndpointAuthority(config NodeEndpointAuthorityConfig) (EndpointAuthorityGate, error) {
	values := []string{config.NodeBinary, config.Script, config.TrustRootFile, config.ManifestFile, config.CheckpointFile, config.TrustedTimeFile}
	present := 0
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			present++
		}
	}
	if present == 0 {
		return unavailableEndpointAuthority{code: "FINANCE_AUTHORITY_V2_NOT_CONFIGURED"}, nil
	}
	if present != len(values) {
		return nil, errors.New("Finance Endpoint Authority v2 configuration is incomplete")
	}
	for _, value := range values {
		if !filepath.IsAbs(value) || filepath.Clean(value) != value {
			return nil, errors.New("Finance Endpoint Authority v2 requires fixed absolute paths")
		}
	}
	if config.Timeout == 0 {
		config.Timeout = 3 * time.Second
	}
	if config.Timeout < time.Second || config.Timeout > 10*time.Second {
		return nil, errors.New("Finance Endpoint Authority v2 timeout must be between 1s and 10s")
	}
	return &nodeEndpointAuthority{config: config, slots: make(chan struct{}, 4)}, nil
}

func (g *nodeEndpointAuthority) Authorize(ctx context.Context) error {
	stdout, diagnostic, err := g.execute(ctx, "")
	if err != nil {
		return err
	}
	var response struct {
		SchemaVersion           string `json:"schemaVersion"`
		Status                  string `json:"status"`
		WalletGateway           string `json:"walletGateway"`
		FinanceOrigin           string `json:"financeOrigin"`
		ManifestVersion         string `json:"manifestVersion"`
		PayloadSHA256           string `json:"payloadSha256"`
		OfficialSandboxVerified bool   `json:"officialSandboxVerified"`
		ProviderVerified        bool   `json:"providerVerified"`
		ProductionApproved      bool   `json:"productionApproved"`
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout))
	decoder.DisallowUnknownFields()
	if decodeErr := decoder.Decode(&response); decodeErr != nil || decoder.Decode(&struct{}{}) != io.EOF {
		g.recordResponseFailure(diagnostic)
		return &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", Status: 503}
	}
	if response.SchemaVersion != "ynx-finance-endpoint-authority-runtime/v1" || response.Status != "VERIFIED" || response.WalletGateway != BrowserWalletAuthority || response.FinanceOrigin != BrowserFinanceOrigin || !regexp.MustCompile(`^2\.0\.0\.[1-9][0-9]*$`).MatchString(response.ManifestVersion) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(response.PayloadSHA256) || response.OfficialSandboxVerified || response.ProviderVerified || response.ProductionApproved {
		g.recordResponseFailure(diagnostic)
		return &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_REJECTED", Status: 503}
	}
	return nil
}

func (g *nodeEndpointAuthority) RequiresProofPrevalidation() bool { return true }

func (g *nodeEndpointAuthority) BrowserConfig(ctx context.Context) ([]byte, error) {
	g.browserMu.Lock()
	defer g.browserMu.Unlock()
	stdout, diagnostic, err := g.execute(ctx, "browser-config")
	if err != nil {
		return nil, err
	}
	var response struct {
		SchemaVersion    string          `json:"schemaVersion"`
		TrustRoot        json.RawMessage `json:"trustRoot"`
		Manifest         json.RawMessage `json:"manifest"`
		ServerCheckpoint struct {
			RootVersion   int64  `json:"rootVersion"`
			Sequence      int64  `json:"sequence"`
			PayloadSHA256 string `json:"payloadSha256"`
		} `json:"serverCheckpoint"`
		TrustedTimeMS int64 `json:"trustedTimeMs"`
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout))
	decoder.DisallowUnknownFields()
	if decodeErr := decoder.Decode(&response); decodeErr != nil || decoder.Decode(&struct{}{}) != io.EOF || response.SchemaVersion != "ynx-finance-endpoint-authority-browser-config/v1" || len(response.TrustRoot) == 0 || len(response.Manifest) == 0 || response.ServerCheckpoint.RootVersion < 1 || response.ServerCheckpoint.Sequence < 0 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(response.ServerCheckpoint.PayloadSHA256) || response.TrustedTimeMS < 0 {
		g.recordResponseFailure(diagnostic)
		return nil, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", Status: 503}
	}
	// A cached time anchor would restart the browser's monotonic clock on every
	// reload and could extend an expired manifest. Fetch a fresh server sample.
	return append([]byte(nil), stdout...), nil
}

func (g *nodeEndpointAuthority) BrowserHistory(ctx context.Context, after EndpointAuthorityHistoryCheckpoint) ([]byte, error) {
	if after.RootVersion < 1 || after.Sequence < 0 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(after.PayloadSHA256) {
		return nil, errors.New("FINANCE_AUTHORITY_V2_HISTORY_QUERY_INVALID")
	}
	g.browserMu.Lock()
	defer g.browserMu.Unlock()
	query, _ := json.Marshal(after)
	stdout, diagnostic, err := g.execute(ctx, "browser-history", string(query))
	if err != nil {
		return nil, err
	}
	var response struct {
		SchemaVersion string                             `json:"schemaVersion"`
		After         EndpointAuthorityHistoryCheckpoint `json:"after"`
		Manifests     []json.RawMessage                  `json:"manifests"`
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout))
	decoder.DisallowUnknownFields()
	// History contains intermediate documents only. Adjacent checkpoints have
	// an explicit empty array; the separately verified current manifest closes
	// that transition. A missing/null array remains an invalid reader response.
	if decoder.Decode(&response) != nil || decoder.Decode(&struct{}{}) != io.EOF || response.SchemaVersion != "ynx-finance-endpoint-authority-history/v1" || response.After != after || response.Manifests == nil || len(response.Manifests) > 2 {
		g.recordResponseFailure(diagnostic)
		return nil, errors.New("FINANCE_AUTHORITY_V2_HISTORY_RESPONSE_INVALID")
	}
	return append([]byte(nil), stdout...), nil
}

func (g *nodeEndpointAuthority) BrowserRootAnchor(ctx context.Context, after EndpointAuthorityHistoryCheckpoint) ([]byte, error) {
	if after.RootVersion < 1 || after.Sequence < 0 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(after.PayloadSHA256) {
		return nil, errors.New("FINANCE_AUTHORITY_V2_HISTORY_QUERY_INVALID")
	}
	g.browserMu.Lock()
	defer g.browserMu.Unlock()
	query, _ := json.Marshal(after)
	stdout, diagnostic, err := g.execute(ctx, "browser-root-anchor", string(query))
	if err != nil {
		return nil, err
	}
	var response struct {
		SchemaVersion string                             `json:"schemaVersion"`
		After         EndpointAuthorityHistoryCheckpoint `json:"after"`
		Manifest      json.RawMessage                    `json:"manifest"`
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&response) != nil || decoder.Decode(&struct{}{}) != io.EOF || response.SchemaVersion != "ynx-finance-endpoint-authority-root-anchor/v1" || response.After != after || len(response.Manifest) == 0 {
		g.recordResponseFailure(diagnostic)
		return nil, errors.New("FINANCE_AUTHORITY_V2_ANCHOR_RESPONSE_INVALID")
	}
	return append([]byte(nil), stdout...), nil
}

func (g *nodeEndpointAuthority) execute(ctx context.Context, outputMode string, args ...string) (output []byte, diagnostic EndpointAuthorityDiagnostic, failure error) {
	started := time.Now()
	diagnostic = EndpointAuthorityDiagnostic{Operation: authorityOperation(outputMode), Phase: "queue", Cause: "UNCLASSIFIED", Exit: "not_started", ChildPhase: "unknown", ChildTelemetry: "not_started"}
	defer func() {
		diagnostic.TotalMilliseconds = time.Since(started).Milliseconds()
		if failure != nil {
			g.recordDiagnostic(diagnostic)
		}
	}()
	ctx, cancel := context.WithTimeout(ctx, g.config.Timeout)
	defer cancel()
	select {
	case g.slots <- struct{}{}:
		defer func() { <-g.slots }()
	case <-ctx.Done():
		diagnostic.QueueMilliseconds = time.Since(started).Milliseconds()
		diagnostic.Cause = "BUSY"
		return nil, diagnostic, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_BUSY", Status: 503}
	}
	diagnostic.QueueMilliseconds = time.Since(started).Milliseconds()
	executionStarted := time.Now()
	diagnostic.Phase = "execution"
	command := exec.CommandContext(ctx, g.config.NodeBinary, append([]string{g.config.Script}, args...)...)
	command.Env = []string{
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE=" + g.config.TrustRootFile,
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE=" + g.config.ManifestFile,
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_CHECKPOINT_FILE=" + g.config.CheckpointFile,
		"YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUSTED_TIME_FILE=" + g.config.TrustedTimeFile,
	}
	if outputMode != "" {
		command.Env = append(command.Env, "YNX_FINANCE_ENDPOINT_AUTHORITY_V2_OUTPUT_MODE="+outputMode)
	}
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	collectPhases := attachAuthorityPhases(command)
	err := command.Run()
	diagnostic.ChildPhase, diagnostic.ChildElapsedMilliseconds, diagnostic.ChildTelemetry = collectPhases()
	diagnostic.ExecutionMilliseconds = time.Since(executionStarted).Milliseconds()
	diagnostic.Exit = "start_failed"
	if command.ProcessState != nil {
		switch command.ProcessState.ExitCode() {
		case 0:
			diagnostic.Exit = "success"
		case 3:
			diagnostic.Exit = "degraded"
		case -1:
			diagnostic.Exit = "signal"
		default:
			diagnostic.Exit = "other_nonzero"
		}
	}
	if ctx.Err() != nil {
		diagnostic.Cause = "TIMEOUT"
		return nil, diagnostic, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_TIMEOUT", Status: 503}
	}
	if stdout.Len() > 16<<10 || stderr.Len() != 0 {
		diagnostic.Phase = "response"
		diagnostic.Cause = "OUTPUT_BOUND"
		if stderr.Len() != 0 {
			diagnostic.Cause = "STDERR_PRESENT"
		}
		return nil, diagnostic, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", Status: 503}
	}
	if err != nil {
		diagnostic.Phase = "rejected"
		diagnostic.Cause = authorityRejectedCause(stdout.Bytes())
		return nil, diagnostic, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_REJECTED", Status: 503}
	}
	return bytes.TrimSpace(stdout.Bytes()), diagnostic, nil
}

// EndpointAuthorityDiagnostic is a bounded operational event, never a client
// response. Every field is fixed metadata; it contains no child text or inputs.
type EndpointAuthorityDiagnostic struct {
	Operation, Phase, Cause, Exit                               string
	QueueMilliseconds, ExecutionMilliseconds, TotalMilliseconds int64
	ChildPhase, ChildTelemetry                                  string
	ChildElapsedMilliseconds                                    int64
}

func authorityOperation(mode string) string {
	switch mode {
	case "browser-config", "browser-history", "browser-root-anchor":
		return mode
	case "":
		return "private"
	default:
		return "unknown"
	}
}
func (g *nodeEndpointAuthority) recordDiagnostic(value EndpointAuthorityDiagnostic) {
	// Observability must not change the original authority decision.
	defer func() { _ = recover() }()
	if g.config.Diagnostic != nil {
		g.config.Diagnostic(value)
		return
	}
	log.Printf("finance_authority_runtime operation=%s phase=%s cause=%s exit=%s queue_ms=%d execution_ms=%d total_ms=%d", value.Operation, value.Phase, value.Cause, value.Exit, value.QueueMilliseconds, value.ExecutionMilliseconds, value.TotalMilliseconds)
	log.Printf("finance_authority_phase operation=%s child_phase=%s child_ms=%d telemetry=%s", value.Operation, value.ChildPhase, value.ChildElapsedMilliseconds, value.ChildTelemetry)
}
func authorityRejectedCause(raw []byte) string {
	if !authorityFailureFieldsUnique(raw) {
		return "INVALID_FAILURE_SHAPE"
	}
	var failure struct {
		SchemaVersion           string `json:"schemaVersion"`
		Status                  string `json:"status"`
		Code                    string `json:"code"`
		OfficialSandboxVerified *bool  `json:"officialSandboxVerified"`
		ProviderVerified        *bool  `json:"providerVerified"`
		ProductionApproved      *bool  `json:"productionApproved"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&failure) != nil || decoder.Decode(&struct{}{}) != io.EOF || failure.SchemaVersion != "ynx-finance-endpoint-authority-runtime/v1" || failure.Status != "PRIVATE_SERVICE_DEGRADED" || failure.OfficialSandboxVerified == nil || *failure.OfficialSandboxVerified || failure.ProviderVerified == nil || *failure.ProviderVerified || failure.ProductionApproved == nil || *failure.ProductionApproved {
		return "INVALID_FAILURE_SHAPE"
	}
	switch failure.Code {
	case "AUTHORITY_V2_CLOCK_ROLLBACK", "AUTHORITY_V2_EXPIRED_OR_FUTURE", "AUTHORITY_V2_SIGNATURE_INVALID",
		"FINANCE_AUTHORITY_V2_CLOCK_STALE", "FINANCE_AUTHORITY_V2_CLOCK_UNAVAILABLE", "FINANCE_AUTHORITY_V2_CLOCK_RESPONSE_INVALID", "FINANCE_AUTHORITY_V2_CLOCK_STORE_BUSY", "FINANCE_AUTHORITY_V2_CLOCK_FILE_CHANGED", "FINANCE_AUTHORITY_V2_CLOCK_LOCK_CHANGED",
		"FINANCE_AUTHORITY_V2_CHECKPOINT_BUSY", "FINANCE_AUTHORITY_V2_CHECKPOINT_ROLLBACK", "FINANCE_AUTHORITY_V2_CHECKPOINT_IDENTITY_INVALID", "FINANCE_AUTHORITY_V2_CHECKPOINT_ANCESTOR_MODE_INVALID", "FINANCE_AUTHORITY_V2_HISTORY_MISSING", "FINANCE_AUTHORITY_V2_SCOPE_INVALID":
		return failure.Code
	default:
		return "UNKNOWN_CAUSE"
	}
}

func authorityFailureFieldsUnique(raw []byte) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return false
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		name, ok := token.(string)
		if err != nil || !ok || seen[name] {
			return false
		}
		seen[name] = true
		switch name {
		case "schemaVersion", "status", "code", "officialSandboxVerified", "providerVerified", "productionApproved":
		default:
			return false
		}
		value, err := decoder.Token()
		if err != nil {
			return false
		}
		switch value.(type) {
		case string, bool:
		default:
			return false
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 6 {
		return false
	}
	_, err = decoder.Token()
	return err == io.EOF
}

func (g *nodeEndpointAuthority) run(ctx context.Context, mode string, args ...string) ([]byte, error) {
	output, _, failure := g.execute(ctx, mode, args...)
	return output, failure
}
func (g *nodeEndpointAuthority) recordResponseFailure(value EndpointAuthorityDiagnostic) {
	value.Phase = "response"
	value.Cause = "STRICT_RESPONSE_INVALID"
	g.recordDiagnostic(value)
}
