package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtversion "github.com/cometbft/cometbft/proto/tendermint/version"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
	cmtversionconst "github.com/cometbft/cometbft/version"
)

type pqIdentityFixture struct {
	app              *consensus.Application
	bootstrap        *consensus.ConsensusBootstrap
	migration        chain.ConsensusMigrationState
	pins             consensus.ConsensusBootstrapPins
	set              *cmttypes.ValidatorSet
	keys             map[string]ed25519.PrivKey
	commit           coretypes.ResultCommit
	validators       coretypes.ResultValidators
	stateHeight      int64
	stateHash        string
	latest, earliest int64
	mode             string
	commitReads      int
	statePath        string
}

// Application-backed test RPC with real synthetic Ed25519 commit signatures.
// No Comet node runs and these are not deployed-network/finality fixtures.
func newPQIdentityFixture(t *testing.T, beforeExport ...func(*chain.Devnet)) *pqIdentityFixture {
	t.Helper()
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), []chain.Validator{{Address: "ynx_validator_identity_a", VotingPower: 1, Active: true}, {Address: "ynx_validator_identity_b", VotingPower: 1, Active: true}})
	for _, prepare := range beforeExport {
		prepare(d)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f := &pqIdentityFixture{keys: map[string]ed25519.PrivKey{}}
	var bindings []chain.ConsensusValidatorKeyBinding
	var validators []*cmttypes.Validator
	for i, v := range m.Validators {
		key := ed25519.GenPrivKeyFromSecret([]byte("public-test-identity-" + strconv.Itoa(i)))
		pub := key.PubKey()
		f.keys[string(pub.Address())] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(pub.Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(pub.Address()))})
		validators = append(validators, cmttypes.NewValidator(pub, v.VotingPower))
	}
	f.migration, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(f.migration, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	f.pins = consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}
	f.bootstrap, err = consensus.NewConsensusBootstrap(raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	f.statePath = filepath.Join(t.TempDir(), "identity.json")
	f.app, err = consensus.NewPersistentApplicationWithBootstrap(f.migration, f.statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	params := doc.ConsensusParams.ToProto()
	init := &abci.RequestInitChain{Time: doc.GenesisTime, ChainId: doc.ChainID, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: doc.AppState}
	for _, v := range doc.Validators {
		key, err := cryptoenc.PubKeyToProto(v.PubKey)
		if err != nil {
			t.Fatal(err)
		}
		init.Validators = append(init.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	if _, err = f.app.InitChain(context.Background(), init); err != nil {
		t.Fatal(err)
	}
	f.set = cmttypes.NewValidatorSet(validators)
	if len(f.set.Validators) == 0 {
		t.Fatal("identity fixture requires an actual exported validator")
	}
	f.stateHeight = doc.InitialHeight
	final, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.stateHeight, Time: doc.GenesisTime.Add(time.Second), NextValidatorsHash: f.set.Hash()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	f.stateHash = hex.EncodeToString(final.AppHash)
	f.latest, f.earliest = f.stateHeight+1, doc.InitialHeight
	header := &cmttypes.Header{Version: cmtversion.Consensus{Block: cmtversionconst.BlockProtocol}, ChainID: doc.ChainID, Height: f.stateHeight + 1, Time: doc.GenesisTime.Add(2 * time.Second), ValidatorsHash: f.set.Hash(), NextValidatorsHash: f.set.Hash(), ConsensusHash: doc.ConsensusParams.Hash(), AppHash: bytes.Clone(final.AppHash), ProposerAddress: f.set.GetProposer().Address}
	parts := sha256.Sum256([]byte("public-test-block-parts"))
	commit := &cmttypes.Commit{Height: header.Height, Round: 0, BlockID: cmttypes.BlockID{Hash: header.Hash(), PartSetHeader: cmttypes.PartSetHeader{Total: 1, Hash: parts[:]}}, Signatures: make([]cmttypes.CommitSig, len(f.set.Validators))}
	for i, v := range f.set.Validators {
		commit.Signatures[i] = cmttypes.CommitSig{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: v.Address, Timestamp: header.Time}
	}
	for i, v := range f.set.Validators {
		signature, err := f.keys[string(v.Address)].Sign(commit.VoteSignBytes(doc.ChainID, int32(i)))
		if err != nil {
			t.Fatal(err)
		}
		commit.Signatures[i].Signature = signature
	}
	f.commit = coretypes.ResultCommit{SignedHeader: cmttypes.SignedHeader{Header: header, Commit: commit}, CanonicalCommit: false}
	f.validators = coretypes.ResultValidators{BlockHeight: header.Height, Validators: f.set.Validators, Count: len(f.set.Validators), Total: len(f.set.Validators)}
	return f
}

func (f *pqIdentityFixture) serve(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var value any
		switch r.URL.Path {
		case "/abci_query":
			path, err := strconv.Unquote(r.URL.Query().Get("path"))
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			response, err := f.app.Query(r.Context(), &abci.RequestQuery{Path: path})
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			if f.mode == "no-bootstrap" {
				response.Code = 1
				response.Value = nil
			}
			value = coretypes.ResultABCIQuery{Response: *response}
		case "/status":
			var status coretypes.ResultStatus
			status.NodeInfo.Network = f.commit.Header.ChainID
			status.SyncInfo = coretypes.SyncInfo{LatestBlockHeight: f.latest, EarliestBlockHeight: f.earliest, LatestBlockHash: bytes.Clone(f.commit.Header.Hash()), EarliestBlockHash: bytes.Clone(f.commit.Header.Hash())}
			value = status
		case "/commit":
			f.commitReads++
			if r.URL.Query().Get("height") != strconv.FormatInt(f.stateHeight+1, 10) {
				t.Error("commit not requested at exact H+1")
			}
			if f.mode == "missing-commit" {
				writeJSON(w, 200, map[string]any{"error": map[string]any{"code": -32603, "message": "commit not retained"}})
				return
			}
			if f.mode == "oversize" {
				_, _ = w.Write(bytes.Repeat([]byte(" "), int(maxPQIdentityCommitBytes)+1))
				return
			}
			if f.mode == "malformed" {
				_, _ = w.Write([]byte(`{"result":{"signed_header":null}}`))
				return
			}
			if f.mode == "duplicate-json" {
				_, _ = w.Write([]byte(`{"result":{},"result":{}}`))
				return
			}
			value = f.commit
		case "/validators":
			if r.URL.Query().Get("height") != strconv.FormatInt(f.stateHeight+1, 10) || r.URL.Query().Get("page") != "1" || r.URL.Query().Get("per_page") != "100" {
				t.Error("validators query not pinned and bounded")
			}
			value = f.validators
		default:
			t.Error("unexpected identity RPC", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		raw, err := cmtjson.Marshal(value)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		if f.mode == "unknown-json" && r.URL.Path == "/commit" || f.mode == "unknown-status" && r.URL.Path == "/status" {
			raw = append(append(bytes.Clone(raw[:len(raw)-1]), []byte(`,"unrecognized":true`)...), '}')
		}
		if f.mode == "unknown-header" && r.URL.Path == "/commit" {
			raw = bytes.Replace(raw, []byte(`"chain_id":`), []byte(`"unexpected":true,"chain_id":`), 1)
		}
		// The real Comet codec owns typed result/public-key encoding. The RPC
		// wrapper is standard JSON containing those complete raw result bytes.
		envelope := struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      int             `json:"id"`
			Result  json.RawMessage `json:"result"`
			Unknown *bool           `json:"unknown,omitempty"`
		}{JSONRPC: "2.0", ID: -1, Result: raw}
		if f.mode == "unknown-envelope" {
			unknown := true
			envelope.Unknown = &unknown
		}
		wrapped, err := json.Marshal(envelope)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		_, _ = w.Write(wrapped)
	})
}

func identityGateway(t *testing.T, f *pqIdentityFixture) (*Gateway, *httptest.Server) {
	t.Helper()
	rpc := httptest.NewServer(f.serve(t))
	t.Cleanup(rpc.Close)
	g, err := New(Config{CometRPCURL: rpc.URL, Build: buildinfo.Info{Commit: "0123456789ab", Release: "public-test", BuildTime: "2026-10-18T00:00:00Z"}})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(g.Handler())
	t.Cleanup(httpServer.Close)
	return g, httpServer
}

func identityRead(t *testing.T, base, path string) (int, []byte) {
	t.Helper()
	response, err := http.Get(base + path)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("identity response was cacheable")
	}
	raw, err := readCometBody(response.Body, 16<<20)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, raw
}

func TestPQIdentityActualApplicationAndSuccessorCommitObservation(t *testing.T) {
	f := newPQIdentityFixture(t)
	_, server := identityGateway(t, f)
	code, raw := identityRead(t, server.URL, "/node/pq-identity")
	var view PQIdentityView
	if err := json.Unmarshal(raw, &view); err != nil {
		t.Fatal(err)
	}
	if code != http.StatusOK || view.Anchor.Status != "rpc-observed" || view.IndependentFinality || view.Anchor.SignatureVerification != "not-performed" || view.BuildSource != "gateway-buildinfo" || view.Build.Commit != "0123456789ab" {
		t.Fatalf("identity claimed absent authority/build/finality or failed: %d %s", code, raw)
	}
	if view.Identity.NativeGenesisHash != f.pins.OriginalGenesisHash || view.Identity.CometGenesisSHA256 != f.pins.CometGenesisSHA256 || view.Identity.CurrentStateHeight != f.stateHeight || view.Anchor.StateHeight != f.stateHeight || view.Anchor.HeaderHeight != f.stateHeight+1 || view.Anchor.HeaderAppHashStateHeight != f.stateHeight || view.Anchor.StateAppHash != f.stateHash || view.Anchor.BlockHash != hex.EncodeToString(f.commit.Header.Hash()) || view.Anchor.BlockHash == view.Anchor.StateAppHash {
		t.Fatal("native/Comet genesis, state AppHash and successor block hash were confused")
	}
	commitRaw, err := cmtjson.Marshal(f.commit)
	if err != nil {
		t.Fatal(err)
	}
	validatorsRaw, err := cmtjson.Marshal(f.validators)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(view.Anchor.CommitResult, commitRaw) || !bytes.Equal(view.Anchor.ValidatorsResult, validatorsRaw) {
		t.Fatal("original complete RPC evidence was rewritten")
	}
	for _, forbidden := range [][]byte{[]byte(`"epoch"`), []byte(`"chainEpoch"`), []byte(`"root"`)} {
		if bytes.Contains(raw, forbidden) {
			t.Fatal("identity fabricated a chain epoch or trust root")
		}
	}
}

func TestPQIdentityHistoricalAnchorDoesNotRelabelLatestApplication(t *testing.T) {
	f := newPQIdentityFixture(t)
	_, server := identityGateway(t, f)
	if _, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.stateHeight + 1, Time: f.commit.Header.Time, NextValidatorsHash: f.set.Hash()}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	path := "/node/pq-identity?" + url.Values{"height": {strconv.FormatInt(f.stateHeight, 10)}, "appHash": {f.stateHash}}.Encode()
	code, raw := identityRead(t, server.URL, path)
	var view PQIdentityView
	if err := json.Unmarshal(raw, &view); err != nil {
		t.Fatal(err)
	}
	if code != 200 || view.Identity.CurrentStateHeight != f.stateHeight+1 || view.Anchor.StateHeight != f.stateHeight || view.Anchor.HeaderHeight != f.stateHeight+1 {
		t.Fatalf("historical anchor relabeled a latest-only query: %d %s", code, raw)
	}
	code, _ = identityRead(t, server.URL, "/node/pq-identity?"+url.Values{"height": {strconv.FormatInt(f.stateHeight, 10)}, "appHash": {strings.Repeat("ab", 32)}}.Encode())
	if code != 409 {
		t.Fatal("wrong historical AppHash accepted", code)
	}
}

