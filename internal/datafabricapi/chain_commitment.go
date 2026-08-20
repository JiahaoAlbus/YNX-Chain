package datafabricapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

const maxChainCommitmentResponseBytes = 64 * 1024

// ChainCoreHTTPCommitmentVerifier consumes the frozen Chain Core v1 read API.
// It performs no mutation and does not reproduce commitment-ID, ownership,
// version-chain, or finality rules owned by Chain Core.
type ChainCoreHTTPCommitmentVerifier struct {
	Endpoint string
	Client   *http.Client
}

type chainCommitmentResponse struct {
	SchemaVersion int             `json:"schemaVersion"`
	Source        string          `json:"source"`
	AsOf          time.Time       `json:"asOf"`
	Version       string          `json:"version"`
	Coverage      string          `json:"coverage"`
	Failure       bool            `json:"failure"`
	Commitment    json.RawMessage `json:"commitment"`
}

type chainCommitmentRecord struct {
	ID string `json:"id"`
}

func (v ChainCoreHTTPCommitmentVerifier) VerifyChainCommitment(ctx context.Context, reference datafabric.ChainCommitmentReference) error {
	endpoint, err := url.Parse(strings.TrimRight(v.Endpoint, "/"))
	if err != nil || endpoint.Host == "" || endpoint.RawQuery != "" || endpoint.Fragment != "" || (endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && isLoopback(endpoint.Hostname()))) {
		return datafabric.Reject(datafabric.CodeChainCommitmentUnavailable, "canonical Chain Core endpoint must use HTTPS or loopback HTTP", chainCommitmentEvidence(reference))
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String()+"/data/commitments/"+reference.ChainCommitmentID, nil)
	if err != nil {
		return datafabric.WrapReject(datafabric.CodeChainCommitmentUnavailable, "Chain Core commitment request could not be created", err, chainCommitmentEvidence(reference))
	}
	request.Header.Set("Accept", "application/json")
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return datafabric.WrapReject(datafabric.CodeChainCommitmentUnavailable, "Chain Core commitment read is unavailable", err, chainCommitmentEvidence(reference))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		code := datafabric.CodeChainCommitmentRejected
		if response.StatusCode >= 500 {
			code = datafabric.CodeChainCommitmentUnavailable
		}
		return datafabric.Reject(code, fmt.Sprintf("Chain Core commitment read returned HTTP %d", response.StatusCode), chainCommitmentEvidence(reference))
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxChainCommitmentResponseBytes+1))
	if err != nil || len(body) > maxChainCommitmentResponseBytes {
		return datafabric.WrapReject(datafabric.CodeChainCommitmentUnavailable, "Chain Core commitment response exceeded the canonical limit", err, chainCommitmentEvidence(reference))
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	var result chainCommitmentResponse
	if err := decoder.Decode(&result); err != nil {
		return datafabric.WrapReject(datafabric.CodeChainCommitmentUnavailable, "Chain Core commitment response is invalid", err, chainCommitmentEvidence(reference))
	}
	if err := ensureChainCommitmentEOF(decoder); err != nil {
		return datafabric.WrapReject(datafabric.CodeChainCommitmentUnavailable, "Chain Core commitment response is invalid", err, chainCommitmentEvidence(reference))
	}
	var commitment chainCommitmentRecord
	if err := json.Unmarshal(result.Commitment, &commitment); err != nil {
		return datafabric.WrapReject(datafabric.CodeChainCommitmentUnavailable, "Chain Core commitment record is invalid", err, chainCommitmentEvidence(reference))
	}
	if result.SchemaVersion != 1 || result.Source != datafabric.ChainCoreDataCommitmentSource || result.Version != datafabric.ChainCoreDataCommitmentVersion || result.Coverage != "exact" || result.Failure || result.AsOf.IsZero() || commitment.ID != reference.ChainCommitmentID {
		return datafabric.Reject(datafabric.CodeChainCommitmentRejected, "Chain Core commitment evidence does not match the frozen read contract", chainCommitmentEvidence(reference))
	}
	return nil
}

func ensureChainCommitmentEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func chainCommitmentEvidence(reference datafabric.ChainCommitmentReference) map[string]string {
	return map[string]string{"eventId": reference.EventID, "chainCommitmentId": reference.ChainCommitmentID}
}
