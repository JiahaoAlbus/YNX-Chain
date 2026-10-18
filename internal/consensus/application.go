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
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	ApplicationName      = "ynx-chain-abci"
	ApplicationVersion   = 20
	CodeInvalidTx        = 2
	CodeInvalidNonce     = 3
	CodeInsufficientYNXT = 4
	CodeUnsupportedTx    = CodeInvalidTx
)

type Application struct {
	abcitypes.BaseApplication
	mu                          sync.RWMutex
	migration                   chain.ConsensusMigrationState
	committed                   CommittedState
	pending                     *CommittedState
	statePath                   string
	journal                     *snapshotJournal // explicit opt-in; default atomic JSON remains unchanged
	blockJournal                *blockJournal
	pendingBlockRequest         []byte
	pendingBlockResponseHash    string
	feeRecipient                string
	snapshotExports             map[uint64]stateSyncSnapshotExport
	snapshotRestore             *stateSyncSnapshotRestore
	commitTimings               *commitTimings // nil outside opt-in diagnostics
	commitTimingEnabled         bool
	commitTimingLatest          *CommitTimingSample
	nativeVerification          nativeVerificationCache
	replayStateVersion          int                      // decoder-owned historical journal replay only; zero for normal execution
	replayVerificationFacts     *nativeVerificationCache // decoder-owned crypto facts only; never mutable execution state
	bootstrap                   *ConsensusBootstrap
	persistenceHooks            *committedPersistenceHooks
	pqCertificateCache          *chain.PQCertificateCache
	pqEngineAuthorization       *PQEngineAuthorization
	runtimeUpgradeAuthorization *RuntimeUpgradeAuthorization
	runtimeUpgradeCursor        *runtimeUpgradeCursor
}

type transactionError struct {
	code uint32
	err  error
}

type executionState struct {
	hashVersion                int // private decoder-bound legacy replay domain, never accepted through a transaction
	bootstrap                  *ConsensusBootstrap
	validatorRegistry          *ValidatorRegistryState
	pqEngineSchedule           *PQEngineSchedule
	legacyContracts            *LegacyContracts
	legacyResourceMarket       *LegacyResourceMarket
	legacyResourceSponsor      *LegacyResourceSponsor
	legacyPaySource            *LegacyPaySource
	legacyAISource             *LegacyAISource
	legacyTrustSource          *LegacyTrustSource
	traceLots                  map[string]chain.TrustTraceLot
	accountPolicy              *ynxauth.State
	pqBatches                  map[string]PQCommittedBatch
	pqHistory                  []PQCommittedAuthorization
	accounts                   []chain.ConsensusAccount
	nativeAccounts             *nativeDelta[nativeAccountValue]
	feeEvents                  feeEventJournal
	strategyMandates           []assetauth.StrategyMandate
	strategyVaults             []assetauth.StrategyVault
	assetAuditEvents           []BFTAssetAuditEvent
	smartAccounts              []assetauth.SmartAccount
	paymasters                 []BFTPaymaster
	userOperationEvents        []BFTUserOperationEvent
	stakeDelegations           []BFTStakeDelegation
	unbondings                 []BFTUnbondingEntry
	nativeTransfers            []BFTNativeTransfer
	permissions                []BFTAIPermission
	actions                    []BFTAIAction
	auditEvents                []BFTAIAuditEvent
	payIntents                 []BFTPayIntent
	payInvoices                []BFTPayInvoice
	paySettlements             []BFTPaySettlement
	payRefunds                 []BFTPayRefund
	payWebhooks                []BFTPayWebhook
	payEvents                  []BFTPayEvent
	payIdempotency             []BFTPayIdempotency
	resourceQuotes             []BFTResourceQuote
	resourceDelegations        []BFTResourceDelegation
	resourceRentals            []BFTResourceRental
	resourceIncome             []BFTResourceIncome
	resourceEvents             []BFTResourceEvent
	resourceIdempotency        []BFTResourceIdempotency
	resourcePools              []BFTResourcePool
	resourceSponsorships       []BFTResourceSponsorship
	resourceSponsorIdempotency []BFTResourceSponsorIdempotency
	resourceSponsorActionRefs  []BFTResourceSponsorActionRef
	resourceSponsorAudit       []BFTResourceSponsorAudit
	governanceRequests         []BFTGovernanceRequest
	trustAppeals               []BFTTrustAppeal
	trustCorrections           []BFTTrustCorrection
	trustLabels                []BFTTrustLabel
	trustEvidence              []BFTTrustEvidence
	trackingReviews            []BFTTrackingReview
	transparency               []BFTTransparencyEntry
	contracts                  []BFTContract
	evmReceipts                []BFTEVMReceipt
	evmLogs                    []BFTEVMLog
	ideIdempotency             []BFTIDEIdempotency
	governanceExecutions       []BFTGovernanceExecution
	governanceExecutionAudit   []BFTGovernanceExecutionAudit
	dexAssets                  []BFTDexAsset
	dexBalances                []BFTDexBalance
	dexPools                   []BFTDexPool
	dexEvents                  []BFTDexEvent
}

type transactionExecution struct {
	resultData []byte
	typeName   string
	hash       string
	event      abcitypes.Event
	gas        int64
}

func executionResultData(tx transactionExecution, payload []byte) []byte {
	if tx.resultData != nil {
		return tx.resultData
	}
	return []byte(tx.resultHash(payload))
}

func (e transactionExecution) resultHash(payload []byte) string {
	if e.hash != "" {
		return e.hash
	}
	return SignedTransactionHash(payload)
}

func (e transactionExecution) gasUsed() int64 {
	if e.gas > 0 {
		return e.gas
	}
	return 1
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
	return newPersistentApplication(state, statePath, nil, nil)
}

// Bootstrap is explicit operator configuration, not recovered authority.
// Omitting it preserves legacy hashes and refuses registry-bearing state.
func NewPersistentApplicationWithBootstrap(state chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap) (*Application, error) {
	if bootstrap == nil {
		return nil, errors.New("explicit consensus bootstrap is required")
	}
	return newPersistentApplication(state, statePath, bootstrap, nil)
}

func newPersistentApplication(state chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, hooks *committedPersistenceHooks) (*Application, error) {
	return newPersistentApplicationWithAuthorization(state, statePath, bootstrap, hooks, nil)
}

// Authorization is independent startup configuration, never restored from the
// same ledger or accepted through a transaction/API request.
func NewPersistentApplicationWithEngineAuthorization(state chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization) (*Application, error) {
	if bootstrap == nil || authorization == nil {
		return nil, errors.New("engine schedule requires explicit bootstrap and independent operator authorization")
	}
	return newPersistentApplicationWithAuthorization(state, statePath, bootstrap, nil, authorization)
}

func newPersistentApplicationWithAuthorization(state chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, hooks *committedPersistenceHooks, authorization *PQEngineAuthorization) (*Application, error) {
	if err := state.Validate(); err != nil {
		return nil, fmt.Errorf("invalid YNX consensus migration state: %w", err)
	}
	if err := validateMigrationExecutionClosure(state); err != nil {
		return nil, err
	}
	payload, err := state.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &migration); err != nil {
		return nil, fmt.Errorf("clone YNX consensus migration state: %w", err)
	}
	if bootstrap != nil {
		if err := bootstrap.matchesMigration(migration); err != nil {
			return nil, err
		}
	}
	committed, err := loadCommittedStateWithBootstrap(strings.TrimSpace(statePath), migration, bootstrap)
	if err != nil {
		return nil, err
	}
	if err := committed.Validate(migration); err != nil {
		return nil, fmt.Errorf("validate imported or restored application state: %w", err)
	}
	if err := authorization.ValidateCommittedSchedule(committed.PQEngineSchedule, committed.Height); err != nil {
		return nil, err
	}
	if authorization != nil && committed.PQEngineSchedule == nil {
		if authorization.schedule.RegistryHeight != committed.Height {
			return nil, errors.New("operator schedule must bind the actual committed registry height")
		}
		if _, err := newPQEngineSnapshot(bootstrap, committed.ValidatorRegistry, authorization.schedule, authorization.schedule.AuthorizedAt); err != nil {
			return nil, fmt.Errorf("validate independently authorized engine candidate: %w", err)
		}
	}
	if err := confirmLoadedCommittedState(strings.TrimSpace(statePath), hooks); err != nil {
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
		pqCertificateCache:    chain.NewPQCertificateCache(),
		pqEngineAuthorization: authorization,
		bootstrap:             bootstrap,
		persistenceHooks:      hooks,
		migration:             migration,
		committed:             committed,
		statePath:             strings.TrimSpace(statePath),
		feeRecipient:          feeRecipient,
	}, nil
}

// NewJournaledApplication is an explicit alternative full-snapshot layout.
// Existing JSON state files are never converted or overwritten by this API.
func NewJournaledApplication(state chain.ConsensusMigrationState, path string) (*Application, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("journal requires an explicit durable path")
	}
	a, err := NewPersistentApplication(state, "")
	if err != nil {
		return nil, err
	}
	j, committed, err := openSnapshotJournal(path, a.migration)
	if err != nil {
		return nil, err
	}
	a.journal, a.committed, a.statePath = j, committed, path
	return a, nil
}

