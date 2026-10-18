package bftgateway

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// The N1 transfer profile is smaller than 64 KiB. Migration retains its existing
// 256 KiB protocol bound; both canonical JSON envelopes fit the existing Comet
// and postBroadcast limits. No mempool, block, or RPC cap is changed here.
const MaxPQMemberIngressBytes = 64 << 10

// PQMemberView describes configured Comet RPC evidence, not native producer
// durability or an independently verified light-client finality proof. Wire is
// the exact submitted original. Only a matched successful index + committed
// PQHistory + historical authorization populates Transaction and Committed.
type PQMemberView struct {
	Type                  string  `json:"type,omitempty"`
	Status                string  `json:"status"`
	Committed             bool    `json:"committed"`
	Source                string  `json:"source"`
	NativeTransactionHash string  `json:"nativeTransactionHash"`
	ABCITransactionHash   string  `json:"abciTransactionHash,omitempty"`
	Wire                  []byte  `json:"wire,omitempty"`
	ExecutionHeight       uint64  `json:"executionHeight,string"`
	CometIndex            *uint32 `json:"cometIndex,omitempty"`
	From                  string  `json:"from,omitempty"`
	To                    string  `json:"to,omitempty"`
	Amount                int64   `json:"amount,string"`
	Fee                   int64   `json:"fee,string"`
	Nonce                 uint64  `json:"nonce,string"`
	// Transaction preserves the original legacy history shape. Wallet consumers
	// use the decimal-string fields above, never recover uint64 from JSON floats.
	Transaction *chain.Transaction `json:"transaction,omitempty"`
	ReadbackURL string             `json:"readbackUrl"`
	Error       string             `json:"error,omitempty"`
}

func pqMemberIdentity(kind string, wire, payload []byte) PQMemberView {
	hash := consensus.SignedTransactionHash(wire)
	return PQMemberView{Type: kind, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: hash, ABCITransactionHash: consensus.SignedTransactionHash(payload), Wire: bytes.Clone(wire), ReadbackURL: "/transactions/pq/originals/" + hash}
}

// isPQMemberTransaction is used only AFTER /tx succeeds. A failed Comet lookup
// is never treated as permission to reinterpret an ABCI hash as a native hash.
func isPQMemberTransaction(payload []byte) bool {
	envelope, _, err := consensus.DecodePQTransaction(payload)
	return err == nil && (envelope.Type == consensus.PQTransferType || envelope.Type == consensus.PQMigrationType)
}

func decodeIngressPQMember(kind string, wire []byte) (owner string, payload []byte, err error) {
	switch kind {
	case consensus.PQTransferType:
		if len(wire) == 0 || len(wire) > MaxPQMemberIngressBytes {
			return "", nil, errors.New("Member exceeds bounded N1 transfer ingress profile")
		}
		member, decodeErr := ynxbatch.DecodeMember(wire)
		if decodeErr != nil {
			return "", nil, decodeErr
		}
		transfer, decodeErr := ynxauth.DecodeTransfer(member.Message)
		if decodeErr != nil {
			return "", nil, decodeErr
		}
		if member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 || member.Certificate.Purpose != ynxauth.TransactionPurpose || member.Certificate.Owner != transfer.From || !bytes.Equal(member.Certificate.ChainID, transfer.ChainID) || transfer.Fee != uint64(consensus.SignedTransactionFeeYNXT) {
			return "", nil, errors.New("expected canonical N1 TX-BATCH transfer Member")
		}
		owner = transfer.From
	case consensus.PQMigrationType:
		if len(wire) == 0 || len(wire) > ynxauth.MaxMigrationBytes {
			return "", nil, errors.New("migration exceeds protocol bound")
		}
		migration, decodeErr := ynxauth.DecodeMigration(wire)
		if decodeErr != nil {
			return "", nil, decodeErr
		}
		canonical, encodeErr := migration.Encode()
		if encodeErr != nil || !bytes.Equal(canonical, wire) {
			return "", nil, errors.New("noncanonical migration original")
		}
		owner = migration.Intent.Owner
	default:
		return "", nil, errors.New("unsupported single PQ ingress kind")
	}
	// Parsing grants no authority. The real Application checks the registered
	// current authorization and both proposed-key PoPs, fees and ledger nonce.
	payload, err = consensus.EncodePQTransaction(kind, wire)
	return owner, payload, err
}

