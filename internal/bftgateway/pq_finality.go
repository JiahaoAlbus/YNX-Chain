package bftgateway

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const maxPQFinalityRPCBytes int64 = 4 << 20

// PQFinalityView is a collector observation, not the result of the independently
// anchored consensus proof verifier. A successful response grants no authority.
type PQFinalityView struct {
	Version               string                               `json:"version"`
	Source                string                               `json:"source"`
	Status                string                               `json:"status"`
	NativeTransactionHash string                               `json:"nativeTransactionHash"`
	ABCITransactionHash   string                               `json:"abciTransactionHash,omitempty"`
	ExecutionHeight       uint64                               `json:"executionHeight,string"`
	CometIndex            *uint32                              `json:"cometIndex,omitempty"`
	IndependentFinality   bool                                 `json:"independentFinality"`
	ProofVerification     string                               `json:"proofVerification"`
	Proof                 *consensus.PQTransactionProofRequest `json:"proof,omitempty"`
	Error                 string                               `json:"error,omitempty"`
}

// Decode through Comet's real codec and require its complete field grammar.
// JSON key order/whitespace may vary; duplicate/unknown fields, replaced UTF-8,
// omitted required fields and noncanonical integer/base64 encodings may not.
func pqFinalityDecode(raw []byte, target any) error {
	if !utf8.Valid(raw) || identityUniqueJSON(raw) != nil {
		return errors.New("invalid finality RPC JSON")
	}
	if err := cmtjson.Unmarshal(raw, target); err != nil {
		return errors.New("invalid finality RPC typed result")
	}
	canonical, err := cmtjson.Marshal(target)
	if err != nil {
		return errors.New("cannot encode finality RPC typed result")
	}
	decode := func(b []byte) (any, error) {
		d := json.NewDecoder(bytes.NewReader(b))
		d.UseNumber()
		var v any
		err := d.Decode(&v)
		return v, err
	}
	a, err := decode(raw)
	b, other := decode(canonical)
	if err != nil || other != nil || !reflect.DeepEqual(a, b) {
		return errors.New("noncanonical or unknown finality RPC fields")
	}
	return nil
}

func pqFinalityEnvelope(raw []byte) (json.RawMessage, error) {
	if !utf8.Valid(raw) || identityUniqueJSON(raw) != nil {
		return nil, errors.New("invalid finality RPC envelope JSON")
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&envelope) != nil || envelope.JSONRPC != "2.0" || len(envelope.ID) == 0 || bytes.Equal(envelope.ID, []byte("null")) || len(envelope.Error) != 0 && !bytes.Equal(envelope.Error, []byte("null")) || len(envelope.Result) == 0 || bytes.Equal(envelope.Result, []byte("null")) {
		return nil, errors.New("configured finality RPC result unavailable or malformed")
	}
	var id any
	ids := json.NewDecoder(bytes.NewReader(envelope.ID))
	ids.UseNumber()
	if ids.Decode(&id) != nil {
		return nil, errors.New("invalid finality RPC response ID")
	}
	switch id.(type) {
	case string, json.Number:
	default:
		return nil, errors.New("invalid finality RPC response ID type")
	}
	return bytes.Clone(envelope.Result), nil
}

// The existing original lookup is retained, but all of its HTTP reads pass
// through the same strict collector boundary before its legacy projections.
// This wrapper exists only for this request and has no cache or retry behavior.
type pqFinalityLookupTransport struct{ base http.RoundTripper }

func (t pqFinalityLookupTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var target any
	limit := maxPQFinalityRPCBytes
	switch req.URL.Path {
	case "/tx":
		target = &coretypes.ResultTx{}
	case "/abci_query":
		target = &coretypes.ResultABCIQuery{}
		limit = int64((consensus.MaxPQWalletQueryBytes+2)/3*4 + (64 << 10))
	default:
		return nil, errors.New("unexpected finality original lookup path")
	}
	if req.Method != http.MethodGet {
		return nil, errors.New("finality collector is read-only")
	}
	response, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, errors.New("configured finality original lookup failed")
	}
	raw, readErr := readCometBody(response.Body, limit)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || readErr != nil {
		return nil, errors.New("finality original lookup unavailable or oversized")
	}
	result, err := pqFinalityEnvelope(raw)
	if err != nil {
		return nil, err
	}
	if err = pqFinalityDecode(result, target); err != nil {
		return nil, err
	}
	if query, ok := target.(*coretypes.ResultABCIQuery); ok && (!utf8.Valid(query.Response.Value) || identityUniqueJSON(query.Response.Value) != nil) {
		return nil, errors.New("invalid original committed history JSON")
	}
	response.Body = io.NopCloser(bytes.NewReader(raw))
	return response, nil
}

