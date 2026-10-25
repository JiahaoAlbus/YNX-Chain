package bftgateway

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	cmttypes "github.com/cometbft/cometbft/types"
)

// PQ Ethereum values use integer YNXT and original Member/ABCI SHA256 hashes.
// They are not signed RLP, have no Keccak transaction identity or ECDSA V/R/S.
type PQEthereumValueView struct {
	Type                  string                                 `json:"type"`
	Profile               string                                 `json:"profile"`
	Status                string                                 `json:"status"`
	Submitted             bool                                   `json:"submitted"`
	Committed             bool                                   `json:"committed"`
	Source                string                                 `json:"source"`
	NativeTransactionHash string                                 `json:"nativeTransactionHash"`
	ABCITransactionHash   string                                 `json:"abciTransactionHash,omitempty"`
	Wire                  []byte                                 `json:"wire,omitempty"`
	Transport             []byte                                 `json:"transport,omitempty"`
	ExecutionHeight       uint64                                 `json:"executionHeight,string"`
	CometIndex            *uint32                                `json:"cometIndex,string,omitempty"`
	From                  string                                 `json:"from,omitempty"`
	To                    string                                 `json:"to,omitempty"`
	TransactionType       uint32                                 `json:"transactionType,string"`
	Value                 uint64                                 `json:"value,string"`
	Nonce                 uint64                                 `json:"nonce,string"`
	ConsumedNonce         uint64                                 `json:"consumedNonce,string"`
	GasLimit              uint64                                 `json:"gasLimit,string"`
	GasPrice              uint64                                 `json:"gasPrice,string"`
	MaxPriorityFeePerGas  uint64                                 `json:"maxPriorityFeePerGas,string"`
	MaxFeePerGas          uint64                                 `json:"maxFeePerGas,string"`
	EffectiveGasPrice     uint64                                 `json:"effectiveGasPrice,string"`
	Fee                   uint64                                 `json:"fee,string"`
	Original              *consensus.PQEthereumValueOriginalView `json:"original,omitempty"`
	ReadbackURL           string                                 `json:"readbackUrl"`
	ABCIReadbackURL       string                                 `json:"abciReadbackUrl,omitempty"`
	Error                 string                                 `json:"error,omitempty"`
	transaction           chain.Transaction
	indexed               cometTx
}

func pqEthereumIdentity(wire, raw []byte, intent ynxauth.EthereumValueIntent) PQEthereumValueView {
	nativeHash, abciHash := consensus.SignedTransactionHash(wire), consensus.SignedTransactionHash(raw)
	price := intent.GasPrice
	if intent.TxType == 2 {
		price = intent.MaxPriorityFeePerGas
	}
	return PQEthereumValueView{Type: consensus.PQEthereumValueType, Profile: intent.Profile, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: nativeHash, ABCITransactionHash: abciHash, Wire: bytes.Clone(wire), Transport: bytes.Clone(raw), From: intent.Owner, To: intent.To, TransactionType: intent.TxType, Value: intent.Value, Nonce: intent.Nonce, GasLimit: intent.GasLimit, GasPrice: intent.GasPrice, MaxPriorityFeePerGas: intent.MaxPriorityFeePerGas, MaxFeePerGas: intent.MaxFeePerGas, EffectiveGasPrice: price, Fee: price * intent.GasLimit, ReadbackURL: "/transactions/pq/ethereum/originals/" + nativeHash, ABCIReadbackURL: "/transactions/pq/ethereum/" + abciHash}
}

func isPQEthereumEnvelope(raw []byte) bool {
	kind, err := consensus.TransactionEnvelopeType(raw)
	return err == nil && kind == consensus.PQEthereumValueType
}

func decodeIngressPQEthereum(body []byte, contentType string) ([]byte, []byte, ynxauth.EthereumValueIntent, error) {
	raw := body
	if contentType == "application/octet-stream" {
		var err error
		raw, err = consensus.EncodePQTransaction(consensus.PQEthereumValueType, body)
		if err != nil {
			return nil, nil, ynxauth.EthereumValueIntent{}, err
		}
	}
	wire, intent, err := consensus.DecodePQEthereumValueTransaction(raw)
	return wire, raw, intent, err
}

