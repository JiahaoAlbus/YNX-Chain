package dex

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/sha3"
)

type EVMPollerConfig struct {
	RPCURL        string
	Factory       string
	StrategyVault string
	FairFlow      string
	StartBlock    uint64
	Confirmations uint64
	BlockRange    uint64
	ReorgDepth    uint64
	CursorPath    string
	CursorSecret  []byte
	PollInterval  time.Duration
	Client        *http.Client
}

type poolIdentity struct {
	Address      string `json:"address"`
	Token0       string `json:"token0"`
	Token1       string `json:"token1"`
	CreatedBlock uint64 `json:"createdBlock"`
}

type pollCursor struct {
	SchemaVersion int            `json:"schemaVersion"`
	StrategyVault string         `json:"strategyVault,omitempty"`
	FairFlow      string         `json:"fairFlow,omitempty"`
	NextBlock     uint64         `json:"nextBlock"`
	LastBlockHash string         `json:"lastBlockHash"`
	Pools         []poolIdentity `json:"pools"`
}

type cursorEnvelope struct {
	Cursor    pollCursor `json:"cursor"`
	Integrity string     `json:"integrity"`
}

type EVMPoller struct {
	mu     sync.Mutex
	store  *Store
	cfg    EVMPollerConfig
	cursor pollCursor
}

type evmLog struct {
	Address     string   `json:"address"`
	Topics      []string `json:"topics"`
	Data        string   `json:"data"`
	BlockNumber string   `json:"blockNumber"`
	BlockHash   string   `json:"blockHash"`
	TxHash      string   `json:"transactionHash"`
	LogIndex    string   `json:"logIndex"`
	Removed     bool     `json:"removed"`
}

type evmBlock struct {
	Hash      string `json:"hash"`
	Timestamp string `json:"timestamp"`
}

var eventTopics = map[string]string{
	"pool-created":            eventTopic("PoolCreated(address,address,address,uint256)"),
	"mint":                    eventTopic("Mint(address,uint256,uint256,address)"),
	"burn":                    eventTopic("Burn(address,uint256,uint256,address)"),
	"swap":                    eventTopic("Swap(address,address,uint256,uint256,address)"),
	"sync":                    eventTopic("Sync(uint112,uint112)"),
	"fees":                    eventTopic("ProtocolFeesClaimed(address,uint256,uint256)"),
	"transfer":                eventTopic("Transfer(address,address,uint256)"),
	"vault-action":            eventTopic("ActionExecuted(uint256,bytes4,uint256,uint256)"),
	"fair-batch-opened":       eventTopic("BatchOpened(uint64,address,address,uint256,uint256,uint256,uint256)"),
	"fair-intent-submitted":   eventTopic("IntentSubmitted(bytes32,uint64,address,bool,uint256,uint256,uint256,uint256)"),
	"fair-intent-cancelled":   eventTopic("IntentCancelled(bytes32,uint64,address,bool)"),
	"fair-solution-committed": eventTopic("SolutionCommitted(uint64,address,bytes32)"),
	"fair-solution-revealed":  eventTopic("SolutionRevealed(uint64,address,uint256,uint256,uint256,bytes32,bytes32)"),
	"fair-winner-finalized":   eventTopic("WinnerFinalized(uint64,address,uint256,uint256,uint256,bytes32,bytes32)"),
	"fair-intent-settled":     eventTopic("IntentSettled(bytes32,uint64,address,uint256,uint256,uint256,uint256)"),
	"fair-batch-settled":      eventTopic("BatchSettled(uint64,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes32)"),
	"fair-batch-failed":       eventTopic("BatchFailed(uint64,address,bytes32,uint256)"),
	"fair-solver-slashed":     eventTopic("SolverSlashed(uint64,address,bytes32,uint256)"),
}
var cumulativePriceSelector = functionSelector("currentCumulativePrices()")
var nonceDomainSelector = functionSelector("nonceDomain()")
var vaultMethods = map[string]string{
	strings.ToLower(functionSelector("swapExactInput(uint256,uint256,uint256,address[],uint256)")):                "swapExactInput",
	strings.ToLower(functionSelector("swapExactOutput(uint256,uint256,uint256,address[],uint256)")):               "swapExactOutput",
	strings.ToLower(functionSelector("addLiquidity(uint256,address,address,uint256,uint256,uint256,uint256)")):    "addLiquidity",
	strings.ToLower(functionSelector("removeLiquidity(uint256,address,address,uint256,uint256,uint256,uint256)")): "removeLiquidity",
}

