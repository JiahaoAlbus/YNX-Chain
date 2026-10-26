package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

type pqIdentityContractHTTP struct {
	Name         string `json:"name"`
	Method       string `json:"method"`
	Path         string `json:"path"`
	StatusCode   int    `json:"statusCode"`
	ContentType  string `json:"contentType"`
	CacheControl string `json:"cacheControl"`
	BodyWire     []byte `json:"bodyWire"` // Exact HTTP response bytes, JSON base64.
}

type pqIdentityContractExpectedPin struct {
	NativeChainID       string         `json:"nativeChainId"`
	CometChainID        string         `json:"cometChainId"`
	NativeGenesisHash   string         `json:"nativeGenesisHash"`
	CometGenesisSHA256  string         `json:"cometGenesisSHA256"`
	MigrationStateHash  string         `json:"migrationStateHash"`
	MigrationHeight     string         `json:"migrationHeight"`
	InitialHeight       string         `json:"initialHeight"`
	CurrentStateHeight  string         `json:"currentStateHeight"`
	CurrentStateAppHash string         `json:"currentStateAppHash"`
	AnchorStateHeight   string         `json:"anchorStateHeight"`
	AnchorStateAppHash  string         `json:"anchorStateAppHash"`
	HeaderHeight        string         `json:"headerHeight"`
	BlockHash           string         `json:"blockHash"`
	ValidatorsHash      string         `json:"validatorsHash"`
	Build               buildinfo.Info `json:"build"`
}

