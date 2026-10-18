package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// This ingress profile fits the existing 1 MiB Comet mempool limit and the
// existing decimal 1,000,000-byte RPC body limit. It does not enlarge either.
// Canonical native transfers are 230 bytes, for N=1..1024 (powers of two).
const (
	MaxPQWholeIngressBytes  = 297196
	MaxPQWholeEnvelopeBytes = 594436
)

// PQWholeView is ONE Comet transaction container, never an Ethereum transaction
// or N fabricated Comet transactions. Results retain the native member hashes.
// Evidence comes from the configured Comet RPC, not a light-client verification.
type PQWholeView struct {
	Type                string                      `json:"type"`
	Status              string                      `json:"status"`
	Committed           bool                        `json:"committed"`
	Provenance          string                      `json:"provenance"`
	ABCITransactionHash string                      `json:"abciTransactionHash,omitempty"`
	BatchHash           string                      `json:"batchHash,omitempty"`
	ExecutionHeight     uint64                      `json:"executionHeight,string"`
	CometIndex          *uint32                     `json:"cometIndex,omitempty"`
	FeeYNXT             uint64                      `json:"feeYNXT,omitempty"`
	Results             []chain.PQBatchMemberResult `json:"results,omitempty"`
	Whole               []byte                      `json:"whole,omitempty"`
	ReadbackURL         string                      `json:"readbackUrl,omitempty"`
	Error               string                      `json:"error,omitempty"`
}

func wholeIdentity(wire, payload []byte) PQWholeView {
	hash := consensus.SignedTransactionHash(payload)
	return PQWholeView{Type: consensus.PQWholeType, Status: "unknown", Provenance: "comet-rpc", ABCITransactionHash: hash, BatchHash: consensus.SignedTransactionHash(wire), ReadbackURL: "/transactions/pq/wholes/" + hash}
}

func decodeIngressWhole(wire []byte) (ynxbatch.Whole, []byte, error) {
	if len(wire) == 0 || len(wire) > MaxPQWholeIngressBytes {
		return ynxbatch.Whole{}, nil, errors.New("Whole exceeds bounded transfer ingress profile")
	}
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil {
		return whole, nil, err
	}
	// DecodeWhole enforces canonical framing, message count and root lengths.
	// Authentication and business eligibility remain the real ABCI's decision.
	if whole.Certificate.Purpose != ynxauth.TransactionPurpose {
		return whole, nil, errors.New("Whole must use TX-BATCH purpose")
	}
	payload, err := consensus.EncodePQTransaction(consensus.PQWholeType, wire)
	if err != nil {
		return whole, nil, err
	}
	if len(payload) > MaxPQWholeEnvelopeBytes {
		return whole, nil, errors.New("Whole envelope exceeds bounded ingress profile")
	}
	return whole, payload, nil
}

func strictPQJSON(data []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("trailing PQ result JSON")
	}
	// These ABCI records use canonical json.Marshal. This also rejects duplicate
	// fields, alternate scalar forms and whitespace, rather than last-wins JSON.
	canonical, err := json.Marshal(out)
	if err != nil || !bytes.Equal(canonical, data) {
		return errors.New("noncanonical PQ result JSON")
	}
	return nil
}

func validatePQResults(whole ynxbatch.Whole, batchHash string, results []chain.PQBatchMemberResult) (uint64, error) {
	if len(results) != len(whole.Messages) {
		return 0, errors.New("PQ member result count mismatch")
	}
	var fee uint64
	for i, result := range results {
		if result.Index != uint32(i) {
			return 0, errors.New("PQ member result index mismatch")
		}
		switch result.Outcome {
		case "admitted":
			expected, err := chain.PQBatchTransactionHash(batchHash, uint32(i))
			if err != nil || result.TransactionHash != expected || result.Error != "" {
				return 0, errors.New("PQ member identity mismatch")
			}
			transfer, err := ynxauth.DecodeTransfer(whole.Messages[i])
			if err != nil || transfer.From != whole.Certificate.Owner || !bytes.Equal(transfer.ChainID, whole.Certificate.ChainID) || transfer.NativeChainID != 6423 || transfer.Fee != 1 {
				return 0, errors.New("admitted PQ member is not a canonical native transfer")
			}
			fee += transfer.Fee
		case "rejected":
			if result.TransactionHash != "" || strings.TrimSpace(result.Error) == "" {
				return 0, errors.New("rejected PQ member has an effect identity or missing reason")
			}
		default:
			return 0, errors.New("invalid PQ member outcome")
		}
	}
	return fee, nil
}