func NewEVMPoller(store *Store, cfg EVMPollerConfig) (*EVMPoller, error) {
	if store == nil || strings.TrimSpace(cfg.RPCURL) == "" || !addressPattern.MatchString(cfg.Factory) || cfg.StartBlock == 0 {
		return nil, errors.New("store, RPC URL, factory, and positive start block are required")
	}
	if cfg.StrategyVault != "" && (!addressPattern.MatchString(cfg.StrategyVault) || strings.EqualFold(cfg.StrategyVault, cfg.Factory)) {
		return nil, errors.New("strategy vault must be a distinct valid address")
	}
	if cfg.FairFlow != "" && (!addressPattern.MatchString(cfg.FairFlow) || strings.EqualFold(cfg.FairFlow, cfg.Factory) || strings.EqualFold(cfg.FairFlow, cfg.StrategyVault)) {
		return nil, errors.New("FairFlow must be a distinct valid address")
	}
	if len(cfg.CursorSecret) < 32 || strings.TrimSpace(cfg.CursorPath) == "" {
		return nil, errors.New("cursor path and 32-byte cursor secret are required")
	}
	if cfg.Confirmations == 0 {
		cfg.Confirmations = 12
	}
	if cfg.BlockRange == 0 {
		cfg.BlockRange = 500
	}
	if cfg.BlockRange > 2_000 {
		return nil, errors.New("block range exceeds safety limit")
	}
	if cfg.ReorgDepth == 0 {
		cfg.ReorgDepth = 32
	}
	if cfg.PollInterval == 0 {
		cfg.PollInterval = 5 * time.Second
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 12 * time.Second}
	}
	poller := &EVMPoller{store: store, cfg: cfg, cursor: pollCursor{SchemaVersion: 3, StrategyVault: strings.ToLower(cfg.StrategyVault), FairFlow: strings.ToLower(cfg.FairFlow), NextBlock: cfg.StartBlock, Pools: []poolIdentity{}}}
	if err := poller.loadCursor(); err != nil {
		return nil, err
	}
	return poller, nil
}