func (g *Gateway) queryPQEthereumOriginal(ctx context.Context, hash string) (consensus.PQEthereumValueOriginalView, int64, error) {
	var v consensus.PQEthereumValueOriginalView
	h, err := g.queryPQWalletJSON(ctx, consensus.PQEthereumValueOriginalPath+hash, &v)
	return v, h, err
}

// Fetch raw block evidence directly to avoid a recursive block-projection
// lookup. Match ORIGINAL Comet index, bytes, data hash, time, result and gas.
// This verifies consistency at the configured RPC, not an independent header.
func (g *Gateway) verifyPQEthereumBlock(ctx context.Context, indexed cometTx, height uint64, tx chain.Transaction) (string, error) {
	// Original bytes, policy and block evidence stay on the configured RPC
	// authority. Do not mutate redirect behavior for unrelated legacy clients.
	httpClient := *g.client.httpClient
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	c := *g.client
	c.httpClient = &httpClient
	var block cometBlock
	if err := c.getBounded(ctx, "/block", url.Values{"height": {strconv.FormatUint(height, 10)}}, &block, cometBlockReadBytes); err != nil {
		return "", err
	}
	if block.Error != nil {
		return "", errors.New(cometError(block.Error))
	}
	b := block.Result.Block
	blockHash := strings.ToLower(block.Result.BlockID.Hash)
	if b.Header.Height != strconv.FormatUint(height, 10) || !blockHashPattern.MatchString(blockHash) || !blockHashPattern.MatchString(strings.ToLower(b.Header.AppHash)) || !b.Header.Time.Equal(tx.Timestamp) || uint64(indexed.Index) >= uint64(len(b.Data.Txs)) || !bytes.Equal(b.Data.Txs[indexed.Index], indexed.Tx) {
		return "", errors.New("PQ Ethereum block original index, time or header mismatch")
	}
	txs := make(cmttypes.Txs, len(b.Data.Txs))
	for i, raw := range b.Data.Txs {
		txs[i] = cmttypes.Tx(raw)
	}
	if !strings.EqualFold(b.Header.DataHash, hex.EncodeToString(txs.Hash())) {
		return "", errors.New("PQ Ethereum block data hash differs from complete raw transactions")
	}
	var results cometBlockResults
	if err := c.getBounded(ctx, "/block_results", url.Values{"height": {strconv.FormatUint(height, 10)}}, &results, cometBlockReadBytes); err != nil {
		return "", err
	}
	if results.Error != nil {
		return "", errors.New(cometError(results.Error))
	}
	if results.Result.Height != indexed.Height || len(results.Result.TxsResults) != len(b.Data.Txs) {
		return "", errors.New("PQ Ethereum complete block result height/count mismatch")
	}
	result := results.Result.TxsResults[indexed.Index]
	gas, err := parseCometGas(result.GasUsed)
	if err != nil || result.Code != 0 || gas != ynxauth.EthereumValueTransferGasLimit || !bytes.Equal(result.Data, indexed.TxResult.Data) || result.Code != indexed.TxResult.Code || result.GasUsed != indexed.TxResult.GasUsed {
		return "", errors.New("PQ Ethereum block result differs from successful indexed execution")
	}
	return blockHash, nil
}

