package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// EVMLoginAuthority is a Finance adapter to the accepted Wallet/Auth package.
// No Finance code parses SIWE messages or verifies EVM signatures.
type EVMLoginAuthority interface {
	Create(context.Context, map[string]any) (EVMLoginIssued, error)
	Verify(context.Context, json.RawMessage, json.RawMessage, time.Time) (EVMLoginVerified, error)
}

type EVMLoginIssued struct {
	Challenge      json.RawMessage `json:"challenge"`
	SigningRequest struct {
		Method  string   `json:"method"`
		Params  []string `json:"params"`
		Message string   `json:"message"`
	} `json:"signingRequest"`
}

type EVMLoginVerified struct {
	Account      string   `json:"account"`
	AccountType  string   `json:"accountType"`
	ChainID      int      `json:"chainId"`
	ProductID    string   `json:"productId"`
	Scopes       []string `json:"scopes"`
	ProviderKind string   `json:"providerKind"`
	Nonce        string   `json:"nonce"`
	RequestID    string   `json:"requestId"`
}

type NodeEVMLoginAuthority struct {
	NodeBinary string
	Script     string
	Timeout    time.Duration
}

func NewNodeEVMLoginAuthority(nodeBinary, script string, timeout time.Duration) (*NodeEVMLoginAuthority, error) {
	if !filepath.IsAbs(nodeBinary) || !filepath.IsAbs(script) || timeout <= 0 || timeout > 10*time.Second {
		return nil, errors.New("Finance EVM login verifier requires exact absolute runtime paths and bounded timeout")
	}
	for _, path := range []string{nodeBinary, script} {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("Finance EVM login verifier runtime is unavailable")
		}
	}
	return &NodeEVMLoginAuthority{NodeBinary: nodeBinary, Script: script, Timeout: timeout}, nil
}

func (a *NodeEVMLoginAuthority) Create(ctx context.Context, challenge map[string]any) (EVMLoginIssued, error) {
	var response struct {
		EVMLoginIssued
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := a.invoke(ctx, map[string]any{"action": "create", "challenge": challenge}, &response); err != nil {
		return EVMLoginIssued{}, err
	}
	if response.Error != nil || len(response.Challenge) == 0 || response.SigningRequest.Method != "personal_sign" || len(response.SigningRequest.Params) != 2 {
		return EVMLoginIssued{}, errors.New("Finance EVM login challenge authority rejected the request")
	}
	return response.EVMLoginIssued, nil
}

func (a *NodeEVMLoginAuthority) Verify(ctx context.Context, proof, expected json.RawMessage, at time.Time) (EVMLoginVerified, error) {
	var response struct {
		Verified EVMLoginVerified `json:"verified"`
		Error    *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := a.invoke(ctx, map[string]any{"action": "verify", "proof": proof, "expectedChallenge": expected, "at": at.UTC().Format(time.RFC3339Nano)}, &response); err != nil {
		return EVMLoginVerified{}, err
	}
	if response.Error != nil || response.Verified.Account == "" {
		return EVMLoginVerified{}, errors.New("Finance EVM login proof was rejected")
	}
	return response.Verified, nil
}

func (a *NodeEVMLoginAuthority) invoke(ctx context.Context, input any, output any) error {
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) > 32<<10 {
		return errors.New("Finance EVM login input is invalid")
	}
	callCtx, cancel := context.WithTimeout(ctx, a.Timeout)
	defer cancel()
	command := exec.CommandContext(callCtx, a.NodeBinary, a.Script)
	command.Stdin = bytes.NewReader(encoded)
	stdout, err := command.Output()
	if callCtx.Err() != nil || len(stdout) > 32<<10 {
		return errors.New("Finance EVM login authority timed out or returned an oversized response")
	}
	if err != nil {
		return errors.New("Finance EVM login authority rejected or could not verify the request")
	}
	if json.Unmarshal(stdout, output) != nil {
		return errors.New("Finance EVM login authority returned an invalid response")
	}
	return nil
}