func (poller *EVMPoller) Run(ctx context.Context) error {
	ticker := time.NewTicker(poller.cfg.PollInterval)
	defer ticker.Stop()
	for {
		if _, err := poller.PollOnce(ctx); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// PollOnce processes at most one bounded confirmed range. It returns true when
// the durable cursor advanced.
func (poller *EVMPoller) PollOnce(ctx context.Context) (bool, error) {
	poller.mu.Lock()
	defer poller.mu.Unlock()
	var chain string
	if err := poller.rpc(ctx, "eth_chainId", []any{}, &chain); err != nil {
		return false, err
	}
	chainID, err := parseQuantity(chain)
	if err != nil || chainID != ChainID {
		return false, errors.New("EVM RPC chain identity mismatch")
	}
	var headHex string
	if err := poller.rpc(ctx, "eth_blockNumber", []any{}, &headHex); err != nil {
		return false, err
	}
	head, err := parseQuantity(headHex)
	if err != nil {
		return false, err
	}
	if head < poller.cfg.Confirmations {
		return false, nil
	}
	safeHead := head - poller.cfg.Confirmations
	if err := poller.recoverReorg(ctx); err != nil {
		return false, err
	}
	if poller.cursor.NextBlock > safeHead {
		return false, nil
	}
	end := poller.cursor.NextBlock + poller.cfg.BlockRange - 1
	if end > safeHead {
		end = safeHead
	}

	factoryLogs, err := poller.getLogs(ctx, poller.cursor.NextBlock, end, poller.cfg.Factory)
	if err != nil {
		return false, err
	}
	createdEvents := make([]Event, 0)
	for _, log := range factoryLogs {
		if len(log.Topics) == 0 || !strings.EqualFold(log.Topics[0], eventTopics["pool-created"]) {
			continue
		}
		pool, event, err := poller.decodePoolCreated(ctx, log)
		if err != nil {
			return false, err
		}
		if !poller.hasPool(pool.Address) {
			poller.cursor.Pools = append(poller.cursor.Pools, pool)
		}
		createdEvents = append(createdEvents, event)
	}
	sort.Slice(poller.cursor.Pools, func(i, j int) bool { return poller.cursor.Pools[i].Address < poller.cursor.Pools[j].Address })
	addresses := make([]string, 0, len(poller.cursor.Pools))
	for _, pool := range poller.cursor.Pools {
		addresses = append(addresses, pool.Address)
	}
	poolLogs := []evmLog{}
	for start := 0; start < len(addresses); start += 100 {
		stop := start + 100
		if stop > len(addresses) {
			stop = len(addresses)
		}
		chunk, readErr := poller.getLogs(ctx, poller.cursor.NextBlock, end, addresses[start:stop])
		poolLogs = append(poolLogs, chunk...)
		err = readErr
		if err != nil {
			return false, err
		}
	}
	events, err := poller.decodePoolLogs(ctx, poolLogs)
	if err != nil {
		return false, err
	}
	vaultEvents := []Event{}
	if poller.cfg.StrategyVault != "" {
		vaultLogs, readErr := poller.getLogs(ctx, poller.cursor.NextBlock, end, poller.cfg.StrategyVault)
		if readErr != nil {
			return false, readErr
		}
		vaultEvents, err = poller.decodeVaultLogs(ctx, vaultLogs)
		if err != nil {
			return false, err
		}
	}
	fairFlowEvents := []FairFlowEvent{}
	if poller.cfg.FairFlow != "" {
		fairLogs, readErr := poller.getLogs(ctx, poller.cursor.NextBlock, end, poller.cfg.FairFlow)
		if readErr != nil {
			return false, readErr
		}
		fairFlowEvents, err = poller.decodeFairFlowLogs(ctx, fairLogs)
		if err != nil {
			return false, err
		}
	}
	all := append(append(createdEvents, events...), vaultEvents...)
	sort.Slice(all, func(i, j int) bool {
		if all[i].BlockNumber == all[j].BlockNumber {
			return all[i].LogIndex < all[j].LogIndex
		}
		return all[i].BlockNumber < all[j].BlockNumber
	})
	for _, event := range all {
		if _, err := poller.store.Append(event); err != nil {
			return false, err
		}
	}
	for _, event := range fairFlowEvents {
		if _, err := poller.store.AppendFairFlow(event); err != nil {
			return false, err
		}
	}
	block, err := poller.block(ctx, end)
	if err != nil {
		return false, err
	}
	poller.cursor.NextBlock = end + 1
	poller.cursor.LastBlockHash = block.Hash
	if err := poller.persistCursor(); err != nil {
		return false, err
	}
	return true, nil
}

func (poller *EVMPoller) decodeVaultLogs(ctx context.Context, logs []evmLog) ([]Event, error) {
	result := make([]Event, 0, len(logs))
	for _, log := range logs {
		if log.Removed || len(log.Topics) == 0 {
			continue
		}
		if !strings.EqualFold(log.Address, poller.cfg.StrategyVault) {
			return nil, errors.New("vault log address mismatch")
		}
		if !strings.EqualFold(log.Topics[0], eventTopics["vault-action"]) {
			continue
		}
		block, index, err := validateLog(log)
		if err != nil || len(log.Topics) != 3 {
			return nil, errors.New("invalid ActionExecuted log")
		}
		words, err := dataWords(log.Data)
		if err != nil || len(words) != 2 {
			return nil, errors.New("invalid ActionExecuted data")
		}
		nonce, err := topicUintDecimal(log.Topics[1])
		if err != nil {
			return nil, errors.New("invalid ActionExecuted nonce")
		}
		selector, err := topicBytes4(log.Topics[2])
		if err != nil {
			return nil, errors.New("invalid ActionExecuted method")
		}
		method, ok := vaultMethods[strings.ToLower(selector)]
		if !ok {
			return nil, errors.New("unsupported ActionExecuted method")
		}
		timestamp, err := poller.blockTime(ctx, block)
		if err != nil {
			return nil, err
		}
		nonceDomain, err := poller.nonceDomain(ctx, block)
		if err != nil {
			return nil, err
		}
		event := Event{
			ID: strings.ToLower(log.TxHash) + ":" + strconv.FormatUint(index, 10), ChainID: ChainID,
			ContractVersion: "ynx-strategy-vault-v1", BlockNumber: block, BlockHash: strings.ToLower(log.BlockHash),
			TxHash: strings.ToLower(log.TxHash), LogIndex: index, Type: "vault-action", Timestamp: timestamp,
			Vault: strings.ToLower(log.Address), NonceDomain: nonceDomain, ActionNonce: nonce, Method: method,
			MethodSelector: strings.ToLower(selector),
			BeforeValue:    wordDecimal(words[0]), AfterValue: wordDecimal(words[1]),
		}
		if err := event.Validate(); err != nil {
			return nil, fmt.Errorf("decoded vault event validation: %w", err)
		}
		result = append(result, event)
	}
	return result, nil
}

func (poller *EVMPoller) decodeFairFlowLogs(ctx context.Context, logs []evmLog) ([]FairFlowEvent, error) {
	result := make([]FairFlowEvent, 0, len(logs))
	for _, log := range logs {
		if log.Removed || len(log.Topics) == 0 {
			continue
		}
		if !strings.EqualFold(log.Address, poller.cfg.FairFlow) {
			return nil, errors.New("FairFlow log address mismatch")
		}
		kind := ""
		expectedTopics, expectedWords := 0, 0
		switch {
		case strings.EqualFold(log.Topics[0], eventTopics["fair-batch-opened"]):
			kind, expectedTopics, expectedWords = "batch-opened", 4, 4
		case strings.EqualFold(log.Topics[0], eventTopics["fair-intent-submitted"]):
			kind, expectedTopics, expectedWords = "intent-submitted", 4, 5
		case strings.EqualFold(log.Topics[0], eventTopics["fair-intent-cancelled"]):
			kind, expectedTopics, expectedWords = "intent-cancelled", 4, 1
		case strings.EqualFold(log.Topics[0], eventTopics["fair-solution-committed"]):
			kind, expectedTopics, expectedWords = "solution-committed", 3, 1
		case strings.EqualFold(log.Topics[0], eventTopics["fair-solution-revealed"]):
			kind, expectedTopics, expectedWords = "solution-revealed", 3, 5
		case strings.EqualFold(log.Topics[0], eventTopics["fair-winner-finalized"]):
			kind, expectedTopics, expectedWords = "winner-finalized", 3, 5
		case strings.EqualFold(log.Topics[0], eventTopics["fair-intent-settled"]):
			kind, expectedTopics, expectedWords = "intent-settled", 4, 4
		case strings.EqualFold(log.Topics[0], eventTopics["fair-batch-settled"]):
			kind, expectedTopics, expectedWords = "batch-settled", 3, 9
		case strings.EqualFold(log.Topics[0], eventTopics["fair-batch-failed"]):
			kind, expectedTopics, expectedWords = "batch-failed", 3, 2
		case strings.EqualFold(log.Topics[0], eventTopics["fair-solver-slashed"]):
			kind, expectedTopics, expectedWords = "solver-slashed", 4, 1
		default:
			continue
		}
		block, index, err := validateLog(log)
		if err != nil || len(log.Topics) != expectedTopics {
			return nil, fmt.Errorf("invalid FairFlow %s log", kind)
		}
		words, err := dataWords(log.Data)
		if err != nil || len(words) != expectedWords {
			return nil, fmt.Errorf("invalid FairFlow %s data", kind)
		}
		timestamp, err := poller.blockTime(ctx, block)
		if err != nil {
			return nil, err
		}
		event := FairFlowEvent{ID: strings.ToLower(log.TxHash) + ":" + strconv.FormatUint(index, 10), ChainID: ChainID, ContractVersion: "ynx-fairflow-v1", FairFlow: strings.ToLower(log.Address), BlockNumber: block, BlockHash: strings.ToLower(log.BlockHash), TransactionHash: strings.ToLower(log.TxHash), LogIndex: index, Type: kind, Details: map[string]string{}, AsOf: timestamp, Source: "confirmed YNX Testnet EVM logs", Version: "ynx-fairflow-event-v1", Confidence: "confirmed-on-chain", Coverage: "Confirmed FairFlow event identity and stage-specific indexed/data fields", Failure: nil}
		if kind == "batch-opened" {
			event.BatchID, err = topicUintDecimal(log.Topics[1])
			if err != nil {
				return nil, err
			}
			event.Details = map[string]string{"token0": strings.ToLower(topicAddress(log.Topics[2])), "token1": strings.ToLower(topicAddress(log.Topics[3])), "intentEnd": wordDecimal(words[0]), "commitEnd": wordDecimal(words[1]), "revealEnd": wordDecimal(words[2]), "settleEnd": wordDecimal(words[3])}
		} else if kind == "intent-submitted" || kind == "intent-cancelled" || kind == "intent-settled" {
			event.IntentID = strings.ToLower(log.Topics[1])
			event.BatchID, err = topicUintDecimal(log.Topics[2])
			event.Actor = strings.ToLower(topicAddress(log.Topics[3]))
			if err != nil {
				return nil, err
			}
			switch kind {
			case "intent-submitted":
				boolean, boolErr := wordBoolean(words[0])
				if boolErr != nil {
					return nil, boolErr
				}
				event.Details = map[string]string{"zeroForOne": boolean, "sellAmount": wordDecimal(words[1]), "minBuyAmount": wordDecimal(words[2]), "validTo": wordDecimal(words[3]), "nonce": wordDecimal(words[4])}
			case "intent-cancelled":
				boolean, boolErr := wordBoolean(words[0])
				if boolErr != nil {
					return nil, boolErr
				}
				event.Details = map[string]string{"batchAborted": boolean}
			case "intent-settled":
				event.Details = map[string]string{"sellAmount": wordDecimal(words[0]), "baseBuyAmount": wordDecimal(words[1]), "solverFundedRebate": wordDecimal(words[2]), "priceImprovement": wordDecimal(words[3])}
			}
		} else {
			event.BatchID, err = topicUintDecimal(log.Topics[1])
			event.Actor = strings.ToLower(topicAddress(log.Topics[2]))
			if err != nil {
				return nil, err
			}
			switch kind {
			case "solution-committed":
				event.Details = map[string]string{"commitment": wordHash(words[0])}
			case "solution-revealed":
				event.Details = map[string]string{"priceX96": wordDecimal(words[0]), "rebateBps": wordDecimal(words[1]), "scoreToken0": wordDecimal(words[2]), "routeHash": wordHash(words[3]), "executionDigest": wordHash(words[4])}
			case "winner-finalized":
				event.Details = map[string]string{"priceX96": wordDecimal(words[0]), "rebateBps": wordDecimal(words[1]), "scoreToken0": wordDecimal(words[2]), "routeHash": wordHash(words[3]), "bestExecutionDigest": wordHash(words[4])}
			case "batch-settled":
				event.Details = map[string]string{"userInput0": wordDecimal(words[0]), "userInput1": wordDecimal(words[1]), "userOutput0": wordDecimal(words[2]), "userOutput1": wordDecimal(words[3]), "externalInput0": wordDecimal(words[4]), "externalInput1": wordDecimal(words[5]), "solverOutput0": wordDecimal(words[6]), "solverOutput1": wordDecimal(words[7]), "bestExecutionDigest": wordHash(words[8])}
			case "batch-failed":
				event.Details = map[string]string{"reason": wordHash(words[0]), "slashedBond": wordDecimal(words[1])}
			case "solver-slashed":
				event.Details = map[string]string{"reason": strings.ToLower(log.Topics[3]), "amount": wordDecimal(words[0])}
			}
		}
		if err := event.Validate(); err != nil {
			return nil, fmt.Errorf("decoded FairFlow event validation: %w", err)
		}
		result = append(result, event)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].BlockNumber == result[j].BlockNumber {
			return result[i].LogIndex < result[j].LogIndex
		}
		return result[i].BlockNumber < result[j].BlockNumber
	})
	return result, nil
}

