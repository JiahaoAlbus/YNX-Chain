package bftgateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	maxPQIdentityCommitBytes     int64 = 8 << 20
	maxPQIdentityValidatorsBytes int64 = 2 << 20
	maxPQIdentityValidators            = 100
)

// These are configured-RPC observations. Build describes this gateway binary;
// it is neither a Comet/ABCI build attestation nor a trusted chain descriptor.
type PQIdentityView struct {
	Version             string                         `json:"version"`
	Source              string                         `json:"source"`
	BuildSource         string                         `json:"buildSource"`
	Build               buildinfo.Info                 `json:"build"`
	Identity            consensus.PQWalletIdentityView `json:"identity"`
	Anchor              PQIdentityAnchor               `json:"anchor"`
	IndependentFinality bool                           `json:"independentFinality"`
}

type PQIdentityAnchor struct {
	Status                    string `json:"status"`
	StateHeight               int64  `json:"stateHeight,string"`
	StateAppHash              string `json:"stateAppHash"`
	HeaderHeight              int64  `json:"headerHeight,string"`
	HeaderAppHashStateHeight  int64  `json:"headerAppHashStateHeight,string"`
	ObservedLatestBlockHeight int64  `json:"observedLatestBlockHeight,string"`
	BlockHash                 string `json:"blockHash,omitempty"`
	BlockHashAlgorithm        string `json:"blockHashAlgorithm"`
	ValidatorsHash            string `json:"validatorsHash,omitempty"`
	SignatureVerification     string `json:"signatureVerification"`
	// Exact RPC result bytes, base64 encoded by JSON, retain complete signatures
	// and key bindings. They are never reconstructed as synthetic evidence.
	CommitResult     []byte `json:"commitResult,omitempty"`
	ValidatorsResult []byte `json:"validatorsResult,omitempty"`
}

type pqIdentityError struct {
	code int
	err  error
}

func (e *pqIdentityError) Error() string { return e.err.Error() }
func identityError(code int, message string) error {
	return &pqIdentityError{code, errors.New(message)}
}

// Reject duplicate keys before decoding RPC envelopes, including nested
// headers/keys. RPC whitespace is allowed; application values remain canonical.
func identityUniqueJSON(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var visit func(int) error
	visit = func(depth int) error {
		if depth > 32 {
			return errors.New("identity RPC JSON depth exceeded")
		}
		token, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] || len(seen) >= 1024 {
					return errors.New("duplicate or excessive identity RPC fields")
				}
				seen[name] = true
				if err = visit(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			count := 0
			for d.More() {
				count++
				if count > 10000 {
					return errors.New("excessive identity RPC array")
				}
				if err = visit(depth + 1); err != nil {
					return err
				}
			}
		default:
			return errors.New("unexpected identity RPC delimiter")
		}
		_, err = d.Token()
		return err
	}
	if err := visit(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing identity RPC JSON")
	}
	return nil
}

