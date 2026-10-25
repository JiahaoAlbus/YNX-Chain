package bftgateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const dexAPIVersion = "abci-state-v13"

func (g *Gateway) handleDEXMutation(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, dexFailure("Content-Type application/json is required"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, dexFailure("signed DEX action exceeds maximum size"))
		return
	}
	tx, err := consensus.DecodeSignedApplicationAction(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, dexFailure(err.Error()))
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, dexFailure(err.Error()))
		return
	}
	expected, objectID, status, err := dexRouteBinding(r, tx)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, dexFailure(err.Error()))
		return
	}
	if tx.Action != expected {
		writeJSON(w, http.StatusBadRequest, dexFailure("signed DEX action does not match the requested route"))
		return
	}
	if _, err := g.broadcastApplicationAction(r.Context(), raw, tx); err != nil {
		var txErr *gatewayTransactionError
		if errors.As(err, &txErr) {
			writeJSON(w, txErr.status, dexFailure(txErr.Error()))
		} else {
			writeJSON(w, http.StatusBadGateway, dexFailure(err.Error()))
		}
		return
	}
	txHash := consensus.ApplicationActionHash(raw)
	var events []consensus.BFTDexEvent
	if err := g.queryABCIJSON(r.Context(), "/dex/events", &events); err != nil {
		writeJSON(w, http.StatusBadGateway, dexFailure("committed DEX event evidence unavailable"))
		return
	}
	var evidence *consensus.BFTDexEvent
	for index := range events {
		candidate := &events[index]
		if candidate.ID == consensus.ApplicationActionRecordID("dex-event", txHash) && candidate.TxHash == txHash && candidate.Type == tx.Action && candidate.Signer == tx.Signer && candidate.BlockHeight > 0 && !candidate.OccurredAt.IsZero() && blockHashPattern.MatchString(candidate.AuditHash) {
			evidence = candidate
			break
		}
	}
	if evidence == nil {
		writeJSON(w, http.StatusBadGateway, dexFailure("committed DEX event evidence mismatch"))
		return
	}
	response := dexBase(evidence.OccurredAt, "exact")
	response["event"] = evidence
	if tx.Action == consensus.ActionDexAssetCreate || tx.Action == consensus.ActionDexAssetMint {
		var asset consensus.BFTDexAsset
		if err := g.queryABCIJSON(r.Context(), "/dex/assets/"+objectID, &asset); err != nil || asset.ID != objectID {
			writeJSON(w, http.StatusBadGateway, dexFailure("committed DEX asset evidence mismatch"))
			return
		}
		response["asset"] = asset
	} else if tx.Action == consensus.ActionDexAssetTransfer {
		var balances []consensus.BFTDexBalance
		if err := g.queryABCIJSON(r.Context(), "/dex/balances/"+tx.Signer, &balances); err != nil {
			writeJSON(w, http.StatusBadGateway, dexFailure("committed DEX balance evidence unavailable"))
			return
		}
		response["balances"] = balances
	} else {
		var pool consensus.BFTDexPool
		if err := g.queryABCIJSON(r.Context(), "/dex/pools/"+objectID, &pool); err != nil || pool.ID != objectID {
			writeJSON(w, http.StatusBadGateway, dexFailure("committed DEX pool evidence mismatch"))
			return
		}
		response["pool"] = pool
	}
	writeJSON(w, status, response)
}

func dexRouteBinding(r *http.Request, tx consensus.SignedApplicationAction) (string, string, int, error) {
	switch r.URL.Path {
	case "/dex/assets":
		var input consensus.DexAssetCreatePayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.AssetID == "" {
			return "", "", 0, errors.New("invalid DEX asset creation payload")
		}
		return consensus.ActionDexAssetCreate, input.AssetID, http.StatusCreated, nil
	case "/dex/pools":
		var input consensus.DexPoolCreatePayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.PoolID == "" {
			return "", "", 0, errors.New("invalid DEX pool creation payload")
		}
		return consensus.ActionDexPoolCreate, input.PoolID, http.StatusCreated, nil
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		return "", "", 0, errors.New("canonical DEX object ID is required")
	}
	switch {
	case strings.HasSuffix(r.URL.Path, "/mint"):
		var input consensus.DexAssetAmountPayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.AssetID != id {
			return "", "", 0, errors.New("signed DEX asset ID does not match its route")
		}
		return consensus.ActionDexAssetMint, id, http.StatusOK, nil
	case strings.HasSuffix(r.URL.Path, "/transfer"):
		var input consensus.DexAssetTransferPayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.AssetID != id {
			return "", "", 0, errors.New("signed DEX asset ID does not match its route")
		}
		return consensus.ActionDexAssetTransfer, id, http.StatusOK, nil
	case strings.HasSuffix(r.URL.Path, "/liquidity/add"):
		var input consensus.DexLiquidityPayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.PoolID != id {
			return "", "", 0, errors.New("signed DEX pool ID does not match its route")
		}
		return consensus.ActionDexLiquidityAdd, id, http.StatusOK, nil
	case strings.HasSuffix(r.URL.Path, "/liquidity/remove"):
		var input consensus.DexLiquidityRemovePayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.PoolID != id {
			return "", "", 0, errors.New("signed DEX pool ID does not match its route")
		}
		return consensus.ActionDexLiquidityRemove, id, http.StatusOK, nil
	case strings.HasSuffix(r.URL.Path, "/swaps/exact-input"):
		var input consensus.DexSwapExactInputPayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.PoolID != id {
			return "", "", 0, errors.New("signed DEX pool ID does not match its route")
		}
		return consensus.ActionDexSwapExactInput, id, http.StatusOK, nil
	case strings.HasSuffix(r.URL.Path, "/swaps/exact-output"):
		var input consensus.DexSwapExactOutputPayload
		if json.Unmarshal(tx.Payload, &input) != nil || input.PoolID != id {
			return "", "", 0, errors.New("signed DEX pool ID does not match its route")
		}
		return consensus.ActionDexSwapExactOutput, id, http.StatusOK, nil
	default:
		return "", "", 0, errors.New("unsupported DEX mutation route")
	}
}

