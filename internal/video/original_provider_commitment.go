package video

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strings"
)

// Computed by the ORIGINAL configured provider from its exact outbound bytes.
// This is a commitment, never an ACK, final outcome, auth or permission.
// ProviderRequestKey is empty when the original AI wire has no such field.
type VideoOriginalProviderCommitment struct {
	Method             string `json:"method"`
	WireDigest         string `json:"wireDigest"`
	EndpointDigest     string `json:"endpointDigest"`
	ProviderRequestKey string `json:"providerRequestKey,omitempty"`
}

// Trusted local descriptors must be synchronous, pure, without Store/network
// access. A provider lacking its exact original descriptor stays unavailable in
// the coordinated mode; legacy records are not retroactively assigned hashes.
type VideoOriginalPayoutCommitmentSource interface {
	OriginalPayoutCommitment(string, int64, string) (VideoOriginalProviderCommitment, error)
}
type VideoOriginalAICommitmentSource interface {
	OriginalAICommitment(AIRequest, bool) (VideoOriginalProviderCommitment, error)
}

func videoOriginalDigest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func originalVideoPayoutBody(owner string, amount int64, ref string) ([]byte, error) {
	return json.Marshal(map[string]any{"merchant": "ynx-video", "payoutAddress": owner, "amount": amount, "idempotencyKey": ref})
}
func videoProviderCommitment(endpoint string, raw []byte, key string) (VideoOriginalProviderCommitment, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return VideoOriginalProviderCommitment{}, ErrVideoTransactionUnavailable
	}
	return VideoOriginalProviderCommitment{Method: "POST", WireDigest: videoOriginalDigest(raw), EndpointDigest: videoOriginalDigest([]byte(endpoint)), ProviderRequestKey: key}, nil
}
func (p PayClient) OriginalPayoutCommitment(owner string, amount int64, ref string) (VideoOriginalProviderCommitment, error) {
	if p.Token == "" {
		return VideoOriginalProviderCommitment{}, ErrVideoTransactionUnavailable
	}
	raw, err := originalVideoPayoutBody(owner, amount, ref)
	if err != nil {
		return VideoOriginalProviderCommitment{}, err
	}
	return videoProviderCommitment(strings.TrimRight(p.Endpoint, "/")+"/pay/intents", raw, ref)
}
func (g GatewayAI) OriginalAICommitment(in AIRequest, stream bool) (VideoOriginalProviderCommitment, error) {
	if g.Token == "" {
		return VideoOriginalProviderCommitment{}, ErrVideoTransactionUnavailable
	}
	raw, err := json.Marshal(in)
	if err != nil {
		return VideoOriginalProviderCommitment{}, err
	}
	path := "/v1/video/generate"
	if stream {
		path = "/v1/video/stream"
	}
	return videoProviderCommitment(strings.TrimRight(g.Endpoint, "/")+path, raw, "")
}
func validVideoProviderCommitment(p *VideoOriginalProviderCommitment) bool {
	return p != nil && p.Method == "POST" && validVideoDigest(p.WireDigest) && validVideoDigest(p.EndpointDigest) && len(p.ProviderRequestKey) <= 256
}