func (a *Application) persistState(state CommittedState, timings *commitTimings) error {
	if a.blockJournal != nil {
		return a.blockJournal.replaceCheckpoint(state, a.migration)
	}
	if a.journal != nil {
		return a.journal.save(state, a.migration, timings)
	}
	return saveCommittedStateWithHooksAndTimings(a.statePath, state, a.migration, a.persistenceHooks, timings)
}

// NewBlockJournaledApplication uses an explicit V2 checkpoint/block format.
// V1 journals and atomic JSON files are not converted or overwritten.
func NewBlockJournaledApplication(state chain.ConsensusMigrationState, path string) (*Application, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("block journal requires an explicit path")
	}
	a, err := NewPersistentApplication(state, "")
	if err != nil {
		return nil, err
	}
	j, committed, err := openBlockJournal(path, a.migration)
	if err != nil {
		return nil, err
	}
	a.blockJournal, a.committed, a.statePath = j, committed, path
	return a, nil
}

func (a *Application) Info(context.Context, *abcitypes.RequestInfo) (*abcitypes.ResponseInfo, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	version, err := a.runtimeApplicationVersionLocked()
	if err != nil {
		return nil, err
	}
	if !a.committed.Initialized {
		return &abcitypes.ResponseInfo{
			Data:       ApplicationName,
			Version:    "cometbft-v0.38",
			AppVersion: version,
		}, nil
	}
	appHash, err := hex.DecodeString(a.committed.AppHash)
	if err != nil {
		return nil, fmt.Errorf("decode committed app hash: %w", err)
	}
	return &abcitypes.ResponseInfo{
		Data:             ApplicationName,
		Version:          "cometbft-v0.38",
		AppVersion:       version,
		LastBlockHeight:  a.committed.Height,
		LastBlockAppHash: appHash,
	}, nil
}

