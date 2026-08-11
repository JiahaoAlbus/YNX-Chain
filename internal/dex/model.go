package dex

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
	"time"
)

const ChainID = uint64(6423)
const MinimumTWAPInterval = uint64(60)

var (
	addressPattern        = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	hashPattern           = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
	amountPattern         = regexp.MustCompile(`^-?[0-9]{1,78}$`)
	nativePattern         = regexp.MustCompile(`^ynx1[0-9a-z]{20,80}$`)
	sessionBindingPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{64}$`)
	selectorPattern       = regexp.MustCompile(`^0x[0-9a-fA-F]{8}$`)
)

type Event struct {
	ID               string    `json:"id"`
	ChainID          uint64    `json:"chainId"`
	ContractVersion  string    `json:"contractVersion"`
	BlockNumber      uint64    `json:"blockNumber"`
	BlockHash        string    `json:"blockHash"`
	TxHash           string    `json:"txHash"`
	LogIndex         uint64    `json:"logIndex"`
	Type             string    `json:"type"`
	Pool             string    `json:"pool"`
	Account          string    `json:"account"`
	Token0           string    `json:"token0"`
	Token1           string    `json:"token1"`
	Amount0          string    `json:"amount0"`
	Amount1          string    `json:"amount1"`
	LPAmount         string    `json:"lpAmount"`
	Fee0             string    `json:"fee0"`
	Fee1             string    `json:"fee1"`
	Reserve0         string    `json:"reserve0"`
	Reserve1         string    `json:"reserve1"`
	Price0Cumulative string    `json:"price0Cumulative,omitempty"`
	Price1Cumulative string    `json:"price1Cumulative,omitempty"`
	Timestamp        time.Time `json:"timestamp"`
	Vault            string    `json:"vault,omitempty"`
	NonceDomain      string    `json:"nonceDomain,omitempty"`
	ActionNonce      string    `json:"actionNonce,omitempty"`
	Method           string    `json:"method,omitempty"`
	MethodSelector   string    `json:"methodSelector,omitempty"`
	BeforeValue      string    `json:"beforeValue,omitempty"`
	AfterValue       string    `json:"afterValue,omitempty"`
}

func (event Event) Validate() error {
	if len(event.ID) < 16 || len(event.ID) > 128 || strings.TrimSpace(event.ID) != event.ID {
		return errors.New("invalid event id")
	}
	if event.ChainID != ChainID {
		return errors.New("wrong chain or contract version")
	}
	if event.BlockNumber == 0 || !hashPattern.MatchString(event.BlockHash) || !hashPattern.MatchString(event.TxHash) {
		return errors.New("invalid block or transaction identity")
	}
	if event.ContractVersion == "ynx-strategy-vault-v1" {
		return event.validateVaultAction()
	}
	if !isPoolContractVersion(event.ContractVersion) {
		return errors.New("wrong chain or contract version")
	}
	if event.Vault != "" || event.NonceDomain != "" || event.ActionNonce != "" || event.Method != "" || event.MethodSelector != "" || event.BeforeValue != "" || event.AfterValue != "" {
		return errors.New("pool event contains vault fields")
	}
	switch event.Type {
	case "pool-created", "sync", "swap", "liquidity-add", "liquidity-remove", "protocol-fee-claimed":
	default:
		return errors.New("unsupported event type")
	}
	if !addressPattern.MatchString(event.Pool) || !addressPattern.MatchString(event.Token0) || !addressPattern.MatchString(event.Token1) || strings.ToLower(event.Token0) >= strings.ToLower(event.Token1) {
		return errors.New("invalid pool or token identity")
	}
	if event.Account != "" && !nativePattern.MatchString(event.Account) && !addressPattern.MatchString(event.Account) {
		return errors.New("invalid account")
	}
	for _, amount := range []string{event.Amount0, event.Amount1, event.LPAmount, event.Fee0, event.Fee1} {
		if !amountPattern.MatchString(amount) {
			return errors.New("invalid amount")
		}
	}
	if (event.Reserve0 == "") != (event.Reserve1 == "") {
		return errors.New("partial reserve snapshot")
	}
	for _, amount := range []string{event.Reserve0, event.Reserve1} {
		if amount != "" && !amountPattern.MatchString(amount) {
			return errors.New("invalid reserve")
		}
	}
	if (event.Price0Cumulative == "") != (event.Price1Cumulative == "") {
		return errors.New("partial cumulative-price snapshot")
	}
	for _, amount := range []string{event.Price0Cumulative, event.Price1Cumulative} {
		if amount != "" && !amountPattern.MatchString(amount) {
			return errors.New("invalid cumulative price")
		}
	}
	if event.Timestamp.IsZero() || event.Timestamp.After(time.Now().Add(2*time.Minute)) {
		return errors.New("invalid timestamp")
	}
	return nil
}

func isPoolContractVersion(version string) bool {
	return version == "ynx-dex-cpmm-v1" || version == "ynx-stableswap-v1"
}

func (event Event) validateVaultAction() error {
	if event.Type != "vault-action" || !addressPattern.MatchString(event.Vault) || !hashPattern.MatchString(event.NonceDomain) || !selectorPattern.MatchString(event.MethodSelector) {
		return errors.New("invalid vault action identity")
	}
	expectedSelectors := map[string]string{
		"swapExactInput":  functionSelector("swapExactInput(uint256,uint256,uint256,address[],uint256)"),
		"swapExactOutput": functionSelector("swapExactOutput(uint256,uint256,uint256,address[],uint256)"),
		"addLiquidity":    functionSelector("addLiquidity(uint256,address,address,uint256,uint256,uint256,uint256)"),
		"removeLiquidity": functionSelector("removeLiquidity(uint256,address,address,uint256,uint256,uint256,uint256)"),
	}
	expected, ok := expectedSelectors[event.Method]
	if !ok || !strings.EqualFold(expected, event.MethodSelector) {
		return errors.New("unsupported vault action method")
	}
	for _, amount := range []string{event.ActionNonce, event.BeforeValue, event.AfterValue} {
		if !amountPattern.MatchString(amount) || strings.HasPrefix(amount, "-") {
			return errors.New("invalid vault action amount")
		}
	}
	if event.Pool != "" || event.Token0 != "" || event.Token1 != "" || event.Account != "" || event.Amount0 != "" || event.Amount1 != "" || event.LPAmount != "" || event.Fee0 != "" || event.Fee1 != "" || event.Reserve0 != "" || event.Reserve1 != "" || event.Price0Cumulative != "" || event.Price1Cumulative != "" {
		return errors.New("vault action contains pool fields")
	}
	if event.Timestamp.IsZero() || event.Timestamp.After(time.Now().Add(2*time.Minute)) {
		return errors.New("invalid timestamp")
	}
	return nil
}

type Pool struct {
	Address         string    `json:"address"`
	Token0          string    `json:"token0"`
	Token1          string    `json:"token1"`
	Reserve0        string    `json:"reserve0"`
	Reserve1        string    `json:"reserve1"`
	ContractVersion string    `json:"contractVersion"`
	UpdatedBlock    uint64    `json:"updatedBlock"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type Position struct {
	Account       string `json:"account"`
	Pool          string `json:"pool"`
	NetLPAmount   string `json:"netLpAmount"`
	AddedToken0   string `json:"addedToken0"`
	AddedToken1   string `json:"addedToken1"`
	RemovedToken0 string `json:"removedToken0"`
	RemovedToken1 string `json:"removedToken1"`
}

type Analytics struct {
	Source             string `json:"source"`
	IndexedEvents      int    `json:"indexedEvents"`
	Pools              int    `json:"pools"`
	Swaps              int    `json:"swaps"`
	LiquidityEvents    int    `json:"liquidityEvents"`
	LatestBlock        uint64 `json:"latestBlock"`
	VaultActions       int    `json:"vaultActions"`
	FairFlowEvents     int    `json:"fairFlowEvents"`
	LPProtectionEvents int    `json:"lpProtectionEvents"`
}

type VaultAction struct {
	Vault           string    `json:"vault"`
	NonceDomain     string    `json:"nonceDomain"`
	ActionNonce     string    `json:"actionNonce"`
	Method          string    `json:"method"`
	MethodSelector  string    `json:"methodSelector"`
	BeforeValue     string    `json:"beforeValue"`
	AfterValue      string    `json:"afterValue"`
	TransactionHash string    `json:"transactionHash"`
	BlockHash       string    `json:"blockHash"`
	BlockNumber     uint64    `json:"blockNumber"`
	LogIndex        uint64    `json:"logIndex"`
	AsOf            time.Time `json:"asOf"`
	Source          string    `json:"source"`
	Version         string    `json:"version"`
	Confidence      string    `json:"confidence"`
	Coverage        string    `json:"coverage"`
	Failure         *string   `json:"failure"`
}

type FairFlowEvent struct {
	ID              string            `json:"id"`
	ChainID         uint64            `json:"chainId"`
	ContractVersion string            `json:"contractVersion"`
	FairFlow        string            `json:"fairFlow"`
	BlockNumber     uint64            `json:"blockNumber"`
	BlockHash       string            `json:"blockHash"`
	TransactionHash string            `json:"transactionHash"`
	LogIndex        uint64            `json:"logIndex"`
	Type            string            `json:"type"`
	BatchID         string            `json:"batchId"`
	Actor           string            `json:"actor"`
	IntentID        string            `json:"intentId"`
	Details         map[string]string `json:"details"`
	AsOf            time.Time         `json:"asOf"`
	Source          string            `json:"source"`
	Version         string            `json:"version"`
	Confidence      string            `json:"confidence"`
	Coverage        string            `json:"coverage"`
	Failure         *string           `json:"failure"`
}

type LPProtectionEvent struct {
	ID              string            `json:"id"`
	ChainID         uint64            `json:"chainId"`
	ContractVersion string            `json:"contractVersion"`
	LPProtection    string            `json:"lpProtection"`
	Pool            string            `json:"pool"`
	TokenIn         string            `json:"tokenIn"`
	BlockNumber     uint64            `json:"blockNumber"`
	BlockHash       string            `json:"blockHash"`
	TransactionHash string            `json:"transactionHash"`
	LogIndex        uint64            `json:"logIndex"`
	Type            string            `json:"type"`
	Details         map[string]string `json:"details"`
	AsOf            time.Time         `json:"asOf"`
	Source          string            `json:"source"`
	Version         string            `json:"version"`
	Confidence      string            `json:"confidence"`
	Coverage        string            `json:"coverage"`
	Failure         *string           `json:"failure"`
}

func (event LPProtectionEvent) Validate() error {
	if len(event.ID) < 16 || len(event.ID) > 128 || event.ChainID != ChainID || event.ContractVersion != "ynx-lp-protection-v1" || !addressPattern.MatchString(event.LPProtection) || !addressPattern.MatchString(event.Pool) || event.LPProtection == "0x0000000000000000000000000000000000000000" || event.Pool == "0x0000000000000000000000000000000000000000" || event.BlockNumber == 0 || !hashPattern.MatchString(event.BlockHash) || !hashPattern.MatchString(event.TransactionHash) {
		return errors.New("invalid LP protection event identity")
	}
	if event.Source != "confirmed YNX Testnet EVM logs" || event.Version != "ynx-lp-protection-event-v1" || event.Confidence != "confirmed-on-chain" || len(event.Coverage) < 20 || event.Failure != nil || event.AsOf.IsZero() || event.AsOf.After(time.Now().Add(2*time.Minute)) {
		return errors.New("invalid LP protection provenance")
	}
	expected := map[string][]string{
		"pool-registered":  {"token0", "token1"},
		"config-scheduled": {"configHash", "executableAt"},
		"config-changed":   {"configHash"},
		"assessed":         {"amountIn", "baseFeeBps", "depegBps", "depthFeeBps", "divergenceFeeBps", "incentiveAmount", "jitFeeBps", "oracleAsOf", "oracleSourceHash", "realizedFeeAmount", "totalFeeBps", "toxicFlowFeeBps", "volatilityFeeBps"},
	}
	keys, ok := expected[event.Type]
	if !ok || len(event.Details) != len(keys) {
		return errors.New("unsupported LP protection event type or details")
	}
	for _, key := range keys {
		if _, exists := event.Details[key]; !exists {
			return errors.New("missing LP protection event detail")
		}
	}
	if event.Type == "assessed" {
		if !addressPattern.MatchString(event.TokenIn) || event.TokenIn == "0x0000000000000000000000000000000000000000" || !hashPattern.MatchString(event.Details["oracleSourceHash"]) {
			return errors.New("invalid LP protection assessment identity")
		}
		for _, key := range []string{"amountIn", "realizedFeeAmount", "incentiveAmount", "oracleAsOf"} {
			if !amountPattern.MatchString(event.Details[key]) || strings.HasPrefix(event.Details[key], "-") {
				return errors.New("invalid LP protection amount")
			}
		}
		if event.Details["amountIn"] == "0" || event.Details["incentiveAmount"] != "0" || event.Details["oracleAsOf"] == "0" {
			return errors.New("invalid LP protection realized fee semantics")
		}
		for _, key := range []string{"totalFeeBps", "baseFeeBps", "volatilityFeeBps", "depthFeeBps", "divergenceFeeBps", "toxicFlowFeeBps", "jitFeeBps", "depegBps"} {
			value, ok := new(big.Int).SetString(event.Details[key], 10)
			if !ok || value.Sign() < 0 || value.Cmp(big.NewInt(20_000)) > 0 {
				return errors.New("invalid LP protection bps")
			}
		}
		total, _ := new(big.Int).SetString(event.Details["totalFeeBps"], 10)
		base, _ := new(big.Int).SetString(event.Details["baseFeeBps"], 10)
		componentSum := new(big.Int).Set(base)
		for _, key := range []string{"volatilityFeeBps", "depthFeeBps", "divergenceFeeBps", "toxicFlowFeeBps", "jitFeeBps"} {
			component, _ := new(big.Int).SetString(event.Details[key], 10)
			componentSum.Add(componentSum, component)
		}
		if total.Cmp(big.NewInt(2_000)) > 0 || total.Cmp(base) < 0 || total.Cmp(componentSum) > 0 {
			return errors.New("LP protection total fee exceeds contract cap")
		}
		amount, _ := new(big.Int).SetString(event.Details["amountIn"], 10)
		realized, _ := new(big.Int).SetString(event.Details["realizedFeeAmount"], 10)
		expectedRealized := new(big.Int).Mul(amount, total)
		expectedRealized.Div(expectedRealized, big.NewInt(10_000))
		oracleAsOf, _ := new(big.Int).SetString(event.Details["oracleAsOf"], 10)
		if realized.Cmp(expectedRealized) != 0 || !oracleAsOf.IsUint64() || oracleAsOf.Uint64() > uint64(event.AsOf.Unix()+120) {
			return errors.New("invalid LP protection realized fee or Oracle time")
		}
	} else {
		if event.TokenIn != "" {
			return errors.New("non-assessment LP protection event contains token")
		}
		for key, value := range event.Details {
			switch key {
			case "token0", "token1":
				if !addressPattern.MatchString(value) || value == "0x0000000000000000000000000000000000000000" {
					return errors.New("invalid LP protection pool token")
				}
			case "configHash":
				if !hashPattern.MatchString(value) {
					return errors.New("invalid LP protection config hash")
				}
			case "executableAt":
				if !amountPattern.MatchString(value) || strings.HasPrefix(value, "-") || value == "0" {
					return errors.New("invalid LP protection execution time")
				}
			}
		}
		if event.Type == "pool-registered" && strings.ToLower(event.Details["token0"]) >= strings.ToLower(event.Details["token1"]) {
			return errors.New("invalid LP protection token ordering")
		}
	}
	return nil
}

func (event FairFlowEvent) Validate() error {
	if len(event.ID) < 16 || len(event.ID) > 128 || event.ChainID != ChainID || event.ContractVersion != "ynx-fairflow-v1" || !addressPattern.MatchString(event.FairFlow) || event.BlockNumber == 0 || !hashPattern.MatchString(event.BlockHash) || !hashPattern.MatchString(event.TransactionHash) {
		return errors.New("invalid FairFlow event identity")
	}
	if !amountPattern.MatchString(event.BatchID) || strings.HasPrefix(event.BatchID, "-") || event.BatchID == "0" || event.AsOf.IsZero() || event.AsOf.After(time.Now().Add(2*time.Minute)) {
		return errors.New("invalid FairFlow batch or timestamp")
	}
	if event.Source != "confirmed YNX Testnet EVM logs" || event.Version != "ynx-fairflow-event-v1" || event.Confidence != "confirmed-on-chain" || len(event.Coverage) < 20 || event.Failure != nil {
		return errors.New("invalid FairFlow provenance")
	}
	expected := map[string][]string{
		"batch-opened":       {"commitEnd", "intentEnd", "revealEnd", "settleEnd", "token0", "token1"},
		"intent-submitted":   {"minBuyAmount", "nonce", "sellAmount", "validTo", "zeroForOne"},
		"intent-cancelled":   {"batchAborted"},
		"solution-committed": {"commitment"},
		"solution-revealed":  {"executionDigest", "priceX96", "rebateBps", "routeHash", "scoreToken0"},
		"winner-finalized":   {"bestExecutionDigest", "priceX96", "rebateBps", "routeHash", "scoreToken0"},
		"intent-settled":     {"baseBuyAmount", "priceImprovement", "sellAmount", "solverFundedRebate"},
		"batch-settled":      {"bestExecutionDigest", "externalInput0", "externalInput1", "solverOutput0", "solverOutput1", "userInput0", "userInput1", "userOutput0", "userOutput1"},
		"batch-failed":       {"reason", "slashedBond"},
		"solver-slashed":     {"amount", "reason"},
	}
	keys, ok := expected[event.Type]
	if !ok || len(event.Details) != len(keys) {
		return errors.New("unsupported FairFlow event type or details")
	}
	for _, key := range keys {
		if _, ok := event.Details[key]; !ok {
			return errors.New("missing FairFlow event detail")
		}
	}
	intentType := event.Type == "intent-submitted" || event.Type == "intent-cancelled" || event.Type == "intent-settled"
	if intentType != hashPattern.MatchString(event.IntentID) {
		return errors.New("invalid FairFlow intent identity")
	}
	if event.Type == "batch-opened" {
		if event.Actor != "" || !addressPattern.MatchString(event.Details["token0"]) || !addressPattern.MatchString(event.Details["token1"]) || strings.ToLower(event.Details["token0"]) >= strings.ToLower(event.Details["token1"]) {
			return errors.New("invalid FairFlow batch tokens")
		}
	} else if !addressPattern.MatchString(event.Actor) {
		return errors.New("invalid FairFlow actor")
	}
	for key, value := range event.Details {
		switch key {
		case "token0", "token1":
			if !addressPattern.MatchString(value) {
				return errors.New("invalid FairFlow token")
			}
		case "commitment", "executionDigest", "routeHash", "bestExecutionDigest", "reason":
			if !hashPattern.MatchString(value) {
				return errors.New("invalid FairFlow digest")
			}
		case "zeroForOne", "batchAborted":
			if value != "true" && value != "false" {
				return errors.New("invalid FairFlow boolean")
			}
		default:
			if !amountPattern.MatchString(value) || strings.HasPrefix(value, "-") {
				return errors.New("invalid FairFlow amount")
			}
		}
	}
	return nil
}

// Token is owner-reviewed Testnet metadata used to interpret raw pool amounts.
// The API never infers decimals or symbols from untrusted event data.
type Token struct {
	ChainID      uint64 `json:"chainId"`
	Address      string `json:"address"`
	Symbol       string `json:"symbol"`
	Name         string `json:"name"`
	Decimals     uint8  `json:"decimals"`
	Standard     string `json:"standard"`
	ReviewStatus string `json:"reviewStatus"`
}

type SpotPrice struct {
	Pool              string `json:"pool"`
	Token0            string `json:"token0"`
	Token1            string `json:"token1"`
	Price0Numerator   string `json:"price0Numerator"`
	Price0Denominator string `json:"price0Denominator"`
	Price1Numerator   string `json:"price1Numerator"`
	Price1Denominator string `json:"price1Denominator"`
	UpdatedBlock      uint64 `json:"updatedBlock"`
}

type TWAP struct {
	Pool              string `json:"pool"`
	Token0            string `json:"token0"`
	Token1            string `json:"token1"`
	Price0AverageX112 string `json:"price0AverageX112"`
	Price1AverageX112 string `json:"price1AverageX112"`
	IntervalSeconds   uint64 `json:"intervalSeconds"`
	FromBlock         uint64 `json:"fromBlock"`
	ToBlock           uint64 `json:"toBlock"`
}

type FeeSummary struct {
	Pool        string `json:"pool"`
	Token0      string `json:"token0"`
	Token1      string `json:"token1"`
	SwapFee0    string `json:"swapFee0"`
	SwapFee1    string `json:"swapFee1"`
	ClaimedFee0 string `json:"claimedFee0"`
	ClaimedFee1 string `json:"claimedFee1"`
}

func (token Token) Validate() error {
	if token.ChainID != ChainID || !addressPattern.MatchString(token.Address) {
		return errors.New("invalid token chain or address")
	}
	if len(token.Symbol) < 1 || len(token.Symbol) > 16 || strings.TrimSpace(token.Symbol) != token.Symbol {
		return errors.New("invalid token symbol")
	}
	if len(token.Name) < 1 || len(token.Name) > 64 || strings.TrimSpace(token.Name) != token.Name {
		return errors.New("invalid token name")
	}
	if token.Decimals > 36 || token.Standard != "ERC-20" || token.ReviewStatus != "owner-reviewed-testnet" {
		return errors.New("token is not approved Testnet ERC-20 metadata")
	}
	return nil
}
