package bftgateway

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"maps"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// One response must establish both presence/absence and account value at the
// status height. Never retry a moving snapshot or follow a write authority's redirect.
func (g *Gateway) evmAccountAtHeight(ctx context.Context, address string, height uint64) (chain.ConsensusAccount, bool, error) {
	var account chain.ConsensusAccount
	var upstream struct {
		cometABCIQuery
		Error *cometRPCError `json:"error"`
	}
	httpClient := *g.client.httpClient
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	client := *g.client
	client.httpClient = &httpClient
	limit := int64((consensus.MaxPQWalletQueryBytes+2)/3*4 + (64 << 10))
	query := url.Values{"path": {fmt.Sprintf("%q", "/accounts/"+address)}, "height": {strconv.FormatUint(height, 10)}}
	if err := client.getBounded(ctx, "/abci_query", query, &upstream, limit); err != nil {
		return account, false, err
	}
	if upstream.Error != nil {
		return account, false, errors.New(cometError(upstream.Error))
	}
	response := upstream.Result.Response
	h, err := strconv.ParseUint(response.Height, 10, 64)
	if err != nil || strconv.FormatUint(h, 10) != response.Height || h != height {
		return account, false, errors.New("account snapshot height differs from requested committed block")
	}
	if response.Code != 0 {
		if response.Log == "YNX account not found" && response.Value == "" {
			return account, false, nil
		}
		return account, false, errors.New("ABCI account query rejected")
	}
	payload, err := base64.StdEncoding.DecodeString(response.Value)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxPQWalletQueryBytes || base64.StdEncoding.EncodeToString(payload) != response.Value {
		return account, false, errors.New("invalid bounded ABCI account value")
	}
	if err := strictPQJSON(payload, &account); err != nil {
		return account, false, err
	}
	return account, true, nil
}

// Pin both presence and absence to the requested committed height. A moving
// node must never turn a newer missing-contract result into an older zero value.
func (g *Gateway) evmContractAtHeight(ctx context.Context, address string, height uint64) (consensus.BFTContract, bool, error) {
	var contract consensus.BFTContract
	var upstream struct {
		cometABCIQuery
		Error *cometRPCError `json:"error"`
	}
	httpClient := *g.client.httpClient
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	client := *g.client
	client.httpClient = &httpClient
	limit := int64((consensus.MaxPQWalletQueryBytes+2)/3*4 + (64 << 10))
	query := url.Values{"path": {fmt.Sprintf("%q", "/ide/contracts/"+address)}, "height": {strconv.FormatUint(height, 10)}}
	if err := client.getBounded(ctx, "/abci_query", query, &upstream, limit); err != nil {
		return contract, false, err
	}
	if upstream.Error != nil {
		return contract, false, errors.New(cometError(upstream.Error))
	}
	response := upstream.Result.Response
	h, err := strconv.ParseUint(response.Height, 10, 64)
	if err != nil || strconv.FormatUint(h, 10) != response.Height || h != height {
		return contract, false, errors.New("contract snapshot height differs from requested committed block")
	}
	if response.Code != 0 {
		if response.Log == "IDE contract not found" && response.Value == "" {
			return contract, false, nil
		}
		return contract, false, errors.New("ABCI contract query rejected")
	}
	payload, err := base64.StdEncoding.DecodeString(response.Value)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxPQWalletQueryBytes || base64.StdEncoding.EncodeToString(payload) != response.Value {
		return contract, false, errors.New("invalid bounded ABCI contract value")
	}
	if err := strictPQJSON(payload, &contract); err != nil {
		return contract, false, err
	}
	if contract.SourceAnchor != "" {
		if err := g.validateMigratedContractAtHeight(ctx, contract, address, height); err != nil {
			return contract, false, err
		}
	} else if err := validateCommittedContract(contract, address); err != nil {
		return contract, false, err
	}
	if uint64(contract.LastUpdatedHeight) > height {
		return contract, false, errors.New("contract update height exceeds requested committed block")
	}
	return contract, true, nil
}

