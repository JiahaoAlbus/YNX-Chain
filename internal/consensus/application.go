package consensus

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	ApplicationName      = "ynx-chain-abci"
	ApplicationVersion   = 2
	CodeInvalidTx        = 2
	CodeInvalidNonce     = 3
	CodeInsufficientYNXT = 4
	CodeUnsupportedTx    = CodeInvalidTx
)

type Application struct {
	abcitypes.BaseApplication
	mu           sync.RWMutex
	migration    chain.ConsensusMigrationState
	committed    CommittedState
	pending      *CommittedState
	statePath    string
	feeRecipient string
}

type transactionError struct {
	code uint32
	err  error
}

func (e *transactionError) Error() string { return e.err.Error() }

var _ abcitypes.Application = (*Application)(nil)

func NewApplication(state chain.ConsensusMigrationState) (*Application, error) {
	application, err := NewPersistentApplication(state, "")
	if err != nil {
		return nil, err
	}
	application.committed.Initialized = true
	return application, nil
}

func NewPersistentApplication(state chain.ConsensusMigrationState, statePath string) (*Application, error) {
	if err := state.Validate(); err != nil {
		return nil, fmt.Errorf("invalid YNX consensus migration state: %w", err)
	}
	payload, err := state.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &migration); err != nil {
		return nil, fmt.Errorf("clone YNX consensus migration state: %w", err)
	}
	committed, err := loadCommittedState(strings.TrimSpace(statePath), migration)
	if err != nil {
		return nil, err
	}
	feeRecipient := ""
	for _, validator := range migration.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	if feeRecipient == "" {
		return nil, errors.New("YNX migration has no active fee recipient")
	}
	return &Application{
		migration:    migration,
		committed:    committed,
		statePath:    strings.TrimSpace(statePath),
		feeRecipient: feeRecipient,
	}, nil
}

func (a *Application) Info(context.Context, *abcitypes.RequestInfo) (*abcitypes.ResponseInfo, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if !a.committed.Initialized {
		return &abcitypes.ResponseInfo{
			Data:       ApplicationName,
			Version:    "cometbft-v0.38",
			AppVersion: ApplicationVersion,
		}, nil
	}
	appHash, err := hex.DecodeString(a.committed.AppHash)
	if err != nil {
		return nil, fmt.Errorf("decode committed app hash: %w", err)
	}
	return &abcitypes.ResponseInfo{
		Data:             ApplicationName,
		Version:          "cometbft-v0.38",
		AppVersion:       ApplicationVersion,
		LastBlockHeight:  a.committed.Height,
		LastBlockAppHash: appHash,
	}, nil
}

func (a *Application) InitChain(_ context.Context, req *abcitypes.RequestInitChain) (*abcitypes.ResponseInitChain, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	expectedChainID := fmt.Sprintf("ynx_%d-1", a.migration.Network.ChainID)
	if req.ChainId != "" && req.ChainId != expectedChainID {
		return nil, fmt.Errorf("CometBFT chain ID %q does not match YNX migration chain ID %q", req.ChainId, expectedChainID)
	}
	if req.InitialHeight > 0 && req.InitialHeight != int64(a.migration.Height)+1 {
		return nil, fmt.Errorf("CometBFT initial height %d must continue after migrated height %d", req.InitialHeight, a.migration.Height)
	}
	if len(req.AppStateBytes) > 0 {
		var supplied chain.ConsensusMigrationState
		if err := json.Unmarshal(req.AppStateBytes, &supplied); err != nil {
			return nil, fmt.Errorf("decode CometBFT app state: %w", err)
		}
		if err := supplied.Validate(); err != nil {
			return nil, fmt.Errorf("validate CometBFT app state: %w", err)
		}
		if supplied.StateHash != a.migration.StateHash {
			return nil, fmt.Errorf("CometBFT app state hash %s does not match loaded migration %s", supplied.StateHash, a.migration.StateHash)
		}
	}
	appHash, err := hex.DecodeString(a.committed.AppHash)
	if err != nil {
		return nil, err
	}
	return &abcitypes.ResponseInitChain{AppHash: appHash}, nil
}