func TestPQIdentityPendingOnlyBeforeActualSuccessorAndNeverForErrors(t *testing.T) {
	f := newPQIdentityFixture(t)
	_, server := identityGateway(t, f)
	f.latest = f.stateHeight
	code, raw := identityRead(t, server.URL, "/node/pq-identity")
	var view PQIdentityView
	if err := json.Unmarshal(raw, &view); err != nil {
		t.Fatal(err)
	}
	if code != 202 || view.Anchor.Status != "pending" || view.Anchor.BlockHash != "" || len(view.Anchor.CommitResult) != 0 || len(view.Anchor.ValidatorsResult) != 0 || f.commitReads != 0 {
		t.Fatal("pending manufactured successor evidence or queried nonexistent commit")
	}
	f.mode = "unknown-status"
	if code, _ = identityRead(t, server.URL, "/node/pq-identity"); code != 502 {
		t.Fatal("unknown status JSON was accepted as pending", code)
	}
	f.latest = f.stateHeight + 1
	for _, mode := range []string{"missing-commit", "malformed", "duplicate-json", "unknown-json", "unknown-header", "unknown-envelope", "oversize", "no-bootstrap"} {
		f.mode = mode
		code, _ = identityRead(t, server.URL, "/node/pq-identity")
		want := 502
		if mode == "no-bootstrap" {
			want = 503
		}
		if code != want {
			t.Fatalf("%s was not an explicit unavailable/error: %d", mode, code)
		}
	}
	f.mode = ""
	f.latest = f.stateHeight + 2
	f.earliest = f.latest
	code, _ = identityRead(t, server.URL, "/node/pq-identity")
	if code != 503 {
		t.Fatal("pruned successor was mislabeled pending", code)
	}
}