func (poller *EVMPoller) recoverReorg(ctx context.Context) error {
	if poller.cursor.NextBlock <= poller.cfg.StartBlock || poller.cursor.LastBlockHash == "" {
		return nil
	}
	previous := poller.cursor.NextBlock - 1
	block, err := poller.block(ctx, previous)
	if err != nil {
		return err
	}
	if strings.EqualFold(block.Hash, poller.cursor.LastBlockHash) {
		return nil
	}
	rewind := poller.cfg.StartBlock
	if previous > poller.cfg.ReorgDepth && previous-poller.cfg.ReorgDepth >= poller.cfg.StartBlock {
		rewind = previous - poller.cfg.ReorgDepth
	}
	if err := poller.store.Rewind(rewind); err != nil {
		return err
	}
	kept := poller.cursor.Pools[:0]
	for _, pool := range poller.cursor.Pools {
		if pool.CreatedBlock < rewind {
			kept = append(kept, pool)
		}
	}
	poller.cursor.Pools = kept
	poller.cursor.NextBlock, poller.cursor.LastBlockHash = rewind, ""
	return poller.persistCursor()
}

func (poller *EVMPoller) decodePoolCreated(ctx context.Context, log evmLog) (poolIdentity, Event, error) {
	block, index, err := validateLog(log)
	if err != nil || len(log.Topics) != 3 {
		return poolIdentity{}, Event{}, errors.New("invalid PoolCreated log")
	}
	words, err := dataWords(log.Data)
	if err != nil || len(words) != 2 {
		return poolIdentity{}, Event{}, errors.New("invalid PoolCreated data")
	}
	token0, token1, poolAddress := topicAddress(log.Topics[1]), topicAddress(log.Topics[2]), wordAddress(words[0])
	if !addressPattern.MatchString(token0) || !addressPattern.MatchString(token1) || !addressPattern.MatchString(poolAddress) || strings.ToLower(token0) >= strings.ToLower(token1) {
		return poolIdentity{}, Event{}, errors.New("invalid PoolCreated identity")
	}
	timestamp, err := poller.blockTime(ctx, block)
	if err != nil {
		return poolIdentity{}, Event{}, err
	}
	pool := poolIdentity{Address: strings.ToLower(poolAddress), Token0: strings.ToLower(token0), Token1: strings.ToLower(token1), CreatedBlock: block}
	return pool, baseEvent(log, block, index, timestamp, pool, "pool-created"), nil
}

