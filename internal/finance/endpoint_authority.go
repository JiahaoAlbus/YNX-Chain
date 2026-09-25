package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
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

type NodeEndpointAuthorityConfig struct {
	NodeBinary, Script, TrustRootFile, ManifestFile, CheckpointFile, TrustedTimeFile string
	Timeout                                                                          time.Duration
}

type nodeEndpointAuthority struct {
	config             NodeEndpointAuthorityConfig
	slots              chan struct{}
	browserMu          sync.Mutex
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
	stdout, err := g.run(ctx, "")
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
		return &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", Status: 503}
	}
	if response.SchemaVersion != "ynx-finance-endpoint-authority-runtime/v1" || response.Status != "VERIFIED" || response.WalletGateway != BrowserWalletAuthority || response.FinanceOrigin != BrowserFinanceOrigin || !regexp.MustCompile(`^2\.0\.0\.[1-9][0-9]*$`).MatchString(response.ManifestVersion) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(response.PayloadSHA256) || response.OfficialSandboxVerified || response.ProviderVerified || response.ProductionApproved {
		return &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_REJECTED", Status: 503}
	}
	return nil
}

func (g *nodeEndpointAuthority) RequiresProofPrevalidation() bool { return true }

func (g *nodeEndpointAuthority) BrowserConfig(ctx context.Context) ([]byte, error) {
	g.browserMu.Lock()
	defer g.browserMu.Unlock()
	stdout, err := g.run(ctx, "browser-config")
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
		return nil, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", Status: 503}
	}
	// A cached time anchor would restart the browser's monotonic clock on every
	// reload and could extend an expired manifest. Fetch a fresh server sample.
	return append([]byte(nil), stdout...), nil
}

func (g *nodeEndpointAuthority) run(ctx context.Context, outputMode string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, g.config.Timeout)
	defer cancel()
	select {
	case g.slots <- struct{}{}:
		defer func() { <-g.slots }()
	case <-ctx.Done():
		return nil, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_BUSY", Status: 503}
	}
	command := exec.CommandContext(ctx, g.config.NodeBinary, g.config.Script)
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
	err := command.Run()
	if ctx.Err() != nil {
		return nil, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_TIMEOUT", Status: 503}
	}
	if stdout.Len() > 16<<10 || stderr.Len() != 0 {
		return nil, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", Status: 503}
	}
	if err != nil {
		return nil, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_REJECTED", Status: 503}
	}
	return bytes.TrimSpace(stdout.Bytes()), nil
}