func (g *Gateway) projectPQEthereum(ctx context.Context, indexed cometTx, known *consensus.PQEthereumValueOriginalView, queryHeight int64) (PQEthereumValueView, error) {
	wire, intent, err := consensus.DecodePQEthereumValueTransaction(indexed.Tx)
	if err != nil {
		return PQEthereumValueView{}, err
	}
	v := pqEthereumIdentity(wire, indexed.Tx, intent)
	if !strings.EqualFold(indexed.Hash, strings.TrimPrefix(v.ABCITransactionHash, "0x")) {
		return v, errors.New("PQ Ethereum indexed hash differs from original outer transport")
	}
	h, err := strconv.ParseUint(indexed.Height, 10, 64)
	if err != nil || h == 0 || strconv.FormatUint(h, 10) != indexed.Height {
		return v, errors.New("invalid PQ Ethereum indexed height")
	}
	if indexed.TxResult.Code != 0 {
		if len(indexed.TxResult.Data) != 0 {
			return v, errors.New("rejected PQ Ethereum acquired execution identity")
		}
		v.Status, v.Error, v.ExecutionHeight, v.CometIndex = "rejected", indexed.TxResult.Log, h, &indexed.Index
		return v, nil
	}
	gas, err := parseCometGas(indexed.TxResult.GasUsed)
	if err != nil || gas != intent.GasLimit || indexed.TxResult.GasUsed != strconv.FormatUint(intent.GasLimit, 10) || !bytes.Equal(indexed.TxResult.Data, []byte(v.ABCITransactionHash)) {
		return v, errors.New("PQ Ethereum successful index has wrong gas or identity")
	}
	var original consensus.PQEthereumValueOriginalView
	if known == nil {
		original, queryHeight, err = g.queryPQEthereumOriginal(ctx, v.NativeTransactionHash)
		if err != nil {
			return v, err
		}
	} else {
		original = *known
	}
	tx, _, err := consensus.ValidatePQEthereumValueOriginalView(original, queryHeight)
	if err != nil {
		return v, err
	}
	if original.NativeTransactionHash != v.NativeTransactionHash || original.ABCITransactionHash != v.ABCITransactionHash || original.ExecutionHeight != h || !bytes.Equal(original.Transport, indexed.Tx) || !bytes.Equal(original.Wire, wire) {
		return v, errors.New("PQ Ethereum committed original differs from indexed bytes or height")
	}
	blockHash, err := g.verifyPQEthereumBlock(ctx, indexed, h, tx)
	if err != nil {
		return v, err
	}
	tx.BlockHash = blockHash
	v.Status, v.Committed, v.ExecutionHeight, v.CometIndex, v.ConsumedNonce = "committed", true, h, &indexed.Index, tx.Nonce
	v.Original, v.transaction, v.indexed = &original, tx, indexed
	return v, nil
}

func (g *Gateway) lookupPQEthereumABCI(ctx context.Context, hash string) (PQEthereumValueView, error) {
	v := PQEthereumValueView{Type: consensus.PQEthereumValueType, Status: "unknown", Source: "comet-rpc", ABCITransactionHash: hash, ABCIReadbackURL: "/transactions/pq/ethereum/" + hash}
	indexed, err := g.readPQMemberIndex(ctx, hash)
	if err != nil {
		return v, err
	}
	return g.projectPQEthereum(ctx, indexed, nil, 0)
}

func (g *Gateway) lookupPQEthereumOriginal(ctx context.Context, hash string) (PQEthereumValueView, error) {
	v := PQEthereumValueView{Type: consensus.PQEthereumValueType, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: hash, ReadbackURL: "/transactions/pq/ethereum/originals/" + hash}
	original, h, err := g.queryPQEthereumOriginal(ctx, hash)
	if err != nil {
		return v, err
	}
	if original.NativeTransactionHash != hash {
		return v, errors.New("PQ Ethereum original lookup returned another native hash")
	}
	if _, _, err = consensus.ValidatePQEthereumValueOriginalView(original, h); err != nil {
		return v, err
	}
	indexed, err := g.readPQMemberIndex(ctx, original.ABCITransactionHash)
	if err != nil {
		return v, err
	}
	confirmed, err := g.projectPQEthereum(ctx, indexed, &original, h)
	if err == nil && !confirmed.Committed {
		err = errors.New("PQ Ethereum committed original disagrees with indexed rejection")
	}
	return confirmed, err
}