// An imported contract has no fabricated BFT deployment receipt. Bind its
// original identity and unchanged source to the same configured bootstrap and
// committed height; this is a configured-RPC observation, not light proof.
func (g *Gateway) validateMigratedContractAtHeight(ctx context.Context, contract consensus.BFTContract, address string, height uint64) error {
	if height > math.MaxInt64 || contract.Address != address || !consensus.IsNativeAddress(contract.Deployer) || !identityHash(contract.SourceAnchor) || contract.BlockHeight != 0 || contract.TxHash != "" || contract.RuntimeMode != chain.BoundedContractRuntimeMode || contract.AuditHash != consensus.BFTContractAuditHash(contract) {
		return errors.New("invalid imported contract identity")
	}
	bytecodeHash, err := chain.ValidateBoundedPinnedIdentity(contract.Name, contract.SourceHash, contract.DeployedBytecode)
	if err != nil || bytecodeHash != contract.DeployedBytecodeHash || !isCanonicalEVMData(contract.DeployedBytecode, 1, 12<<10) {
		return errors.New("invalid imported contract artifact")
	}
	for slot, value := range contract.RuntimeStorage {
		if !evmWordPattern.MatchString(slot) || !evmWordPattern.MatchString(value) {
			return errors.New("invalid imported contract storage")
		}
	}
	var identity consensus.PQWalletIdentityView
	if err := g.evmCallAtHeight(ctx, consensus.PQWalletIdentityPath, height, &identity); err != nil || consensus.ValidatePQWalletIdentityView(identity, int64(height)) != nil || identity.MigrationStateHash != contract.SourceAnchor || (g.migrationHeight != 0 && identity.MigrationHeight != g.migrationHeight) {
		return errors.New("imported contract bootstrap identity unavailable or inconsistent")
	}
	var original struct {
		chain.ContractArtifact
		SourceAnchor string `json:"sourceAnchor"`
	}
	if err := g.evmCallAtHeight(ctx, "/ide/source/"+address, height, &original); err != nil || original.SourceAnchor != contract.SourceAnchor || original.Address != address || original.Name != contract.Name || original.Deployer != contract.Deployer || original.SourceHash != contract.SourceHash || original.DeployedBytecodeHash != contract.DeployedBytecodeHash || !slices.Equal(original.ConstructorArgs, contract.ConstructorArgs) {
		return errors.New("imported contract differs from original source identity")
	}
	if contract.LastCallTxHash == "" {
		if contract.LastUpdatedHeight != 0 || !maps.Equal(original.RuntimeStorage, contract.RuntimeStorage) {
			return errors.New("untouched imported contract differs from original storage")
		}
		return nil
	}
	if !transactionHashPattern.MatchString(contract.LastCallTxHash) || contract.LastUpdatedHeight <= int64(identity.MigrationHeight) || uint64(contract.LastUpdatedHeight) > height {
		return errors.New("invalid imported contract update identity")
	}
	var receipt consensus.BFTEVMReceipt
	if err := g.evmCallAtHeight(ctx, "/evm/receipts/"+contract.LastCallTxHash, height, &receipt); err != nil || consensus.ValidateBFTEVMReceipt(receipt) != nil || receipt.TxHash != contract.LastCallTxHash || receipt.To != address || receipt.Action != consensus.ActionIDEContractCall || receipt.BlockHeight != contract.LastUpdatedHeight {
		return errors.New("imported contract update receipt unavailable or inconsistent")
	}
	return nil
}

var errEVMCallHeightMismatch = errors.New("contract call snapshot height differs from requested committed block")

// Contract execution and its preceding contract lookup must observe the same
// committed height. Do not follow redirects or silently retry a moving node.
func (g *Gateway) evmCallAtHeight(ctx context.Context, path string, height uint64, out any) error {
	var upstream struct {
		cometABCIQuery
		Error *cometRPCError `json:"error"`
	}
	httpClient := *g.client.httpClient
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	client := *g.client
	client.httpClient = &httpClient
	limit := int64((consensus.MaxPQWalletQueryBytes+2)/3*4 + (64 << 10))
	query := url.Values{"path": {fmt.Sprintf("%q", path)}, "height": {strconv.FormatUint(height, 10)}}
	if err := client.getBounded(ctx, "/abci_query", query, &upstream, limit); err != nil {
		return err
	}
	if upstream.Error != nil {
		return errors.New(cometError(upstream.Error))
	}
	response := upstream.Result.Response
	h, err := strconv.ParseUint(response.Height, 10, 64)
	if err != nil || strconv.FormatUint(h, 10) != response.Height || h != height {
		return errEVMCallHeightMismatch
	}
	if response.Code != 0 {
		return errors.New("ABCI contract call rejected: " + response.Log)
	}
	payload, err := base64.StdEncoding.DecodeString(response.Value)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxPQWalletQueryBytes || base64.StdEncoding.EncodeToString(payload) != response.Value {
		return errors.New("invalid bounded ABCI contract call value")
	}
	return strictPQJSON(payload, out)
}