func (a *Application) InitChain(_ context.Context, req *abcitypes.RequestInitChain) (*abcitypes.ResponseInitChain, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.bootstrap != nil {
		if err := a.bootstrap.validateInitChain(req); err != nil {
			return nil, err
		}
	}
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
	if queryPQWallet(response, req, a.committed, a.migration) {
		return response, nil
	}
	if queryPQIdentity(response, req, a.committed, a.migration, a.bootstrap) {
		return response, nil
	}
	if queryPQEthereumValue(response, req, a.committed, a.migration) {
		return response, nil
	}
	if queryPQAction(response, req, a.committed, a.migration) {
		return response, nil
	}
	if req.Path == "/validator-registry" {
		// No pending/candidate state or bootstrap authority is published here.
		response.Value, _ = json.Marshal(a.committed.ValidatorRegistry)
		return response, nil
	}
	if queryLegacySponsor(response, req.Path, a.committed) {
		return response, nil
	}
	if queryLegacyResourceMarket(response, req.Path, a.committed.LegacyResourceMarket, a.committed) {
		return response, nil
	}
	if queryLegacyContracts(response, req.Path, a.committed) {
		return response, nil
	}
	if queryLegacyPaySource(response, req.Path, a.committed.LegacyPaySource, a.committed) {
		return response, nil
	}
	if queryLegacyAISource(response, req.Path, a.committed.LegacyAISource, a.committed) {
		return response, nil
	}
	if queryLegacyTrustSource(response, req.Path, a.committed.LegacyTrustSource, a.committed) {
		return response, nil
	}
	switch {
	case req.Path == "/migration/compatibility":
		response.Value, _ = json.Marshal(MigrationExecutionBlockers(a.migration))
		return response, nil
	case strings.HasPrefix(req.Path, "/pq-batches/"):
		hash := strings.TrimPrefix(req.Path, "/pq-batches/")
		if proof, ok := a.committed.PQBatches[hash]; ok {
			response.Value, _ = json.Marshal(proof)
			return response, nil
		}
		if a.migration.Runtime != nil {
			if proof, ok := a.migration.Runtime.PQBatches[hash]; ok {
				response.Value, _ = json.Marshal(proof)
				return response, nil
			}
		}
		response.Code, response.Log = 1, "PQ batch not found"
		return response, nil
	case req.Path == "/account-policy":
		response.Value, _ = json.Marshal(a.committed.AccountPolicy)
		return response, nil
	case strings.HasPrefix(req.Path, "/migration/transactions/"):
		tx, ok := sourceHistoryTransaction(a.migration, strings.TrimPrefix(req.Path, "/migration/transactions/"))
		if !ok {
			response.Code, response.Log = 1, "source transaction not found"
			return response, nil
		}
		response.Value, _ = json.Marshal(tx)
		return response, nil
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
	case req.Path == "/economics/fees":
		response.Value, _ = json.Marshal(a.committed.FeeEvents)
		return response, nil
	case strings.HasPrefix(req.Path, "/economics/fees/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/economics/fees/"), a.committed.FeeEvents, func(v BFTFeeEvent) string { return v.ID }, "Fee event")
	case req.Path == "/quant/mandates":
		response.Value, _ = json.Marshal(a.committed.StrategyMandates)
		return response, nil
	case strings.HasPrefix(req.Path, "/quant/mandates/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/quant/mandates/"), a.committed.StrategyMandates, func(v assetauth.StrategyMandate) string { return v.ID }, "Strategy mandate")
	case req.Path == "/quant/vaults":
		response.Value, _ = json.Marshal(a.committed.StrategyVaults)
		return response, nil
	case strings.HasPrefix(req.Path, "/quant/vaults/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/quant/vaults/"), a.committed.StrategyVaults, func(v assetauth.StrategyVault) string { return v.ID }, "Strategy vault")
	case req.Path == "/quant/audit":
		response.Value, _ = json.Marshal(a.committed.AssetAuditEvents)
		return response, nil
	case req.Path == "/dex/assets":
		response.Value, _ = json.Marshal(a.committed.DexAssets)
		return response, nil
	case strings.HasPrefix(req.Path, "/dex/assets/"):
		id := normalizeDexAssetID(strings.TrimPrefix(req.Path, "/dex/assets/"))
		if id == DexNativeAssetID {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(map[string]any{"id": DexNativeAssetID, "symbol": DexNativeAssetID, "name": "YNX Testnet", "native": true, "decimals": 0})
			return response, nil
		}
		return queryPayRecord(response, id, a.committed.DexAssets, func(v BFTDexAsset) string { return v.ID }, "DEX asset")
	case req.Path == "/dex/balances":
		response.Value, _ = json.Marshal(a.committed.DexBalances)
		return response, nil
	case strings.HasPrefix(req.Path, "/dex/balances/"):
		address := strings.TrimSpace(strings.TrimPrefix(req.Path, "/dex/balances/"))
		if !IsNativeAddress(address) {
			response.Code, response.Log = 1, "canonical YNX address is required"
			return response, nil
		}
		balances := make([]BFTDexBalance, 0)
		for _, balance := range a.committed.DexBalances {
			if balance.Account == address {
				balances = append(balances, balance)
			}
		}
		response.Key = []byte(address)
		response.Value, _ = json.Marshal(balances)
		return response, nil
	case req.Path == "/dex/pools":
		response.Value, _ = json.Marshal(a.committed.DexPools)
		return response, nil
	case strings.HasPrefix(req.Path, "/dex/pools/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/dex/pools/"), a.committed.DexPools, func(v BFTDexPool) string { return v.ID }, "DEX pool")
	case req.Path == "/dex/events":
		response.Value, _ = json.Marshal(a.committed.DexEvents)
		return response, nil
	case req.Path == "/aa/accounts":
		response.Value, _ = json.Marshal(a.committed.SmartAccounts)
		return response, nil
	case strings.HasPrefix(req.Path, "/aa/accounts/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/aa/accounts/"), a.committed.SmartAccounts, func(v assetauth.SmartAccount) string { return v.Address }, "Smart account")
	case req.Path == "/aa/paymasters":
		response.Value, _ = json.Marshal(a.committed.Paymasters)
		return response, nil
	case strings.HasPrefix(req.Path, "/aa/paymasters/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/aa/paymasters/"), a.committed.Paymasters, func(v BFTPaymaster) string { return v.Policy.ID }, "Paymaster")
	case req.Path == "/aa/user-operations":
		response.Value, _ = json.Marshal(a.committed.UserOperationEvents)
		return response, nil
	case strings.HasPrefix(req.Path, "/aa/user-operations/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/aa/user-operations/"), a.committed.UserOperationEvents, func(v BFTUserOperationEvent) string { return v.ID }, "User operation")
	case req.Path == "/staking/delegations":
		response.Value, _ = json.Marshal(a.committed.StakeDelegations)
		return response, nil
	case strings.HasPrefix(req.Path, "/staking/delegations/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/staking/delegations/"), a.committed.StakeDelegations, func(v BFTStakeDelegation) string { return v.ID }, "Stake delegation")
	case req.Path == "/staking/unbondings":
		response.Value, _ = json.Marshal(a.committed.Unbondings)
		return response, nil
	case strings.HasPrefix(req.Path, "/staking/unbondings/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/staking/unbondings/"), a.committed.Unbondings, func(v BFTUnbondingEntry) string { return v.ID }, "Unbonding entry")
	case req.Path == "/staking/summary":
		response.Value, _ = json.Marshal(stakingRecordSummary(a.migration, a.committed))
		return response, nil
	case req.Path == "/treasury/snapshot":
		response.Value, _ = json.Marshal(buildTreasurySnapshot(a.migration, a.committed))
		return response, nil
	case req.Path == "/solvency/snapshot":
		snapshot, err := buildSolvencySnapshot(a.migration, a.committed)
		if err != nil {
			return nil, err
		}
		response.Value, _ = json.Marshal(snapshot)
		return response, nil
	case strings.HasPrefix(req.Path, "/solvency/liabilities/"):
		address := strings.TrimSpace(strings.TrimPrefix(req.Path, "/solvency/liabilities/"))
		if !IsNativeAddress(address) {
			response.Code, response.Log = 1, "canonical YNX liability address is required"
			return response, nil
		}
		proof, err := buildSolvencyLiabilityProof(a.committed, address)
		if err != nil {
			response.Code, response.Log = 1, err.Error()
			return response, nil
		}
		response.Key = []byte(address)
		response.Value, _ = json.Marshal(proof)
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
	case req.Path == "/ai/permissions":
		response.Value, _ = json.Marshal(a.committed.AIPermissions)
		return response, nil
	case strings.HasPrefix(req.Path, "/ai/permissions/"):
		id := strings.TrimSpace(strings.TrimPrefix(req.Path, "/ai/permissions/"))
		if index, ok := aiPermissionIndex(a.committed.AIPermissions, id); ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(a.committed.AIPermissions[index])
			return response, nil
		}
		response.Code, response.Log = 1, "AI permission not found"
		return response, nil
	case req.Path == "/ai/actions":
		response.Value, _ = json.Marshal(a.committed.AIActions)
		return response, nil
	case strings.HasPrefix(req.Path, "/ai/actions/"):
		id := strings.TrimSpace(strings.TrimPrefix(req.Path, "/ai/actions/"))
		if index, ok := aiActionIndex(a.committed.AIActions, id); ok {
			response.Key = []byte(id)
			response.Value, _ = json.Marshal(a.committed.AIActions[index])
			return response, nil
		}
		response.Code, response.Log = 1, "AI action not found"
		return response, nil
	case req.Path == "/ai/audit":
		response.Value, _ = json.Marshal(a.committed.AIAuditEvents)
		return response, nil
	case strings.HasPrefix(req.Path, "/pay/intents/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/pay/intents/"), a.committed.PayIntents, func(v BFTPayIntent) string { return v.ID }, "Pay intent")
	case strings.HasPrefix(req.Path, "/pay/invoices/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/pay/invoices/"), a.committed.PayInvoices, func(v BFTPayInvoice) string { return v.ID }, "Pay invoice")
	case strings.HasPrefix(req.Path, "/pay/settlements/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/pay/settlements/"), a.committed.PaySettlements, func(v BFTPaySettlement) string { return v.ID }, "Pay settlement")
	case strings.HasPrefix(req.Path, "/pay/refunds/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/pay/refunds/"), a.committed.PayRefunds, func(v BFTPayRefund) string { return v.ID }, "Pay refund")
	case strings.HasPrefix(req.Path, "/pay/webhooks/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/pay/webhooks/"), a.committed.PayWebhooks, func(v BFTPayWebhook) string { return v.EventID }, "Pay webhook")
	case req.Path == "/pay/events":
		response.Value, _ = json.Marshal(a.committed.PayEvents)
		return response, nil
	case strings.HasPrefix(req.Path, "/pay/events/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/pay/events/"), a.committed.PayEvents, func(v BFTPayEvent) string { return v.ID }, "Pay event")
	case strings.HasPrefix(req.Path, "/pay/idempotency/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/pay/idempotency/"), a.committed.PayIdempotency, func(v BFTPayIdempotency) string { return v.ID }, "Pay idempotency")
	case req.Path == "/resource/policy":
		response.Value, _ = json.Marshal(a.migration.ResourcePolicy)
		return response, nil
	case strings.HasPrefix(req.Path, "/resource/quotes/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/resource/quotes/"), a.committed.ResourceQuotes, func(v BFTResourceQuote) string { return v.ID }, "Resource quote")
	case req.Path == "/resource/delegations":
		response.Value, _ = json.Marshal(a.committed.ResourceDelegations)
		return response, nil
	case strings.HasPrefix(req.Path, "/resource/delegations/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/resource/delegations/"), a.committed.ResourceDelegations, func(v BFTResourceDelegation) string { return v.ID }, "Resource delegation")
	case req.Path == "/resource/rentals":
		response.Value, _ = json.Marshal(a.committed.ResourceRentals)
		return response, nil
	case strings.HasPrefix(req.Path, "/resource/rentals/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/resource/rentals/"), a.committed.ResourceRentals, func(v BFTResourceRental) string { return v.ID }, "Resource rental")
	case req.Path == "/resource/income":
		response.Value, _ = json.Marshal(a.committed.ResourceIncome)
		return response, nil
	case req.Path == "/resource/events":
		response.Value, _ = json.Marshal(a.committed.ResourceEvents)
		return response, nil
	case strings.HasPrefix(req.Path, "/resource/idempotency/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/resource/idempotency/"), a.committed.ResourceIdempotency, func(v BFTResourceIdempotency) string { return v.ID }, "Resource idempotency")
	case req.Path == "/resource/pools":
		response.Value, _ = json.Marshal(a.committed.ResourcePools)
		return response, nil
	case strings.HasPrefix(req.Path, "/resource/pools/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/resource/pools/"), a.committed.ResourcePools, func(v BFTResourcePool) string { return v.ID }, "Resource pool")
	case req.Path == "/resource/sponsorships":
		response.Value, _ = json.Marshal(a.committed.ResourceSponsorships)
		return response, nil
	case strings.HasPrefix(req.Path, "/resource/sponsorships/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/resource/sponsorships/"), a.committed.ResourceSponsorships, func(v BFTResourceSponsorship) string { return v.ID }, "Resource sponsorship")
	case strings.HasPrefix(req.Path, "/resource/sponsor-idempotency/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/resource/sponsor-idempotency/"), a.committed.ResourceSponsorIdempotency, func(v BFTResourceSponsorIdempotency) string { return v.ID }, "Resource sponsor idempotency")
	case req.Path == "/resource/sponsor-audit":
		response.Value, _ = json.Marshal(a.committed.ResourceSponsorAudit)
		return response, nil
	case req.Path == "/resource/sponsor-action-refs":
		response.Value, _ = json.Marshal(a.committed.ResourceSponsorActionRefs)
		return response, nil
	case req.Path == "/resource/analytics":
		response.Value, _ = json.Marshal(buildBFTResourceAnalytics(a.migration, a.committed))
		return response, nil
	case strings.HasPrefix(req.Path, "/resources/"):
		address := strings.TrimSpace(strings.TrimPrefix(req.Path, "/resources/"))
		if index, ok := accountIndex(a.committed.Accounts, address); ok {
			response.Value, _ = json.Marshal(bftResourceBalance(a.committed.Accounts[index], a.migration.ResourcePolicy))
			return response, nil
		}
		response.Code, response.Log = 1, "Resource account not found"
		return response, nil
	case strings.HasPrefix(req.Path, "/governance/requests/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/governance/requests/"), a.committed.GovernanceRequests, func(v BFTGovernanceRequest) string { return v.ID }, "governance request")
	case strings.HasPrefix(req.Path, "/trust/appeals/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/trust/appeals/"), a.committed.TrustAppeals, func(v BFTTrustAppeal) string { return v.ID }, "Trust appeal")
	case strings.HasPrefix(req.Path, "/trust/corrections/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/trust/corrections/"), a.committed.TrustCorrections, func(v BFTTrustCorrection) string { return v.ID }, "Trust correction")
	case strings.HasPrefix(req.Path, "/trust/labels/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/trust/labels/"), a.committed.TrustLabels, func(v BFTTrustLabel) string { return v.ID }, "Trust label")
	case strings.HasPrefix(req.Path, "/trust/evidence/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/trust/evidence/"), a.committed.TrustEvidence, func(v BFTTrustEvidence) string { return v.ID }, "Trust evidence")
	case strings.HasPrefix(req.Path, "/trust/tracking-reviews/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/trust/tracking-reviews/"), a.committed.TrackingReviews, func(v BFTTrackingReview) string { return v.ID }, "Trust tracking review")
	case strings.HasPrefix(req.Path, "/trust/trace/"):
		subject := strings.TrimSpace(strings.TrimPrefix(req.Path, "/trust/trace/"))
		if subject == "" {
			response.Code, response.Log = 1, "Trust trace subject is required"
			return response, nil
		}
		response.Value, _ = json.Marshal(buildBFTTrustTrace(a.committed, subject))
		return response, nil
	case req.Path == "/governance/transparency":
		response.Value, _ = json.Marshal(a.committed.Transparency)
		return response, nil
	case req.Path == "/governance/executions":
		response.Value, _ = json.Marshal(a.committed.GovernanceExecutions)
		return response, nil
	case strings.HasPrefix(req.Path, "/governance/executions/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/governance/executions/"), a.committed.GovernanceExecutions, func(v BFTGovernanceExecution) string { return v.ProposalID }, "governance execution")
	case req.Path == "/governance/execution-audit":
		response.Value, _ = json.Marshal(a.committed.GovernanceExecutionAudit)
		return response, nil
	case req.Path == "/ide/contracts":
		response.Value, _ = json.Marshal(a.committed.Contracts)
		return response, nil
	case strings.HasPrefix(req.Path, "/ide/contracts/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/ide/contracts/"), a.committed.Contracts, func(v BFTContract) string { return v.Address }, "IDE contract")
	case strings.HasPrefix(req.Path, "/ide/verifier/"):
		address := strings.TrimPrefix(req.Path, "/ide/verifier/")
		index, ok := bftContractIndex(a.committed.Contracts, address)
		if !ok {
			response.Code, response.Log = 1, "IDE contract verifier evidence not found"
			return response, nil
		}
		contract := a.committed.Contracts[index]
		response.Value, _ = json.Marshal(map[string]any{"address": contract.Address, "name": contract.Name, "sourceHash": contract.SourceHash, "deployedBytecodeHash": contract.DeployedBytecodeHash, "runtimeMode": contract.RuntimeMode, "artifactStatus": "bounded_pinned_artifact_committed", "verificationStatus": "source_and_deployed_bytecode_identity_committed", "blockHeight": contract.BlockHeight, "transactionHash": contract.TxHash, "auditHash": contract.AuditHash, "remotePublicProofStatus": "not_claimed"})
		return response, nil
	case strings.HasPrefix(req.Path, "/ide/call/"):
		parts := strings.SplitN(strings.TrimPrefix(req.Path, "/ide/call/"), "/", 2)
		if len(parts) != 2 {
			response.Code, response.Log = 1, "IDE call requires contract and calldata"
			return response, nil
		}
		index, ok := bftContractIndex(a.committed.Contracts, parts[0])
		if !ok {
			response.Code, response.Log = 1, "IDE contract not found"
			return response, nil
		}
		encoded, steps, err := chain.CallBoundedContract(a.committed.Contracts[index].DeployedBytecode, normalizeIDEQueryCalldata(parts[1]), a.committed.Contracts[index].RuntimeStorage)
		if err != nil {
			response.Code, response.Log = 1, "bounded IDE call failed: "+err.Error()
			return response, nil
		}
		response.Value, _ = json.Marshal(map[string]any{"address": parts[0], "encodedResult": encoded, "opcodeStepCount": steps, "runtimeMode": chain.BoundedContractRuntimeMode})
		return response, nil
	case strings.HasPrefix(req.Path, "/evm/receipts/"):
		return queryPayRecord(response, strings.TrimPrefix(req.Path, "/evm/receipts/"), a.committed.EVMReceipts, func(v BFTEVMReceipt) string { return v.TxHash }, "EVM receipt")
	case req.Path == "/evm/logs":
		response.Value, _ = json.Marshal(a.committed.EVMLogs)
		return response, nil
	default:
		response.Code = 1
		response.Log = "supported query paths include migration, state, accounts, economics fees, Quant mandates/vaults/audit, DEX assets/balances/pools/events, account abstraction, staking, Treasury, solvency, AI, Pay, Resource Market, governance, Trust, IDE contracts/calls, EVM receipts/logs, and transparency"
		return response, nil
	}
}