func (g *Gateway) authenticatePQProof(ctx context.Context, proof consensus.PQCommittedBatch) (ynxbatch.Whole, uint64, error) {
	whole, err := ynxbatch.DecodeWhole(proof.Whole)
	if err != nil {
		return whole, 0, err
	}
	if proof.Height == 0 || len(proof.Whole) > MaxPQWholeIngressBytes {
		return whole, 0, errors.New("PQ proof outside gateway profile")
	}
	var policy *ynxauth.State
	if err := g.queryABCIJSON(ctx, "/account-policy", &policy); err != nil {
		return whole, 0, err
	}
	if policy == nil || policy.Validate(policy.NetworkID) != nil || proof.Height < policy.EnableAt {
		return whole, 0, errors.New("invalid trusted account policy")
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: policy.NetworkID, Purpose: ynxauth.TransactionPurpose, CacheEntries: 1, Optimized: true, ResolveTrustedOwner: func(req ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		return policy.TrustedRegistration(req.Owner, ynxauth.TransactionPurpose, req.Height)
	}})
	if err != nil {
		return whole, 0, err
	}
	defer v.Clear()
	cert, err := ynxbatch.EncodeCertificate(whole.Certificate)
	if err != nil {
		return whole, 0, err
	}
	if err = v.VerifyWholeBatch(cert, whole.Messages, proof.Height); err != nil {
		return whole, 0, err
	}
	fee, err := validatePQResults(whole, consensus.SignedTransactionHash(proof.Whole), proof.Results)
	if err == nil && fee == 0 {
		err = errors.New("persisted Whole has no admitted members")
	}
	return whole, fee, err
}

func decodePQExecution(wire, payload, data []byte, height uint64) (consensus.PQBatchExecutionResult, uint64, error) {
	var result consensus.PQBatchExecutionResult
	if err := strictPQJSON(data, &result); err != nil {
		return result, 0, err
	}
	if result.ABCITransactionHash != consensus.SignedTransactionHash(payload) || result.BatchHash != consensus.SignedTransactionHash(wire) || result.ExecutionHeight == 0 || (height != 0 && result.ExecutionHeight != height) {
		return result, 0, errors.New("PQ execution identity or height mismatch")
	}
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil {
		return result, 0, err
	}
	fee, err := validatePQResults(whole, result.BatchHash, result.Results)
	return result, fee, err
}

