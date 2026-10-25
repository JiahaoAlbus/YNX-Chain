package bftgateway

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Public data from the EXISTING compiled deployment test. This DTO cannot
// serialize its fixture key, Application, database or private signer state.
// All original binary/JSON bytes use canonical standard base64 via []byte;
// decimal strings preserve all integer input and execution coordinates.
type pqContractDeployPublicFile struct {
	Role       string `json:"role"`
	Path       string `json:"path"`
	ByteLength string `json:"byteLength"`
	SHA256     string `json:"sha256"`
	Bytes      []byte `json:"bytes"`
}

type pqContractDeployPublicHTTP struct {
	Method       string `json:"method"`
	Path         string `json:"path"`
	StatusCode   string `json:"statusCode"`
	ContentType  string `json:"contentType"`
	CacheControl string `json:"cacheControl"`
	Body         []byte `json:"body"`
	BodySHA256   string `json:"bodySha256"`
}

type pqContractDeployPublicFixture struct {
	Version                     string                          `json:"version"`
	Classification              string                          `json:"classification"`
	SourceTest                  string                          `json:"sourceTest"`
	SyntheticOnly               bool                            `json:"syntheticOnly"`
	ApplicationExecution        string                          `json:"applicationExecution"`
	BroadcastExecuted           bool                            `json:"broadcastExecuted"`
	ActualCometNode             bool                            `json:"actualCometNode"`
	IndependentFinality         bool                            `json:"independentFinality"`
	NativeGrant                 bool                            `json:"nativeGrant"`
	PublicBFT                   bool                            `json:"publicBFT"`
	DeployedSourceQualification bool                            `json:"deployedSourceQualification"`
	ProofVerification           string                          `json:"proofVerification"`
	Files                       []pqContractDeployPublicFile    `json:"files"`
	AccountBefore               consensus.PQWalletAccountView   `json:"accountBefore"`
	History                     consensus.PQActionHistoryView   `json:"history"`
	TransactionType             string                          `json:"transactionType"`
	ActionKind                  string                          `json:"actionKind"`
	Owner                       string                          `json:"owner"`
	NetworkID                   string                          `json:"networkId"`
	NativeChainID               string                          `json:"nativeChainId"`
	Nonce                       string                          `json:"nonce"`
	Fee                         string                          `json:"fee"`
	Payload                     pqContractDeployPublicPayload   `json:"payload"`
	Source                      string                          `json:"source"`
	NativeWire                  []byte                          `json:"nativeWire"`
	NativeWireSHA256            string                          `json:"nativeWireSha256"`
	Transport                   []byte                          `json:"transport"`
	TransportSHA256             string                          `json:"transportSha256"`
	TransportFields             []string                        `json:"transportFields"`
	MemberN                     string                          `json:"memberN"`
	MemberIndex                 string                          `json:"memberIndex"`
	CometIndex                  string                          `json:"cometIndex"`
	ExecutionHeight             string                          `json:"executionHeight"`
	ExecutionCode               string                          `json:"executionCode"`
	PreparedRequest             pqContractDeployPreparedRequest `json:"preparedRequest"`
	HTTP                        []pqContractDeployPublicHTTP    `json:"http"`
}

type pqContractDeployPublicPayload struct {
	Name                 string   `json:"name"`
	SourceHash           string   `json:"sourceHash"`
	DeployedBytecodeHash string   `json:"deployedBytecodeHash"`
	CompilerConfigHash   string   `json:"compilerConfigHash"`
	ConstructorArgs      []string `json:"constructorArgs"`
	Value                string   `json:"value"`
}

type pqContractDeployPreparedRequest struct {
	Method          string `json:"method"`
	Path            string `json:"path"`
	ContentType     string `json:"contentType"`
	Body            []byte `json:"body"`
	Executed        bool   `json:"executed"`
	EncodedRPCBytes string `json:"encodedRpcBytes"`
	MaxRPCBytes     string `json:"maxRpcBytes"`
	EligibleForRPC  bool   `json:"eligibleForRpc"`
}

func pqContractDeploySHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func capturePQContractDeployGET(t *testing.T, g *Gateway, path string) pqContractDeployPublicHTTP {
	t.Helper()
	w := httptest.NewRecorder()
	g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("actual deployment GET was cacheable")
	}
	body := bytes.Clone(w.Body.Bytes())
	return pqContractDeployPublicHTTP{Method: http.MethodGet, Path: path, StatusCode: strconv.Itoa(w.Code), ContentType: w.Header().Get("Content-Type"), CacheControl: w.Header().Get("Cache-Control"), Body: body, BodySHA256: pqContractDeploySHA(body)}
}

func emitPQContractDeployPublicFixture(t *testing.T, observed *pqFinalityFixture, before consensus.PQWalletAccountView, source string, material chain.ConsensusContractMaterial, payload ynxauth.ContractDeployPayload, responses []pqContractDeployPublicHTTP) {
	t.Helper()
	wire, raw := observed.f.wire, observed.f.payload
	decoded, action, err := consensus.DecodePQActionTransport(raw)
	if err != nil || !bytes.Equal(decoded, wire) || action.Kind != ynxauth.ActionContractDeploy {
		t.Fatal("public deploy export lost its actual compiled transport", err)
	}
	value, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil || !reflect.DeepEqual(value, payload) {
		t.Fatal("public deployment input differs from signed payload", err)
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil || member.Certificate.N != 2 || member.Index != 1 {
		t.Fatal("public deployment must preserve the original non-N1 Member", err)
	}
	var outer map[string]json.RawMessage
	var encodedMaterial chain.ConsensusContractMaterial
	if json.Unmarshal(raw, &outer) != nil || len(outer) != 5 || json.Unmarshal(outer["material"], &encodedMaterial) != nil || !bytes.Equal(encodedMaterial.ArtifactFile, material.ArtifactFile) || !bytes.Equal(encodedMaterial.BuildInfoFile, material.BuildInfoFile) {
		t.Fatal("deployment export requires exactly five original fields and complete raw material")
	}
	fields := []string{"version", "type", "wireHex", "source", "material"}
	for _, field := range fields {
		if len(outer[field]) == 0 {
			t.Fatal("missing original deploy field", field)
		}
	}
	if consensus.ValidatePQWalletAccountView(before, action.Owner) != nil || before.ExecutionHeight != uint64(observed.tx.Height) || before.LedgerNonce+1 != action.Nonce {
		t.Fatal("public deployment prestate is not the original next-execution account view")
	}
	history, tx := actionQuery(t, observed.f, consensus.SignedTransactionHash(wire))
	if tx.Type != ynxauth.ActionContractDeploy || history.ExecutionHeight != uint64(observed.tx.Height) || !bytes.Equal(history.Transport, raw) || observed.tx.TxResult.Code != 0 || len(responses) != 4 {
		t.Fatal("public deployment lacks its real execution/history/four GET responses")
	}
	sourcePath := filepath.ToSlash(filepath.Join("contracts", "devtools", payload.Name+".sol"))
	artifactPath := "artifacts/" + sourcePath + "/" + payload.Name + ".json"
	var artifact struct {
		BuildInfoID string `json:"buildInfoId"`
	}
	if json.Unmarshal(material.ArtifactFile, &artifact) != nil || artifact.BuildInfoID == "" || strings.ContainsAny(artifact.BuildInfoID, `/\`) {
		t.Fatal("actual compiled artifact has no confined build-info identity")
	}
	buildPath := "artifacts/build-info/" + artifact.BuildInfoID + ".json"
	sourceRaw, err := os.ReadFile(filepath.Join("..", "..", filepath.FromSlash(sourcePath)))
	if err != nil || strings.TrimSpace(string(sourceRaw)) != source {
		t.Fatal("source changed after actual deployment", err)
	}
	fixture := pqContractDeployPublicFixture{
		Version: "YNX-PQ-CONTRACT-DEPLOY-PUBLIC/v1", Classification: "data", SourceTest: "TestGatewayPQActionFinalityRetainsCompiledContractTransport", SyntheticOnly: true,
		ApplicationExecution: "normal-handshake-blockexecutor-commit", ProofVerification: "not-performed",
		AccountBefore: before, History: history, TransactionType: consensus.PQActionType, ActionKind: action.Kind, Owner: action.Owner,
		NetworkID: hex.EncodeToString(action.ChainID), NativeChainID: strconv.FormatUint(action.NativeChainID, 10), Nonce: strconv.FormatUint(action.Nonce, 10), Fee: strconv.FormatUint(action.Fee, 10),
		Payload: pqContractDeployPublicPayload{Name: payload.Name, SourceHash: payload.SourceHash, DeployedBytecodeHash: payload.DeployedBytecodeHash, CompilerConfigHash: payload.CompilerConfigHash, ConstructorArgs: make([]string, len(payload.ConstructorArgs)), Value: strconv.FormatUint(payload.Value, 10)},
		Source:  source, NativeWire: bytes.Clone(wire), NativeWireSHA256: pqContractDeploySHA(wire), Transport: bytes.Clone(raw), TransportSHA256: pqContractDeploySHA(raw), TransportFields: fields,
		MemberN: strconv.FormatUint(uint64(member.Certificate.N), 10), MemberIndex: strconv.FormatUint(uint64(member.Index), 10), CometIndex: strconv.FormatUint(uint64(observed.tx.Index), 10), ExecutionHeight: strconv.FormatInt(observed.tx.Height, 10), ExecutionCode: strconv.FormatUint(uint64(observed.tx.TxResult.Code), 10),
		PreparedRequest: pqContractDeployPreparedRequest{Method: http.MethodPost, Path: "/transactions/pq/actions/broadcast", ContentType: "application/json", Body: bytes.Clone(raw), EncodedRPCBytes: strconv.Itoa(4*((len(raw)+2)/3) + 74), MaxRPCBytes: "792658", EligibleForRPC: 4*((len(raw)+2)/3)+74 <= 792658}, HTTP: responses,
	}
	for i, arg := range payload.ConstructorArgs {
		fixture.Payload.ConstructorArgs[i] = strconv.FormatUint(arg, 10)
	}
	for _, file := range []struct {
		role, path string
		raw        []byte
	}{{"source", sourcePath, sourceRaw}, {"artifactFile", artifactPath, material.ArtifactFile}, {"buildInfoFile", buildPath, material.BuildInfoFile}} {
		actual, err := os.ReadFile(filepath.Join("..", "..", filepath.FromSlash(file.path)))
		if err != nil || !bytes.Equal(actual, file.raw) {
			t.Fatal("compiled deployment input changed before public export", file.path, err)
		}
		fixture.Files = append(fixture.Files, pqContractDeployPublicFile{Role: file.role, Path: file.path, ByteLength: strconv.Itoa(len(file.raw)), SHA256: pqContractDeploySHA(file.raw), Bytes: bytes.Clone(file.raw)})
	}
	for _, request := range observed.requests {
		if strings.Contains(request, "broadcast") {
			t.Fatal("export must not invent or replay a broadcast")
		}
	}
	// Account views require their exact compact JSON. Expanding the container
	// changes the nested bytes passed to the production canonical decoder.
	data, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	var roundtrip pqContractDeployPublicFixture
	if err := json.Unmarshal(data, &roundtrip); err != nil {
		t.Fatal("public deployment canonical serialization did not decode", err)
	}
	if !bytes.Equal(roundtrip.Transport, raw) || !bytes.Equal(roundtrip.NativeWire, wire) || !reflect.DeepEqual(roundtrip.Files, fixture.Files) || !reflect.DeepEqual(roundtrip.HTTP, responses) || !bytes.Equal(roundtrip.PreparedRequest.Body, raw) || roundtrip.BroadcastExecuted || roundtrip.PreparedRequest.Executed || roundtrip.IndependentFinality || roundtrip.NativeGrant || roundtrip.PublicBFT || roundtrip.ActualCometNode || roundtrip.DeployedSourceQualification {
		t.Fatal("public deployment serialization changed raw bytes or claimed a higher evidence layer")
	}
	for _, field := range []struct {
		name               string
		original, restored any
	}{
		{"accountBefore", fixture.AccountBefore, roundtrip.AccountBefore},
		{"history", fixture.History, roundtrip.History},
	} {
		expectedJSON, err := json.Marshal(field.original)
		if err != nil {
			t.Fatal("cannot encode original public deployment state", field.name, err)
		}
		restoredJSON, err := json.Marshal(field.restored)
		if err != nil || !bytes.Equal(expectedJSON, restoredJSON) {
			t.Fatal("public deployment changed original account or history JSON", field.name, err)
		}
	}
	// The SDK's exact contract payload includes value, even when it is zero.
	// Re-encode the exported decimal strings through the original Go codec so
	// the public projection cannot omit or invent a signed field.
	projected := ynxauth.ContractDeployPayload{Name: roundtrip.Payload.Name, SourceHash: roundtrip.Payload.SourceHash, DeployedBytecodeHash: roundtrip.Payload.DeployedBytecodeHash, CompilerConfigHash: roundtrip.Payload.CompilerConfigHash}
	projected.Value, err = strconv.ParseUint(roundtrip.Payload.Value, 10, 64)
	if err != nil || strconv.FormatUint(projected.Value, 10) != roundtrip.Payload.Value {
		t.Fatal("public deployment value is not the original canonical decimal", err)
	}
	for _, decimal := range roundtrip.Payload.ConstructorArgs {
		arg, err := strconv.ParseUint(decimal, 10, 64)
		if err != nil || strconv.FormatUint(arg, 10) != decimal {
			t.Fatal("public deployment constructor argument is not an exact decimal", err)
		}
		projected.ConstructorArgs = append(projected.ConstructorArgs, arg)
	}
	projectedBytes, err := ynxauth.EncodeActionPayload(roundtrip.ActionKind, projected)
	if err != nil || !bytes.Equal(projectedBytes, action.Payload) {
		t.Fatal("public deployment payload differs from the actual signed Member", err)
	}
	output := os.Getenv("YNX_PQ_CONTRACT_DEPLOY_FIXTURE_OUT")
	if output == "" {
		return
	}
	if err := writePQContractDeployPublicFixture(output, data); err != nil {
		t.Fatal("public deployment output incomplete; retain original/partial", err)
	}
	// Normal producer acceptance also proves the old artifact cannot be replaced
	// by a second output, including an attempted truncation of the exact path.
	if err := writePQContractDeployPublicFixture(output, []byte("replacement")); !errors.Is(err, os.ErrExist) {
		t.Fatal("public deployment output allowed reuse", err)
	}
	readback, err := os.ReadFile(output)
	if err != nil || !bytes.Equal(readback, data) {
		t.Fatal("public deployment output changed during reuse rejection", err)
	}
	t.Logf("PQ_CONTRACT_DEPLOY_PUBLIC_FIXTURE version=%s bytes=%d sha256=%s broadcastExecuted=false independentFinality=false", fixture.Version, len(data), pqContractDeploySHA(data))
}

func writePQContractDeployPublicFixture(path string, raw []byte) (err error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.TrimSpace(path) != path || len(raw) == 0 || len(raw) > 32<<20 {
		return errors.New("public deployment fixture requires a bounded explicit absolute new file")
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	before, err := f.Stat()
	if err != nil {
		return err
	}
	if n, err := f.Write(raw); err != nil || n != len(raw) {
		return fmt.Errorf("public deployment partial output retained: wrote=%d error=%v", n, err)
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	readback, err := io.ReadAll(io.LimitReader(f, int64(len(raw))+1))
	after, statErr := f.Stat()
	entry, pathErr := os.Lstat(path)
	if err != nil || statErr != nil || pathErr != nil || !after.Mode().IsRegular() || after.Mode().Perm() != 0600 || !os.SameFile(before, after) || !os.SameFile(after, entry) || !bytes.Equal(readback, raw) {
		return errors.New("public deployment output readback failed; original attempt retained")
	}
	parent, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	return errors.Join(parent.Sync(), parent.Close())
}