func (g *Gateway) finalityOriginal(ctx context.Context, hash string) (PQMemberView, error) {
	client, transport := *g.client.httpClient, g.client.httpClient.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	client.Transport = pqFinalityLookupTransport{base: transport}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	rpc, gateway := *g.client, *g
	rpc.httpClient = &client
	gateway.client = &rpc
	return gateway.lookupPQOriginal(ctx, hash)
}

func (g *Gateway) finalityRPC(ctx context.Context, path string, query url.Values, limit int64, target any) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.client.baseURL+path+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	client := *g.client.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("configured finality RPC read failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("configured finality RPC HTTP result unavailable")
	}
	raw, err := readCometBody(response.Body, limit)
	if err != nil {
		return nil, err
	}
	result, err := pqFinalityEnvelope(raw)
	if err == nil {
		err = pqFinalityDecode(result, target)
	}
	return result, err
}

func (g *Gateway) finalityBlock(ctx context.Context, height int64) (consensus.PQLightProofRequest, coretypes.ResultCommit, error) {
	proof := consensus.PQLightProofRequest{Version: consensus.PQLightProofVersion}
	var commit coretypes.ResultCommit
	var validators coretypes.ResultValidators
	query := url.Values{"height": {strconv.FormatInt(height, 10)}}
	var err error
	proof.CommitResult, err = g.finalityRPC(ctx, "/commit", query, maxPQIdentityCommitBytes, &commit)
	if err != nil {
		return proof, commit, err
	}
	if commit.Header == nil || commit.Commit == nil || commit.Height != height || commit.ChainID == "" || commit.Time.IsZero() || commit.SignedHeader.ValidateBasic(commit.ChainID) != nil || len(commit.Header.AppHash) != 32 || len(commit.ConsensusHash) != 32 || len(commit.NextValidatorsHash) != 32 {
		return proof, commit, errors.New("finality commit differs from requested height or valid header")
	}
	query.Set("page", "1")
	query.Set("per_page", strconv.Itoa(maxPQIdentityValidators))
	proof.ValidatorsResult, err = g.finalityRPC(ctx, "/validators", query, maxPQIdentityValidatorsBytes, &validators)
	if err != nil {
		return proof, commit, err
	}
	if validators.BlockHeight != height || validators.Count == 0 || validators.Count > maxPQIdentityValidators || validators.Count != validators.Total || validators.Count != len(validators.Validators) || len(commit.Commit.Signatures) != validators.Count {
		return proof, commit, errors.New("finality validator set is incomplete or from another height")
	}
	var total, signed int64
	seen := make(map[string]bool, validators.Count)
	for i, v := range validators.Validators {
		if v == nil || v.ValidateBasic() != nil || v.VotingPower <= 0 || v.VotingPower > cmttypes.MaxTotalVotingPower-total || seen[string(v.Address)] {
			return proof, commit, errors.New("invalid finality validator identity or power")
		}
		seen[string(v.Address)] = true
		total += v.VotingPower
		sig := commit.Commit.Signatures[i]
		if sig.BlockIDFlag != cmttypes.BlockIDFlagAbsent && !bytes.Equal(sig.ValidatorAddress, v.Address) {
			return proof, commit, errors.New("finality commit validator index mismatch")
		}
		if sig.BlockIDFlag == cmttypes.BlockIDFlagCommit {
			signed += v.VotingPower
		}
	}
	set := cmttypes.ValidatorSet{Validators: validators.Validators}
	if !sort.IsSorted(cmttypes.ValidatorsByVotingPower(validators.Validators)) || signed <= total*2/3 || !bytes.Equal(set.Hash(), commit.Header.ValidatorsHash) {
		return proof, commit, errors.New("finality commit lacks matching full validator root or structural quorum")
	}
	return proof, commit, nil
}

