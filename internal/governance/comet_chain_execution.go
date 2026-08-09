package governance

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const maxCometRPCResponseBytes = 1 << 20

type CometChainExecutionClient struct {
	baseURL       string
	expectedChain int64
	client        *http.Client
}

type cometRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

type cometGovernanceQuery struct {
	Result struct {
		Response struct {
			Code   uint32 `json:"code"`
			Log    string `json:"log"`
			Height string `json:"height"`
			Value  string `json:"value"`
		} `json:"response"`
	} `json:"result"`
	Error *cometRPCError `json:"error,omitempty"`
}

type cometGovernanceBroadcast struct {
	Result struct {
		CheckTx struct {
			Code uint32 `json:"code"`
			Log  string `json:"log"`
		} `json:"check_tx"`
		TxResult struct {
			Code uint32 `json:"code"`
			Log  string `json:"log"`
		} `json:"tx_result"`
		Hash   string `json:"hash"`
		Height string `json:"height"`
	} `json:"result"`
	Error *cometRPCError `json:"error,omitempty"`
}

type cometGovernanceStatus struct {
	Result struct {
		NodeInfo struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo struct {
			LatestBlockHeight string `json:"latest_block_height"`
			CatchingUp        bool   `json:"catching_up"`
		} `json:"sync_info"`
	} `json:"result"`
	Error *cometRPCError `json:"error,omitempty"`
}

type cometGovernanceBlock struct {
	Result struct {
		BlockID struct {
			Hash string `json:"hash"`
		} `json:"block_id"`
		Block struct {
			Header struct {
				Height string `json:"height"`
			} `json:"header"`
		} `json:"block"`
	} `json:"result"`
	Error *cometRPCError `json:"error,omitempty"`
}

func NewCometChainExecutionClient(rawURL string, expectedChain int64, timeout time.Duration, upstream *http.Client) (*CometChainExecutionClient, error) {
	baseURL, err := validateCometRPCURL(rawURL)
	if err != nil {
		return nil, err
	}
	if expectedChain <= 0 || timeout < time.Second || timeout > 30*time.Second {
		return nil, ErrInvalid
	}
	client := &http.Client{}
	if upstream != nil {
		*client = *upstream
	}
	client.Timeout = timeout
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &CometChainExecutionClient{baseURL: baseURL, expectedChain: expectedChain, client: client}, nil
}