func TestPQIdentityRejectsHeaderValidatorAndRequestSubstitution(t *testing.T) {
	for _, mode := range []string{"header-hash", "chain", "header-height", "app-hash", "validator-height", "validator-hash", "duplicate-validator", "power", "signature-address", "missing-signature", "pagination"} {
		t.Run(mode, func(t *testing.T) {
			f := newPQIdentityFixture(t)
			_, server := identityGateway(t, f)
			switch mode {
			case "header-hash":
				f.commit.Commit.BlockID.Hash[0] ^= 1
			case "chain":
				f.commit.Header.ChainID = "other"
			case "header-height":
				f.commit.Header.Height++
			case "app-hash":
				f.commit.Header.AppHash = bytes.Repeat([]byte{7}, 32)
				f.commit.Commit.BlockID.Hash = f.commit.Header.Hash()
			case "validator-height":
				f.validators.BlockHeight++
			case "validator-hash":
				f.commit.Header.ValidatorsHash = bytes.Repeat([]byte{8}, 32)
				f.commit.Commit.BlockID.Hash = f.commit.Header.Hash()
			case "duplicate-validator":
				duplicate := *f.validators.Validators[0]
				duplicate.Address = bytes.Clone(duplicate.Address)
				f.validators.Validators = append(f.validators.Validators, &duplicate)
				f.validators.Count = len(f.validators.Validators)
				f.validators.Total = f.validators.Count
				signature := f.commit.Commit.Signatures[0]
				signature.ValidatorAddress = bytes.Clone(signature.ValidatorAddress)
				signature.Signature = bytes.Clone(signature.Signature)
				f.commit.Commit.Signatures = append(f.commit.Commit.Signatures, signature)
				set := cmttypes.ValidatorSet{Validators: f.validators.Validators}
				f.commit.Header.ValidatorsHash = set.Hash()
				f.commit.Commit.BlockID.Hash = f.commit.Header.Hash()
			case "power":
				f.validators.Validators[0].VotingPower++
			case "signature-address":
				f.commit.Commit.Signatures[0].ValidatorAddress = bytes.Repeat([]byte{9}, 20)
			case "missing-signature":
				f.commit.Commit.Signatures = f.commit.Commit.Signatures[:len(f.commit.Commit.Signatures)-1]
			case "pagination":
				f.validators.Total++
			}
			code, _ := identityRead(t, server.URL, "/node/pq-identity")
			if code != 502 && code != 409 {
				t.Fatal("malformed/substituted commit became identity or pending", mode, code)
			}
		})
	}
	f := newPQIdentityFixture(t)
	_, server := identityGateway(t, f)
	for _, query := range []string{"?height=1", "?appHash=" + f.stateHash, "?height=0&appHash=" + f.stateHash, "?height=02&appHash=" + f.stateHash, "?height=2&height=2&appHash=" + f.stateHash, "?host=https://other", "?height=2&appHash=" + f.stateHash + "&extra=1"} {
		code, _ := identityRead(t, server.URL, "/node/pq-identity"+query)
		if code != 400 {
			t.Fatal("noncanonical identity selector accepted", query, code)
		}
	}
	for _, query := range []url.Values{{"height": {strconv.FormatInt(f.stateHeight+1, 10)}, "appHash": {f.stateHash}}, {"height": {strconv.FormatInt(f.stateHeight, 10)}, "appHash": {strings.Repeat("ab", 32)}}} {
		code, _ := identityRead(t, server.URL, "/node/pq-identity?"+query.Encode())
		if code != 409 {
			t.Fatal("future/current state substitution accepted", code)
		}
	}
}

