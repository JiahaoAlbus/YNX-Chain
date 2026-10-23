package bftgateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Imported records retain their native identity. They do not acquire a Comet
// position, header, AppHash or finality proof by being served through this RPC.
type importedBlockView struct {
	chain.Block
	consensus.MigrationHistoryAnchor
	IndependentFinality bool `json:"independentFinality"`
}

type importedTransactionView struct {
	chain.Transaction
	consensus.MigrationHistoryAnchor
	IndependentFinality bool `json:"independentFinality"`
}

func sourceTransactionHash(hash string) bool {
	return identityHash(strings.TrimPrefix(hash, "0x"))
}

func (g *Gateway) queryMigrationHistory(ctx context.Context, path string, out any) (int64, error) {
	limit := int64((consensus.MaxMigrationHistoryQueryBytes+2)/3*4 + (64 << 10))
	raw, err := g.identityRPCResult(ctx, "/abci_query", url.Values{"path": {strconv.Quote(path)}}, limit)
	if err != nil {
		return 0, err
	}
	var result struct {
		Response struct {
			Code   uint32 `json:"code"`
			Height string `json:"height"`
			Value  string `json:"value"`
		} `json:"response"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || result.Response.Code != 0 {
		return 0, errors.New("original source history query is unavailable")
	}
	height, err := identityHeight(result.Response.Height)
	if err != nil || height < 1 {
		return 0, errors.New("original source history response has no committed height")
	}
	payload, err := base64.StdEncoding.DecodeString(result.Response.Value)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxMigrationHistoryQueryBytes || base64.StdEncoding.EncodeToString(payload) != result.Response.Value {
		return 0, errors.New("original source history value is not bounded canonical base64")
	}
	if err := strictPQJSON(payload, out); err != nil {
		return 0, err
	}
	return height, nil
}

func (g *Gateway) validateMigrationHistory(ctx context.Context, anchor consensus.MigrationHistoryAnchor, height int64) error {
	if g.migrationHeight == 0 || anchor.Version != consensus.MigrationHistoryVersion || anchor.Source != "source_import" || anchor.NativeChainID != 6423 || anchor.MigrationHeight != g.migrationHeight || anchor.MigrationBlockHash != g.migrationBlockHash || height < 0 || uint64(height) < anchor.MigrationHeight || !identityHash(anchor.SourceAnchor) || !identityHash(anchor.OriginalGenesisHash) {
		return errors.New("original source history differs from the configured migration boundary")
	}
	// Check the same configured application's independently installed bootstrap
	// identity. This is a source observation, not authentication to a light client.
	identity, err := g.pqIdentityQuery(ctx)
	if err != nil {
		return err
	}
	if identity.NativeChainID != anchor.NativeChainID || identity.MigrationHeight != anchor.MigrationHeight || identity.MigrationStateHash != anchor.SourceAnchor || identity.NativeGenesisHash != anchor.OriginalGenesisHash || identity.CurrentStateHeight < height {
		return errors.New("original source history and configured bootstrap identity disagree")
	}
	return nil
}

func (g *Gateway) handleImportedBlock(w http.ResponseWriter, r *http.Request, height uint64) {
	var view consensus.MigrationHistoryBlockView
	queryHeight, err := g.queryMigrationHistory(r.Context(), consensus.MigrationHistoryBlockPath+strconv.FormatUint(height, 10), &view)
	if err == nil {
		err = g.validateMigrationHistory(r.Context(), view.MigrationHistoryAnchor, queryHeight)
	}
	if err != nil || view.Found != (view.Block != nil) {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "original source block observation is unavailable or inconsistent"})
		return
	}
	if !view.Found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "original source block not found"})
		return
	}
	block := view.Block
	if block.Height != height || block.Height > view.MigrationHeight || !identityHash(block.Hash) || height == 0 && block.Hash != view.OriginalGenesisHash || height == view.MigrationHeight && block.Hash != view.MigrationBlockHash {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "original source block identity differs from the requested height"})
		return
	}
	for _, tx := range block.Transactions {
		if tx.BlockNum != height || tx.BlockHash != block.Hash || !sourceTransactionHash(tx.Hash) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "original source block transaction identity differs"})
			return
		}
	}
	writeJSON(w, http.StatusOK, importedBlockView{Block: *block, MigrationHistoryAnchor: view.MigrationHistoryAnchor})
}

// Membership is queried explicitly, before selecting a transaction namespace.
// An RPC error must not trigger a switch between original and Comet history.
func (g *Gateway) importedTransaction(ctx context.Context, hash string) (importedTransactionView, bool, error) {
	var view consensus.MigrationHistoryTransactionView
	height, err := g.queryMigrationHistory(ctx, consensus.MigrationHistoryTransactionPath+hash, &view)
	if err != nil {
		return importedTransactionView{}, false, err
	}
	if err := g.validateMigrationHistory(ctx, view.MigrationHistoryAnchor, height); err != nil {
		return importedTransactionView{}, false, err
	}
	if view.Found != (view.Transaction != nil) {
		return importedTransactionView{}, false, errors.New("original source membership and record disagree")
	}
	if !view.Found {
		return importedTransactionView{}, false, nil
	}
	tx := view.Transaction
	if tx.Hash != hash || tx.BlockNum > view.MigrationHeight || !identityHash(tx.BlockHash) || tx.BlockNum == view.MigrationHeight && tx.BlockHash != view.MigrationBlockHash {
		return importedTransactionView{}, false, errors.New("original source transaction identity differs from the requested hash")
	}
	return importedTransactionView{Transaction: *tx, MigrationHistoryAnchor: view.MigrationHistoryAnchor}, true, nil
}
