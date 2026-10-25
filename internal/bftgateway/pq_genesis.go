package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const pqConsensusGenesisRPCReadBytes = int64((consensus.MaxCometGenesisBytes+2)/3*4 + (64 << 10))

func (g *Gateway) queryPQConsensusGenesis(ctx context.Context) ([]byte, int64, error) {
	raw, err := g.identityRPCResult(ctx, "/abci_query", url.Values{"path": {strconv.Quote(consensus.PQWalletConsensusGenesisPath)}}, pqConsensusGenesisRPCReadBytes)
	if err != nil {
		return nil, 0, err
	}
	var result struct {
		Response struct {
			Code   json.RawMessage `json:"code"`
			Height string          `json:"height"`
			Value  string          `json:"value"`
		} `json:"response"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, 0, err
	}
	// Comet omits a successful zero code. An explicitly present code must be
	// that exact number, never null, a string, or a nonzero application refusal.
	if len(result.Response.Code) != 0 && !bytes.Equal(bytes.TrimSpace(result.Response.Code), []byte("0")) {
		return nil, 0, errors.New("original consensus Genesis ABCI query was rejected")
	}
	height, err := identityHeight(result.Response.Height)
	if err != nil || height <= 0 || uint64(height) < g.migrationHeight {
		return nil, 0, errors.New("invalid original consensus Genesis observation height")
	}
	if len(result.Response.Value) > base64.StdEncoding.EncodedLen(consensus.MaxCometGenesisBytes) {
		return nil, 0, errors.New("original consensus Genesis exceeds its existing bound")
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(result.Response.Value)
	trimmed := bytes.TrimSpace(payload)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxCometGenesisBytes || base64.StdEncoding.EncodeToString(payload) != result.Response.Value ||
		!utf8.Valid(payload) || !json.Valid(payload) || len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, 0, errors.New("invalid original bounded consensus Genesis bytes")
	}
	return payload, height, nil
}

func (g *Gateway) handlePQConsensusGenesis(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "consensus Genesis observation accepts no query or request body"})
		return
	}
	raw, height, err := g.queryPQConsensusGenesis(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	// These headers report only these exact response bytes and this one ABCI
	// response's height. The consumer must independently admit the original pin
	// and align/recheck its separate owner policy query; this is not Root/finality.
	digest := sha256.Sum256(raw)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-YNX-Comet-Genesis-SHA256", hex.EncodeToString(digest[:]))
	w.Header().Set("X-YNX-Observation-Height", strconv.FormatInt(height, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}