// Public synthetic contract DATA only. The actual Application executes and the
// existing test RPC carries complete, genuinely signed synthetic Ed commits.
// There is no Node.Start, live source, private export or independent finality.
func TestPQIdentityPublicHistoricalContractFixture(t *testing.T) {
	f := newPQIdentityFixture(t)
	anchorHeight, anchorHash := f.stateHeight, f.stateHash
	doc, err := consensus.BuildCometGenesis(f.migration, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	genesisRaw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	genesisSHA := sha256.Sum256(genesisRaw)
	if f.bootstrap == nil || hex.EncodeToString(genesisSHA[:]) != f.pins.CometGenesisSHA256 || doc.InitialHeight != anchorHeight {
		t.Fatal("fixture original genesis/pins differ")
	}
	if err = f.set.VerifyCommitLightAllSignatures(doc.ChainID, f.commit.Commit.BlockID, f.commit.Height, f.commit.Commit); err != nil {
		t.Fatalf("original synthetic commit signatures failed: %v", err)
	}
	commitRaw, err := cmtjson.Marshal(f.commit)
	if err != nil {
		t.Fatal(err)
	}
	validatorsRaw, err := cmtjson.Marshal(f.validators)
	if err != nil {
		t.Fatal(err)
	}
	final, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: anchorHeight + 1, Time: f.commit.Header.Time, NextValidatorsHash: f.set.Hash()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	info, err := f.app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil || info == nil || info.LastBlockHeight != f.latest || !bytes.Equal(info.LastBlockAppHash, final.AppHash) {
		t.Fatal("actual committed Application did not advance to Comet latest", err)
	}
	currentHash := hex.EncodeToString(final.AppHash)
	if currentHash == anchorHash {
		t.Fatal("fixture must distinguish current state from historical anchor")
	}
	g, server := identityGateway(t, f)
	// SYNTHETIC full-40 identity, never an actual source/release attestation.
	g.build = buildinfo.Info{Commit: strings.Repeat("12", 20), Release: "ynx-bft-gateway-121212121212", BuildTime: "2026-10-18T00:00:00Z"}
	expected := pqIdentityContractExpectedPin{
		NativeChainID: strconv.FormatInt(f.migration.Network.ChainID, 10), CometChainID: doc.ChainID,
		NativeGenesisHash: f.pins.OriginalGenesisHash, CometGenesisSHA256: f.pins.CometGenesisSHA256,
		MigrationStateHash: f.pins.MigrationStateHash, MigrationHeight: strconv.FormatUint(f.migration.Height, 10),
		InitialHeight: strconv.FormatInt(doc.InitialHeight, 10), CurrentStateHeight: strconv.FormatInt(info.LastBlockHeight, 10),
		CurrentStateAppHash: currentHash, AnchorStateHeight: strconv.FormatInt(anchorHeight, 10), AnchorStateAppHash: anchorHash,
		HeaderHeight: strconv.FormatInt(f.commit.Height, 10), BlockHash: hex.EncodeToString(f.commit.Header.Hash()),
		ValidatorsHash: hex.EncodeToString(f.set.Hash()), Build: g.build,
	}
	read := func(name, path string, want int) (pqIdentityContractHTTP, PQIdentityView) {
		t.Helper()
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := readCometBody(response.Body, 64<<10)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != want || response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("Content-Type") != "application/json" {
			t.Fatal("actual identity HTTP status/headers differ", name, response.StatusCode)
		}
		var view PQIdentityView
		if err = json.Unmarshal(raw, &view); err != nil {
			t.Fatal(err)
		}
		if view.Version != "ynx-pq-rpc-identity-v1" || view.Source != "configured-comet-rpc" || view.BuildSource != "gateway-buildinfo" || view.Build != expected.Build || view.IndependentFinality || view.Anchor.SignatureVerification != "not-performed" || view.Identity.NativeChainID != f.migration.Network.ChainID || view.Identity.CometChainID != doc.ChainID || view.Identity.NativeGenesisHash != expected.NativeGenesisHash || view.Identity.CometGenesisSHA256 != expected.CometGenesisSHA256 || view.Identity.MigrationStateHash != expected.MigrationStateHash || view.Identity.MigrationHeight != f.migration.Height || view.Identity.InitialHeight != doc.InitialHeight || view.Identity.CurrentStateHeight != info.LastBlockHeight || view.Identity.CurrentStateAppHash != currentHash || view.Anchor.ObservedLatestBlockHeight != f.latest {
			t.Fatal("identity differs from independent fixture inputs or claimed finality", name)
		}
		return pqIdentityContractHTTP{Name: name, Method: http.MethodGet, Path: path, StatusCode: response.StatusCode, ContentType: response.Header.Get("Content-Type"), CacheControl: response.Header.Get("Cache-Control"), BodyWire: raw}, view
	}
	pendingHTTP, pending := read("current-pending", "/node/pq-identity", http.StatusAccepted)
	if pending.Anchor.Status != "pending" || pending.Anchor.StateHeight != anchorHeight+1 || pending.Anchor.StateAppHash != currentHash || pending.Anchor.HeaderHeight != anchorHeight+2 || pending.Anchor.HeaderAppHashStateHeight != anchorHeight+1 || pending.Anchor.BlockHash != "" || len(pending.Anchor.CommitResult) != 0 || len(pending.Anchor.ValidatorsResult) != 0 || f.commitReads != 0 {
		t.Fatal("current pending response fabricated successor evidence")
	}
	historicalPath := "/node/pq-identity?" + url.Values{"height": {expected.AnchorStateHeight}, "appHash": {expected.AnchorStateAppHash}}.Encode()
	historicalHTTP, historical := read("historical-anchor", historicalPath, http.StatusOK)
	if historical.Anchor.Status != "rpc-observed" || historical.Anchor.StateHeight != anchorHeight || historical.Anchor.StateAppHash != anchorHash || historical.Anchor.HeaderHeight != anchorHeight+1 || historical.Anchor.HeaderAppHashStateHeight != anchorHeight || historical.Identity.CurrentStateHeight == historical.Anchor.StateHeight || historical.Anchor.BlockHash != expected.BlockHash || historical.Anchor.ValidatorsHash != expected.ValidatorsHash || !bytes.Equal(historical.Anchor.CommitResult, commitRaw) || !bytes.Equal(historical.Anchor.ValidatorsResult, validatorsRaw) || f.commitReads != 1 {
		t.Fatal("historical response changed current/anchor coordinates or original complete RPC bytes")
	}
	fixture := struct {
		FixtureVersion         string                        `json:"fixtureVersion"`
		PublicSynthetic        bool                          `json:"publicSynthetic"`
		Live                   bool                          `json:"live"`
		NodeStarted            bool                          `json:"nodeStarted"`
		IndependentFinality    bool                          `json:"independentFinality"`
		SourceTest             string                        `json:"sourceTest"`
		FixtureOnlyExpectedPin pqIdentityContractExpectedPin `json:"fixtureOnlyExpectedPin"`
		HTTP                   []pqIdentityContractHTTP      `json:"http"`
		CommitResult           []byte                        `json:"commitResult"`
		ValidatorsResult       []byte                        `json:"validatorsResult"`
	}{"YNX-PQ-IDENTITY-CONTRACT-FIXTURE/v1", true, false, false, false, t.Name(), expected,
		[]pqIdentityContractHTTP{pendingHTTP, historicalHTTP}, commitRaw, validatorsRaw}
	raw, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	if len(raw) > 64<<10 {
		t.Fatal("complete public identity fixture exceeds 64 KiB")
	}
	for _, key := range f.keys {
		if bytes.Contains(raw, []byte(base64.StdEncoding.EncodeToString(key))) || bytes.Contains(raw, []byte(hex.EncodeToString(key))) {
			t.Fatal("public fixture contains private signing material")
		}
	}
	output := os.Getenv("YNX_PQ_IDENTITY_CONTRACT_FIXTURE_OUT")
	if output == "" {
		return
	}
	if !filepath.IsAbs(output) || filepath.Clean(output) != output || strings.TrimSpace(output) != output {
		t.Fatal("public fixture requires an explicit canonical absolute new output")
	}
	parent := filepath.Dir(output)
	canonicalParent, err := filepath.EvalSymlinks(parent)
	if err != nil || canonicalParent != parent {
		t.Fatal("public fixture output parent must be original and canonical", err)
	}
	file, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	// Retain partial/UNKNOWN on every late error; never remove or overwrite it.
	if n, writeErr := file.Write(raw); writeErr != nil || n != len(raw) {
		_ = file.Close()
		t.Fatal("public identity fixture write incomplete", writeErr)
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	directory, err := os.Open(parent)
	if err != nil {
		t.Fatal(err)
	}
	err = directory.Sync()
	errClose := directory.Close()
	if err != nil || errClose != nil {
		t.Fatal("public identity fixture parent sync incomplete", err, errClose)
	}
	sum := sha256.Sum256(raw)
	t.Logf("PQ_IDENTITY_PUBLIC_CONTRACT_FIXTURE version=%s bytes=%d sha256=%x live=false nodeStarted=false independentFinality=false", fixture.FixtureVersion, len(raw), sum)
}