// Caller holds a.mu. Constructing a detached snapshot here avoids recursively
// acquiring that lock through the public committed-snapshot accessor.
func (a *Application) validateEngineNextValidatorsHash(height int64, hash []byte) error {
	if a.bootstrap == nil {
		return nil
	}
	if a.committed.PQEngineSchedule == nil {
		return a.bootstrap.validateFixedMembership(hash)
	}
	if height == 0 {
		height = a.committed.Height + 1
	}
	if err := a.pqEngineAuthorization.ValidateCommittedSchedule(a.committed.PQEngineSchedule, a.committed.Height); err != nil {
		return err
	}
	snapshot, err := newPQEngineSnapshot(a.bootstrap, a.committed.ValidatorRegistry, a.committed.PQEngineSchedule, a.committed.Height)
	if err != nil {
		return err
	}
	return snapshot.ValidateNextValidatorsHash(height, hash)
}

func (a *Application) CheckTx(_ context.Context, req *abcitypes.RequestCheckTx) (*abcitypes.ResponseCheckTx, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	state := a.committedExecutionStateView()
	state, err := a.prepareConsensusExecution(state, a.committed.Height+1)
	if err != nil {
		return &abcitypes.ResponseCheckTx{Code: CodeInvalidTx, Log: err.Error()}, nil
	}
	_, tx, err := a.applyTransaction(state, req.Tx, a.committed.Height+1, time.Time{})
	if err != nil {
		return &abcitypes.ResponseCheckTx{Code: transactionCode(err), Log: err.Error(), Data: tx.resultData}, nil
	}
	return &abcitypes.ResponseCheckTx{Code: abcitypes.CodeTypeOK, Data: executionResultData(tx, req.Tx), GasWanted: tx.gasUsed(), GasUsed: tx.gasUsed(), Info: tx.typeName}, nil
}

func (a *Application) PrepareProposal(_ context.Context, req *abcitypes.RequestPrepareProposal) (*abcitypes.ResponsePrepareProposal, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.validateEngineNextValidatorsHash(req.Height, req.NextValidatorsHash); err != nil {
		return nil, err
	}
	height := req.Height
	if height == 0 {
		height = a.committed.Height + 1
	}
	if height != a.committed.Height+1 {
		return nil, errors.New("proposal height must follow committed state")
	}
	state := a.committedExecutionStateView()
	state, err := a.prepareConsensusExecution(state, height)
	if err != nil {
		return nil, err
	}
	selected := make([][]byte, 0, len(req.Txs))
	var selectedBytes int64
	for _, payload := range req.Txs {
		if req.MaxTxBytes > 0 && selectedBytes+int64(len(payload)) > req.MaxTxBytes {
			continue
		}
		next, _, err := a.applyTransactionAt(state, payload, height, req.Time, uint32(len(selected)))
		if err != nil {
			continue
		}
		state = next
		selected = append(selected, payload)
		selectedBytes += int64(len(payload))
	}
	return &abcitypes.ResponsePrepareProposal{Txs: selected}, nil
}

func (a *Application) ProcessProposal(_ context.Context, req *abcitypes.RequestProcessProposal) (*abcitypes.ResponseProcessProposal, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if err := a.validateEngineNextValidatorsHash(req.Height, req.NextValidatorsHash); err != nil {
		return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_REJECT}, nil
	}
	if req.Height != 0 && req.Height != a.committed.Height+1 {
		return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_REJECT}, nil
	}
	height := req.Height
	if height == 0 {
		height = a.committed.Height + 1
	}
	state := a.committedExecutionStateView()
	state, err := a.prepareConsensusExecution(state, height)
	if err != nil {
		return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_REJECT}, nil
	}
	for i, payload := range req.Txs {
		next, _, err := a.applyTransactionAt(state, payload, height, req.Time, uint32(i))
		if err != nil {
			return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_REJECT}, nil
		}
		state = next
	}
	return &abcitypes.ResponseProcessProposal{Status: abcitypes.ResponseProcessProposal_ACCEPT}, nil
}

func (a *Application) FinalizeBlock(_ context.Context, req *abcitypes.RequestFinalizeBlock) (*abcitypes.ResponseFinalizeBlock, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending != nil {
		return nil, errors.New("cannot finalize another block before committing pending state")
	}
	if err := a.validateEngineNextValidatorsHash(req.Height, req.NextValidatorsHash); err != nil {
		return nil, err
	}
	if req.Height != a.committed.Height+1 {
		return nil, fmt.Errorf("finalize height %d must immediately follow committed height %d", req.Height, a.committed.Height)
	}
	var ownedRequest []byte
	if a.blockJournal != nil {
		var err error
		ownedRequest, err = req.Marshal()
		if err != nil {
			return nil, err
		}
		if len(ownedRequest) > blockJournalMaxRequest {
			return nil, errors.New("FinalizeBlock request exceeds block-journal bound")
		}
		var owned abcitypes.RequestFinalizeBlock
		if err := owned.Unmarshal(ownedRequest); err != nil {
			return nil, err
		}
		req = &owned
	}
	state := a.committedExecutionStateView()
	state, err := a.prepareConsensusExecution(state, req.Height)
	if err != nil {
		return nil, err
	}
	results := make([]*abcitypes.ExecTxResult, len(req.Txs))
	for i, payload := range req.Txs {
		next, tx, err := a.applyTransactionAt(state, payload, req.Height, req.Time, uint32(i))
		if err != nil {
			results[i] = &abcitypes.ExecTxResult{Code: transactionCode(err), Log: err.Error(), Data: tx.resultData}
			continue
		}
		state = next
		events := []abcitypes.Event{}
		if tx.event.Type != "" {
			events = append(events, tx.event)
		}
		results[i] = &abcitypes.ExecTxResult{
			Code:    abcitypes.CodeTypeOK,
			Data:    executionResultData(tx, payload),
			GasUsed: tx.gasUsed(),
			Log:     tx.typeName,
			Events:  events,
		}
	}
	pending, err := sealCommittedState(a.migration, req.Height, state)
	if err != nil {
		return nil, fmt.Errorf("seal finalized YNX state: %w", err)
	}
	if err := validateConsensusPQContinuation(a.committed, pending); err != nil {
		return nil, err
	}
	if err := validateLegacySourceContinuation(a.committed, pending); err != nil {
		return nil, err
	}
	if err := validateValidatorRegistryContinuation(a.committed, pending); err != nil {
		return nil, err
	}
	if err := validatePQEngineScheduleContinuation(a.committed.PQEngineSchedule, pending.PQEngineSchedule); err != nil {
		return nil, err
	}
	appHash, err := hex.DecodeString(pending.AppHash)
	if err != nil {
		return nil, err
	}
	response := &abcitypes.ResponseFinalizeBlock{TxResults: results, AppHash: appHash}
	if a.bootstrap != nil {
		snapshot, err := newPQEngineSnapshot(a.bootstrap, pending.ValidatorRegistry, pending.PQEngineSchedule, req.Height)
		if err != nil {
			return nil, err
		}
		params, updates, err := snapshot.UpdatesAt(req.Height)
		if err != nil {
			return nil, err
		}
		response.ConsensusParamUpdates, response.ValidatorUpdates = params, updates
	}
	if err := a.applyRuntimeUpgradeResponse(req.Height, response); err != nil {
		return nil, err
	}
	if a.blockJournal != nil {
		hash, err := finalizeResponseHash(response)
		if err != nil {
			return nil, err
		}
		a.pendingBlockRequest, a.pendingBlockResponseHash = ownedRequest, hash
	}
	a.pending = &pending
	return response, nil
}