// projectPQWhole verifies exact outer bytes, original shared proof, ordered
// partial results and original-height authorization. It never retries a member.
func (g *Gateway) projectPQWhole(ctx context.Context, tx cometTx) (PQWholeView, error) {
	envelope, wire, err := consensus.DecodePQTransaction(tx.Tx)
	if err != nil || envelope.Type != consensus.PQWholeType {
		return PQWholeView{}, errors.New("not a canonical Whole envelope")
	}
	view := wholeIdentity(wire, tx.Tx)
	if !strings.EqualFold(tx.Hash, strings.TrimPrefix(view.ABCITransactionHash, "0x")) {
		return view, errors.New("Comet Whole payload hash mismatch")
	}
	height, err := strconv.ParseUint(tx.Height, 10, 64)
	if err != nil || height == 0 {
		return view, errors.New("invalid Comet Whole height")
	}
	view.ExecutionHeight, view.CometIndex = height, &tx.Index
	if tx.TxResult.Code != 0 {
		view.Status, view.Error = "rejected", tx.TxResult.Log
		if len(tx.TxResult.Data) != 0 {
			result, fee, err := decodePQExecution(wire, tx.Tx, tx.TxResult.Data, height)
			if err != nil || fee != 0 {
				return view, errors.New("failed Whole has invalid or successful member results")
			}
			view.Results = result.Results
		}
		return view, nil
	}
	result, fee, err := decodePQExecution(wire, tx.Tx, tx.TxResult.Data, height)
	if err != nil || fee == 0 {
		return view, errors.New("successful Whole lacks valid member result evidence")
	}
	var proof consensus.PQCommittedBatch
	if err := g.queryABCIJSON(ctx, "/pq-batches/"+view.BatchHash, &proof); err != nil {
		return view, err
	}
	if proof.ABCITransactionHash != view.ABCITransactionHash || proof.Height != height || !bytes.Equal(proof.Whole, wire) || !reflect.DeepEqual(proof.Results, result.Results) {
		return view, errors.New("committed Whole proof differs from actual Comet execution")
	}
	if _, checkedFee, err := g.authenticatePQProof(ctx, proof); err != nil || checkedFee != fee {
		return view, errors.New("committed Whole authorization or fee evidence mismatch")
	}
	view.Status, view.Committed, view.FeeYNXT, view.Results, view.Whole = "committed", true, fee, result.Results, bytes.Clone(wire)
	return view, nil
}

func (g *Gateway) lookupPQWhole(ctx context.Context, hash string) (PQWholeView, error) {
	var tx cometTxLookup
	if err := g.client.get(ctx, "/tx", url.Values{"hash": {hash}, "prove": {"true"}}, &tx); err != nil {
		return PQWholeView{}, err
	}
	if tx.Error != nil {
		return PQWholeView{}, errors.New(cometError(tx.Error))
	}
	view, err := g.projectPQWhole(ctx, tx.Result)
	if err == nil && view.ABCITransactionHash != hash {
		err = errors.New("original Whole lookup hash mismatch")
	}
	return view, err
}

func (g *Gateway) handlePQWholeBroadcast(w http.ResponseWriter, r *http.Request) {
	if strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])) != "application/octet-stream" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/octet-stream is required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxPQWholeIngressBytes)
	wire, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Whole exceeds bounded transfer ingress profile"})
		return
	}
	_, payload, err := decodeIngressWhole(wire)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	view := wholeIdentity(wire, payload)
	unknown := func(err error) {
		view.Status, view.Error = "unknown", err.Error()
		writeJSON(w, http.StatusAccepted, view)
	}
	var broadcast cometBroadcast
	// There is deliberately ONE transport attempt. A timeout may follow a commit;
	// neither it nor a malformed response authorizes automatic rebroadcast.
	if err := g.client.postBroadcast(r.Context(), payload, &broadcast); err != nil {
		unknown(err)
		return
	}
	if broadcast.Error != nil {
		unknown(errors.New(cometError(broadcast.Error)))
		return
	}
	if !strings.EqualFold(broadcast.Result.Hash, strings.TrimPrefix(view.ABCITransactionHash, "0x")) {
		unknown(errors.New("Comet broadcast hash mismatch"))
		return
	}
	if broadcast.Result.CheckTx.Code != 0 {
		view.Status, view.Error = "rejected", broadcast.Result.CheckTx.Log
		if len(broadcast.Result.CheckTx.Data) != 0 {
			result, fee, err := decodePQExecution(wire, payload, broadcast.Result.CheckTx.Data, 0)
			if err != nil || fee != 0 {
				unknown(errors.New("invalid CheckTx rejection evidence"))
				return
			}
			view.ExecutionHeight, view.Results = result.ExecutionHeight, result.Results
		}
		writeJSON(w, http.StatusUnprocessableEntity, view)
		return
	}
	// Read the original indexed transaction and shared proof, not a whole block.
	// CheckTx success alone is never reported as committed.
	height, err := strconv.ParseUint(broadcast.Result.Height, 10, 64)
	if err != nil || height == 0 {
		unknown(errors.New("Comet broadcast has no committed height"))
		return
	}
	confirmed, err := g.lookupPQWhole(r.Context(), view.ABCITransactionHash)
	if err != nil {
		unknown(err)
		return
	}
	if confirmed.ExecutionHeight != height {
		unknown(errors.New("broadcast/readback height mismatch"))
		return
	}
	if broadcast.Result.TxResult.Code != 0 {
		if confirmed.Status != "rejected" {
			unknown(errors.New("broadcast/readback result mismatch"))
			return
		}
	} else {
		result, _, err := decodePQExecution(wire, payload, broadcast.Result.TxResult.Data, height)
		if err != nil || !confirmed.Committed || !reflect.DeepEqual(result.Results, confirmed.Results) {
			unknown(errors.New("broadcast/readback member results mismatch"))
			return
		}
	}
	status := http.StatusOK
	if !confirmed.Committed {
		status = http.StatusUnprocessableEntity
	}
	writeJSON(w, status, confirmed)
}