func pqMemberHistoryWire(history consensus.PQWalletHistoryView) (kind string, wire, payload []byte, err error) {
	kind, prefix := consensus.PQTransferType, "ynx-pq-transfer-v1:"
	switch history.Transaction.Type {
	case "transfer":
	case consensus.PQMigrationType:
		kind, prefix = consensus.PQMigrationType, "ynx-pq-migration-v1:"
	default:
		return "", nil, nil, errors.New("history is not a standalone Member transfer or migration")
	}
	memo := history.Transaction.Memo
	if !strings.HasPrefix(memo, prefix) || len(memo) > len(prefix)+2*ynxauth.MaxMigrationBytes {
		return "", nil, nil, errors.New("history has no bounded original PQ wire")
	}
	wire, err = hex.DecodeString(strings.TrimPrefix(memo, prefix))
	if err != nil || prefix+hex.EncodeToString(wire) != memo {
		return "", nil, nil, errors.New("history original wire is noncanonical")
	}
	_, payload, err = decodeIngressPQMember(kind, wire)
	return kind, wire, payload, err
}

func validatePQMemberHistory(history consensus.PQWalletHistoryView, queryHeight int64, kind string, wire, payload []byte, height uint64) error {
	tx, auth := history.Transaction, history.Authorization
	if history.Source != "comet-rpc" || queryHeight != auth.CommittedHeight || queryHeight < 0 || height == 0 || height > uint64(queryHeight) || history.ExecutionHeight != height || tx.BlockNum != height || tx.Hash != consensus.SignedTransactionHash(wire) || history.ABCITransactionHash != consensus.SignedTransactionHash(payload) {
		return errors.New("original PQ history provenance, height or identity mismatch")
	}
	if err := consensus.ValidatePQWalletAccountView(auth, tx.From); err != nil {
		return err
	}
	if auth.Policy == nil || tx.Nonce == 0 || tx.Nonce > auth.LedgerNonce || tx.Timestamp.IsZero() || tx.Timestamp.Location().String() != "UTC" {
		return errors.New("original PQ history lacks committed policy, nonce or timestamp")
	}
	// Neither executor produces these unsigned metadata fields for a standalone
	// transfer/migration. Do not turn a valid signature into fabricated receipts.
	if tx.BlockHash != "" || len(tx.Logs) != 0 || len(tx.LotFlows) != 0 || tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" {
		return errors.New("original PQ history contains unexecuted metadata")
	}
	historyKind, historyWire, historyPayload, err := pqMemberHistoryWire(history)
	if err != nil || historyKind != kind || !bytes.Equal(historyWire, wire) || !bytes.Equal(historyPayload, payload) {
		return errors.New("committed original differs from indexed PQ envelope")
	}
	// This shared pure validator checks the exact execution fields and performs
	// real dual signature verification at ORIGINAL H. Later rotations/revocations
	// do not reclassify an old lawful transaction under today's authorization.
	return chain.ValidateConsensusHistoricalPQTransaction(tx, auth.Policy, height, auth.NativeChainID)
}

func (g *Gateway) queryPQMemberHistory(ctx context.Context, hash string) (consensus.PQWalletHistoryView, int64, error) {
	var history consensus.PQWalletHistoryView
	height, err := g.queryPQWalletJSON(ctx, consensus.PQWalletHistoryPath+hash, &history)
	return history, height, err
}

