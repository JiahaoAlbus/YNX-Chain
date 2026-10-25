package appgateway

import (
	"bytes"
	"context"
	"encoding/hex"
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

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

var (
	ErrAccountPolicyUnavailable = errors.New("authoritative account policy unavailable; classic app sessions are disabled")
	ErrPQSessionRequired        = errors.New("active PQ account cannot use the classic app session flow")
)

const maxAccountPolicyBytes = 1 << 20

type accountPolicyResponse struct {
	PolicyView       string                `json:"policyView"`
	Source           string                `json:"source"`
	RecordsView      string                `json:"recordsView"`
	Owner            string                `json:"owner"`
	ExecutionHeight  string                `json:"executionHeight"`
	LedgerNonce      string                `json:"ledgerNonce"`
	AlgorithmVersion string                `json:"algorithmVersion"`
	Enabled          *bool                 `json:"enabled"`
	PolicyVersion    string                `json:"policyVersion"`
	NetworkID        string                `json:"networkId"`
	EnableAt         string                `json:"enableAt"`
	ActiveRevision   string                `json:"activeRevision"`
	Records          []accountPolicyRecord `json:"records"`
}

type accountPolicyRecord struct {
	AlgorithmVersion string `json:"algorithmVersion"`
	Owner            string `json:"owner"`
	PKA              string `json:"pkA"`
	PKB              string `json:"pkB"`
	Revision         string `json:"revision"`
	RegisteredAt     string `json:"registeredAt"`
	ActiveFrom       string `json:"activeFrom"`
	LedgerNonce      string `json:"ledgerNonce"`
}

func validateAccountPolicyConfig(cfg Config) error {
	if cfg.AccountPolicyURL == "" && cfg.AccountPolicyNetworkID == "" {
		return nil
	}
	u, err := url.Parse(cfg.AccountPolicyURL)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" {
		return errors.New("YNX_APP_GATEWAY_ACCOUNT_POLICY_URL must be an exact Core origin")
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if u.Scheme != "https" && !(u.Scheme == "http" && (host == "localhost" || (ip != nil && ip.IsLoopback()))) {
		return errors.New("YNX_APP_GATEWAY_ACCOUNT_POLICY_URL requires HTTPS or loopback HTTP")
	}
	if _, err := policyHex(cfg.AccountPolicyNetworkID, 32); err != nil {
		return errors.New("YNX_APP_GATEWAY_ACCOUNT_POLICY_NETWORK_ID must be the fixed 64 lowercase hex original genesis hash")
	}
	return nil
}

// This is a gate on the existing classic ownership protocol, not a PQ login or
// canonical Product Session implementation. The pinned Core endpoint is an
// operator trust boundary; its response is not a consensus/light-client proof.
// Read on every challenge, verification and protected session use: no cached
// legacy decision can outlive activation. Missing policy never means legacy.
func (g *Gateway) requireClassicAccountPolicy(owner string) error {
	if g.cfg.AccountPolicyURL == "" || g.cfg.AccountPolicyNetworkID == "" || !accountaddress.IsCanonical(owner) {
		return ErrAccountPolicyUnavailable
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	var chainID struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      int             `json:"id"`
		Result  string          `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	// The only RPC method is fixed and read-only; neither target nor body comes
	// from a session request. Chain ID is checked without floating-point parsing.
	if err := readPolicyJSON(ctx, client, http.MethodPost, g.cfg.AccountPolicyURL+"/evm", []byte(`{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`), 4096, &chainID); err != nil {
		return ErrAccountPolicyUnavailable
	}
	id, err := strconv.ParseUint(strings.TrimPrefix(chainID.Result, "0x"), 16, 64)
	if err != nil || chainID.JSONRPC != "2.0" || chainID.ID != 1 || (len(chainID.Error) != 0 && string(chainID.Error) != "null") || chainID.Result != "0x"+strconv.FormatUint(id, 16) || id != uint64(g.cfg.ChainID) {
		return ErrAccountPolicyUnavailable
	}
	var response accountPolicyResponse
	if err := readPolicyJSON(ctx, client, http.MethodGet, g.cfg.AccountPolicyURL+"/accounts/"+owner+"/authorization", nil, maxAccountPolicyBytes, &response); err != nil {
		return ErrAccountPolicyUnavailable
	}
	active, err := validateAccountPolicyResponse(response, owner, g.cfg.AccountPolicyNetworkID)
	if err != nil {
		return ErrAccountPolicyUnavailable
	}
	if active {
		return ErrPQSessionRequired
	}
	return nil
}

func readPolicyJSON(ctx context.Context, client *http.Client, method, target string, body []byte, limit int64, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("account policy read failed")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return errors.New("account policy response exceeds bound")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("account policy response must contain one object")
	}
	return nil
}

func validateAccountPolicyResponse(v accountPolicyResponse, owner, networkHex string) (bool, error) {
	bad := errors.New("inconsistent account policy")
	if v.PolicyView != "next_execution" || v.Source != "authoritative_producer" || v.RecordsView != "includes_pending" || v.Owner != owner || v.Enabled == nil || !*v.Enabled || v.PolicyVersion != ynxauth.PolicyVersion || v.NetworkID != networkHex || v.Records == nil {
		return false, bad
	}
	network, err := policyHex(v.NetworkID, 32)
	if err != nil {
		return false, bad
	}
	height, err := policyUint(v.ExecutionHeight, false)
	if err != nil {
		return false, bad
	}
	nonce, err := policyUint(v.LedgerNonce, true)
	if err != nil {
		return false, bad
	}
	enableAt, err := policyUint(v.EnableAt, false)
	if err != nil {
		return false, bad
	}
	state := ynxauth.State{Version: v.PolicyVersion, NetworkID: network, EnableAt: enableAt}
	for _, raw := range v.Records {
		if raw.Owner != owner {
			return false, bad
		}
		pkA, err := policyHex(raw.PKA, ynxbatch.PublicKeyASize)
		if err != nil {
			return false, bad
		}
		pkB, err := policyHex(raw.PKB, ynxbatch.PublicKeyBSize)
		if err != nil {
			return false, bad
		}
		revision, err := policyUint(raw.Revision, false)
		if err != nil {
			return false, bad
		}
		registered, err := policyUint(raw.RegisteredAt, false)
		if err != nil || registered > height {
			return false, bad
		}
		activeFrom, err := policyUint(raw.ActiveFrom, false)
		if err != nil {
			return false, bad
		}
		ledgerNonce, err := policyUint(raw.LedgerNonce, false)
		if err != nil || ledgerNonce > nonce {
			return false, bad
		}
		state.Records = append(state.Records, ynxauth.Record{AlgorithmVersion: raw.AlgorithmVersion, Owner: raw.Owner, PKA: pkA, PKB: pkB, Revision: revision, RegisteredAt: registered, ActiveFrom: activeFrom, LedgerNonce: ledgerNonce})
	}
	if err := state.Validate(network); err != nil {
		return false, bad
	}
	record, active := state.PolicyAt(owner, height)
	if active {
		if height < enableAt || v.AlgorithmVersion != record.AlgorithmVersion || v.ActiveRevision != strconv.FormatUint(record.Revision, 10) {
			return false, bad
		}
	} else if v.AlgorithmVersion != "legacy" || v.ActiveRevision != "" {
		return false, bad
	}
	return active, nil
}

func policyUint(raw string, zero bool) (uint64, error) {
	v, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || strconv.FormatUint(v, 10) != raw || (!zero && v == 0) {
		return 0, fmt.Errorf("invalid policy integer")
	}
	return v, nil
}
func policyHex(raw string, size int) ([]byte, error) {
	if len(raw) != size*2 || strings.ToLower(raw) != raw {
		return nil, errors.New("invalid policy bytes")
	}
	v, err := hex.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	return v, nil
}
