package dex

import (
	"errors"
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
}

func (event Event) Validate() error {
	if len(event.ID) < 16 || len(event.ID) > 128 || strings.TrimSpace(event.ID) != event.ID {
		return errors.New("invalid event id")
	}
	if event.ChainID != ChainID || event.ContractVersion != "ynx-dex-cpmm-v1" {
		return errors.New("wrong chain or contract version")
	}
	if event.BlockNumber == 0 || !hashPattern.MatchString(event.BlockHash) || !hashPattern.MatchString(event.TxHash) {
		return errors.New("invalid block or transaction identity")
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
	Source          string `json:"source"`
	IndexedEvents   int    `json:"indexedEvents"`
	Pools           int    `json:"pools"`
	Swaps           int    `json:"swaps"`
	LiquidityEvents int    `json:"liquidityEvents"`
	LatestBlock     uint64 `json:"latestBlock"`
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
