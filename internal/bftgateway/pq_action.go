package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// These are configured-RPC observations, never native-producer durability or
// independently verified finality. Effects are projected with decimal strings
// for EVERY JSON number; Wallets never reconstruct uint64 through JS floats.
type PQActionView struct {
	Type                  string          `json:"type"`
	Status                string          `json:"status"`
	Committed             bool            `json:"committed"`
	Source                string          `json:"source"`
	NativeTransactionHash string          `json:"nativeTransactionHash"`
	ABCITransactionHash   string          `json:"abciTransactionHash,omitempty"`
	Wire                  []byte          `json:"wire,omitempty"`
	Transport             []byte          `json:"transport,omitempty"`
	ExecutionHeight       uint64          `json:"executionHeight,string"`
	CometIndex            *uint32         `json:"cometIndex,omitempty"`
	From                  string          `json:"from,omitempty"`
	To                    string          `json:"to,omitempty"`
	Amount                int64           `json:"amount,string"`
	Fee                   uint64          `json:"fee,string"`
	Nonce                 uint64          `json:"nonce,string"`
	Effects               json.RawMessage `json:"effects,omitempty"`
	ReadbackURL           string          `json:"readbackUrl"`
	ABCIReadbackURL       string          `json:"abciReadbackUrl,omitempty"`
	Error                 string          `json:"error,omitempty"`
}

func pqActionIdentity(wire, raw []byte, action ynxauth.Action) PQActionView {
	nativeHash, abciHash := consensus.SignedTransactionHash(wire), consensus.SignedTransactionHash(raw)
	return PQActionView{Type: action.Kind, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: bytes.Clone(wire), Transport: bytes.Clone(raw), From: action.Owner, Fee: action.Fee, Nonce: action.Nonce, ReadbackURL: "/transactions/pq/actions/originals/" + nativeHash, ABCIReadbackURL: "/transactions/pq/actions/" + abciHash}
}

func decodeIngressPQAction(body []byte, contentType string) ([]byte, []byte, ynxauth.Action, error) {
	var action ynxauth.Action
	if contentType == "application/json" {
		wire, action, err := consensus.DecodePQActionTransport(body)
		return wire, body, action, err
	}
	if len(body) == 0 || len(body) > chain.MaxPQActionMemberBytes {
		return nil, nil, action, errors.New("PQ action Member exceeds protocol bound")
	}
	member, err := ynxbatch.DecodeMember(body)
	if err != nil {
		return nil, nil, action, err
	}
	action, err = ynxauth.DecodeAction(member.Message)
	if err != nil {
		return nil, nil, action, err
	}
	var raw []byte
	switch action.Kind {
	case ynxauth.ActionContractDeploy:
		return nil, nil, action, errors.New("contract_deploy requires application/json canonical PQContractTransaction with complete source and material")
	case ynxauth.ActionContractExecute:
		raw, err = consensus.EncodePQContractTransaction(body, "", nil)
	default:
		raw, err = consensus.EncodePQNativeActionTransaction(body)
	}
	return body, raw, action, err
}

func (g *Gateway) queryPQActionHistory(ctx context.Context, hash string) (consensus.PQActionHistoryView, int64, error) {
	var v consensus.PQActionHistoryView
	height, err := g.queryPQWalletJSON(ctx, consensus.PQActionHistoryPath+hash, &v)
	return v, height, err
}

// Only the already-validated effects enter the public projection. Preserve
// every numeric token exactly, including nested AMM balances and nonces.
func decimalPQActionEffects(raw []byte) (json.RawMessage, error) {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var value any
	if err := d.Decode(&value); err != nil {
		return nil, err
	}
	var project func(any) any
	project = func(v any) any {
		switch x := v.(type) {
		case json.Number:
			return x.String()
		case []any:
			for i := range x {
				x[i] = project(x[i])
			}
		case map[string]any:
			for k := range x {
				x[k] = project(x[k])
			}
		}
		return v
	}
	return json.Marshal(project(value))
}

