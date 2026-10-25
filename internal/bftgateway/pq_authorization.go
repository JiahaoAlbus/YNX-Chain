package bftgateway

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// queryPQWalletJSON retains the height of the SAME ABCI response as its value.
// A separate /accounts or /status query cannot supply an atomic nonce/policy
// snapshot. This remains configured-RPC evidence, never a light-client proof.
func (g *Gateway) queryPQWalletJSON(ctx context.Context, path string, out any) (int64, error) {
	var upstream struct {
		cometABCIQuery
		Error *cometRPCError `json:"error"`
	}
	limit := int64((consensus.MaxPQWalletQueryBytes+2)/3*4 + (64 << 10))
	// Keep the original transport, timeout and body budget, but never follow a
	// configured authority's redirect to a different query source. Do not mutate
	// the shared HTTP client used by unrelated gateway requests.
	httpClient := *g.client.httpClient
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	queryClient := *g.client
	queryClient.httpClient = &httpClient
	if err := queryClient.getBounded(ctx, "/abci_query", url.Values{"path": {fmt.Sprintf("%q", path)}}, &upstream, limit); err != nil {
		return 0, err
	}
	if upstream.Error != nil {
		return 0, errors.New(cometError(upstream.Error))
	}
	response := upstream.Result.Response
	if response.Code != 0 {
		return 0, errors.New("PQ Wallet ABCI query rejected: " + response.Log)
	}
	height, err := strconv.ParseInt(response.Height, 10, 64)
	if err != nil || height < 0 || strconv.FormatInt(height, 10) != response.Height {
		return 0, errors.New("invalid PQ Wallet ABCI response height")
	}
	payload, err := base64.StdEncoding.DecodeString(response.Value)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxPQWalletQueryBytes || base64.StdEncoding.EncodeToString(payload) != response.Value {
		return 0, errors.New("invalid bounded PQ Wallet ABCI value")
	}
	if err := strictPQJSON(payload, out); err != nil {
		return 0, err
	}
	return height, nil
}

func (g *Gateway) queryPQWalletAuthorization(ctx context.Context, owner string) (consensus.PQWalletAccountView, error) {
	var view consensus.PQWalletAccountView
	if !accountaddress.IsCanonical(owner) {
		return view, errors.New("canonical lowercase account owner is required")
	}
	height, err := g.queryPQWalletJSON(ctx, consensus.PQWalletAuthorizationPath+owner, &view)
	if err != nil {
		return view, err
	}
	if view.CommittedHeight != height {
		return view, errors.New("PQ Wallet account value and ABCI response height disagree")
	}
	return view, consensus.ValidatePQWalletAccountView(view, owner)
}

func (g *Gateway) handlePQAuthorization(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	owner := r.PathValue("address")
	if !accountaddress.IsCanonical(owner) || r.URL.RawQuery != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical lowercase account owner and no query parameters are required"})
		return
	}
	view, err := g.queryPQWalletAuthorization(r.Context(), owner)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, view)
}