func (poller *EVMPoller) decodePoolLogs(ctx context.Context, logs []evmLog) ([]Event, error) {
	sort.Slice(logs, func(i, j int) bool {
		bi, _ := parseQuantity(logs[i].BlockNumber)
		bj, _ := parseQuantity(logs[j].BlockNumber)
		if bi == bj {
			li, _ := parseQuantity(logs[i].LogIndex)
			lj, _ := parseQuantity(logs[j].LogIndex)
			return li < lj
		}
		return bi < bj
	})
	reserves := map[string][2]string{}
	lpMint, lpBurn := map[string]string{}, map[string]string{}
	for _, log := range logs {
		if len(log.Topics) == 3 && strings.EqualFold(log.Topics[0], eventTopics["transfer"]) {
			words, err := dataWords(log.Data)
			if err != nil || len(words) != 1 {
				return nil, errors.New("invalid LP Transfer data")
			}
			key := strings.ToLower(log.TxHash + ":" + log.Address)
			from, to := topicAddress(log.Topics[1]), topicAddress(log.Topics[2])
			if isZeroAddress(from) {
				lpMint[key] = wordDecimal(words[0])
			}
			if isZeroAddress(to) {
				lpBurn[key] = wordDecimal(words[0])
			}
		}
	}
	result := make([]Event, 0, len(logs))
	for _, log := range logs {
		if log.Removed || len(log.Topics) == 0 || strings.EqualFold(log.Topics[0], eventTopics["transfer"]) {
			continue
		}
		pool, ok := poller.pool(log.Address)
		if !ok {
			return nil, errors.New("log from unknown pool")
		}
		block, index, err := validateLog(log)
		if err != nil {
			return nil, err
		}
		timestamp, err := poller.blockTime(ctx, block)
		if err != nil {
			return nil, err
		}
		words, err := dataWords(log.Data)
		if err != nil {
			return nil, err
		}
		event := baseEvent(log, block, index, timestamp, pool, "")
		key := strings.ToLower(log.TxHash + ":" + log.Address)
		switch strings.ToLower(log.Topics[0]) {
		case strings.ToLower(eventTopics["sync"]):
			if len(words) != 2 {
				return nil, errors.New("invalid Sync log")
			}
			reserves[key] = [2]string{wordDecimal(words[0]), wordDecimal(words[1])}
			event.Type = "sync"
			price0, price1, readErr := poller.cumulativePrices(ctx, pool.Address, block)
			if readErr != nil {
				return nil, readErr
			}
			event.Price0Cumulative, event.Price1Cumulative = price0, price1
		case strings.ToLower(eventTopics["mint"]):
			if len(log.Topics) != 3 || len(words) != 2 {
				return nil, errors.New("invalid Mint log")
			}
			event.Type, event.Account, event.Amount0, event.Amount1, event.LPAmount = "liquidity-add", topicAddress(log.Topics[2]), wordDecimal(words[0]), wordDecimal(words[1]), defaultAmount(lpMint[key])
		case strings.ToLower(eventTopics["burn"]):
			if len(log.Topics) != 3 || len(words) != 2 {
				return nil, errors.New("invalid Burn log")
			}
			event.Type, event.Account, event.Amount0, event.Amount1, event.LPAmount = "liquidity-remove", topicAddress(log.Topics[2]), wordDecimal(words[0]), wordDecimal(words[1]), defaultAmount(lpBurn[key])
		case strings.ToLower(eventTopics["swap"]):
			if len(log.Topics) != 4 || len(words) != 2 {
				return nil, errors.New("invalid Swap log")
			}
			tokenIn, amountIn, amountOut := topicAddress(log.Topics[2]), wordDecimal(words[0]), wordDecimal(words[1])
			event.Type, event.Account = "swap", topicAddress(log.Topics[3])
			fee := new(big.Int)
			fee.SetString(amountIn, 10)
			fee.Mul(fee, big.NewInt(30))
			fee.Div(fee, big.NewInt(10_000))
			if strings.EqualFold(tokenIn, pool.Token0) {
				event.Amount0, event.Amount1, event.Fee0 = amountIn, "-"+amountOut, fee.String()
			} else if strings.EqualFold(tokenIn, pool.Token1) {
				event.Amount0, event.Amount1, event.Fee1 = "-"+amountOut, amountIn, fee.String()
			} else {
				return nil, errors.New("Swap token is outside pool")
			}
		case strings.ToLower(eventTopics["fees"]):
			if len(log.Topics) != 2 || len(words) != 2 {
				return nil, errors.New("invalid ProtocolFeesClaimed log")
			}
			event.Type, event.Account, event.Amount0, event.Amount1, event.Fee0, event.Fee1 = "protocol-fee-claimed", topicAddress(log.Topics[1]), wordDecimal(words[0]), wordDecimal(words[1]), wordDecimal(words[0]), wordDecimal(words[1])
			event.Reserve0, event.Reserve1 = "", ""
		default:
			continue
		}
		values, hasReserves := reserves[key]
		if hasReserves {
			event.Reserve0, event.Reserve1 = values[0], values[1]
		}
		if (event.Type == "swap" || event.Type == "liquidity-add" || event.Type == "liquidity-remove") && !hasReserves {
			return nil, errors.New("state-changing pool event is missing its preceding Sync")
		}
		if err := event.Validate(); err != nil {
			return nil, fmt.Errorf("decoded event validation: %w", err)
		}
		result = append(result, event)
	}
	return result, nil
}