func (g *Gateway) projectPQAction(ctx context.Context, indexed cometTx, known *consensus.PQActionHistoryView, queryHeight int64) (PQActionView, error) {
	wire, action, err := consensus.DecodePQActionTransport(indexed.Tx)
	if err != nil {
		return PQActionView{}, err
	}
	v := pqActionIdentity(wire, indexed.Tx, action)
	if !strings.EqualFold(indexed.Hash, strings.TrimPrefix(v.ABCITransactionHash, "0x")) {
		return v, errors.New("indexed action hash differs from original ABCI transport")
	}
	height, err := strconv.ParseUint(indexed.Height, 10, 64)
	if err != nil || height == 0 || strconv.FormatUint(height, 10) != indexed.Height {
		return v, errors.New("invalid indexed action execution height")
	}
	if indexed.TxResult.Code != 0 {
		if len(indexed.TxResult.Data) != 0 {
			return v, errors.New("rejected action acquired execution identity data")
		}
		v.Status, v.Error, v.ExecutionHeight, v.CometIndex = "rejected", indexed.TxResult.Log, height, &indexed.Index
		return v, nil
	}
	if !bytes.Equal(indexed.TxResult.Data, []byte(v.ABCITransactionHash)) {
		return v, errors.New("successful action index lacks exact execution identity")
	}
	var history consensus.PQActionHistoryView
	if known == nil {
		history, queryHeight, err = g.queryPQActionHistory(ctx, v.NativeTransactionHash)
		if err != nil {
			return v, err
		}
	} else {
		history = *known
	}
	if history.ExecutionHeight != height || !bytes.Equal(history.Transport, indexed.Tx) {
		return v, errors.New("committed action original differs from indexed transport or height")
	}
	tx, _, err := consensus.ValidatePQActionHistoryView(history, queryHeight)
	if err != nil {
		return v, err
	}
	if tx.Hash != v.NativeTransactionHash || history.ABCITransactionHash != v.ABCITransactionHash {
		return v, errors.New("committed action original identity mismatch")
	}
	effects, err := decimalPQActionEffects(history.Effects)
	if err != nil {
		return v, err
	}
	v.Status, v.Committed, v.ExecutionHeight, v.CometIndex, v.To, v.Amount, v.Effects = "committed", true, height, &indexed.Index, tx.To, tx.Amount, effects
	return v, nil
}

func (g *Gateway) lookupPQActionABCI(ctx context.Context, hash string) (PQActionView, error) {
	v := PQActionView{Status: "unknown", Source: "comet-rpc", ABCITransactionHash: hash, ABCIReadbackURL: "/transactions/pq/actions/" + hash}
	indexed, err := g.readPQMemberIndex(ctx, hash)
	if err != nil {
		return v, err
	}
	projected, err := g.projectPQAction(ctx, indexed, nil, 0)
	if err != nil && projected.ABCITransactionHash != hash {
		return v, err
	}
	return projected, err
}

func (g *Gateway) lookupPQActionOriginal(ctx context.Context, hash string) (PQActionView, error) {
	v := PQActionView{Status: "unknown", Source: "comet-rpc", NativeTransactionHash: hash, ReadbackURL: "/transactions/pq/actions/originals/" + hash}
	history, queryHeight, err := g.queryPQActionHistory(ctx, hash)
	if err != nil {
		return v, err
	}
	wire, action, err := consensus.DecodePQActionTransport(history.Transport)
	if err != nil || consensus.SignedTransactionHash(wire) != hash {
		return v, errors.New("history differs from requested original Action Member")
	}
	v = pqActionIdentity(wire, history.Transport, action)
	if history.Source != "comet-rpc" || history.ABCITransactionHash != v.ABCITransactionHash {
		return v, errors.New("source action has no matching Comet execution identity")
	}
	if _, _, err = consensus.ValidatePQActionHistoryView(history, queryHeight); err != nil {
		return v, err
	}
	indexed, err := g.readPQMemberIndex(ctx, v.ABCITransactionHash)
	if err != nil {
		return v, err
	}
	if !bytes.Equal(indexed.Tx, history.Transport) {
		return v, errors.New("Comet index returned a different original action transport")
	}
	confirmed, err := g.projectPQAction(ctx, indexed, &history, queryHeight)
	if err != nil {
		return v, err
	}
	if !confirmed.Committed {
		return v, errors.New("committed action history disagrees with indexed rejection")
	}
	return confirmed, nil
}