// Comet's codec represents integers as strings, so a standard-library typed
// decoder is not an interchangeable strict decoder for these RPC results.
// Check the fixed RPC object's field grammar before using the real codec.
// Unknown fields fail closed rather than silently changing evidence meaning.
func identityJSONShape(raw json.RawMessage, kind string) error {
	type child struct {
		field, kind string
		array       bool
	}
	var allowed string
	var children []child
	switch kind {
	case "envelope":
		allowed = "jsonrpc id result error"
	case "/abci_query":
		allowed, children = "response", []child{{"response", "query-response", false}}
	case "query-response":
		allowed = "code log info index key value proof_ops height codespace"
	case "/status":
		allowed, children = "node_info sync_info validator_info", []child{{"node_info", "node-info", false}, {"sync_info", "sync-info", false}, {"validator_info", "validator-info", false}}
	case "node-info":
		allowed, children = "protocol_version id listen_addr network version channels moniker other", []child{{"protocol_version", "protocol-version", false}, {"other", "node-other", false}}
	case "protocol-version":
		allowed = "p2p block app"
	case "node-other":
		allowed = "tx_index rpc_address"
	case "sync-info":
		allowed = "latest_block_hash latest_app_hash latest_block_height latest_block_time earliest_block_hash earliest_app_hash earliest_block_height earliest_block_time catching_up"
	case "validator-info":
		allowed, children = "address pub_key voting_power", []child{{"pub_key", "pub-key", false}}
	case "/commit":
		allowed, children = "signed_header canonical", []child{{"signed_header", "signed-header", false}}
	case "signed-header":
		allowed, children = "header commit", []child{{"header", "header", false}, {"commit", "commit", false}}
	case "header":
		allowed = "version chain_id height time last_block_id last_commit_hash data_hash validators_hash next_validators_hash consensus_hash app_hash last_results_hash evidence_hash proposer_address"
		children = []child{{"version", "version", false}, {"last_block_id", "block-id", false}}
	case "version":
		allowed = "block app"
	case "block-id":
		allowed, children = "hash parts", []child{{"parts", "parts", false}}
	case "parts":
		allowed = "total hash"
	case "commit":
		allowed, children = "height round block_id signatures", []child{{"block_id", "block-id", false}, {"signatures", "commit-signature", true}}
	case "commit-signature":
		allowed = "block_id_flag validator_address timestamp signature"
	case "/validators":
		allowed, children = "block_height validators count total", []child{{"validators", "validator", true}}
	case "validator":
		allowed, children = "address pub_key voting_power proposer_priority", []child{{"pub_key", "pub-key", false}}
	case "pub-key":
		allowed = "type value"
	default:
		return errors.New("unsupported identity RPC grammar")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return errors.New("identity RPC object required")
	}
	for field := range fields {
		known := false
		for _, name := range strings.Fields(allowed) {
			known = known || name == field
		}
		if !known {
			return errors.New("unknown identity RPC field")
		}
	}
	// This read never requests an ABCI proof. Do not accept an opaque proof
	// subtree that this identity contract neither interprets nor verifies.
	if kind == "query-response" && len(fields["proof_ops"]) != 0 && !bytes.Equal(fields["proof_ops"], []byte("null")) {
		return errors.New("unexpected identity ABCI proof")
	}
	for _, c := range children {
		value, exists := fields[c.field]
		if !exists || kind == "validator-info" && bytes.Equal(value, []byte("null")) {
			continue
		}
		if c.array {
			var values []json.RawMessage
			if err := json.Unmarshal(value, &values); err != nil || len(values) > maxPQIdentityValidators {
				return errors.New("invalid bounded identity RPC array")
			}
			for _, element := range values {
				if err := identityJSONShape(element, c.kind); err != nil {
					return err
				}
			}
		} else if err := identityJSONShape(value, c.kind); err != nil {
			return err
		}
	}
	return nil
}