func baseEvent(log evmLog, block, index uint64, timestamp time.Time, pool poolIdentity, kind string) Event {
	return Event{ID: strings.ToLower(log.TxHash) + ":" + strconv.FormatUint(index, 10), ChainID: ChainID, ContractVersion: "ynx-dex-cpmm-v1", BlockNumber: block, BlockHash: strings.ToLower(log.BlockHash), TxHash: strings.ToLower(log.TxHash), LogIndex: index, Type: kind, Pool: strings.ToLower(pool.Address), Token0: strings.ToLower(pool.Token0), Token1: strings.ToLower(pool.Token1), Amount0: "0", Amount1: "0", LPAmount: "0", Fee0: "0", Fee1: "0", Reserve0: "0", Reserve1: "0", Timestamp: timestamp}
}

func (poller *EVMPoller) getLogs(ctx context.Context, from, to uint64, address any) ([]evmLog, error) {
	var logs []evmLog
	err := poller.rpc(ctx, "eth_getLogs", []any{map[string]any{"fromBlock": hexQuantity(from), "toBlock": hexQuantity(to), "address": address}}, &logs)
	if err != nil {
		return nil, err
	}
	for _, log := range logs {
		if log.Removed {
			return nil, errors.New("RPC returned removed log inside confirmed range")
		}
	}
	return logs, nil
}