func (a *Application) Commit(context.Context, *abcitypes.RequestCommit) (*abcitypes.ResponseCommit, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.commitTimingEnabled {
		a.commitTimingLatest = nil
	}

	if a.pending == nil {
		return nil, errors.New("cannot commit without finalized state")
	}
	if a.runtimeUpgradeAuthorization != nil {
		if _, err := a.runtimeUpgradeCursor.modeForNext(a.committed, a.pending.Height); err != nil {
			return nil, err
		}
	}
	if err := validateConsensusPQContinuation(a.committed, *a.pending); err != nil {
		return nil, err
	}
	if err := validateLegacySourceContinuation(a.committed, *a.pending); err != nil {
		return nil, err
	}
	if err := validateValidatorRegistryContinuation(a.committed, *a.pending); err != nil {
		return nil, err
	}
	if err := validatePQEngineScheduleContinuation(a.committed.PQEngineSchedule, a.pending.PQEngineSchedule); err != nil {
		return nil, err
	}
	if err := a.pqEngineAuthorization.ValidateCommittedSchedule(a.pending.PQEngineSchedule, a.pending.Height); err != nil {
		return nil, err
	}
	var started time.Time
	if a.commitTimingEnabled {
		started = time.Now()
		a.commitTimings = &commitTimings{}
	}
	var err error
	if a.blockJournal != nil {
		err = a.blockJournal.saveBlock(a.committed, *a.pending, a.pendingBlockRequest, a.pendingBlockResponseHash, a.migration, a.commitTimings)
	} else {
		err = a.persistState(*a.pending, a.commitTimings)
	}
	if a.commitTimingEnabled {
		storage := "atomic-json"
		if a.journal != nil {
			storage = "snapshot-journal-v1"
		}
		if a.blockJournal != nil {
			storage = "block-journal-v2"
		}
		sample := &CommitTimingSample{Height: a.pending.Height, Storage: storage, Durable: err == nil && a.statePath != "", ElapsedNs: time.Since(started).Nanoseconds(), PayloadBytes: a.commitTimings.bytes, StagesNs: make(map[string]int64, len(a.commitTimings.stages))}
		for stage, duration := range a.commitTimings.stages {
			sample.StagesNs[stage] = duration.Nanoseconds()
		}
		a.commitTimingLatest = sample
	}
	if err != nil {
		return nil, fmt.Errorf("persist finalized YNX state: %w", err)
	}
	a.committed = *a.pending
	a.pending = nil
	a.pendingBlockRequest = nil
	a.pendingBlockResponseHash = ""
	return &abcitypes.ResponseCommit{RetainHeight: 0}, nil
}

func (a *Application) cloneExecutionState() executionState {
	return a.cloneTransactionState(a.committedExecutionStateView())
}

func (a *Application) cloneTransactionState(state executionState) executionState {
	policy := a.pqCertificateCache.ClonePolicy(state.accountPolicy)
	state.accountPolicy = nil
	state = cloneExecutionStateValue(state)
	state.accountPolicy = policy
	return state
}

// committedExecutionStateView borrows immutable committed records. The caller
// must hold a.mu while using it. applyTransaction isolates every supported
// transaction before mutation; callers that mutate state directly must clone.
func (a *Application) committedExecutionStateView() executionState {
	traceLots := a.committed.TraceLots
	if a.committed.Version <= 13 && a.replayStateVersion == 0 {
		traceLots = migrationTraceLots(a.migration)
	}
	return executionState{
		hashVersion: a.replayStateVersion,
		bootstrap:   a.bootstrap, validatorRegistry: a.committed.ValidatorRegistry, pqEngineSchedule: a.committed.PQEngineSchedule,
		legacyContracts: a.committed.LegacyContracts, legacyResourceMarket: a.committed.LegacyResourceMarket, legacyResourceSponsor: a.committed.LegacyResourceSponsor,
		legacyPaySource: a.committed.LegacyPaySource, legacyAISource: a.committed.LegacyAISource, legacyTrustSource: a.committed.LegacyTrustSource,
		traceLots: traceLots, accountPolicy: a.committed.AccountPolicy, pqHistory: a.committed.PQHistory, pqBatches: a.committed.PQBatches,
		nativeTransfers: a.committed.NativeTransfers, paySettlements: a.committed.PaySettlements,

		accounts: a.committed.Accounts, feeEvents: feeEventJournal{base: a.committed.FeeEvents}, strategyMandates: a.committed.StrategyMandates, strategyVaults: a.committed.StrategyVaults, assetAuditEvents: a.committed.AssetAuditEvents, smartAccounts: a.committed.SmartAccounts, paymasters: a.committed.Paymasters, userOperationEvents: a.committed.UserOperationEvents, stakeDelegations: a.committed.StakeDelegations, unbondings: a.committed.Unbondings, permissions: a.committed.AIPermissions, actions: a.committed.AIActions, auditEvents: a.committed.AIAuditEvents,
		payIntents: a.committed.PayIntents, payInvoices: a.committed.PayInvoices, payRefunds: a.committed.PayRefunds, payWebhooks: a.committed.PayWebhooks, payEvents: a.committed.PayEvents, payIdempotency: a.committed.PayIdempotency,
		resourceQuotes: a.committed.ResourceQuotes, resourceDelegations: a.committed.ResourceDelegations, resourceRentals: a.committed.ResourceRentals, resourceIncome: a.committed.ResourceIncome, resourceEvents: a.committed.ResourceEvents, resourceIdempotency: a.committed.ResourceIdempotency,
		resourcePools: a.committed.ResourcePools, resourceSponsorships: a.committed.ResourceSponsorships, resourceSponsorIdempotency: a.committed.ResourceSponsorIdempotency, resourceSponsorActionRefs: a.committed.ResourceSponsorActionRefs, resourceSponsorAudit: a.committed.ResourceSponsorAudit,
		governanceRequests: a.committed.GovernanceRequests, trustAppeals: a.committed.TrustAppeals, trustCorrections: a.committed.TrustCorrections, trustLabels: a.committed.TrustLabels, trustEvidence: a.committed.TrustEvidence, trackingReviews: a.committed.TrackingReviews, transparency: a.committed.Transparency,
		contracts: a.committed.Contracts, evmReceipts: a.committed.EVMReceipts, evmLogs: a.committed.EVMLogs, ideIdempotency: a.committed.IDEIdempotency,
		governanceExecutions: a.committed.GovernanceExecutions, governanceExecutionAudit: a.committed.GovernanceExecutionAudit,
		dexAssets: a.committed.DexAssets, dexBalances: a.committed.DexBalances, dexPools: a.committed.DexPools, dexEvents: a.committed.DexEvents,
	}
}

func (a *Application) applyTransaction(state executionState, payload []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	return a.applyTransactionAt(state, payload, height, blockTime, 0)
}