func (g *Gateway) handlePQEthereumBroadcast(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" {
		writeJSON(w, 400, map[string]string{"error": "PQ Ethereum broadcast accepts no query parameters"})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if ct != "application/octet-stream" && ct != "application/json" {
		writeJSON(w, 415, map[string]string{"error": "expected full Member octet-stream or canonical PQTransaction JSON"})
		return
	}
	limit := int64(consensus.MaxPQEthereumMemberBytes)
	if ct == "application/json" {
		limit = int64(consensus.MaxPQEthereumTransactionBytes)
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		writeJSON(w, 413, map[string]string{"error": "PQ Ethereum original exceeds transport bound"})
		return
	}
	wire, raw, intent, err := decodeIngressPQEthereum(body, ct)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	v := pqEthereumIdentity(wire, raw, intent)
	reject := func(status int, err error) { v.Status, v.Error = "rejected", err.Error(); writeJSON(w, status, v) }
	auth, err := g.queryPQWalletAuthorization(r.Context(), intent.Owner)
	if err != nil {
		reject(502, err)
		return
	}
	if auth.Policy == nil || !auth.PQSigningEnabled || intent.NativeChainID != uint64(auth.NativeChainID) || !bytes.Equal(intent.ChainID, auth.Policy.NetworkID) || intent.Nonce != auth.LedgerNonce {
		reject(422, errors.New("PQ Ethereum current account policy, network or nonce mismatch"))
		return
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		reject(400, err)
		return
	}
	if err = chain.NewPQCertificateCache().VerifyDecodedMember(auth.Policy, intent.Owner, ynxauth.TransactionPurpose, member.Message, member, auth.ExecutionHeight); err != nil {
		reject(422, err)
		return
	}
	// Parsing/policy preflight grants no execution. The Application repeats it
	// at actual H. Exactly one POST; UNKNOWN is recovered only by original read.
	v.Submitted = true
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
		unknown(errors.New("PQ Ethereum broadcast hash mismatch"))
		return
	}
	if broadcast.Result.CheckTx.Code != 0 {
		if len(broadcast.Result.CheckTx.Data) != 0 {
			unknown(errors.New("PQ Ethereum rejected CheckTx has identity data"))
			return
		}
		reject(422, errors.New(broadcast.Result.CheckTx.Log))
		return
	}
	height, err := strconv.ParseUint(broadcast.Result.Height, 10, 64)
	if err != nil || height == 0 || strconv.FormatUint(height, 10) != broadcast.Result.Height {
		unknown(errors.New("PQ Ethereum broadcast height invalid"))
		return
	}
	confirmed, err := g.lookupPQEthereumABCI(r.Context(), v.ABCITransactionHash)
	if err != nil {
		unknown(err)
		return
	}
	if confirmed.NativeTransactionHash != v.NativeTransactionHash || !bytes.Equal(confirmed.Wire, wire) || confirmed.ExecutionHeight != height {
		unknown(errors.New("PQ Ethereum broadcast and original readback disagree"))
		return
	}
	confirmed.Submitted = true
	if broadcast.Result.TxResult.Code != 0 {
		if confirmed.Status != "rejected" || len(broadcast.Result.TxResult.Data) != 0 || confirmed.Error != broadcast.Result.TxResult.Log {
			unknown(errors.New("PQ Ethereum rejection evidence disagrees"))
			return
		}
		writeJSON(w, 422, confirmed)
		return
	}
	gas, err := parseCometGas(broadcast.Result.TxResult.GasUsed)
	if err != nil || gas != intent.GasLimit || broadcast.Result.TxResult.GasUsed != strconv.FormatUint(intent.GasLimit, 10) || !confirmed.Committed || !bytes.Equal(broadcast.Result.TxResult.Data, []byte(v.ABCITransactionHash)) {
		unknown(errors.New("PQ Ethereum broadcast success differs from committed result"))
		return
	}
	writeJSON(w, 200, confirmed)
}

func (g *Gateway) handlePQEthereumOriginal(w http.ResponseWriter, r *http.Request) {
	g.handlePQEthereumRead(w, r, true)
}
func (g *Gateway) handlePQEthereumTransaction(w http.ResponseWriter, r *http.Request) {
	g.handlePQEthereumRead(w, r, false)
}
func (g *Gateway) handlePQEthereumRead(w http.ResponseWriter, r *http.Request, original bool) {
	w.Header().Set("Cache-Control", "no-store")
	hash := r.PathValue("hash")
	if !transactionHashPattern.MatchString(hash) || r.URL.RawQuery != "" {
		writeJSON(w, 400, map[string]string{"error": "canonical PQ Ethereum hash and no query parameters required"})
		return
	}
	var v PQEthereumValueView
	var err error
	if original {
		v, err = g.lookupPQEthereumOriginal(r.Context(), hash)
	} else {
		v, err = g.lookupPQEthereumABCI(r.Context(), hash)
	}
	if err != nil {
		v.Status, v.Committed, v.Original, v.ExecutionHeight, v.CometIndex, v.Error = "unknown", false, nil, 0, nil, err.Error()
		writeJSON(w, 202, v)
		return
	}
	writeJSON(w, 200, v)
}

func (g *Gateway) committedPQEthereumOriginal(ctx context.Context, hash string) (cometTx, chain.Transaction, bool, error) {
	v, err := g.lookupPQEthereumOriginal(ctx, hash)
	if err != nil {
		if err.Error() == "PQ Wallet ABCI query rejected: PQ Ethereum original not found" {
			return cometTx{}, chain.Transaction{}, false, nil
		}
		return cometTx{}, chain.Transaction{}, false, err
	}
	return v.indexed, v.transaction, v.Committed, nil
}