func (g *Gateway) identityRPCResult(ctx context.Context, path string, query url.Values, limit int64) (json.RawMessage, error) {
	endpoint := g.client.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	c := *g.client.httpClient
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := c.Do(req)
	if err != nil {
		return nil, errors.New("configured Comet RPC read failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New("configured Comet RPC did not return successful HTTP")
	}
	raw, err := readCometBody(response.Body, limit)
	if err != nil {
		return nil, err
	}
	if err = identityUniqueJSON(raw); err != nil {
		return nil, err
	}
	if err = identityJSONShape(raw, "envelope"); err != nil {
		return nil, err
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *cometRPCError  `json:"error"`
	}
	if err = json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	if envelope.Error != nil || len(envelope.Result) == 0 || bytes.Equal(envelope.Result, []byte("null")) {
		return nil, errors.New("configured Comet RPC result unavailable")
	}
	if err = identityJSONShape(envelope.Result, path); err != nil {
		return nil, err
	}
	return bytes.Clone(envelope.Result), nil
}

func (g *Gateway) pqIdentityQuery(ctx context.Context) (consensus.PQWalletIdentityView, error) {
	var v consensus.PQWalletIdentityView
	raw, err := g.identityRPCResult(ctx, "/abci_query", url.Values{"path": {strconv.Quote(consensus.PQWalletIdentityPath)}}, 64<<10)
	if err != nil {
		return v, err
	}
	var result struct {
		Response struct {
			Code   uint32 `json:"code"`
			Height string `json:"height"`
			Value  string `json:"value"`
		} `json:"response"`
	}
	if err = json.Unmarshal(raw, &result); err != nil {
		return v, err
	}
	if result.Response.Code != 0 {
		return v, identityError(http.StatusServiceUnavailable, "independent configured application identity is unavailable")
	}
	h, err := strconv.ParseInt(result.Response.Height, 10, 64)
	if err != nil || h < 0 || strconv.FormatInt(h, 10) != result.Response.Height {
		return v, errors.New("invalid identity ABCI response height")
	}
	payload, err := base64.StdEncoding.DecodeString(result.Response.Value)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxPQWalletIdentityBytes || base64.StdEncoding.EncodeToString(payload) != result.Response.Value {
		return v, errors.New("invalid bounded identity ABCI value")
	}
	if err = strictPQJSON(payload, &v); err != nil {
		return v, err
	}
	return v, consensus.ValidatePQWalletIdentityView(v, h)
}

func identityHeight(raw string) (int64, error) {
	h, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || h < 0 || strconv.FormatInt(h, 10) != raw {
		return 0, errors.New("canonical decimal height required")
	}
	return h, nil
}
func identityHash(raw string) bool {
	value, err := hex.DecodeString(raw)
	return err == nil && len(value) == 32 && hex.EncodeToString(value) == raw && !bytes.Equal(value, make([]byte, 32))
}

func (g *Gateway) pqIdentity(ctx context.Context, requestedHeight, requestedHash string) (PQIdentityView, error) {
	var view PQIdentityView
	identity, err := g.pqIdentityQuery(ctx)
	if err != nil {
		return view, err
	}
	h, hash := identity.CurrentStateHeight, identity.CurrentStateAppHash
	if requestedHeight != "" {
		h, err = identityHeight(requestedHeight)
		if err != nil || h <= 0 || !identityHash(requestedHash) {
			return view, identityError(http.StatusBadRequest, "canonical state height and SHA256 AppHash required")
		}
		hash = requestedHash
		if h < int64(identity.MigrationHeight) || h > identity.CurrentStateHeight || h == identity.CurrentStateHeight && hash != identity.CurrentStateAppHash {
			return view, identityError(http.StatusConflict, "requested state checkpoint differs from current identity boundary")
		}
	}
	if h == math.MaxInt64 {
		return view, identityError(http.StatusBadRequest, "successor header height overflows")
	}
	view = PQIdentityView{Version: "ynx-pq-rpc-identity-v1", Source: "configured-comet-rpc", BuildSource: "gateway-buildinfo", Build: g.build, Identity: identity, Anchor: PQIdentityAnchor{Status: "pending", StateHeight: h, StateAppHash: hash, HeaderHeight: h + 1, HeaderAppHashStateHeight: h, BlockHashAlgorithm: "cometbft-header-merkle-sha256", SignatureVerification: "not-performed"}}
	raw, err := g.identityRPCResult(ctx, "/status", nil, 64<<10)
	if err != nil {
		return view, err
	}
	var status struct {
		NodeInfo struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo struct {
			Latest       string `json:"latest_block_height"`
			Earliest     string `json:"earliest_block_height"`
			LatestHash   string `json:"latest_block_hash"`
			EarliestHash string `json:"earliest_block_hash"`
		} `json:"sync_info"`
	}
	if err = json.Unmarshal(raw, &status); err != nil {
		return view, err
	}
	latest, err := identityHeight(status.SyncInfo.Latest)
	if err != nil {
		return view, err
	}
	earliest, err := identityHeight(status.SyncInfo.Earliest)
	if err != nil {
		return view, err
	}
	if status.NodeInfo.Network != identity.CometChainID || earliest > latest || latest > 0 && (earliest == 0 || !identityHash(strings.ToLower(status.SyncInfo.LatestHash)) || !identityHash(strings.ToLower(status.SyncInfo.EarliestHash))) || latest == 0 && (earliest != 0 || status.SyncInfo.LatestHash != "" || status.SyncInfo.EarliestHash != "") {
		return view, errors.New("Comet status network or retained block boundary mismatch")
	}
	view.Anchor.ObservedLatestBlockHeight = latest
	if latest < h+1 {
		return view, nil
	} // Only observed lack of a successor is pending.
	if earliest > h+1 {
		return view, identityError(http.StatusServiceUnavailable, "successor commit was pruned; original anchor is unavailable")
	}
	commitRaw, err := g.identityRPCResult(ctx, "/commit", url.Values{"height": {strconv.FormatInt(h+1, 10)}}, maxPQIdentityCommitBytes)
	if err != nil {
		return view, err
	}
	var commit coretypes.ResultCommit
	if err = cmtjson.Unmarshal(commitRaw, &commit); err != nil {
		return view, err
	}
	if err = commit.SignedHeader.ValidateBasic(identity.CometChainID); err != nil {
		return view, err
	}
	if commit.Height != h+1 || len(commit.Header.AppHash) != 32 {
		return view, errors.New("successor commit header is not the requested state anchor")
	}
	if hex.EncodeToString(commit.Header.AppHash) != hash {
		return view, identityError(http.StatusConflict, "successor header AppHash differs from requested state checkpoint")
	}
	validatorsRaw, err := g.identityRPCResult(ctx, "/validators", url.Values{"height": {strconv.FormatInt(h+1, 10)}, "page": {"1"}, "per_page": {strconv.Itoa(maxPQIdentityValidators)}}, maxPQIdentityValidatorsBytes)
	if err != nil {
		return view, err
	}
	var validators coretypes.ResultValidators
	if err = cmtjson.Unmarshal(validatorsRaw, &validators); err != nil {
		return view, err
	}
	if validators.BlockHeight != h+1 || validators.Count != len(validators.Validators) || validators.Total != validators.Count || validators.Count == 0 || validators.Count > maxPQIdentityValidators || len(commit.Commit.Signatures) != validators.Count {
		return view, errors.New("successor validator set is incomplete or from another height")
	}
	seen := map[string]bool{}
	var total, signed int64
	for i, v := range validators.Validators {
		if v == nil || v.ValidateBasic() != nil || v.VotingPower <= 0 || v.VotingPower > cmttypes.MaxTotalVotingPower-total || seen[string(v.Address)] {
			return view, errors.New("invalid successor validator identity or voting power")
		}
		switch key := v.PubKey.(type) {
		case ed25519.PubKey:
			if len(key) != ed25519.PubKeySize {
				return view, errors.New("invalid full Ed25519 validator key")
			}
		case ynxpq.PubKey:
			binding, err := ynxconsensusauth.DecodeLogicalPublicKey(key.Bytes())
			if err != nil || hex.EncodeToString(binding.GenesisID) != identity.CometGenesisSHA256 || binding.ChainID != identity.CometChainID || binding.ValidFromHeight > h+1 {
				return view, errors.New("PQ validator full binding differs from configured consensus genesis")
			}
		default:
			return view, errors.New("unsupported actual consensus public key type")
		}
		seen[string(v.Address)] = true
		total += v.VotingPower
		sig := commit.Commit.Signatures[i]
		if sig.BlockIDFlag != cmttypes.BlockIDFlagAbsent && !bytes.Equal(sig.ValidatorAddress, v.Address) {
			return view, errors.New("commit signatures do not match exact validator order")
		}
		if sig.BlockIDFlag == cmttypes.BlockIDFlagCommit {
			signed += v.VotingPower
		}
	}
	if !sort.IsSorted(cmttypes.ValidatorsByVotingPower(validators.Validators)) || signed <= total*2/3 {
		return view, errors.New("commit lacks structurally complete quorum or ordered validator set")
	}
	set := cmttypes.ValidatorSet{Validators: validators.Validators}
	if !bytes.Equal(set.Hash(), commit.Header.ValidatorsHash) {
		return view, errors.New("successor header validators hash differs from complete RPC set")
	}
	view.Anchor.Status = "rpc-observed"
	view.Anchor.BlockHash = hex.EncodeToString(commit.Header.Hash())
	view.Anchor.ValidatorsHash = hex.EncodeToString(commit.Header.ValidatorsHash)
	view.Anchor.CommitResult = bytes.Clone(commitRaw)
	view.Anchor.ValidatorsResult = bytes.Clone(validatorsRaw)
	return view, nil
}

func (g *Gateway) handlePQIdentity(w http.ResponseWriter, r *http.Request) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) > 2 || len(query["height"]) > 1 || len(query["appHash"]) > 1 || len(query) != 0 && (len(query) != 2 || len(query["height"]) != 1 || len(query["appHash"]) != 1 || query.Get("height") == "" || query.Get("appHash") == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only one paired height and appHash may be requested"})
		return
	}
	view, err := g.pqIdentity(r.Context(), query.Get("height"), query.Get("appHash"))
	if err != nil {
		code := http.StatusBadGateway
		var failure *pqIdentityError
		if errors.As(err, &failure) {
			code = failure.code
		}
		writeJSON(w, code, map[string]string{"error": fmt.Sprint(err)})
		return
	}
	code := http.StatusOK
	if view.Anchor.Status == "pending" {
		code = http.StatusAccepted
	}
	writeJSON(w, code, view)
}