func (g *Gateway) handlePQActionBroadcast(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "action broadcast accepts no query parameters"})
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if contentType != "application/octet-stream" && contentType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "expected original Member octet-stream or complete canonical PQContractTransaction JSON"})
		return
	}
	limit := int64(chain.MaxPQActionMemberBytes)
	if contentType == "application/json" {
		limit = consensus.MaxPQContractTransactionBytes
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "complete action exceeds protocol transport bound"})
		return
	}
	wire, raw, action, err := decodeIngressPQAction(body, contentType)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	v := pqActionIdentity(wire, raw, action)
	// This is the EXISTING postBroadcast limit, after full canonical rebuild.
	// Contract material is never stripped to fit. The protocol's 24 MiB decoder
	// limit does not imply that this configured RPC accepts a 24 MiB transaction.
	if 4*((len(raw)+2)/3)+74 > 792658 {
		v.Status = "rejected"
		v.Error = "complete canonical action exceeds existing RPC broadcast profile"
		writeJSON(w, http.StatusRequestEntityTooLarge, v)
		return
	}
	unknown := func(err error) { v.Error = err.Error(); writeJSON(w, http.StatusAccepted, v) }
	var broadcast cometBroadcast
	if err = g.client.postBroadcast(r.Context(), raw, &broadcast); err != nil {
		unknown(err)
		return
	}
	if broadcast.Error != nil {
		unknown(errors.New(cometError(broadcast.Error)))
		return
	}
	if !strings.EqualFold(broadcast.Result.Hash, strings.TrimPrefix(v.ABCITransactionHash, "0x")) {
		unknown(errors.New("broadcast hash differs from original action transport"))
		return
	}
	if broadcast.Result.CheckTx.Code != 0 {
		if len(broadcast.Result.CheckTx.Data) != 0 {
			unknown(errors.New("action CheckTx rejection has unexpected data"))
			return
		}
		v.Status, v.Error = "rejected", broadcast.Result.CheckTx.Log
		writeJSON(w, http.StatusUnprocessableEntity, v)
		return
	}
	height, err := strconv.ParseUint(broadcast.Result.Height, 10, 64)
	if err != nil || height == 0 || strconv.FormatUint(height, 10) != broadcast.Result.Height {
		unknown(errors.New("broadcast action execution height is missing or noncanonical"))
		return
	}
	confirmed, err := g.lookupPQActionABCI(r.Context(), v.ABCITransactionHash)
	if err != nil {
		unknown(err)
		return
	}
	if confirmed.NativeTransactionHash != v.NativeTransactionHash || !bytes.Equal(confirmed.Wire, wire) || !bytes.Equal(confirmed.Transport, raw) || confirmed.ExecutionHeight != height {
		unknown(errors.New("broadcast and indexed action original or height disagree"))
		return
	}
	if broadcast.Result.TxResult.Code != 0 {
		if confirmed.Status != "rejected" || len(broadcast.Result.TxResult.Data) != 0 || confirmed.Error != broadcast.Result.TxResult.Log {
			unknown(errors.New("broadcast and indexed action rejection disagree"))
			return
		}
		writeJSON(w, http.StatusUnprocessableEntity, confirmed)
		return
	}
	if !confirmed.Committed || !bytes.Equal(broadcast.Result.TxResult.Data, []byte(v.ABCITransactionHash)) {
		unknown(errors.New("broadcast action result lacks matching committed original"))
		return
	}
	writeJSON(w, http.StatusOK, confirmed)
}

func (g *Gateway) handlePQActionOriginal(w http.ResponseWriter, r *http.Request) {
	g.handlePQActionRead(w, r, true)
}
func (g *Gateway) handlePQActionTransaction(w http.ResponseWriter, r *http.Request) {
	g.handlePQActionRead(w, r, false)
}

func (g *Gateway) handlePQActionRead(w http.ResponseWriter, r *http.Request, original bool) {
	w.Header().Set("Cache-Control", "no-store")
	hash := r.PathValue("hash")
	if !transactionHashPattern.MatchString(hash) || r.URL.RawQuery != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical action hash and no query parameters are required"})
		return
	}
	var v PQActionView
	var err error
	if original {
		v, err = g.lookupPQActionOriginal(r.Context(), hash)
	} else {
		v, err = g.lookupPQActionABCI(r.Context(), hash)
	}
	if err != nil {
		v.Status, v.Committed, v.Effects, v.ExecutionHeight, v.CometIndex, v.Error = "unknown", false, nil, 0, nil, err.Error()
		writeJSON(w, http.StatusAccepted, v)
		return
	}
	writeJSON(w, http.StatusOK, v)
}