func (a *Application) Query(_ context.Context, req *abcitypes.RequestQuery) (*abcitypes.ResponseQuery, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	response := &abcitypes.ResponseQuery{Code: abcitypes.CodeTypeOK, Height: a.committed.Height}
	switch {
	case req.Path == "/migration":
		payload, err := a.migration.CanonicalJSON()
		if err != nil {
			return nil, err
		}
		response.Value = payload
		return response, nil
	case req.Path == "/state":
		payload, err := json.Marshal(a.committed)
		if err != nil {
			return nil, err
		}
		response.Value = payload
		return response, nil
	case strings.HasPrefix(req.Path, "/accounts/"):
		address := strings.TrimSpace(strings.TrimPrefix(req.Path, "/accounts/"))
		index, ok := accountIndex(a.committed.Accounts, address)
		if ok {
			payload, err := json.Marshal(a.committed.Accounts[index])
			if err != nil {
				return nil, err
			}
			response.Key = []byte(address)
			response.Value = payload
			return response, nil
		}
		response.Code = 1
		response.Log = "YNX account not found"
		return response, nil
	default:
		response.Code = 1
		response.Log = "supported query paths: /migration, /state, /accounts/{address}"
		return response, nil
	}
}

func (a *Application) CheckTx(_ context.Context, req *abcitypes.RequestCheckTx) (*abcitypes.ResponseCheckTx, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	_, tx, err := a.applyTransaction(cloneAccounts(a.committed.Accounts), req.Tx)
	if err != nil {
		return &abcitypes.ResponseCheckTx{Code: transactionCode(err), Log: err.Error()}, nil
	}
	return &abcitypes.ResponseCheckTx{Code: abcitypes.CodeTypeOK, Data: []byte(SignedTransactionHash(req.Tx)), GasWanted: 1, GasUsed: 1, Info: tx.Type}, nil
}

func (a *Application) PrepareProposal(_ context.Context, req *abcitypes.RequestPrepareProposal) (*abcitypes.ResponsePrepareProposal, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	accounts := cloneAccounts(a.committed.Accounts)
	selected := make([][]byte, 0, len(req.Txs))
	var selectedBytes int64
	for _, payload := range req.Txs {
		if req.MaxTxBytes > 0 && selectedBytes+int64(len(payload)) > req.MaxTxBytes {
			continue
		}
		next, _, err := a.applyTransaction(accounts, payload)
		if err != nil {
			continue
		}
		accounts = next
		selected = append(selected, payload)
		selectedBytes += int64(len(payload))
	}
	return &abcitypes.ResponsePrepareProposal{Txs: selected}, nil
}

func (a *Application) ProcessProposal(_ context.Context, req *abcitypes.RequestProcessProposal) (*abcitypes.ResponseProcessProposal, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if req.Height != 0 && req.Height != a.committed.Height+1 {
		return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_REJECT}, nil
	}
	accounts := cloneAccounts(a.committed.Accounts)
	for _, payload := range req.Txs {
		next, _, err := a.applyTransaction(accounts, payload)
		if err != nil {
			return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_REJECT}, nil
		}
		accounts = next
	}
	return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_ACCEPT}, nil
}

func (a *Application) FinalizeBlock(_ context.Context, req *abcitypes.RequestFinalizeBlock) (*abcitypes.ResponseFinalizeBlock, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending != nil {
		return nil, errors.New("cannot finalize another block before committing pending state")
	}
	if req.Height != a.committed.Height+1 {
		return nil, fmt.Errorf("finalize height %d must immediately follow committed height %d", req.Height, a.committed.Height)
	}
	accounts := cloneAccounts(a.committed.Accounts)
	results := make([]*abcitypes.ExecTxResult, len(req.Txs))
	for i, payload := range req.Txs {
		next, tx, err := a.applyTransaction(accounts, payload)
		if err != nil {
			results[i] = &abcitypes.ExecTxResult{Code: transactionCode(err), Log: err.Error()}
			continue
		}
		accounts = next
		results[i] = &abcitypes.ExecTxResult{
			Code:    abcitypes.CodeTypeOK,
			Data:    []byte(SignedTransactionHash(payload)),
			GasUsed: 1,
			Log:     tx.Type,
			Events: []abcitypes.Event{{
				Type: "ynx.transfer",
				Attributes: []abcitypes.EventAttribute{
					{Key: "sender", Value: tx.From, Index: true},
					{Key: "recipient", Value: tx.To, Index: true},
					{Key: "amount", Value: fmt.Sprint(tx.Amount), Index: true},
				},
			}},
		}
	}
	pending, err := sealCommittedState(a.migration, req.Height, accounts)
	if err != nil {
		return nil, fmt.Errorf("seal finalized YNX state: %w", err)
	}
	a.pending = &pending
	appHash, err := hex.DecodeString(pending.AppHash)
	if err != nil {
		return nil, err
	}
	return &abcitypes.ResponseFinalizeBlock{TxResults: results, AppHash: appHash}, nil
}