func pqEthereumEVMTransaction(tx chain.Transaction, index uint32, wire, raw []byte, intent ynxauth.EthereumValueIntent) map[string]any {
	price := intent.GasPrice
	if intent.TxType == 2 {
		price = intent.MaxPriorityFeePerGas
	}
	v := map[string]any{"hash": tx.Hash, "from": intent.Owner, "to": intent.To, "value": hexEVMQuantity(intent.Value), "nonce": hexEVMQuantity(intent.Nonce), "blockHash": "0x" + strings.TrimPrefix(tx.BlockHash, "0x"), "blockNumber": hexEVMQuantity(tx.BlockNum), "transactionIndex": hexEVMQuantity(uint64(index)), "gas": hexEVMQuantity(intent.GasLimit), "gasPrice": hexEVMQuantity(price), "input": "0x", "type": hexEVMQuantity(uint64(intent.TxType)), "chainId": hexEVMQuantity(intent.NativeChainID), "ynxAuthorization": "pq-and", "ynxProfile": intent.Profile, "ynxNativeTransactionHash": consensus.SignedTransactionHash(wire), "ynxABCITransactionHash": consensus.SignedTransactionHash(raw)}
	if intent.TxType != 0 {
		v["accessList"] = []any{}
	}
	if intent.TxType == 2 {
		v["maxPriorityFeePerGas"] = hexEVMQuantity(intent.MaxPriorityFeePerGas)
		v["maxFeePerGas"] = hexEVMQuantity(intent.MaxFeePerGas)
	}
	return v
}

func pqEthereumEVMReceipt(tx chain.Transaction, index uint32, gas, cumulative uint64, raw []byte, intent ynxauth.EthereumValueIntent) map[string]any {
	price := intent.GasPrice
	if intent.TxType == 2 {
		price = intent.MaxPriorityFeePerGas
	}
	return map[string]any{"transactionHash": tx.Hash, "transactionIndex": hexEVMQuantity(uint64(index)), "blockHash": "0x" + strings.TrimPrefix(tx.BlockHash, "0x"), "blockNumber": hexEVMQuantity(tx.BlockNum), "from": intent.Owner, "to": intent.To, "contractAddress": nil, "cumulativeGasUsed": hexEVMQuantity(cumulative), "gasUsed": hexEVMQuantity(gas), "effectiveGasPrice": hexEVMQuantity(price), "status": "0x1", "type": hexEVMQuantity(uint64(intent.TxType)), "logs": []any{}, "logsBloom": "0x" + strings.Repeat("0", 512), "ynxAuthorization": "pq-and", "ynxProfile": intent.Profile, "ynxNativeTransactionHash": tx.Hash, "ynxABCITransactionHash": consensus.SignedTransactionHash(raw)}
}

// Only resolve a projection already produced by projectPQEthereum. Raw shape
// decoding alone is never authorization and cannot manufacture this evidence.
func mappedPQEthereumAtCometIndex(e committedBlockEvidence, index uint64) (chain.Transaction, error) {
	if index >= uint64(len(e.RawTransactions)) || len(e.MappedTransactionIndexes) != len(e.RawTransactions) {
		return chain.Transaction{}, errors.New("PQ Ethereum original Comet index is missing")
	}
	i := e.MappedTransactionIndexes[index]
	if i < 0 || i >= len(e.Block.Transactions) {
		return chain.Transaction{}, errors.New("PQ Ethereum verified block projection is missing")
	}
	raw := e.RawTransactions[index]
	wire, intent, err := consensus.DecodePQEthereumValueTransaction(raw)
	if err != nil {
		return chain.Transaction{}, err
	}
	tx := e.Block.Transactions[i]
	identity := pqEthereumIdentity(wire, raw, intent)
	if tx.Hash != identity.NativeTransactionHash || tx.Type != consensus.PQEthereumValueType || tx.From != intent.Owner || tx.To != intent.To || tx.Amount != int64(intent.Value) || tx.Fee != int64(identity.Fee) || tx.Nonce != intent.Nonce+1 || tx.BlockNum != e.Block.Height || tx.BlockHash != e.Block.Hash || !tx.Timestamp.Equal(e.Block.Time) {
		return chain.Transaction{}, errors.New("PQ Ethereum projection differs from original raw Comet index")
	}
	return tx, nil
}
