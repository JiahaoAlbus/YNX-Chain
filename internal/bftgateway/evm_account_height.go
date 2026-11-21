package bftgateway

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
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