func (g *Gateway) handlePQWhole(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !transactionHashPattern.MatchString(hash) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical original ABCI hash required"})
		return
	}
	view, err := g.lookupPQWhole(r.Context(), hash)
	if err != nil {
		writeJSON(w, http.StatusAccepted, PQWholeView{Type: consensus.PQWholeType, Status: "unknown", Provenance: "comet-rpc", ABCITransactionHash: hash, ReadbackURL: "/transactions/pq/wholes/" + hash, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (g *Gateway) handlePQBatch(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !transactionHashPattern.MatchString(hash) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical batch hash required"})
		return
	}
	var proof consensus.PQCommittedBatch
	if err := g.queryABCIJSON(r.Context(), "/pq-batches/"+hash, &proof); err != nil {
		writeJSON(w, http.StatusAccepted, PQWholeView{Type: consensus.PQWholeType, Status: "unknown", Provenance: "comet-rpc", BatchHash: hash, Error: err.Error()})
		return
	}
	if consensus.SignedTransactionHash(proof.Whole) != hash {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "original batch hash mismatch"})
		return
	}
	if proof.ABCITransactionHash != "" {
		view, err := g.lookupPQWhole(r.Context(), proof.ABCITransactionHash)
		if err != nil || view.BatchHash != hash || !view.Committed {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "batch lacks matching Comet execution evidence"})
			return
		}
		writeJSON(w, http.StatusOK, view)
		return
	}
	_, fee, err := g.authenticatePQProof(r.Context(), proof)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	// Imported source proof is real source history, not a Comet transaction.
	writeJSON(w, http.StatusOK, PQWholeView{Type: consensus.PQWholeType, Status: "source_import", Provenance: "imported-authoritative-source", BatchHash: hash, ExecutionHeight: proof.Height, FeeYNXT: fee, Results: proof.Results, Whole: proof.Whole})
}

func (c *client) postBroadcast(ctx context.Context, payload []byte, out any) error {
	body, err := json.Marshal(struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Method  string `json:"method"`
		Params  struct {
			Tx []byte `json:"tx"`
		} `json:"params"`
	}{JSONRPC: "2.0", ID: 1, Method: "broadcast_tx_commit", Params: struct {
		Tx []byte `json:"tx"`
	}{Tx: payload}})
	if err != nil {
		return err
	}
	if len(body) > 792658 {
		return errors.New("Whole JSON-RPC POST exceeds bounded profile")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	// Disable redirects for this write. 307/308 must not replay a signed request
	// at another authority; the caller receives UNKNOWN and reads original state.
	hc := *c.httpClient
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := readCometBody(resp.Body, 4<<20)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Comet broadcast HTTP %d; outcome unknown", resp.StatusCode)
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	if envelope.JSONRPC != "2.0" || string(envelope.ID) != "1" {
		return errors.New("Comet broadcast JSON-RPC response identity mismatch")
	}
	return json.Unmarshal(data, out)
}