func (poller *EVMPoller) block(ctx context.Context, number uint64) (evmBlock, error) {
	var block evmBlock
	if err := poller.rpc(ctx, "eth_getBlockByNumber", []any{hexQuantity(number), false}, &block); err != nil {
		return block, err
	}
	if !hashPattern.MatchString(block.Hash) {
		return block, errors.New("invalid EVM block identity")
	}
	return block, nil
}

func (poller *EVMPoller) blockTime(ctx context.Context, number uint64) (time.Time, error) {
	block, err := poller.block(ctx, number)
	if err != nil {
		return time.Time{}, err
	}
	seconds, err := parseQuantity(block.Timestamp)
	if err != nil {
		return time.Time{}, err
	}
	return time.Unix(int64(seconds), 0).UTC(), nil
}

func (poller *EVMPoller) cumulativePrices(ctx context.Context, pool string, block uint64) (string, string, error) {
	var encoded string
	if err := poller.rpc(ctx, "eth_call", []any{map[string]string{"to": pool, "data": cumulativePriceSelector}, hexQuantity(block)}, &encoded); err != nil {
		return "", "", err
	}
	words, err := dataWords(encoded)
	if err != nil || len(words) != 3 {
		return "", "", errors.New("invalid cumulative-price eth_call response")
	}
	return wordDecimal(words[0]), wordDecimal(words[1]), nil
}

func (poller *EVMPoller) nonceDomain(ctx context.Context, block uint64) (string, error) {
	var encoded string
	if err := poller.rpc(ctx, "eth_call", []any{map[string]string{"to": poller.cfg.StrategyVault, "data": nonceDomainSelector}, hexQuantity(block)}, &encoded); err != nil {
		return "", err
	}
	words, err := dataWords(encoded)
	if err != nil || len(words) != 1 {
		return "", errors.New("invalid nonceDomain eth_call response")
	}
	return "0x" + strings.ToLower(words[0]), nil
}

func (poller *EVMPoller) rpc(ctx context.Context, method string, params any, output any) error {
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": "ynx-dex", "method": method, "params": params})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, poller.cfg.RPCURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := poller.cfg.Client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("EVM RPC HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return err
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	if envelope.JSONRPC != "2.0" || envelope.Error != nil || len(envelope.Result) == 0 {
		return fmt.Errorf("EVM RPC %s failed", method)
	}
	return json.Unmarshal(envelope.Result, output)
}