func (g *Gateway) collectPQFinality(ctx context.Context, hash string) (PQFinalityView, error) {
	view := PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "unavailable", NativeTransactionHash: hash, ProofVerification: "not-performed"}
	original, err := g.finalityOriginal(ctx, hash)
	if err != nil {
		return view, err
	}
	if !original.Committed || original.ExecutionHeight == 0 || original.ExecutionHeight >= math.MaxInt64 || original.CometIndex == nil {
		return view, errors.New("successful original PQ execution unavailable")
	}
	view.ABCITransactionHash, view.ExecutionHeight, view.CometIndex = original.ABCITransactionHash, original.ExecutionHeight, original.CometIndex
	h := int64(original.ExecutionHeight)
	var tx coretypes.ResultTx
	if _, err = g.finalityRPC(ctx, "/tx", url.Values{"hash": {original.ABCITransactionHash}, "prove": {"true"}}, maxPQFinalityRPCBytes, &tx); err != nil {
		return view, err
	}
	_, payload, err := decodeIngressPQMember(original.Type, original.Wire)
	if err != nil || tx.Height != h || tx.Index != *original.CometIndex || !bytes.Equal(tx.Tx, payload) || consensus.SignedTransactionHash(tx.Tx) != original.ABCITransactionHash || !bytes.Equal(tx.Hash, tx.Tx.Hash()) || tx.TxResult.Code != 0 || !bytes.Equal(tx.TxResult.Data, []byte(original.ABCITransactionHash)) {
		return view, errors.New("finality indexed transaction differs from committed original")
	}
	block, first, err := g.finalityBlock(ctx, h)
	if err != nil {
		return view, err
	}
	if tx.Proof.Proof.ValidateBasic() != nil || tx.Proof.Proof.Index != int64(tx.Index) || tx.Proof.Proof.Total <= int64(tx.Index) || !bytes.Equal(tx.Proof.Data, tx.Tx) || tx.Proof.Validate(first.DataHash) != nil {
		return view, errors.New("invalid original transaction inclusion proof")
	}
	var results coretypes.ResultBlockResults
	if _, err = g.finalityRPC(ctx, "/block_results", url.Values{"height": {strconv.FormatInt(h, 10)}}, maxPQFinalityRPCBytes, &results); err != nil {
		return view, err
	}
	if results.Height != h || len(results.TxsResults) == 0 || len(results.TxsResults) > 10000 || int64(len(results.TxsResults)) != tx.Proof.Proof.Total {
		return view, errors.New("finality results height or total differs from transaction proof")
	}
	for _, result := range results.TxsResults {
		if result == nil {
			return view, errors.New("missing actual block execution result")
		}
	}
	deterministic := cmttypes.NewResults(results.TxsResults)
	actual, err := deterministic[int(tx.Index)].Marshal()
	indexed, indexErr := cmttypes.NewResults([]*abci.ExecTxResult{&tx.TxResult})[0].Marshal()
	if err != nil || indexErr != nil || !bytes.Equal(actual, indexed) {
		return view, errors.New("indexed and block deterministic execution results differ")
	}
	var status coretypes.ResultStatus
	if _, err = g.finalityRPC(ctx, "/status", nil, 64<<10, &status); err != nil {
		return view, err
	}
	info := status.SyncInfo
	if status.NodeInfo.Network != first.ChainID || info.LatestBlockHeight < h || info.EarliestBlockHeight <= 0 || info.EarliestBlockHeight > h || len(info.LatestBlockHash) != 32 || len(info.EarliestBlockHash) != 32 {
		return view, errors.New("finality RPC status chain or retained history boundary mismatch")
	}
	if info.LatestBlockHeight == h {
		if !bytes.Equal(info.LatestBlockHash, first.Header.Hash()) {
			return view, errors.New("pending successor status differs from actual execution block")
		}
		view.Status = "pending"
		return view, nil
	}
	successor, next, err := g.finalityBlock(ctx, h+1)
	if err != nil {
		return view, err
	}
	if first.ChainID != next.ChainID || !next.LastBlockID.Equals(first.Commit.BlockID) || !bytes.Equal(next.LastCommitHash, first.Commit.Hash()) || !bytes.Equal(first.NextValidatorsHash, next.ValidatorsHash) || !next.Time.After(first.Time) || !bytes.Equal(next.LastResultsHash, deterministic.Hash()) || !bytes.Equal(results.AppHash, next.AppHash) {
		return view, errors.New("successor header does not commit the original block and execution results")
	}
	txProof, err := cmtjson.Marshal(tx.Proof)
	if err != nil {
		return view, err
	}
	execution, executionProof, err := consensus.EncodePQTransactionExecutionProof(results.TxsResults, int(tx.Index))
	if err != nil {
		return view, err
	}
	view.Proof = &consensus.PQTransactionProofRequest{Version: consensus.PQTransactionProofVersion, Block: block, Successor: successor, TransactionProof: txProof, ExecutionResult: execution, ExecutionProof: executionProof}
	view.Status = "collected"
	return view, nil
}

func (g *Gateway) handlePQFinality(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	hash := r.PathValue("hash")
	b, err := hex.DecodeString(strings.TrimPrefix(hash, "0x"))
	if r.URL.RawQuery != "" || err != nil || len(b) != 32 || "0x"+hex.EncodeToString(b) != hash {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical native SHA256 hash and no query parameters are required"})
		return
	}
	view, err := g.collectPQFinality(r.Context(), hash)
	if err != nil {
		view.Error = err.Error()
		writeJSON(w, http.StatusBadGateway, view)
		return
	}
	status := http.StatusOK
	if view.Status == "pending" {
		status = http.StatusAccepted
	}
	writeJSON(w, status, view)
}