// projectPQMember is the /txs ABCI-hash hook. The returned view retains original
// identities on validation failure; callers must return UNKNOWN and never fall
// through to legacy/native transaction interpretation.
func (g *Gateway) projectPQMember(ctx context.Context, tx cometTx) (PQMemberView, error) {
	envelope, wire, err := consensus.DecodePQTransaction(tx.Tx)
	if err != nil || envelope.Type != consensus.PQTransferType && envelope.Type != consensus.PQMigrationType {
		return PQMemberView{}, errors.New("not a canonical single PQ envelope")
	}
	view := pqMemberIdentity(envelope.Type, wire, tx.Tx)
	// The existing generic /txs decoder does not retain field presence. Re-read
	// the same immutable index with presence checks before reporting index zero.
	// This is a read, never a second submission.
	indexed, err := g.readPQMemberIndex(ctx, view.ABCITransactionHash)
	if err != nil {
		return view, err
	}
	if !strings.EqualFold(indexed.Hash, tx.Hash) || indexed.Height != tx.Height || indexed.Index != tx.Index || indexed.TxResult.Code != tx.TxResult.Code || indexed.TxResult.Log != tx.TxResult.Log || indexed.TxResult.GasUsed != tx.TxResult.GasUsed || !bytes.Equal(indexed.TxResult.Data, tx.TxResult.Data) || !bytes.Equal(indexed.Tx, tx.Tx) {
		return view, errors.New("generic and original Comet index observations disagree")
	}
	return g.projectPQMemberWithHistory(ctx, indexed, nil, 0)
}

func (g *Gateway) readPQMemberIndex(ctx context.Context, hash string) (cometTx, error) {
	var upstream struct {
		Result json.RawMessage `json:"result"`
		Error  *cometRPCError  `json:"error"`
	}
	// Preserve the configured authority on reads as well as writes. No redirect
	// can replace the server whose index is being compared to committed history.
	httpClient := *g.client.httpClient
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	c := *g.client
	c.httpClient = &httpClient
	if err := c.get(ctx, "/tx", url.Values{"hash": {hash}, "prove": {"true"}}, &upstream); err != nil {
		return cometTx{}, err
	}
	if upstream.Error != nil {
		return cometTx{}, errors.New(cometError(upstream.Error))
	}
	var result struct {
		Hash     *string `json:"hash"`
		Height   *string `json:"height"`
		Index    *uint32 `json:"index"`
		Tx       []byte  `json:"tx"`
		TxResult *struct {
			// Comet's actual ExecTxResult tags code with omitempty, so missing
			// code is valid success only with the required result object, exact
			// Data identity and separately checked successful committed history.
			Code    uint32 `json:"code"`
			Data    []byte `json:"data"`
			Log     string `json:"log"`
			GasUsed string `json:"gas_used"`
		} `json:"tx_result"`
	}
	if err := json.Unmarshal(upstream.Result, &result); err != nil {
		return cometTx{}, err
	}
	if result.Hash == nil || result.Height == nil || result.Index == nil || result.TxResult == nil || len(result.Tx) == 0 {
		return cometTx{}, errors.New("original Comet index lacks explicit hash, height, index, transaction or result")
	}
	if !strings.EqualFold(*result.Hash, strings.TrimPrefix(hash, "0x")) {
		return cometTx{}, errors.New("original Comet index returned a different requested hash")
	}
	return cometTx{Hash: *result.Hash, Height: *result.Height, Index: *result.Index, Tx: result.Tx, TxResult: cometTxResult{Code: result.TxResult.Code, Data: result.TxResult.Data, Log: result.TxResult.Log, GasUsed: result.TxResult.GasUsed}}, nil
}