func (poller *EVMPoller) loadCursor() error {
	data, err := os.ReadFile(poller.cfg.CursorPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var envelope cursorEnvelope
	if err := decodeExact(data, &envelope); err != nil {
		return err
	}
	payload, _ := json.Marshal(envelope.Cursor)
	mac := hmac.New(sha256.New, poller.cfg.CursorSecret)
	_, _ = mac.Write(payload)
	if envelope.Cursor.SchemaVersion < 1 || envelope.Cursor.SchemaVersion > 3 || !hmac.Equal([]byte(envelope.Integrity), []byte(hex.EncodeToString(mac.Sum(nil)))) || envelope.Cursor.NextBlock < poller.cfg.StartBlock {
		return errors.New("EVM cursor integrity verification failed")
	}
	for _, pool := range envelope.Cursor.Pools {
		if !addressPattern.MatchString(pool.Address) || !addressPattern.MatchString(pool.Token0) || !addressPattern.MatchString(pool.Token1) || pool.CreatedBlock < poller.cfg.StartBlock {
			return errors.New("invalid pool in EVM cursor")
		}
	}
	if envelope.Cursor.SchemaVersion >= 2 && !strings.EqualFold(envelope.Cursor.StrategyVault, poller.cfg.StrategyVault) {
		return errors.New("EVM cursor strategy vault binding mismatch")
	}
	if envelope.Cursor.SchemaVersion == 3 && !strings.EqualFold(envelope.Cursor.FairFlow, poller.cfg.FairFlow) {
		return errors.New("EVM cursor FairFlow binding mismatch")
	}
	if envelope.Cursor.SchemaVersion < 3 {
		legacyVersion := envelope.Cursor.SchemaVersion
		if err := preserveLegacyState(fmt.Sprintf("%s.schema-v%d.bak", poller.cfg.CursorPath, legacyVersion), data); err != nil {
			return fmt.Errorf("preserve EVM cursor schema v%d rollback: %w", legacyVersion, err)
		}
		envelope.Cursor.SchemaVersion = 3
		envelope.Cursor.StrategyVault = strings.ToLower(poller.cfg.StrategyVault)
		envelope.Cursor.FairFlow = strings.ToLower(poller.cfg.FairFlow)
		if (legacyVersion == 1 && (poller.cfg.StrategyVault != "" || poller.cfg.FairFlow != "")) || (legacyVersion == 2 && poller.cfg.FairFlow != "") {
			envelope.Cursor.NextBlock = poller.cfg.StartBlock
			envelope.Cursor.LastBlockHash = ""
		}
		poller.cursor = envelope.Cursor
		return poller.persistCursor()
	}
	poller.cursor = envelope.Cursor
	return nil
}

func (poller *EVMPoller) persistCursor() error {
	payload, _ := json.Marshal(poller.cursor)
	mac := hmac.New(sha256.New, poller.cfg.CursorSecret)
	_, _ = mac.Write(payload)
	data, err := json.MarshalIndent(cursorEnvelope{Cursor: poller.cursor, Integrity: hex.EncodeToString(mac.Sum(nil))}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(poller.cfg.CursorPath), 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(poller.cfg.CursorPath), ".dex-cursor-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, poller.cfg.CursorPath)
}

func (poller *EVMPoller) hasPool(address string) bool { _, ok := poller.pool(address); return ok }
func (poller *EVMPoller) pool(address string) (poolIdentity, bool) {
	for _, pool := range poller.cursor.Pools {
		if strings.EqualFold(pool.Address, address) {
			return pool, true
		}
	}
	return poolIdentity{}, false
}
func validateLog(log evmLog) (uint64, uint64, error) {
	block, e1 := parseQuantity(log.BlockNumber)
	index, e2 := parseQuantity(log.LogIndex)
	if e1 != nil || e2 != nil || block == 0 || !hashPattern.MatchString(log.BlockHash) || !hashPattern.MatchString(log.TxHash) || !addressPattern.MatchString(log.Address) {
		return 0, 0, errors.New("invalid EVM log identity")
	}
	return block, index, nil
}
func dataWords(data string) ([]string, error) {
	raw := strings.TrimPrefix(data, "0x")
	if len(raw)%64 != 0 {
		return nil, errors.New("invalid ABI data")
	}
	result := make([]string, 0, len(raw)/64)
	for len(raw) > 0 {
		word := raw[:64]
		if _, err := hex.DecodeString(word); err != nil {
			return nil, err
		}
		result = append(result, word)
		raw = raw[64:]
	}
	return result, nil
}
func wordDecimal(word string) string {
	value := new(big.Int)
	value.SetString(word, 16)
	return value.String()
}
func wordHash(word string) string { return "0x" + strings.ToLower(word) }
func wordBoolean(word string) (string, error) {
	value := wordDecimal(word)
	if value == "0" {
		return "false", nil
	}
	if value == "1" {
		return "true", nil
	}
	return "", errors.New("invalid ABI boolean")
}
func wordAddress(word string) string { return "0x" + word[24:] }
func topicAddress(topic string) string {
	raw := strings.TrimPrefix(topic, "0x")
	if len(raw) != 64 {
		return ""
	}
	return "0x" + raw[24:]
}
func topicUintDecimal(topic string) (string, error) {
	raw := strings.TrimPrefix(topic, "0x")
	if len(raw) != 64 {
		return "", errors.New("invalid uint topic")
	}
	if _, err := hex.DecodeString(raw); err != nil {
		return "", err
	}
	return wordDecimal(raw), nil
}
func topicBytes4(topic string) (string, error) {
	raw := strings.TrimPrefix(topic, "0x")
	if len(raw) != 64 || strings.Trim(raw[8:], "0") != "" {
		return "", errors.New("invalid bytes4 topic")
	}
	if _, err := hex.DecodeString(raw); err != nil {
		return "", err
	}
	return "0x" + strings.ToLower(raw[:8]), nil
}
func isZeroAddress(value string) bool {
	return strings.EqualFold(value, "0x0000000000000000000000000000000000000000")
}
func defaultAmount(value string) string {
	if value == "" {
		return "0"
	}
	return value
}
func parseQuantity(value string) (uint64, error) {
	if !strings.HasPrefix(value, "0x") || len(value) < 3 {
		return 0, errors.New("invalid hex quantity")
	}
	return strconv.ParseUint(value[2:], 16, 64)
}
func hexQuantity(value uint64) string { return fmt.Sprintf("0x%x", value) }
func eventTopic(signature string) string {
	hash := sha3.NewLegacyKeccak256()
	_, _ = hash.Write([]byte(signature))
	return "0x" + hex.EncodeToString(hash.Sum(nil))
}
func functionSelector(signature string) string {
	hash := sha3.NewLegacyKeccak256()
	_, _ = hash.Write([]byte(signature))
	return "0x" + hex.EncodeToString(hash.Sum(nil)[:4])
}
