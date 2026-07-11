package consensus

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	ApplicationName    = "ynx-chain-abci"
	ApplicationVersion = 1
	CodeUnsupportedTx  = 2
)

type Application struct {
	abcitypes.BaseApplication
	mu              sync.RWMutex
	state           chain.ConsensusMigrationState
	appHash         []byte
	committedHeight int64
	pendingHeight   int64
}

var _ abcitypes.Application = (*Application)(nil)

func NewApplication(state chain.ConsensusMigrationState) (*Application, error) {
	if err := state.Validate(); err != nil {
		return nil, fmt.Errorf("invalid YNX consensus migration state: %w", err)
	}
	payload, err := state.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	var cloned chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &cloned); err != nil {
		return nil, fmt.Errorf("clone YNX consensus migration state: %w", err)
	}
	appHash, err := hex.DecodeString(cloned.StateHash)
	if err != nil {
		return nil, fmt.Errorf("decode YNX consensus state hash: %w", err)
	}
	return &Application{state: cloned, appHash: appHash, committedHeight: int64(cloned.Height)}, nil
}

func (a *Application) Info(context.Context, *abcitypes.RequestInfo) (*abcitypes.ResponseInfo, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return &abcitypes.ResponseInfo{
		Data:             ApplicationName,
		Version:          "cometbft-v0.38",
		AppVersion:       ApplicationVersion,
		LastBlockHeight:  a.committedHeight,
		LastBlockAppHash: append([]byte(nil), a.appHash...),
	}, nil
}

func (a *Application) InitChain(_ context.Context, req *abcitypes.RequestInitChain) (*abcitypes.ResponseInitChain, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	expectedChainID := fmt.Sprintf("ynx_%d-1", a.state.Network.ChainID)
	if req.ChainId != "" && req.ChainId != expectedChainID {
		return nil, fmt.Errorf("CometBFT chain ID %q does not match YNX migration chain ID %q", req.ChainId, expectedChainID)
	}
	if req.InitialHeight > 0 && req.InitialHeight != a.committedHeight+1 {
		return nil, fmt.Errorf("CometBFT initial height %d must continue after migrated height %d", req.InitialHeight, a.committedHeight)
	}
	if len(req.AppStateBytes) > 0 {
		var supplied chain.ConsensusMigrationState
		if err := json.Unmarshal(req.AppStateBytes, &supplied); err != nil {
			return nil, fmt.Errorf("decode CometBFT app state: %w", err)
		}
		if err := supplied.Validate(); err != nil {
			return nil, fmt.Errorf("validate CometBFT app state: %w", err)
		}
		if supplied.StateHash != a.state.StateHash {
			return nil, fmt.Errorf("CometBFT app state hash %s does not match loaded migration %s", supplied.StateHash, a.state.StateHash)
		}
	}
	return &abcitypes.ResponseInitChain{AppHash: append([]byte(nil), a.appHash...)}, nil
}

func (a *Application) Query(_ context.Context, req *abcitypes.RequestQuery) (*abcitypes.ResponseQuery, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	response := &abcitypes.ResponseQuery{Code: abcitypes.CodeTypeOK, Height: a.committedHeight}
	switch {
	case req.Path == "/migration":
		payload, err := a.state.CanonicalJSON()
		if err != nil {
			return nil, err
		}
		response.Value = payload
		return response, nil
	case strings.HasPrefix(req.Path, "/accounts/"):
		address := strings.TrimSpace(strings.TrimPrefix(req.Path, "/accounts/"))
		for _, account := range a.state.Accounts {
			if account.Address == address {
				payload, err := json.Marshal(account)
				if err != nil {
					return nil, err
				}
				response.Key = []byte(address)
				response.Value = payload
				return response, nil
			}
		}
		response.Code = 1
		response.Log = "YNX account not found"
		return response, nil
	default:
		response.Code = 1
		response.Log = "supported query paths: /migration, /accounts/{address}"
		return response, nil
	}
}

func (a *Application) CheckTx(context.Context, *abcitypes.RequestCheckTx) (*abcitypes.ResponseCheckTx, error) {
	return &abcitypes.ResponseCheckTx{Code: CodeUnsupportedTx, Log: "signed YNX consensus transactions are not enabled"}, nil
}

func (a *Application) PrepareProposal(context.Context, *abcitypes.RequestPrepareProposal) (*abcitypes.ResponsePrepareProposal, error) {
	return &abcitypes.ResponsePrepareProposal{Txs: nil}, nil
}

func (a *Application) ProcessProposal(_ context.Context, req *abcitypes.RequestProcessProposal) (*abcitypes.ResponseProcessProposal, error) {
	status := abcitypes.ResponseProcessProposal_ACCEPT
	if len(req.Txs) > 0 {
		status = abcitypes.ResponseProcessProposal_REJECT
	}
	return &abcitypes.ResponseProcessProposal{Status: status}, nil
}

func (a *Application) FinalizeBlock(_ context.Context, req *abcitypes.RequestFinalizeBlock) (*abcitypes.ResponseFinalizeBlock, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if req.Height <= a.committedHeight {
		return nil, fmt.Errorf("finalize height %d must exceed committed height %d", req.Height, a.committedHeight)
	}
	results := make([]*abcitypes.ExecTxResult, len(req.Txs))
	for i := range req.Txs {
		results[i] = &abcitypes.ExecTxResult{Code: CodeUnsupportedTx, Log: "signed YNX consensus transactions are not enabled"}
	}
	a.pendingHeight = req.Height
	return &abcitypes.ResponseFinalizeBlock{TxResults: results, AppHash: append([]byte(nil), a.appHash...)}, nil
}

func (a *Application) Commit(context.Context, *abcitypes.RequestCommit) (*abcitypes.ResponseCommit, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pendingHeight > a.committedHeight {
		a.committedHeight = a.pendingHeight
	}
	a.pendingHeight = 0
	return &abcitypes.ResponseCommit{}, nil
}