func TestPQIdentityStrictRPCJSONGrammar(t *testing.T) {
	for _, test := range []struct{ kind, raw string }{
		{"envelope", `{"result":{},"result":{}}`},
		{"envelope", `{"result":{},"id result":0}`},
		{"envelope", `{"result":{},"":0}`},
		{"/status", `{"node_info":{"network":"ynx_6423-1","other":{"unknown":1}}}`},
		{"/commit", `{"signed_header":{"header":{"version":{"block":"11","unknown":1}}}}`},
		{"/validators", `{"validators":[{"pub_key":{"type":"tendermint/PubKeyEd25519","value":"","unknown":1}}]}`},
		{"/abci_query", `{"response":{"proof_ops":{"ops":[]}}}`},
		{"envelope", `{"result":{}} {}`},
	} {
		if identityUniqueJSON([]byte(test.raw)) == nil && identityJSONShape([]byte(test.raw), test.kind) == nil {
			t.Fatal("unknown/duplicate/trailing RPC grammar accepted", test.kind, test.raw)
		}
	}
}

func TestPQIdentityDoesNotFollowConfiguredAuthorityRedirect(t *testing.T) {
	hits := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; w.WriteHeader(200) }))
	defer target.Close()
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer rpc.Close()
	g, err := New(Config{CometRPCURL: rpc.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(g.Handler())
	defer server.Close()
	code, _ := identityRead(t, server.URL, "/node/pq-identity")
	if code != 502 || hits != 0 {
		t.Fatal("identity followed a configured RPC redirect", code, hits)
	}
}

func TestPQIdentityNativeEndpointDoesNotTriggerSourceFallback(t *testing.T) {
	hits := 0
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.URL.Path != "/abci_query" {
			t.Error("identity attempted an alternate/native source", r.URL.Path)
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer rpc.Close()
	g, err := New(Config{CometRPCURL: rpc.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(g.Handler())
	defer server.Close()
	code, _ := identityRead(t, server.URL, "/node/pq-identity")
	if code != 502 || hits != 1 {
		t.Fatal("native 405 was treated as BFT pending or source fallback", code, hits)
	}
}