func (a *Application) applyTransactionAt(state executionState, payload []byte, height int64, blockTime time.Time, transactionIndex uint32) (executionState, transactionExecution, error) {
	kind, err := TransactionEnvelopeType(payload)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := validateHistoricalRuntimeEnvelope(state, kind); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if kind == ValidatorRegistryTransactionType || kind == PQActionType || kind == PQTransferType || kind == PQMigrationType || kind == PQRevocationType || kind == PQWholeType || kind == SignedActionType {
		state = a.cloneTransactionState(state)
	}
	if kind == ValidatorRegistryTransactionType {
		return a.applyValidatorRegistryTransaction(state, payload, height, transactionIndex)
	}
	if kind == PQActionType {
		return a.applyPQActionTransaction(state, payload, height, blockTime)
	}
	if kind == PQEthereumValueType {
		return a.applyPQEthereumValueTransaction(state, payload, height, blockTime)
	}
	if kind == PQTransferType || kind == PQMigrationType || kind == PQRevocationType || kind == PQWholeType {
		return a.applyPQTransaction(state, payload, height, blockTime)
	}
	if kind == SignedActionType {
		next, execution, err := a.applyApplicationAction(state, payload, height, blockTime)
		if err != nil {
			return executionState{}, transactionExecution{}, err
		}
		tx, _ := DecodeSignedApplicationAction(payload)
		if tx.Fee > 0 {
			next.feeEvents = next.feeEvents.append(newCurrentFeeEvent(ApplicationActionHash(payload), tx.Action, tx.Signer, a.feeRecipient, tx.Fee, height, blockTime))
		}
		return next, execution, nil
	}
	if kind == EthereumLegacyTransferType || kind == EthereumAccessListTransferType || kind == EthereumDynamicFeeTransferType {
		return a.applyEthereumValueTransfer(a.cloneTransactionState(state), payload, height, blockTime)
	}
	tx, err := a.decodeVerifiedNativeTransaction(payload)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := requireConsensusLegacy(state.accountPolicy, tx.From, height); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	return a.applyNativeTransfer(state, tx, SignedTransactionHash(payload), height, blockTime, true)
}

func (a *Application) applyAuthorizedTransfer(state executionState, tx SignedTransaction, transactionHash string, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	return a.applyNativeTransfer(state, tx, transactionHash, height, blockTime, false)
}

func (a *Application) applyNativeTransfer(state executionState, tx SignedTransaction, transactionHash string, height int64, blockTime time.Time, moveFeeLots bool) (executionState, transactionExecution, error) {
	sender, ok := nativeAccountAt(state, tx.From)
	if !ok {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("signed transaction sender account does not exist"))
	}
	if sender.account.Nonce == math.MaxUint64 {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidNonce, errors.New("signed transaction sender nonce is exhausted"))
	}
	expectedNonce := sender.account.Nonce + 1
	if tx.Nonce != expectedNonce {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidNonce, fmt.Errorf("signed transaction nonce %d must equal next account nonce %d", tx.Nonce, expectedNonce))
	}
	if tx.Amount > math.MaxInt64-tx.Fee || sender.account.Balance < tx.Amount+tx.Fee {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT balance for amount and fee"))
	}
	if sender.account.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("sender bandwidth usage overflow"))
	}

	credits := map[string]int64{tx.To: tx.Amount}
	if credits[a.feeRecipient] > math.MaxInt64-tx.Fee {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("native credit exceeds ledger range"))
	}
	credits[a.feeRecipient] += tx.Fee
	for address, credit := range credits {
		value, _ := nativeAccountAt(state, address)
		balance := value.account.Balance
		if address == tx.From {
			balance -= tx.Amount + tx.Fee
		}
		if balance > math.MaxInt64-credit {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("native recipient balance would overflow"))
		}
	}
	// Only publish immutable account/lot update paths after both movements
	// succeed. Distinct local records preserve all fee-recipient aliases.
	working := [3]nativeAccountValue{sender}
	count := 1
	local := func(address string) *nativeAccountValue {
		for i := 0; i < count; i++ {
			if working[i].account.Address == address {
				return &working[i]
			}
		}
		value, _ := nativeAccountAt(state, address)
		working[count] = value
		count++
		return &working[count-1]
	}
	from := &working[0]
	to, fee := local(tx.To), local(a.feeRecipient)
	if err := moveNativeLots(from, to, tx.Amount); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
	}
	if moveFeeLots {
		if err := moveNativeLots(from, fee, tx.Fee); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
	}

	// The trace lineage tracks the actual original signed transaction. Account/lot paths remain immutable.
	state.traceLots = cloneTraceLots(state.traceLots)
	for _, lotID := range sender.lotKeys() {
		if from.lot(lotID) < sender.lot(lotID) {
			if lot, ok := state.traceLots[lotID]; ok {
				lot.LastInbound = transactionHash
				state.traceLots[lotID] = lot
			}
		}
	}
	from.account.Balance -= tx.Amount + tx.Fee
	from.account.Nonce++
	from.account.ResourceUsage.BandwidthUsed++
	to.account.Balance += tx.Amount
	fee.account.Balance += tx.Fee
	for i := 0; i < count; i++ {
		state.nativeAccounts = deltaPut(state.nativeAccounts, working[i].account.Address, working[i])
	}
	state.feeEvents = state.feeEvents.append(newCurrentFeeEvent(transactionHash, tx.Type, tx.From, a.feeRecipient, tx.Fee, height, blockTime))

	if state.hashVersion == 0 || state.hashVersion >= 14 {
		receipt := BFTNativeTransfer{TransactionHash: transactionHash, From: tx.From, To: tx.To, Amount: tx.Amount, Fee: tx.Fee, BlockHeight: height, CommittedAt: blockTime.UTC()}
		state.nativeTransfers = insertNativeTransferReceipt(state.nativeTransfers, receipt)
	}

	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.transfer", Attributes: []abcitypes.EventAttribute{{Key: "sender", Value: tx.From, Index: true}, {Key: "recipient", Value: tx.To, Index: true}, {Key: "amount", Value: fmt.Sprint(tx.Amount), Index: true}}}}, nil
}

func (a *Application) applyEthereumValueTransfer(state executionState, payload []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	tx, err := DecodeEthereumValueTransfer(payload)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := tx.Verify(a.migration.Network.ChainID); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := requireConsensusLegacy(state.accountPolicy, tx.From, height); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	maximumGasFee, err := tx.MaximumGasFee()
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	return a.applyAuthorizedEthereumValueTransfer(state, authorizedEthereumValueTransfer{
		EnvelopeType: tx.EnvelopeType, From: tx.From, To: tx.To, Hash: tx.Hash,
		Nonce: tx.Nonce, GasLimit: tx.GasLimit, Value: tx.Value, Fee: tx.Fee,
		MaximumGasFee: maximumGasFee,
	}, height, blockTime)
}

// This private business view contains no signature or recovered ECDSA fields.
// Each caller must first authenticate its original complete envelope and the
// account's policy at the actual execution height.
type authorizedEthereumValueTransfer struct {
	EnvelopeType, From, To, Hash string
	Nonce, GasLimit              uint64
	Value, Fee, MaximumGasFee    int64
}

func (a *Application) applyAuthorizedEthereumValueTransfer(state executionState, tx authorizedEthereumValueTransfer, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	if tx.EnvelopeType != EthereumLegacyTransferType && tx.EnvelopeType != EthereumAccessListTransferType && tx.EnvelopeType != EthereumDynamicFeeTransferType && tx.EnvelopeType != PQEthereumValueType {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported authorized Ethereum business profile"))
	}
	if !IsNativeAddress(tx.From) || !IsNativeAddress(tx.To) || tx.From == tx.To || tx.Value <= 0 || tx.Fee <= 0 || tx.MaximumGasFee < tx.Fee || tx.GasLimit != EthereumTransferGasLimit {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("invalid authorized Ethereum business values"))
	}
	maximumGasFee := tx.MaximumGasFee
	accounts := state.accounts
	senderIndex, ok := accountIndex(accounts, tx.From)
	if !ok {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("Ethereum transaction sender account does not exist"))
	}
	sender := accounts[senderIndex]
	if tx.Nonce != sender.Nonce {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidNonce, fmt.Errorf("Ethereum transaction nonce %d must equal current account nonce %d", tx.Nonce, sender.Nonce))
	}
	if sender.Nonce == math.MaxUint64 {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidNonce, errors.New("Ethereum transaction sender nonce is exhausted"))
	}
	if tx.Value > math.MaxInt64-maximumGasFee || sender.Balance < tx.Value+maximumGasFee {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT balance for Ethereum value and maximum gas fee exposure"))
	}
	if sender.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("sender bandwidth usage overflow"))
	}
	if _, exists := bftEVMReceiptIndex(state.evmReceipts, tx.Hash); exists {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidNonce, errors.New("Ethereum transaction hash was already committed"))
	}
	// The lot mover mutates the sender's map. Preserve the original amounts
	// before either value or fee movement to update their trace provenance.
	senderLotsBefore := cloneInt64Map(sender.Lots)

	credits := map[string]int64{tx.To: tx.Value}
	if credits[a.feeRecipient] > math.MaxInt64-tx.Fee {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("native credit exceeds ledger range"))
	}
	credits[a.feeRecipient] += tx.Fee
	for address, credit := range credits {
		value, _ := nativeAccountAt(state, address)
		balance := value.account.Balance
		if address == tx.From {
			balance -= tx.Value + tx.Fee
		}
		if balance > math.MaxInt64-credit {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("native recipient balance would overflow"))
		}
	}
	accounts, _ = ensureAccount(accounts, tx.To)
	accounts, _ = ensureAccount(accounts, a.feeRecipient)
	senderIndex, _ = accountIndex(accounts, tx.From)
	receiverIndex, _ := accountIndex(accounts, tx.To)
	feeIndex, _ := accountIndex(accounts, a.feeRecipient)
	if err := moveTraceableLots(&accounts[senderIndex], &accounts[receiverIndex], tx.Value); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
	}
	if err := moveTraceableLots(&accounts[senderIndex], &accounts[feeIndex], tx.Fee); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
	}

	state.traceLots = cloneTraceLots(state.traceLots)
	for lotID, oldAmount := range senderLotsBefore {
		if accounts[senderIndex].Lots[lotID] < oldAmount {
			if lot, ok := state.traceLots[lotID]; ok {
				lot.LastInbound = tx.Hash
				state.traceLots[lotID] = lot
			}
		}
	}
	accounts[senderIndex].Balance -= tx.Value + tx.Fee
	accounts[senderIndex].Nonce++
	accounts[senderIndex].ResourceUsage.BandwidthUsed++
	accounts[receiverIndex].Balance += tx.Value
	accounts[feeIndex].Balance += tx.Fee
	state.accounts = accounts
	state.feeEvents = state.feeEvents.append(newEthereumGasFeeEvent(tx.Hash, tx.EnvelopeType, tx.From, a.feeRecipient, tx.Fee, height, blockTime))
	receipt := BFTEVMReceipt{
		TxHash: tx.Hash, From: tx.From, To: tx.To, Action: tx.EnvelopeType,
		Status: "success", EncodedResult: "0x", Logs: []BFTEVMLog{}, BlockHeight: height,
	}
	receipt.AuditHash = bftEVMReceiptAuditHash(receipt)
	state.evmReceipts = insertBFTEVMReceipt(state.evmReceipts, receipt)
	envelope := "ethereum_legacy_eip155"
	if tx.EnvelopeType == EthereumAccessListTransferType {
		envelope = "ethereum_access_list_eip2930_empty"
	} else if tx.EnvelopeType == EthereumDynamicFeeTransferType {
		envelope = "ethereum_dynamic_fee_eip1559_zero_base_fee"
	} else if tx.EnvelopeType == PQEthereumValueType {
		envelope = "ynx_pq_ethereum_abci_integer_gas_v1"
	}
	return state, transactionExecution{
		typeName: tx.EnvelopeType,
		hash:     tx.Hash,
		gas:      int64(tx.GasLimit),
		event: abcitypes.Event{Type: "ynx.transfer", Attributes: []abcitypes.EventAttribute{
			{Key: "sender", Value: tx.From, Index: true},
			{Key: "recipient", Value: tx.To, Index: true},
			{Key: "amount", Value: fmt.Sprint(tx.Value), Index: true},
			{Key: "envelope", Value: envelope, Index: true},
			{Key: "ethereum_hash", Value: tx.Hash, Index: true},
		}},
	}, nil
}