func validateCometRPCURL(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", ErrInvalid
	}
	host := parsed.Hostname()
	if parsed.Scheme == "http" && !isLoopbackHost(host) {
		return "", fmt.Errorf("%w: plaintext CometBFT RPC must be loopback-only", ErrForbidden)
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (c *CometChainExecutionClient) GovernanceExecution(ctx context.Context, proposalID string) (consensus.BFTGovernanceExecution, bool, error) {
	if c == nil || c.client == nil || !validHash(strings.ToLower(strings.TrimSpace(proposalID))) {
		return consensus.BFTGovernanceExecution{}, false, ErrInvalid
	}
	if err := c.ensureNetwork(ctx); err != nil {
		return consensus.BFTGovernanceExecution{}, false, err
	}
	var response cometGovernanceQuery
	query := url.Values{"path": {strconv.Quote("/governance/executions/" + strings.ToLower(proposalID))}}
	if err := c.get(ctx, "/abci_query", query, &response); err != nil {
		return consensus.BFTGovernanceExecution{}, false, err
	}
	if response.Error != nil {
		return consensus.BFTGovernanceExecution{}, false, cometResponseError(response.Error)
	}
	if response.Result.Response.Code != 0 {
		if response.Result.Response.Code == 1 && strings.Contains(strings.ToLower(response.Result.Response.Log), "governance execution not found") {
			return consensus.BFTGovernanceExecution{}, false, nil
		}
		return consensus.BFTGovernanceExecution{}, false, fmt.Errorf("CometBFT ABCI query rejected: %s", strings.TrimSpace(response.Result.Response.Log))
	}
	height, err := strconv.ParseInt(response.Result.Response.Height, 10, 64)
	if err != nil || height <= 0 {
		return consensus.BFTGovernanceExecution{}, false, errors.New("CometBFT ABCI query returned an invalid height")
	}
	payload, err := base64.StdEncoding.DecodeString(response.Result.Response.Value)
	if err != nil || len(payload) == 0 || len(payload) > 64*1024 {
		return consensus.BFTGovernanceExecution{}, false, errors.New("CometBFT ABCI query returned invalid governance execution encoding")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var record consensus.BFTGovernanceExecution
	if err = decoder.Decode(&record); err != nil {
		return consensus.BFTGovernanceExecution{}, false, fmt.Errorf("decode canonical governance execution: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF || record.ProposalID != strings.ToLower(proposalID) ||
		record.SubmittedHeight <= 0 || record.SubmittedHeight > height {
		return consensus.BFTGovernanceExecution{}, false, errors.New("CometBFT ABCI query returned inconsistent governance execution evidence")
	}
	return record, true, nil
}

func (c *CometChainExecutionClient) BroadcastGovernanceAction(ctx context.Context, raw []byte) error {
	if c == nil || c.client == nil {
		return ErrInvalid
	}
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil || (tx.Action != consensus.ActionGovernanceExecutionBegin && tx.Action != consensus.ActionGovernanceExecutionVerify) || tx.Verify(c.expectedChain) != nil {
		return fmt.Errorf("%w: canonical governance execution action required", ErrInvalid)
	}
	if err = c.ensureNetwork(ctx); err != nil {
		return err
	}
	var response cometGovernanceBroadcast
	query := url.Values{"tx": {"0x" + fmt.Sprintf("%x", raw)}}
	if err = c.get(ctx, "/broadcast_tx_commit", query, &response); err != nil {
		return err
	}
	if response.Error != nil {
		return cometResponseError(response.Error)
	}
	if response.Result.CheckTx.Code != 0 || response.Result.TxResult.Code != 0 {
		message := strings.TrimSpace(response.Result.CheckTx.Log + " " + response.Result.TxResult.Log)
		return fmt.Errorf("CometBFT rejected governance execution action: %s", message)
	}
	expectedHash := strings.TrimPrefix(consensus.ApplicationActionHash(raw), "0x")
	if !strings.EqualFold(response.Result.Hash, expectedHash) {
		return errors.New("CometBFT governance execution transaction hash mismatch")
	}
	height, err := strconv.ParseUint(response.Result.Height, 10, 64)
	if err != nil || height == 0 {
		return errors.New("CometBFT returned an invalid governance execution height")
	}
	return nil
}

func (c *CometChainExecutionClient) GovernanceBlockHash(ctx context.Context, height int64) (string, error) {
	if c == nil || c.client == nil || height <= 0 {
		return "", ErrInvalid
	}
	if err := c.ensureNetwork(ctx); err != nil {
		return "", err
	}
	var response cometGovernanceBlock
	if err := c.get(ctx, "/block", url.Values{"height": {strconv.FormatInt(height, 10)}}, &response); err != nil {
		return "", err
	}
	if response.Error != nil {
		return "", cometResponseError(response.Error)
	}
	returnedHeight, err := strconv.ParseInt(response.Result.Block.Header.Height, 10, 64)
	hash := strings.ToLower(strings.TrimSpace(response.Result.BlockID.Hash))
	if err != nil || returnedHeight != height || !validHash(hash) {
		return "", errors.New("CometBFT returned inconsistent governance verification block evidence")
	}
	return "0x" + hash, nil
}

func (c *CometChainExecutionClient) ensureNetwork(ctx context.Context) error {
	var status cometGovernanceStatus
	if err := c.get(ctx, "/status", nil, &status); err != nil {
		return err
	}
	if status.Error != nil {
		return cometResponseError(status.Error)
	}
	expected := fmt.Sprintf("ynx_%d-1", c.expectedChain)
	height, err := strconv.ParseUint(status.Result.SyncInfo.LatestBlockHeight, 10, 64)
	if err != nil || height == 0 || status.Result.NodeInfo.Network != expected || status.Result.SyncInfo.CatchingUp {
		return fmt.Errorf("%w: CometBFT RPC is not a synchronized %s node", ErrForbidden, expected)
	}
	return nil
}

func (c *CometChainExecutionClient) get(ctx context.Context, path string, query url.Values, out any) error {
	endpoint := c.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.client.Do(request)
	if err != nil {
		return fmt.Errorf("call CometBFT %s: %w", path, err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxCometRPCResponseBytes+1))
	if err != nil {
		return fmt.Errorf("read CometBFT %s: %w", path, err)
	}
	if len(payload) > maxCometRPCResponseBytes {
		return fmt.Errorf("CometBFT %s response exceeds limit", path)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("CometBFT %s returned HTTP %d", path, response.StatusCode)
	}
	if err = json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("decode CometBFT %s response: %w", path, err)
	}
	return nil
}

func cometResponseError(value *cometRPCError) error {
	if value == nil {
		return errors.New("CometBFT returned an unknown RPC error")
	}
	message := strings.TrimSpace(value.Message + " " + value.Data)
	if message == "" {
		message = fmt.Sprintf("RPC error %d", value.Code)
	}
	return errors.New(message)
}