func (g *Gateway) projectPQMemberWithHistory(ctx context.Context, tx cometTx, known *consensus.PQWalletHistoryView, queryHeight int64) (PQMemberView, error) {
	envelope, wire, err := consensus.DecodePQTransaction(tx.Tx)
	if err != nil || envelope.Type != consensus.PQTransferType && envelope.Type != consensus.PQMigrationType {
		return PQMemberView{}, errors.New("not a canonical single PQ envelope")
	}
	view := pqMemberIdentity(envelope.Type, wire, tx.Tx)
	if _, payload, err := decodeIngressPQMember(envelope.Type, wire); err != nil || !bytes.Equal(payload, tx.Tx) {
		return view, errors.New("indexed PQ transaction is outside the supported ingress profile")
	}
	if !strings.EqualFold(tx.Hash, strings.TrimPrefix(view.ABCITransactionHash, "0x")) {
		return view, errors.New("indexed Comet hash differs from original PQ envelope")
	}
	height, err := strconv.ParseUint(tx.Height, 10, 64)
	if err != nil || height == 0 || strconv.FormatUint(height, 10) != tx.Height {
		return view, errors.New("invalid indexed PQ execution height")
	}
	if tx.TxResult.Code != 0 {
		if len(tx.TxResult.Data) != 0 {
			return view, errors.New("failed single PQ transaction has unexpected execution data")
		}
		view.Status, view.Error, view.ExecutionHeight, view.CometIndex = "rejected", tx.TxResult.Log, height, &tx.Index
		return view, nil
	}
	if !bytes.Equal(tx.TxResult.Data, []byte(view.ABCITransactionHash)) {
		return view, errors.New("successful single PQ result lacks exact ABCI identity data")
	}
	var history consensus.PQWalletHistoryView
	if known == nil {
		history, queryHeight, err = g.queryPQMemberHistory(ctx, view.NativeTransactionHash)
		if err != nil {
			return view, err
		}
	} else {
		history = *known
	}
	if err := validatePQMemberHistory(history, queryHeight, envelope.Type, wire, tx.Tx, height); err != nil {
		return view, err
	}
	view.Status, view.Committed, view.ExecutionHeight, view.CometIndex, view.Transaction = "committed", true, height, &tx.Index, &history.Transaction
	view.From, view.To, view.Amount, view.Fee, view.Nonce = history.Transaction.From, history.Transaction.To, history.Transaction.Amount, history.Transaction.Fee, history.Transaction.Nonce
	return view, nil
}

func (g *Gateway) lookupPQMemberABCI(ctx context.Context, hash string) (PQMemberView, error) {
	tx, err := g.readPQMemberIndex(ctx, hash)
	if err != nil {
		return PQMemberView{}, err
	}
	view, err := g.projectPQMemberWithHistory(ctx, tx, nil, 0)
	if err == nil && view.ABCITransactionHash != hash {
		err = errors.New("original single PQ ABCI lookup hash mismatch")
	}
	return view, err
}

func (g *Gateway) lookupPQOriginal(ctx context.Context, hash string) (PQMemberView, error) {
	view := PQMemberView{Status: "unknown", Source: "comet-rpc", NativeTransactionHash: hash, ReadbackURL: "/transactions/pq/originals/" + hash}
	history, queryHeight, err := g.queryPQMemberHistory(ctx, hash)
	if err != nil {
		return view, err
	}
	if history.Source != "comet-rpc" {
		return view, errors.New("imported source history has no Comet execution index")
	}
	kind, wire, payload, err := pqMemberHistoryWire(history)
	if err != nil || consensus.SignedTransactionHash(wire) != hash {
		return view, errors.New("original PQ history differs from requested native wire hash")
	}
	view = pqMemberIdentity(kind, wire, payload)
	if history.ABCITransactionHash != view.ABCITransactionHash {
		return view, errors.New("committed history outer identity differs from original PQ envelope")
	}
	indexed, err := g.readPQMemberIndex(ctx, view.ABCITransactionHash)
	if err != nil {
		return view, err
	}
	// Explicitly compare bytes before projecting: a server cannot answer a lookup
	// for the original with a different valid transaction signed by the same key.
	if !bytes.Equal(indexed.Tx, payload) {
		return view, errors.New("Comet original lookup returned a different envelope")
	}
	confirmed, err := g.projectPQMemberWithHistory(ctx, indexed, &history, queryHeight)
	if err != nil || !confirmed.Committed {
		if err == nil {
			err = errors.New("committed PQ history disagrees with indexed rejection")
		}
		return view, err
	}
	return confirmed, nil
}

func (g *Gateway) handlePQMemberBroadcast(w http.ResponseWriter, r *http.Request) {
	g.handlePQSingleBroadcast(w, r, consensus.PQTransferType)
}

func (g *Gateway) handlePQMigrationBroadcast(w http.ResponseWriter, r *http.Request) {
	g.handlePQSingleBroadcast(w, r, consensus.PQMigrationType)
}