func cloneExecutionStateValue(state executionState) executionState {
	return executionState{
		hashVersion: state.hashVersion,
		bootstrap:   state.bootstrap, validatorRegistry: cloneValidatorRegistry(state.validatorRegistry), pqEngineSchedule: clonePQEngineSchedule(state.pqEngineSchedule),
		legacyContracts: cloneLegacyContracts(state.legacyContracts), legacyResourceMarket: cloneLegacyResourceMarket(state.legacyResourceMarket), legacyResourceSponsor: cloneLegacyResourceSponsor(state.legacyResourceSponsor),
		legacyPaySource: cloneLegacyPaySource(state.legacyPaySource), legacyAISource: cloneLegacyAISource(state.legacyAISource), legacyTrustSource: cloneLegacyTrustSource(state.legacyTrustSource),
		traceLots: cloneTraceLots(state.traceLots), accountPolicy: cloneConsensusAccountPolicy(state.accountPolicy), pqHistory: clonePQHistory(state.pqHistory), pqBatches: cloneConsensusPQBatches(state.pqBatches),
		nativeTransfers: append([]BFTNativeTransfer(nil), state.nativeTransfers...), paySettlements: append([]BFTPaySettlement(nil), state.paySettlements...),

		accounts: cloneExecutionAccounts(state), feeEvents: state.feeEvents, strategyMandates: cloneStrategyMandates(state.strategyMandates), strategyVaults: cloneStrategyVaults(state.strategyVaults), assetAuditEvents: append([]BFTAssetAuditEvent(nil), state.assetAuditEvents...), smartAccounts: cloneSmartAccounts(state.smartAccounts), paymasters: clonePaymasters(state.paymasters), userOperationEvents: append([]BFTUserOperationEvent(nil), state.userOperationEvents...), stakeDelegations: append([]BFTStakeDelegation(nil), state.stakeDelegations...), unbondings: cloneUnbondings(state.unbondings), permissions: cloneAIPermissions(state.permissions), actions: cloneAIActions(state.actions), auditEvents: append([]BFTAIAuditEvent(nil), state.auditEvents...),
		payIntents: append([]BFTPayIntent(nil), state.payIntents...), payInvoices: append([]BFTPayInvoice(nil), state.payInvoices...), payRefunds: append([]BFTPayRefund(nil), state.payRefunds...), payWebhooks: append([]BFTPayWebhook(nil), state.payWebhooks...), payEvents: append([]BFTPayEvent(nil), state.payEvents...), payIdempotency: append([]BFTPayIdempotency(nil), state.payIdempotency...),
		resourceQuotes: append([]BFTResourceQuote(nil), state.resourceQuotes...), resourceDelegations: append([]BFTResourceDelegation(nil), state.resourceDelegations...), resourceRentals: append([]BFTResourceRental(nil), state.resourceRentals...), resourceIncome: append([]BFTResourceIncome(nil), state.resourceIncome...), resourceEvents: append([]BFTResourceEvent(nil), state.resourceEvents...), resourceIdempotency: append([]BFTResourceIdempotency(nil), state.resourceIdempotency...),
		resourcePools: cloneBFTResourcePools(state.resourcePools), resourceSponsorships: append([]BFTResourceSponsorship(nil), state.resourceSponsorships...), resourceSponsorIdempotency: cloneBFTResourceSponsorIdempotency(state.resourceSponsorIdempotency), resourceSponsorActionRefs: append([]BFTResourceSponsorActionRef(nil), state.resourceSponsorActionRefs...), resourceSponsorAudit: append([]BFTResourceSponsorAudit(nil), state.resourceSponsorAudit...),
		governanceRequests: cloneGovernanceRequests(state.governanceRequests), trustAppeals: cloneTrustAppeals(state.trustAppeals), trustCorrections: append([]BFTTrustCorrection(nil), state.trustCorrections...), trustLabels: cloneTrustLabels(state.trustLabels), trustEvidence: cloneTrustEvidence(state.trustEvidence), trackingReviews: cloneTrackingReviews(state.trackingReviews), transparency: cloneTransparencyEntries(state.transparency),
		contracts: cloneBFTContracts(state.contracts), evmReceipts: cloneBFTEVMReceipts(state.evmReceipts), evmLogs: cloneBFTEVMLogs(state.evmLogs), ideIdempotency: append([]BFTIDEIdempotency(nil), state.ideIdempotency...),
		governanceExecutions: append([]BFTGovernanceExecution(nil), state.governanceExecutions...), governanceExecutionAudit: append([]BFTGovernanceExecutionAudit(nil), state.governanceExecutionAudit...),
		dexAssets: append([]BFTDexAsset(nil), state.dexAssets...), dexBalances: append([]BFTDexBalance(nil), state.dexBalances...), dexPools: cloneDexPools(state.dexPools), dexEvents: cloneBFTDexEvents(state.dexEvents),
	}
}