func (a *Application) Commit(context.Context, *abcitypes.RequestCommit) (*abcitypes.ResponseCommit, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending == nil {
		return nil, errors.New("cannot commit without finalized state")
	}
	if err := saveCommittedState(a.statePath, *a.pending, a.migration); err != nil {
		return nil, fmt.Errorf("persist finalized YNX state: %w", err)
	}
	a.committed = *a.pending
	a.pending = nil
	return &abcitypes.ResponseCommit{RetainHeight: 0}, nil
}

func (a *Application) applyTransaction(accounts []chain.ConsensusAccount, payload []byte) ([]chain.ConsensusAccount, SignedTransaction, error) {
	tx, err := DecodeSignedTransaction(payload)
	if err != nil {
		return nil, SignedTransaction{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := tx.Verify(a.migration.Network.ChainID); err != nil {
		return nil, SignedTransaction{}, invalidTransaction(CodeInvalidTx, err)
	}
	senderIndex, ok := accountIndex(accounts, tx.From)
	if !ok {
		return nil, SignedTransaction{}, invalidTransaction(CodeInsufficientYNXT, errors.New("signed transaction sender account does not exist"))
	}
	sender := accounts[senderIndex]
	if sender.Nonce == math.MaxUint64 {
		return nil, SignedTransaction{}, invalidTransaction(CodeInvalidNonce, errors.New("signed transaction sender nonce is exhausted"))
	}
	expectedNonce := sender.Nonce + 1
	if tx.Nonce != expectedNonce {
		return nil, SignedTransaction{}, invalidTransaction(CodeInvalidNonce, fmt.Errorf("signed transaction nonce %d must equal next account nonce %d", tx.Nonce, expectedNonce))
	}
	if tx.Amount > math.MaxInt64-tx.Fee || sender.Balance < tx.Amount+tx.Fee {
		return nil, SignedTransaction{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT balance for amount and fee"))
	}
	if sender.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return nil, SignedTransaction{}, invalidTransaction(CodeInvalidTx, errors.New("sender bandwidth usage overflow"))
	}
	accounts, _ = ensureAccount(accounts, tx.To)
	accounts, _ = ensureAccount(accounts, a.feeRecipient)
	senderIndex, _ = accountIndex(accounts, tx.From)
	receiverIndex, _ := accountIndex(accounts, tx.To)
	feeIndex, _ := accountIndex(accounts, a.feeRecipient)
	if err := moveTraceableLots(&accounts[senderIndex], &accounts[receiverIndex], tx.Amount); err != nil {
		return nil, SignedTransaction{}, invalidTransaction(CodeInsufficientYNXT, err)
	}
	accounts[senderIndex].Balance -= tx.Amount + tx.Fee
	accounts[senderIndex].Nonce++
	accounts[senderIndex].ResourceUsage.BandwidthUsed++
	accounts[receiverIndex].Balance += tx.Amount
	accounts[feeIndex].Balance += tx.Fee
	return accounts, tx, nil
}

func moveTraceableLots(sender, receiver *chain.ConsensusAccount, amount int64) error {
	remaining := amount
	lotIDs := make([]string, 0, len(sender.Lots))
	for lotID := range sender.Lots {
		lotIDs = append(lotIDs, lotID)
	}
	sort.Strings(lotIDs)
	for _, lotID := range lotIDs {
		if remaining == 0 {
			break
		}
		available := sender.Lots[lotID]
		if available <= 0 {
			continue
		}
		moved := available
		if moved > remaining {
			moved = remaining
		}
		sender.Lots[lotID] -= moved
		receiver.Lots[lotID] += moved
		remaining -= moved
	}
	if remaining != 0 {
		return errors.New("insufficient traceable YNXT lot balance")
	}
	return nil
}

func invalidTransaction(code uint32, err error) error {
	return &transactionError{code: code, err: err}
}

func transactionCode(err error) uint32 {
	var txErr *transactionError
	if errors.As(err, &txErr) {
		return txErr.code
	}
	return CodeInvalidTx
}