func (g *Gateway) handlePQSingleBroadcast(w http.ResponseWriter, r *http.Request, kind string) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" || kind == consensus.PQMigrationType && !accountaddress.IsCanonical(r.PathValue("address")) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical migration owner and no query parameters are required"})
		return
	}
	if strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])) != "application/octet-stream" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/octet-stream is required"})
		return
	}
	limit := int64(MaxPQMemberIngressBytes)
	if kind == consensus.PQMigrationType {
		limit = ynxauth.MaxMigrationBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	wire, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "PQ original exceeds bounded ingress profile"})
		return
	}
	owner, payload, err := decodeIngressPQMember(kind, wire)
	if err != nil || kind == consensus.PQMigrationType && owner != r.PathValue("address") {
		if err == nil {
			err = errors.New("migration route owner differs from signed intent")
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	view := pqMemberIdentity(kind, wire, payload)
	unknown := func(err error) { view.Error = err.Error(); writeJSON(w, http.StatusAccepted, view) }
	var broadcast cometBroadcast
	// Exactly one POST. Transport failure, timeout and UNKNOWN never authorize a
	// second submission, a redirected write, or a newly signed replacement.
	if err := g.client.postBroadcast(r.Context(), payload, &broadcast); err != nil {
		unknown(err)
		return
	}
	if broadcast.Error != nil {
		unknown(errors.New(cometError(broadcast.Error)))
		return
	}
	if !strings.EqualFold(broadcast.Result.Hash, strings.TrimPrefix(view.ABCITransactionHash, "0x")) {
		unknown(errors.New("Comet broadcast hash differs from original PQ envelope"))
		return
	}
	if broadcast.Result.CheckTx.Code != 0 {
		if len(broadcast.Result.CheckTx.Data) != 0 {
			unknown(errors.New("single PQ CheckTx rejection has unexpected execution data"))
			return
		}
		view.Status, view.Error = "rejected", broadcast.Result.CheckTx.Log
		writeJSON(w, http.StatusUnprocessableEntity, view)
		return
	}
	height, err := strconv.ParseUint(broadcast.Result.Height, 10, 64)
	if err != nil || height == 0 || strconv.FormatUint(height, 10) != broadcast.Result.Height {
		unknown(errors.New("Comet broadcast lacks a canonical execution height"))
		return
	}
	confirmed, err := g.lookupPQMemberABCI(r.Context(), view.ABCITransactionHash)
	if err != nil {
		unknown(err)
		return
	}
	if confirmed.NativeTransactionHash != view.NativeTransactionHash || !bytes.Equal(confirmed.Wire, wire) || confirmed.ExecutionHeight != height {
		unknown(errors.New("broadcast and original readback identity or height disagree"))
		return
	}
	if broadcast.Result.TxResult.Code != 0 {
		if confirmed.Status != "rejected" || len(broadcast.Result.TxResult.Data) != 0 || confirmed.Error != broadcast.Result.TxResult.Log {
			unknown(errors.New("broadcast and indexed rejection disagree"))
			return
		}
		writeJSON(w, http.StatusUnprocessableEntity, confirmed)
		return
	}
	if !confirmed.Committed || !bytes.Equal(broadcast.Result.TxResult.Data, []byte(view.ABCITransactionHash)) {
		unknown(errors.New("broadcast and committed original execution disagree"))
		return
	}
	writeJSON(w, http.StatusOK, confirmed)
}

func (g *Gateway) handlePQOriginal(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	hash := r.PathValue("hash")
	if !transactionHashPattern.MatchString(hash) || r.URL.RawQuery != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical native original wire hash and no query parameters are required"})
		return
	}
	view, err := g.lookupPQOriginal(r.Context(), hash)
	if err != nil {
		view.Status, view.Committed, view.Transaction, view.ExecutionHeight, view.CometIndex, view.Error = "unknown", false, nil, 0, nil, err.Error()
		writeJSON(w, http.StatusAccepted, view)
		return
	}
	writeJSON(w, http.StatusOK, view)
}