func (a *Application) applyApplicationAction(state executionState, payload []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {
	tx, err := DecodeSignedApplicationAction(payload)
	if err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := tx.Verify(a.migration.Network.ChainID); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := requireConsensusLegacy(state.accountPolicy, tx.Signer, height); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	validationOnly := blockTime.IsZero()
	if validationOnly {
		blockTime = time.Unix(1, 0).UTC()
	} else {
		blockTime = blockTime.UTC()
	}
	// The original source's text identities never become BFT signer authority.
	// Refuse source ID/transfer reuse before charging a fee or consuming a nonce.
	if err := rejectLegacyPayActionWrite(state.legacyPaySource, tx, ApplicationActionHash(payload)); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if err := rejectLegacyAIActionWrite(state.legacyAISource, tx, ApplicationActionHash(payload)); err != nil {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	if isTrustAction(tx.Action) {
		next, source, execution, handled, err := a.applyLegacyTrustSourceAction(state, state.legacyTrustSource, payload, height, blockTime)
		if handled {
			if err != nil {
				return executionState{}, transactionExecution{}, err
			}
			next.legacyTrustSource = source
			return next, execution, nil
		}
	}
	if isPayAction(tx.Action) {
		return a.applyPayAction(state, payload, tx, height, blockTime, validationOnly)
	}
	if isResourceAction(tx.Action) {
		if isResourceSponsorAction(tx.Action) {
			return a.applyResourceSponsorAction(state, payload, tx, height, blockTime, validationOnly)
		}
		return a.applyResourceAction(state, payload, tx, height, blockTime, validationOnly)
	}
	if isTrustAction(tx.Action) {
		return a.applyTrustAction(state, payload, tx, height, blockTime)
	}
	if isIDEAction(tx.Action) {
		return a.applyIDEAction(state, payload, tx, height, blockTime)
	}
	if isAssetAuthorizationAction(tx.Action) {
		return a.applyAssetAuthorizationAction(state, payload, tx, height, blockTime, validationOnly)
	}
	if isAccountAbstractionAction(tx.Action) {
		return a.applyAccountAbstractionAction(state, payload, tx, height, blockTime, validationOnly)
	}
	if isStakingAction(tx.Action) {
		return a.applyStakingAction(state, payload, tx, height, blockTime, validationOnly)
	}
	if isProtocolGovernanceAction(tx.Action) {
		return a.applyProtocolGovernanceAction(state, payload, tx, height, blockTime, validationOnly)
	}
	if isDexAction(tx.Action) {
		return a.applyDexAction(state, payload, tx, height, blockTime, validationOnly)
	}
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash := ApplicationActionHash(payload)
	recordID := ""
	switch tx.Action {
	case ActionAIPermissionCreate:
		var input AIPermissionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		recordID = ApplicationActionRecordID("ai-permission", txHash)
		if _, exists := aiPermissionIndex(state.permissions, recordID); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI permission record already exists"))
		}
		permission := BFTAIPermission{
			ID: recordID, Signer: tx.Signer, SessionID: input.SessionID, Requester: input.Requester,
			Scope: input.Scope, Purpose: input.Purpose, Status: "active", CreatedAt: blockTime,
			ExpiresAt: blockTime.Add(time.Duration(input.ExpiryHours) * time.Hour), BlockHeight: height, TxHash: txHash,
		}
		permission.AuditHash = permissionAuditHash(permission)
		state.permissions = insertAIPermission(state.permissions, permission)
	case ActionAIProposalCreate:
		var input AIActionProposalPayload
		_ = json.Unmarshal(tx.Payload, &input)
		recordID = ApplicationActionRecordID("ai-action", txHash)
		if _, exists := aiActionIndex(state.actions, recordID); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI action record already exists"))
		}
		sensitive, reasons := classifyBFTAIAction(input)
		action := BFTAIAction{
			ID: recordID, Signer: tx.Signer, SessionID: input.SessionID, Requester: input.Requester,
			Scope: input.Scope, ActionType: input.ActionType, Description: input.Description,
			Status: "pending_approval", Sensitive: sensitive, RequiresApproval: sensitive,
			Reasons: reasons, CreatedAt: blockTime, ExpiresAt: blockTime.Add(time.Duration(input.ExpiryHours) * time.Hour),
			BlockHeight: height, TxHash: txHash,
		}
		if !sensitive {
			action.Status, action.Executable = "logged", true
		}
		action.AuditHash = actionAuditHash(action)
		state.actions = insertAIAction(state.actions, action)
	case ActionAIProposalApprove:
		var input AIActionDecisionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		recordID = input.ActionID
		actionIndex, ok := aiActionIndex(state.actions, input.ActionID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI action proposal not found"))
		}
		permissionIndex, ok := aiPermissionIndex(state.permissions, input.PermissionID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI permission not found"))
		}
		action, permission := state.actions[actionIndex], state.permissions[permissionIndex]
		if action.Status != "pending_approval" || !action.RequiresApproval || action.Signer != tx.Signer || permission.Signer != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI action approval signer or state is unauthorized"))
		}
		if permission.SessionID != action.SessionID || permission.Requester != action.Requester || permission.Scope != action.Scope || permission.Status != "active" {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI permission does not bind to the action subject, session, requester, and scope"))
		}
		if !validationOnly && (!blockTime.Before(permission.ExpiresAt) || !blockTime.Before(action.ExpiresAt)) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI permission or action is expired"))
		}
		action.PermissionID, action.Status, action.Executable = permission.ID, "approved", true
		action.ApprovedAt, action.ApprovedBy = timePointer(blockTime), input.Approver
		action.Reasons = appendUniqueString(action.Reasons, "explicit scoped permission approved this sensitive AI action")
		action.BlockHeight, action.TxHash = height, txHash
		action.AuditHash = actionAuditHash(action)
		state.actions[actionIndex] = action
	case ActionAIProposalReject:
		var input AIActionDecisionPayload
		_ = json.Unmarshal(tx.Payload, &input)
		recordID = input.ActionID
		actionIndex, ok := aiActionIndex(state.actions, input.ActionID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI action proposal not found"))
		}
		action := state.actions[actionIndex]
		if action.Status != "pending_approval" || action.Signer != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("AI action rejection signer or state is unauthorized"))
		}
		action.Status, action.Executable = "rejected", false
		action.RejectedAt, action.RejectedBy = timePointer(blockTime), input.Approver
		action.Reasons = appendUniqueString(action.Reasons, "AI action rejected by explicit reviewer decision")
		action.BlockHeight, action.TxHash = height, txHash
		action.AuditHash = actionAuditHash(action)
		state.actions[actionIndex] = action
	default:
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("unsupported application action"))
	}
	event := BFTAIAuditEvent{ID: ApplicationActionRecordID("ai-audit", txHash), RecordID: recordID, Type: tx.Action, Signer: tx.Signer, BlockHeight: height, CreatedAt: blockTime, TxHash: txHash}
	event.AuditHash = aiAuditEventHash(event)
	state.auditEvents = append(state.auditEvents, event)
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.application_action", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}, {Key: "record_id", Value: recordID, Index: true}}}}, nil
}

func (a *Application) chargeApplicationAction(state *executionState, tx SignedApplicationAction) error {
	signerIndex, ok := accountIndex(state.accounts, tx.Signer)
	if !ok {
		return invalidTransaction(CodeInsufficientYNXT, errors.New("application action signer account does not exist"))
	}
	signer := state.accounts[signerIndex]
	if signer.Nonce == math.MaxUint64 || tx.Nonce != signer.Nonce+1 {
		return invalidTransaction(CodeInvalidNonce, fmt.Errorf("application action nonce %d must equal next account nonce %d", tx.Nonce, signer.Nonce+1))
	}
	if signer.Balance < tx.Fee {
		return invalidTransaction(CodeInsufficientYNXT, errors.New("insufficient YNXT balance for application action fee"))
	}
	if signer.ResourceUsage.AICreditsUsed > math.MaxInt64-tx.AIUnits || signer.ResourceUsage.PayCreditsUsed > math.MaxInt64-tx.PayUnits || signer.ResourceUsage.TrustUsed > math.MaxInt64-tx.TrustUnits || signer.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return invalidTransaction(CodeInvalidTx, errors.New("application action resource usage overflow"))
	}
	state.accounts, _ = ensureAccount(state.accounts, a.feeRecipient)
	signerIndex, _ = accountIndex(state.accounts, tx.Signer)
	feeIndex, _ := accountIndex(state.accounts, a.feeRecipient)
	if err := moveTraceableLots(&state.accounts[signerIndex], &state.accounts[feeIndex], tx.Fee); err != nil {
		return invalidTransaction(CodeInsufficientYNXT, err)
	}
	state.accounts[signerIndex].Balance -= tx.Fee
	state.accounts[signerIndex].Nonce++
	state.accounts[signerIndex].ResourceUsage.AICreditsUsed += tx.AIUnits
	state.accounts[signerIndex].ResourceUsage.PayCreditsUsed += tx.PayUnits
	state.accounts[signerIndex].ResourceUsage.TrustUsed += tx.TrustUnits
	state.accounts[signerIndex].ResourceUsage.BandwidthUsed++
	state.accounts[feeIndex].Balance += tx.Fee
	return nil
}

func aiPermissionIndex(values []BFTAIPermission, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return index, index < len(values) && values[index].ID == id
}

func insertAIPermission(values []BFTAIPermission, value BFTAIPermission) []BFTAIPermission {
	index, _ := aiPermissionIndex(values, value.ID)
	values = append(values, BFTAIPermission{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func aiActionIndex(values []BFTAIAction, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return index, index < len(values) && values[index].ID == id
}

func insertAIAction(values []BFTAIAction, value BFTAIAction) []BFTAIAction {
	index, _ := aiActionIndex(values, value.ID)
	values = append(values, BFTAIAction{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func permissionAuditHash(value BFTAIPermission) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_AI_PERMISSION_AUDIT_V1", value)
}
func actionAuditHash(value BFTAIAction) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_AI_ACTION_AUDIT_V1", value)
}
func aiAuditEventHash(value BFTAIAuditEvent) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_AI_AUDIT_EVENT_V1", value)
}
func timePointer(value time.Time) *time.Time { return &value }
func appendUniqueString(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func queryPayRecord[T any](response *abcitypes.ResponseQuery, id string, values []T, idOf func(T) string, label string) (*abcitypes.ResponseQuery, error) {
	id = strings.TrimSpace(id)
	for _, value := range values {
		if idOf(value) == id {
			payload, err := json.Marshal(value)
			if err != nil {
				return nil, err
			}
			response.Key, response.Value = []byte(id), payload
			return response, nil
		}
	}
	response.Code, response.Log = 1, label+" not found"
	return response, nil
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
		if sender != receiver && receiver.Lots[lotID] > math.MaxInt64-moved {
			return errors.New("native recipient lot would overflow")
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