func (g *Gateway) handleDEXAssets(w http.ResponseWriter, r *http.Request) {
	var values []consensus.BFTDexAsset
	if err := g.queryABCIJSON(r.Context(), "/dex/assets", &values); err != nil {
		writeJSON(w, http.StatusBadGateway, dexFailure(err.Error()))
		return
	}
	response := dexBase(latestDEXAssetTime(values), map[string]any{"returned": len(values), "complete": true})
	response["assets"] = values
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleDEXAsset(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var value any
	if id == consensus.DexNativeAssetID {
		value = map[string]any{}
	} else {
		value = &consensus.BFTDexAsset{}
	}
	if err := g.queryABCIJSON(r.Context(), "/dex/assets/"+id, value); err != nil {
		writeJSON(w, http.StatusNotFound, dexFailure("DEX asset not found"))
		return
	}
	response := dexBase(nil, "exact")
	response["asset"] = value
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleDEXBalances(w http.ResponseWriter, r *http.Request) {
	address := strings.TrimSpace(r.PathValue("address"))
	if !consensus.IsNativeAddress(address) {
		writeJSON(w, http.StatusBadRequest, dexFailure("canonical YNX address is required"))
		return
	}
	var values []consensus.BFTDexBalance
	if err := g.queryABCIJSON(r.Context(), "/dex/balances/"+address, &values); err != nil {
		writeJSON(w, http.StatusBadGateway, dexFailure(err.Error()))
		return
	}
	response := dexBase(nil, map[string]any{"returned": len(values), "complete": true})
	response["address"], response["balances"] = address, values
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleDEXPools(w http.ResponseWriter, r *http.Request) {
	var values []consensus.BFTDexPool
	if err := g.queryABCIJSON(r.Context(), "/dex/pools", &values); err != nil {
		writeJSON(w, http.StatusBadGateway, dexFailure(err.Error()))
		return
	}
	response := dexBase(latestDEXPoolTime(values), map[string]any{"returned": len(values), "complete": true})
	response["pools"] = values
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleDEXPool(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var value consensus.BFTDexPool
	if err := g.queryABCIJSON(r.Context(), "/dex/pools/"+id, &value); err != nil || value.ID != id {
		writeJSON(w, http.StatusNotFound, dexFailure("DEX pool not found"))
		return
	}
	response := dexBase(value.UpdatedAt, "exact")
	response["pool"] = value
	writeJSON(w, http.StatusOK, response)
}

func (g *Gateway) handleDEXEvents(w http.ResponseWriter, r *http.Request) {
	var values []consensus.BFTDexEvent
	if err := g.queryABCIJSON(r.Context(), "/dex/events", &values); err != nil {
		writeJSON(w, http.StatusBadGateway, dexFailure(err.Error()))
		return
	}
	var asOf any
	if len(values) != 0 {
		asOf = values[len(values)-1].OccurredAt
	}
	response := dexBase(asOf, map[string]any{"returned": len(values), "complete": true})
	response["events"] = values
	writeJSON(w, http.StatusOK, response)
}

func dexBase(asOf, coverage any) map[string]any {
	return map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "asOf": asOf, "version": dexAPIVersion, "coverage": coverage, "failure": false}
}

func dexFailure(message string) map[string]any {
	return map[string]any{"error": message, "source": "ynx-consensus-abci", "version": dexAPIVersion, "coverage": "none", "failure": true}
}

func latestDEXAssetTime(values []consensus.BFTDexAsset) any {
	var latest time.Time
	for _, value := range values {
		if value.UpdatedAt.After(latest) {
			latest = value.UpdatedAt
		}
	}
	if latest.IsZero() {
		return nil
	}
	return latest
}

func latestDEXPoolTime(values []consensus.BFTDexPool) any {
	var latest time.Time
	for _, value := range values {
		if value.UpdatedAt.After(latest) {
			latest = value.UpdatedAt
		}
	}
	if latest.IsZero() {
		return nil
	}
	return latest
}
