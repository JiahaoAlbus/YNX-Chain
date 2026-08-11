package dex

import (
	"net/http"
	"sort"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const (
	FinanceReadRoute           = "/v1/integrations/finance/account"
	FinanceReadEnvelopeVersion = "finance-source-read-envelope-v1"
	FinanceReadContractVersion = "dex-finance-read-v1"
	FinanceReadPayloadSchema   = "ynx-dex-finance-account-v1"
)

var FinanceReadCapabilities = []string{
	"dex.positions.read",
	"dex.swaps.read",
	"dex.liquidity.read",
	"dex.fees.read",
}

type financeDEXEvent struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Pool        string    `json:"pool"`
	Token0      string    `json:"token0"`
	Token1      string    `json:"token1"`
	Amount0     string    `json:"amount0"`
	Amount1     string    `json:"amount1"`
	LPAmount    string    `json:"lpAmount"`
	Fee0        string    `json:"fee0"`
	Fee1        string    `json:"fee1"`
	BlockNumber uint64    `json:"blockNumber"`
	BlockHash   string    `json:"blockHash"`
	TxHash      string    `json:"transactionHash"`
	OccurredAt  time.Time `json:"occurredAt"`
}

type financeDEXPayload struct {
	Product        string            `json:"product"`
	ProductVersion string            `json:"productVersion"`
	BuildCommit    string            `json:"buildCommit"`
	Source         string            `json:"source"`
	Positions      []Position        `json:"positions"`
	Swaps          []financeDEXEvent `json:"swaps"`
	Liquidity      []financeDEXEvent `json:"liquidity"`
	Pools          []Pool            `json:"pools"`
}

func (server *Server) financeAccount(response http.ResponseWriter, request *http.Request) {
	if server.financeRead == nil {
		writeError(response, http.StatusServiceUnavailable, "finance read integration unavailable")
		return
	}
	select {
	case server.financeSlots <- struct{}{}:
		defer func() { <-server.financeSlots }()
	default:
		writeError(response, http.StatusServiceUnavailable, "finance read capacity exhausted")
		return
	}
	account, err := server.financeRead.Verify(request, FinanceReadRoute)
	if err != nil {
		writeError(response, http.StatusUnauthorized, "invalid Finance read credential")
		return
	}
	normalized, err := accountaddress.Normalize(account)
	if err != nil {
		writeError(response, http.StatusUnauthorized, "invalid Finance read account")
		return
	}
	payload := server.financePayload(normalized)
	writeJSON(response, http.StatusOK, map[string]any{
		"envelopeVersion":      FinanceReadEnvelopeVersion,
		"sourceId":             "dex",
		"owner":                "27-dex",
		"network":              "ynx_6423-1",
		"nativeAsset":          "YNXT",
		"authorizedAccount":    normalized,
		"ownerContractVersion": FinanceReadContractVersion,
		"payloadSchema":        FinanceReadPayloadSchema,
		"asOf":                 time.Now().UTC(),
		"asOfKind":             "dex-indexer-state-observed-at",
		"coverage":             "authorized indexed LP positions, swaps, liquidity actions, raw fees and referenced pool state",
		"syncStatus":           "authoritative-indexed-chain-native-dex-state",
		"readOnly":             true,
		"capabilities":         append([]string(nil), FinanceReadCapabilities...),
		"payload":              payload,
	})
}

func (server *Server) financePayload(account string) financeDEXPayload {
	result := financeDEXPayload{
		Product: "ynx-dex", ProductVersion: server.build.Release, BuildCommit: server.build.Commit, Source: server.source,
		Positions: server.store.Positions(account), Swaps: []financeDEXEvent{}, Liquidity: []financeDEXEvent{}, Pools: []Pool{},
	}
	referencedPools := map[string]struct{}{}
	for _, position := range result.Positions {
		referencedPools[position.Pool] = struct{}{}
	}
	for _, event := range server.store.Events() {
		if !sameDEXAccount(event.Account, account) {
			continue
		}
		item := financeDEXEvent{ID: event.ID, Type: event.Type, Pool: event.Pool, Token0: event.Token0, Token1: event.Token1, Amount0: event.Amount0, Amount1: event.Amount1, LPAmount: event.LPAmount, Fee0: event.Fee0, Fee1: event.Fee1, BlockNumber: event.BlockNumber, BlockHash: event.BlockHash, TxHash: event.TxHash, OccurredAt: event.Timestamp}
		switch event.Type {
		case "swap":
			result.Swaps = append(result.Swaps, item)
			referencedPools[event.Pool] = struct{}{}
		case "liquidity-add", "liquidity-remove":
			result.Liquidity = append(result.Liquidity, item)
			referencedPools[event.Pool] = struct{}{}
		}
	}
	for _, pool := range server.store.Pools() {
		if _, ok := referencedPools[pool.Address]; ok {
			result.Pools = append(result.Pools, pool)
		}
	}
	sort.Slice(result.Swaps, func(i, j int) bool { return result.Swaps[i].BlockNumber > result.Swaps[j].BlockNumber })
	sort.Slice(result.Liquidity, func(i, j int) bool { return result.Liquidity[i].BlockNumber > result.Liquidity[j].BlockNumber })
	return result
}
