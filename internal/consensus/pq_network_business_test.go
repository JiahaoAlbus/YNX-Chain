package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const pqNetworkBusinessClientCommit = "3f5b1ce792616b01b38fe4320c6d4d83fbcc22a0"
const pqNetworkBusinessOptIn = "authorized-four-node-business-window"

type pqNetworkBusinessBinary struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Commit string `json:"commit"`
	Bytes  int64  `json:"bytes"`
}

// The independent manifest pin comes from the normal build caller, never a
// node, an RPC response or this test's generated fixture. It pins the actual
// running test too. A manifest is DATA, not a public validator/Wallet grant.
type pqNetworkBusinessManifest struct {
	Version                 string                             `json:"version"`
	ProtocolCommit          string                             `json:"protocolCommit"`
	PerformanceClientCommit string                             `json:"performanceClientCommit"`
	SourceRoot              string                             `json:"sourceRoot"`
	SourceLeaves            map[string]string                  `json:"sourceLeaves"`
	Binaries                map[string]pqNetworkBusinessBinary `json:"binaries"`
}

func pqBusinessHash(raw []byte) string {
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

func pqBusinessPin(s string, size int) bool {
	raw, err := hex.DecodeString(s)
	return err == nil && len(raw) == size && hex.EncodeToString(raw) == s && s != strings.Repeat("0", size*2)
}

func pqBusinessRead(path string, limit int64) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("canonical absolute original input required")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("original input may not traverse a symlink")
	}
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || before.Size() < 1 || before.Size() > limit {
		return nil, errors.New("bounded protected original input required")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return nil, errors.New("original input changed during open")
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	after, statErr := f.Stat()
	named, nameErr := os.Lstat(path)
	if err != nil || statErr != nil || nameErr != nil || int64(len(raw)) != before.Size() || !os.SameFile(before, after) || !os.SameFile(after, named) || before.Mode() != after.Mode() || before.Mode() != named.Mode() || before.Size() != named.Size() || !before.ModTime().Equal(after.ModTime()) || !after.ModTime().Equal(named.ModTime()) {
		return nil, errors.New("original input changed during read")
	}
	return raw, nil
}

func pqBusinessCheckBinary(p pqNetworkBusinessBinary) error {
	if p.Bytes < 20 || p.Bytes > 128<<20 || !pqBusinessPin(p.SHA256, 32) || !pqBusinessPin(p.Commit, 20) {
		return errors.New("independent bounded executable identity required")
	}
	// This is a streaming executable pin, not executable-sized allocation or an
	// ELF invocation. Before/after identity is checked again for every subprocess.
	resolved, err := filepath.EvalSymlinks(p.Path)
	if err != nil || !filepath.IsAbs(p.Path) || filepath.Clean(p.Path) != p.Path || resolved != p.Path {
		return errors.New("canonical original executable required")
	}
	before, err := os.Lstat(p.Path)
	if err != nil || !before.Mode().IsRegular() || before.Size() != p.Bytes || before.Mode().Perm()&0022 != 0 || before.Mode().Perm()&0111 == 0 {
		return errors.New("original executable metadata differs")
	}
	f, err := os.Open(p.Path)
	if err != nil {
		return err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return errors.New("executable changed before streaming pin")
	}
	header := make([]byte, 20)
	if _, err = io.ReadFull(f, header); err != nil || !bytes.Equal(header[:6], []byte{0x7f, 'E', 'L', 'F', 2, 1}) || !bytes.Equal(header[18:20], []byte{0x3e, 0}) || !bytes.Equal(header[16:18], []byte{2, 0}) && !bytes.Equal(header[16:18], []byte{3, 0}) {
		return errors.New("normal precompiled Linux amd64 ELF required")
	}
	h := sha256.New()
	_, _ = h.Write(header)
	n, err := io.CopyBuffer(h, io.LimitReader(f, (128<<20)+1), make([]byte, 32<<10))
	after, statErr := f.Stat()
	named, nameErr := os.Lstat(p.Path)
	if err != nil || statErr != nil || nameErr != nil || n+20 != p.Bytes || !os.SameFile(before, after) || !os.SameFile(after, named) || before.Size() != named.Size() || before.Mode() != named.Mode() || !before.ModTime().Equal(after.ModTime()) || !after.ModTime().Equal(named.ModTime()) || hex.EncodeToString(h.Sum(nil)) != p.SHA256 {
		return errors.New("original executable differs from independent pin")
	}
	return nil
}

func pqBusinessManifest(raw []byte, pin, commit, source, executable string) (pqNetworkBusinessManifest, error) {
	var m pqNetworkBusinessManifest
	if len(raw) > 64<<10 || !pqBusinessPin(pin, 32) || pqBusinessHash(raw) != pin || !pqBusinessPin(commit, 20) || pqLightUniqueJSON(raw) != nil {
		return m, errors.New("independent normal build manifest pin required")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&m) != nil || d.Decode(new(any)) != io.EOF || m.Version != "YNX-PQ-NETWORK-BUSINESS-BUILD/v1" || m.ProtocolCommit != commit || m.PerformanceClientCommit != pqNetworkBusinessClientCommit || m.SourceRoot != source {
		return m, errors.New("closed original source/client manifest differs")
	}
	var shape map[string]json.RawMessage
	if json.Unmarshal(raw, &shape) != nil || len(shape) != 6 {
		return m, errors.New("exact normal manifest fields required")
	}
	for _, field := range []string{"version", "protocolCommit", "performanceClientCommit", "sourceRoot", "sourceLeaves", "binaries"} {
		if len(shape[field]) == 0 || bytes.Equal(shape[field], []byte("null")) {
			return m, errors.New("manifest field alias or omission refused")
		}
	}
	var binaryShapes map[string]map[string]json.RawMessage
	if json.Unmarshal(shape["binaries"], &binaryShapes) != nil {
		return m, errors.New("exact binary manifest fields required")
	}
	leaves := []string{"internal/consensus/pq_network_e2e_test.go", "internal/consensus/pq_network_business_test.go"}
	if len(m.SourceLeaves) != len(leaves) || len(m.Binaries) != 4 {
		return m, errors.New("exact source and four executable allowlist required")
	}
	for _, leaf := range leaves {
		raw, err := pqBusinessRead(filepath.Join(source, leaf), 256<<10)
		if err != nil || !pqBusinessPin(m.SourceLeaves[leaf], 32) || pqBusinessHash(raw) != m.SourceLeaves[leaf] {
			return m, errors.New("actual normal test source differs")
		}
	}
	var total int64
	seen := map[string]bool{}
	for _, name := range []string{"consensus.test", "ynx-bft-gatewayd", "ynx-consensus-perf-client", "ynx-consensus-proof-verify"} {
		p, exists := m.Binaries[name]
		fields := binaryShapes[name]
		if len(fields) != 4 || len(fields["path"]) == 0 || len(fields["sha256"]) == 0 || len(fields["commit"]) == 0 || len(fields["bytes"]) == 0 {
			return m, errors.New("exact original executable fields required")
		}
		wanted := commit
		if name == "ynx-consensus-perf-client" {
			wanted = pqNetworkBusinessClientCommit
		}
		if !exists || p.Commit != wanted || seen[p.SHA256] || pqBusinessCheckBinary(p) != nil || name == "consensus.test" && p.Path != executable {
			return m, errors.New("distinct actual executable/source identity differs")
		}
		seen[p.SHA256] = true
		total += p.Bytes
	}
	if total > 512<<20 {
		return m, errors.New("unchanged build budget exceeded")
	}
	return m, nil
}

type pqNetworkBusiness struct {
	manifest    pqNetworkBusinessManifest
	root        string
	initialKey  *ynxbatch.PrivateKey
	initialPair ynxbatch.PublicKey
	initial     string
	funding     string
	gateway     *exec.Cmd
	gatewayDone chan error
	url         string
	rows        []pqNetworkBusinessRow
}

func TestPQNetworkFourValidatorSignedBusinessConsumerAndIndependentFinality(t *testing.T) {
	mode := os.Getenv("YNX_PQ_NETWORK_BUSINESS_E2E")
	if mode == "" {
		t.Skip("requires the separately authorized bounded signed-business network window")
	}
	if mode != pqNetworkBusinessOptIn || runtime.GOOS != "linux" || os.Getenv("YNX_PQ_NETWORK_E2E") != "" || os.Getenv("YNX_PQ_NETWORK_REMOTE_E2E") != "" || os.Getenv("YNX_PQ_REMOTE_PROCESS") != "" {
		t.Fatal("exclusive normal Linux business window required")
	}
	manifestPath := os.Getenv("YNX_PQ_NETWORK_BUSINESS_MANIFEST")
	raw, err := pqBusinessRead(manifestPath, 64<<10)
	if err != nil {
		t.Fatal("normal build manifest unavailable before any identity/node creation")
	}
	source, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	m, err := pqBusinessManifest(raw, os.Getenv("YNX_PQ_NETWORK_BUSINESS_MANIFEST_SHA256"), os.Getenv("YNX_PQ_NETWORK_BUSINESS_SOURCE_COMMIT"), source, executable)
	if err != nil {
		t.Fatal("normal business pre-node executable/source pin rejected:", err)
	}
	root, err := os.MkdirTemp("", "ynx-pq-signed-business-")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	b := &pqNetworkBusiness{manifest: m, root: root}
	// Retain the original private case, all signed intents and UNKNOWN on failure.
	// The normal enclosing Linux guard owns the unchanged 105s/120s resources.
	runPQNetworkFourValidatorWithBusiness(t, nil, b)
	if t.Failed() {
		return
	}
	for _, p := range m.Binaries {
		if err := pqBusinessCheckBinary(p); err != nil {
			t.Fatal("original business executable changed after cleanup")
		}
	}
	rawSummary, err := json.Marshal(map[string]any{"version": "YNX-PQ-NETWORK-SIGNED-BUSINESS/v1", "syntheticOnly": true, "clientCommit": pqNetworkBusinessClientCommit, "protocolCommit": m.ProtocolCommit, "rows": b.rows, "sustainedTPSQualified": false, "publicDeployment": false, "nativeGrant": false})
	if err != nil {
		t.Fatal(err)
	}
	pqBusinessWrite(t, filepath.Join(root, "business.public.json"), rawSummary)
	t.Logf("PQ_NETWORK_BUSINESS_SUMMARY %s", rawSummary)
}

func (b *pqNetworkBusiness) seed(t *testing.T, d *chain.Devnet) {
	var err error
	b.initialKey, b.initialPair, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(b.initialKey.Destroy)
	address, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	b.initial = mustNativeAddress(t, address)
	funding, err := d.Faucet(b.initial, 1000)
	if err != nil {
		t.Fatal(err)
	}
	b.funding = funding.Hash
}

func (b *pqNetworkBusiness) genesis(t *testing.T, m chain.ConsensusMigrationState, raw []byte) []byte {
	binding, err := PreparePQInitialPreparedFundingBinding(m, b.initial, b.initialPair.PKA, b.initialPair.PKB, b.funding)
	if err != nil {
		t.Fatal(err)
	}
	configuration := PQInitialAccountConfiguration{Version: PQInitialAccountsVersion, NetworkID: m.OriginalGenesisHash, EnableAt: strconv.FormatUint(m.AccountPolicy.EnableAt, 10), BirthFee: "0", Accounts: []PQInitialAccountBinding{binding}}
	out, err := EncodePQInitialAccountGenesis(raw, m, configuration)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func pqBusinessWrite(t *testing.T, path string, raw []byte) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal("retain original business/UNKNOWN; exclusive write refused")
	}
	n, writeErr := f.Write(raw)
	err = errors.Join(writeErr, f.Sync(), f.Close())
	if err != nil || n != len(raw) {
		t.Fatal("business original exclusive persistence failed; do not replay")
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if err = errors.Join(d.Sync(), d.Close()); err != nil {
		t.Fatal(err)
	}
}

type pqBusinessLog struct {
	file *os.File
	left int
}

func (w *pqBusinessLog) Write(raw []byte) (int, error) {
	if len(raw) > w.left {
		return 0, errors.New("bounded business process log exceeded")
	}
	w.left -= len(raw)
	return w.file.Write(raw)
}

func (b *pqNetworkBusiness) command(t *testing.T, ctx context.Context, label, binary string, input []byte, args ...string) (*exec.Cmd, func()) {
	t.Helper()
	p := b.manifest.Binaries[binary]
	if err := pqBusinessCheckBinary(p); err != nil {
		t.Fatal("original process binary changed before invocation")
	}
	cmd := exec.CommandContext(ctx, p.Path, args...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "TZ=UTC", "GOMAXPROCS=1", "GOGC=50", "GOMEMLIMIT=256MiB"}
	cmd.Stdin = bytes.NewReader(input)
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 2 * time.Second
	var files []*os.File
	for _, stream := range []string{"stdout", "stderr"} {
		f, err := os.OpenFile(filepath.Join(b.root, label+"."+stream), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal("original process log exists; retain UNKNOWN")
		}
		files = append(files, f)
		w := &pqBusinessLog{file: f, left: 16 << 10}
		if stream == "stdout" {
			cmd.Stdout = w
		} else {
			cmd.Stderr = w
		}
	}
	return cmd, func() {
		for _, f := range files {
			if err := errors.Join(f.Sync(), f.Close()); err != nil {
				t.Error("private process log persistence failed")
			}
		}
		if err := pqBusinessCheckBinary(p); err != nil {
			t.Error("original process binary changed after invocation")
		}
	}
}

func (b *pqNetworkBusiness) runCommand(t *testing.T, ctx context.Context, label, binary string, input []byte, args ...string) int {
	cmd, finish := b.command(t, ctx, label, binary, input, args...)
	defer finish()
	err := cmd.Run()
	if err == nil {
		return 0
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 && ctx.Err() == nil {
		return 1
	}
	t.Fatal("original bounded business subprocess failed; preserve UNKNOWN")
	return -1
}

func (b *pqNetworkBusiness) close(t *testing.T) {
	if b.gateway == nil {
		return
	}
	_ = b.gateway.Process.Signal(os.Interrupt)
	select {
	case err := <-b.gatewayDone:
		if err != nil {
			t.Error("normal Gateway did not complete graceful exit")
		}
	case <-time.After(2 * time.Second):
		_ = b.gateway.Process.Kill()
		select {
		case <-b.gatewayDone:
		case <-time.After(time.Second):
			t.Error("normal business Gateway process did not exit")
		}
	}
	b.gateway = nil
}

func (b *pqNetworkBusiness) startGateway(n *pqNetworkE2E) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		n.t.Fatal(err)
	}
	address := l.Addr().String()
	if err = l.Close(); err != nil {
		n.t.Fatal(err)
	}
	b.url = "http://" + address
	cmd, finish := b.command(n.t, n.ctx, "gateway", "ynx-bft-gatewayd", nil, "-http", address, "-comet-rpc", "http://"+strings.TrimPrefix(n.nodes[0].config.RPC.ListenAddress, "tcp://"))
	if err := cmd.Start(); err != nil {
		finish()
		n.t.Fatal("normal pinned Gateway failed to start")
	}
	b.gateway, b.gatewayDone = cmd, make(chan error, 1)
	go func() { err := cmd.Wait(); finish(); b.gatewayDone <- err }()
	client := &http.Client{Timeout: time.Second}
	n.wait("normal business gateway ready", func() bool {
		select {
		case <-b.gatewayDone:
			n.t.Fatal("normal Gateway exited before readiness")
		default:
		}
		response, err := client.Get(b.url + "/health")
		if err != nil {
			return false
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4097))
		return response.StatusCode == http.StatusOK
	})
}

type pqNetworkBusinessRow struct {
	Kind                         string `json:"kind"`
	Outcome                      string `json:"outcome"`
	TransactionHash              string `json:"transactionHash"`
	Height                       int64  `json:"height"`
	FinalizedBusinesses          int    `json:"finalizedBusinesses"`
	RejectedMembers              int    `json:"rejectedMembers"`
	RegistrationFinalized        bool   `json:"registrationFinalized"`
	InitialSubmissionUnknown     bool   `json:"initialSubmissionUnknown"`
	IndependentFinalityVerified  bool   `json:"independentFinalityVerified"`
	OfferToIndependentFinalityNs int64  `json:"offerToIndependentFinalityNs"`
}

func pqBusinessClassify(kind string, result PQTransactionProofResult) (pqNetworkBusinessRow, error) {
	r := pqNetworkBusinessRow{Kind: kind, Outcome: result.Outcome, Height: result.Height}
	if result.Version != PQTransactionProofVersion || result.Classification != "data" || result.TransactionType != kind || !result.Included || !result.Finalized || result.NativeGrant || !pqBusinessPin(result.TransactionHash, 32) || result.Height < 1 {
		return r, errors.New("independent proof does not bind a finalized original transaction")
	}
	r.TransactionHash = result.TransactionHash
	r.IndependentFinalityVerified = true
	if kind == PQInitialRegistrationType {
		if result.Outcome != "succeeded" || !result.ExecutionSuccessful || result.ExecutionCode != 0 {
			return r, errors.New("initial registration did not actually finalize")
		}
		r.RegistrationFinalized = true
		return r, nil // Birth is never counted as a transferred business member.
	}
	if kind == PQWholeType {
		for index, member := range result.BatchResults {
			if member.Index != uint32(index) {
				return r, errors.New("Whole result order differs from signed original order")
			}
			switch member.Outcome {
			case "admitted":
				r.FinalizedBusinesses++
			case "rejected":
				r.RejectedMembers++
			default:
				return r, errors.New("unknown independently proven Whole outcome")
			}
		}
		if result.Outcome == "partial" && (r.FinalizedBusinesses == 0 || r.RejectedMembers == 0 || result.ExecutionSuccessful || result.ExecutionCode != 0) {
			return r, errors.New("partial Whole cannot be promoted to complete success")
		}
	} else if kind != PQTransferType {
		return r, errors.New("unsupported business counting profile")
	} else if result.Outcome == "succeeded" && result.ExecutionSuccessful {
		r.FinalizedBusinesses = 1
	}
	if result.Outcome == "rejected" && (result.ExecutionSuccessful || r.FinalizedBusinesses != 0 || result.ExecutionCode == 0) {
		return r, errors.New("rejected execution cannot release business success")
	}
	if result.Outcome == "succeeded" && (!result.ExecutionSuccessful || result.ExecutionCode != 0 || r.FinalizedBusinesses < 1 || r.RejectedMembers != 0) {
		return r, errors.New("success requires actual complete effect success")
	}
	if result.Outcome == "partial" && kind != PQWholeType {
		return r, errors.New("only Whole can carry a partial result")
	}
	if result.Outcome != "succeeded" && result.Outcome != "partial" && result.Outcome != "rejected" {
		return r, errors.New("unknown independently proven execution outcome")
	}
	return r, nil
}

func (b *pqNetworkBusiness) run(n *pqNetworkE2E, wallet *ynxbatch.PrivateKey) {
	b.startGateway(n)
	h := n.quiet(4)
	initial := ynxauth.RegistrationIntent{ChainID: n.nativeGenesis, Owner: b.initial, PKA: b.initialPair.PKA, PKB: b.initialPair.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: uint64(h + 2)}
	message, err := initial.SigningBytes()
	if err != nil {
		n.t.Fatal(err)
	}
	_, member := consensusPQProof(n.t, b.initialKey, n.nativeGenesis, b.initial, ynxauth.TransactionPurpose, message)
	b.consume(n, "initial", PQInitialRegistrationType, member)
	before := n.account(0, n.owner)
	transfer := ynxauth.Transfer{ChainID: n.nativeGenesis, NativeChainID: 6423, From: n.owner, To: n.recipient, Amount: 2, Fee: 1, Nonce: before.Nonce + 1}
	message, err = transfer.SigningBytes()
	if err != nil {
		n.t.Fatal(err)
	}
	_, member = consensusPQProof(n.t, wallet, n.nativeGenesis, n.owner, ynxauth.TransactionPurpose, message)
	b.consume(n, "member", PQTransferType, member)
	if after := n.account(0, n.owner); after.Nonce != before.Nonce+1 || after.Balance != before.Balance-3 {
		n.t.Fatal("Gateway Member changed unexpected real account fee/nonce")
	}
	before = n.account(0, n.owner)
	transfer.Amount, transfer.Nonce = 1, before.Nonce+1
	first, err := transfer.SigningBytes()
	if err != nil {
		n.t.Fatal(err)
	}
	// Both are genuinely signed. The first spends this next nonce, the second
	// must be rejected at its original ordered index without losing the first.
	transfer.Amount = 3
	second, err := transfer.SigningBytes()
	if err != nil {
		n.t.Fatal(err)
	}
	batch, err := ynxbatch.BatchSign(wallet, ynxbatch.Metadata{ChainID: n.nativeGenesis, Owner: n.owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{first, second}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		n.t.Fatal(err)
	}
	defer batch.Discard()
	whole, err := batch.WholeWire()
	if err != nil {
		n.t.Fatal(err)
	}
	b.consume(n, "whole-partial", PQWholeType, whole)
	if after := n.account(0, n.owner); after.Nonce != before.Nonce+1 || after.Balance != before.Balance-2 {
		n.t.Fatal("partial Whole released a rejected member effect or lost its admitted effect")
	}
	if len(b.rows) != 3 || !b.rows[0].RegistrationFinalized || b.rows[0].FinalizedBusinesses != 0 || b.rows[1].FinalizedBusinesses != 1 || b.rows[2].Outcome != "partial" || b.rows[2].FinalizedBusinesses != 1 || b.rows[2].RejectedMembers != 1 {
		n.t.Fatal("actual initial/single/partial outcomes were collapsed into success")
	}
	b.close(n.t)
}

func (b *pqNetworkBusiness) consume(n *pqNetworkE2E, label, kind string, wire []byte) {
	checkpoint := n.quiet(4)
	if err := pqNetworkE2EBlockBudget(n.doc.InitialHeight, checkpoint, pqNetworkE2ESubmissionBlocks); err != nil {
		n.t.Fatal("unchanged network block budget refuses business offer")
	}
	path := filepath.Join(b.root, label+".wire")
	pqBusinessWrite(n.t, path, wire)
	flag := "-pq-member"
	if kind == PQWholeType {
		flag = "-pq-whole"
	} else if kind == PQInitialRegistrationType {
		flag = "-pq-register"
	}
	payload, err := EncodePQTransaction(kind, wire)
	if err != nil {
		n.t.Fatal(err)
	}
	started := time.Now()
	submission := filepath.Join(b.root, label+".submit.json")
	code := b.runCommand(n.t, n.ctx, label+"-submit", "ynx-consensus-perf-client", nil, flag, path, "-pq-gateway", b.url, "-output", submission, "-timeout", "10s")
	submitRaw, err := pqBusinessRead(submission, 64<<10)
	if err != nil {
		n.t.Fatal("original client report missing; preserve signed intent and never repeat offer")
	}
	var submitted struct {
		SubmissionAttempts       int
		ABCITransactionHash      string
		InitialSubmissionUnknown bool
		Status                   string
	}
	if json.Unmarshal(submitRaw, &submitted) != nil || submitted.SubmissionAttempts != 1 || submitted.ABCITransactionHash != SignedTransactionHash(payload) || code != 0 && !submitted.InitialSubmissionUnknown {
		n.t.Fatal("original client did not preserve exactly one real signed offer")
	}
	var height int64
	var index int
	n.wait("original bytes included and committed", func() bool {
		for h := checkpoint + 1; h <= n.nodes[0].node.BlockStore().Height(); h++ {
			block := n.nodes[0].node.BlockStore().LoadBlock(h)
			if block == nil {
				continue
			}
			for i, raw := range block.Data.Txs {
				if bytes.Equal(raw, payload) {
					height, index = h, i
					return true
				}
			}
		}
		return false
	})
	n.quiet(4)
	n.verifyCommit(height, true, 4, false)
	n.verifyCommit(height+1, true, 4, false)
	// The Host reads its actual stores and checkpoint BEFORE requesting an
	// untrusted Gateway proof. RPC can supply proof bytes, never target/trust.
	contextPath, contextPin, expected := b.hostContext(n, label, kind, wire, payload, height, index)
	readback := filepath.Join(b.root, label+".readback.json")
	args := []string{flag, path, "-pq-gateway", b.url, "-pq-readback-only", "-output", readback, "-timeout", "10s"}
	if kind != PQWholeType {
		args = append(args, "-pq-collect-proof", "-pq-proof-verifier", b.manifest.Binaries["ynx-consensus-proof-verify"].Path, "-pq-proof-verifier-sha256", b.manifest.Binaries["ynx-consensus-proof-verify"].SHA256, "-pq-trust-context", contextPath, "-pq-trust-context-sha256", contextPin)
	}
	if b.runCommand(n.t, n.ctx, label+"-readback", "ynx-consensus-perf-client", nil, args...) != 0 {
		n.t.Fatal("original readback/proof CLI failed; no business success and no rebroadcast")
	}
	proofRaw := b.collect(n, label, payload)
	request, err := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", "expected": expected, "proof": json.RawMessage(proofRaw)})
	if err != nil {
		n.t.Fatal(err)
	}
	pqBusinessWrite(n.t, filepath.Join(b.root, label+".verify-request.json"), request)
	if b.runCommand(n.t, n.ctx, label+"-verify", "ynx-consensus-proof-verify", request, "--trust-context", contextPath, "--trust-context-sha256", contextPin) != 0 {
		n.t.Fatal("independent original offline verifier rejected actual network proof")
	}
	verifiedRaw, err := pqBusinessRead(filepath.Join(b.root, label+"-verify.stdout"), 64<<10)
	if err != nil {
		n.t.Fatal(err)
	}
	var verified struct {
		Version, Code string
		Result        PQTransactionProofResult
	}
	if json.Unmarshal(verifiedRaw, &verified) != nil || verified.Version != "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1" || verified.Result.TransactionHash != strings.TrimPrefix(SignedTransactionHash(payload), "0x") || verified.Result.Height != height {
		n.t.Fatal("independent verifier did not bind the Host's exact original target")
	}
	row, err := pqBusinessClassify(kind, verified.Result)
	if err != nil {
		n.t.Fatal(err)
	}
	wantCode := "VERIFIED_TRANSACTION_DATA"
	if row.Outcome == "partial" {
		wantCode = "VERIFIED_TRANSACTION_PARTIAL_DATA"
	} else if row.Outcome == "rejected" {
		wantCode = "VERIFIED_TRANSACTION_REJECTED_DATA"
	}
	if verified.Code != wantCode || verified.Result.NativeWireHash != strings.TrimPrefix(SignedTransactionHash(wire), "0x") || verified.Result.Index != int64(index) {
		n.t.Fatal("independent verifier code/native wire/index differs from original Host target")
	}
	row.InitialSubmissionUnknown = submitted.InitialSubmissionUnknown
	row.OfferToIndependentFinalityNs = time.Since(started).Nanoseconds()
	b.rows = append(b.rows, row)
}

func (b *pqNetworkBusiness) collect(n *pqNetworkE2E, label string, payload []byte) []byte {
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(n.ctx, http.MethodGet, b.url+"/txs/"+SignedTransactionHash(payload)+"/pq-finality-proof", nil)
	if err != nil {
		n.t.Fatal(err)
	}
	response, err := client.Do(request)
	if err != nil {
		n.t.Fatal("normal Gateway proof collector unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, MaxPQTransactionProofRequestBytes+(64<<10)+1))
	if err != nil || response.StatusCode != http.StatusOK || len(raw) > MaxPQTransactionProofRequestBytes+(64<<10) || pqLightUniqueJSON(raw) != nil {
		n.t.Fatal("normal Gateway proof transport rejected; no fallback proof")
	}
	var v struct {
		ABCITransactionHash string
		IndependentFinality bool
		Proof               json.RawMessage
	}
	if json.Unmarshal(raw, &v) != nil || v.ABCITransactionHash != SignedTransactionHash(payload) || v.IndependentFinality || len(v.Proof) == 0 || bytes.Equal(v.Proof, []byte("null")) {
		n.t.Fatal("collector changed original envelope identity or claimed trust")
	}
	pqBusinessWrite(n.t, filepath.Join(b.root, label+".collector.json"), raw)
	return v.Proof
}

func (b *pqNetworkBusiness) lightBlock(n *pqNetworkE2E, height int64) *cmttypes.LightBlock {
	item := n.nodes[0]
	block := item.node.BlockStore().LoadBlock(height)
	set, err := item.store.LoadValidators(height)
	commit := item.node.BlockStore().LoadSeenCommit(height)
	if err != nil || block == nil || set == nil || commit == nil || set.VerifyCommit(n.doc.ChainID, commit.BlockID, height, commit) != nil || !bytes.Equal(commit.BlockID.Hash, block.Hash()) {
		n.t.Fatal("Host original BlockStore/validator-set target failed full verification")
	}
	return &cmttypes.LightBlock{SignedHeader: &cmttypes.SignedHeader{Header: &block.Header, Commit: commit}, ValidatorSet: set}
}

func (b *pqNetworkBusiness) hostContext(n *pqNetworkE2E, label, kind string, wire, payload []byte, height int64, index int) (string, string, json.RawMessage) {
	block, successor := b.lightBlock(n, height), b.lightBlock(n, height+1)
	trusted := b.lightBlock(n, n.schedule.ActivationHeight)
	statement := func(block *cmttypes.LightBlock) map[string]string {
		return map[string]string{"chainId": block.ChainID, "headerHeight": strconv.FormatInt(block.Height, 10), "blockHash": hex.EncodeToString(block.Hash()), "stateHeight": strconv.FormatInt(block.Height-1, 10), "stateAppHash": hex.EncodeToString(block.AppHash)}
	}
	// This target never consumes an RPC response, client report or collector.
	expected, err := json.Marshal(map[string]any{"block": statement(block), "successor": statement(successor), "transactionType": kind, "envelope": payload, "nativeWire": wire, "transactionHash": strings.TrimPrefix(SignedTransactionHash(payload), "0x"), "nativeWireHash": strings.TrimPrefix(SignedTransactionHash(wire), "0x"), "index": strconv.Itoa(index)})
	if err != nil {
		n.t.Fatal(err)
	}
	migration, err := n.migration.CanonicalJSON()
	if err != nil {
		n.t.Fatal(err)
	}
	schedule, err := json.Marshal(n.schedule)
	if err != nil {
		n.t.Fatal(err)
	}
	scheduleHash, err := n.schedule.Hash()
	if err != nil {
		n.t.Fatal(err)
	}
	trustedRaw, err := cmtjson.Marshal(trusted)
	if err != nil {
		n.t.Fatal(err)
	}
	stateRaw, err := pqBusinessRead(n.nodes[0].appPath, 32<<20)
	var state CommittedState
	if err != nil || decodeStrictJSON(stateRaw, &state) != nil || state.Height != n.nodes[0].node.BlockStore().Height() || state.Height < height+1 || state.AppHash == "" {
		n.t.Fatal("Host did not read its actual stable original checkpoint")
	}
	files := map[string][]byte{"migration": migration, "genesis": n.rawGenesis, "state": stateRaw, "schedule": schedule, "trusted": trustedRaw}
	paths := map[string]string{}
	for name, raw := range files {
		paths[name] = filepath.Join(b.root, label+".host-"+name+".json")
		pqBusinessWrite(n.t, paths[name], raw)
	}
	light := map[string]string{
		"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": n.doc.ChainID,
		"migrationFile": paths["migration"], "genesisFile": paths["genesis"], "stateFile": paths["state"], "scheduleFile": paths["schedule"],
		"scheduleHash": scheduleHash, "consensusGenesisSHA256": pqBusinessHash(n.rawGenesis), "originalGenesisHash": n.migration.OriginalGenesisHash, "migrationStateHash": n.migration.StateHash,
		"runtimePlanFile": "", "runtimePlanHash": "", "engineHeight": strconv.FormatInt(state.Height, 10), "engineAppHash": state.AppHash,
		"expectedHeaderHeight": strconv.FormatInt(block.Height, 10), "expectedBlockHash": hex.EncodeToString(block.Hash()), "expectedStateHeight": strconv.FormatInt(block.Height-1, 10), "expectedStateAppHash": hex.EncodeToString(block.AppHash),
		"trustedLightBlockFile": paths["trusted"], "trustedLightBlockSHA256": pqBusinessHash(trustedRaw), "trustingPeriodNanoseconds": strconv.FormatInt(int64(time.Hour), 10), "maxClockDriftNanoseconds": strconv.FormatInt(int64(time.Second), 10), "trustLevelNumerator": "1", "trustLevelDenominator": "3",
	}
	raw, err := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", "lightTrust": light, "expectedTransaction": json.RawMessage(expected)})
	if err != nil {
		n.t.Fatal(err)
	}
	path := filepath.Join(b.root, label+".host-context.json")
	pqBusinessWrite(n.t, path, raw)
	return path, pqBusinessHash(raw), expected
}

// Ordinary CI runs only these bounded DATA regressions. It does not create a
// network, generate production keys, invoke a CLI, or accept fake ELF execution.
func TestPQNetworkBusinessOutcomeAccountingDoesNotPromotePartialRejectedOrInitial(t *testing.T) {
	base := PQTransactionProofResult{Version: PQTransactionProofVersion, Classification: "data", TransactionType: PQTransferType, Height: 9, TransactionHash: strings.Repeat("1", 64), Included: true, Finalized: true, ExecutionSuccessful: true, Outcome: "succeeded"}
	if r, err := pqBusinessClassify(PQTransferType, base); err != nil || r.FinalizedBusinesses != 1 {
		t.Fatal("proven transfer accounting failed")
	}
	base.TransactionType = PQInitialRegistrationType
	if r, err := pqBusinessClassify(PQInitialRegistrationType, base); err != nil || !r.RegistrationFinalized || r.FinalizedBusinesses != 0 {
		t.Fatal("account birth was incorrectly counted as a transfer")
	}
	base.TransactionType, base.Outcome, base.ExecutionSuccessful = PQWholeType, "partial", false
	base.BatchResults = []PQTransactionBatchResult{{Index: 0, Outcome: "admitted"}, {Index: 1, Outcome: "rejected"}}
	if r, err := pqBusinessClassify(PQWholeType, base); err != nil || r.FinalizedBusinesses != 1 || r.RejectedMembers != 1 {
		t.Fatal("partial real result lost its ordered outcome accounting")
	}
	base.ExecutionSuccessful = true
	if _, err := pqBusinessClassify(PQWholeType, base); err == nil {
		t.Fatal("partial result was promoted to full success")
	}
	base.TransactionType, base.Outcome, base.ExecutionSuccessful, base.BatchResults = PQTransferType, "rejected", false, nil
	base.ExecutionCode = 1
	if r, err := pqBusinessClassify(PQTransferType, base); err != nil || r.FinalizedBusinesses != 0 {
		t.Fatal("rejected proof was promoted to business success")
	}
	for _, change := range []func(*PQTransactionProofResult){func(r *PQTransactionProofResult) { r.Finalized = false }, func(r *PQTransactionProofResult) { r.NativeGrant = true }, func(r *PQTransactionProofResult) { r.TransactionHash = "" }, func(r *PQTransactionProofResult) { r.ExecutionSuccessful = true }} {
		bad := base
		change(&bad)
		if _, err := pqBusinessClassify(PQTransferType, bad); err == nil {
			t.Fatal("unproven/rejected/authority result released a success row")
		}
	}
}

func TestPQNetworkBusinessPreflightPinsActualSourceAndNeverExecutesELFData(t *testing.T) {
	for _, scenario := range []string{"valid-data", "wrong-manifest-pin", "wrong-client-source", "missing-binary", "extra-binary", "duplicate-binary", "wrong-running-test", "changed-ELF", "not-ELF", "symlink-binary", "source-drift", "source-alias", "manifest-alias", "duplicate-field"} {
		t.Run(scenario, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(root, "source")
			if err := os.MkdirAll(filepath.Join(source, "internal", "consensus"), 0700); err != nil {
				t.Fatal(err)
			}
			commit := strings.Repeat("a", 40)
			m := pqNetworkBusinessManifest{Version: "YNX-PQ-NETWORK-BUSINESS-BUILD/v1", ProtocolCommit: commit, PerformanceClientCommit: pqNetworkBusinessClientCommit, SourceRoot: source, SourceLeaves: map[string]string{}, Binaries: map[string]pqNetworkBusinessBinary{}}
			for _, leaf := range []string{"internal/consensus/pq_network_e2e_test.go", "internal/consensus/pq_network_business_test.go"} {
				raw := []byte("inert public source fixture " + leaf)
				if err := os.WriteFile(filepath.Join(source, leaf), raw, 0600); err != nil {
					t.Fatal(err)
				}
				m.SourceLeaves[leaf] = pqBusinessHash(raw)
			}
			// These are deliberately non-runnable ELF DATA fixtures. This test
			// invokes only the same production pin parser, never os/exec or Node.
			originals := map[string][]byte{}
			for i, name := range []string{"consensus.test", "ynx-bft-gatewayd", "ynx-consensus-perf-client", "ynx-consensus-proof-verify"} {
				raw := make([]byte, 64)
				copy(raw, []byte{0x7f, 'E', 'L', 'F', 2, 1})
				raw[16], raw[18], raw[63] = 2, 0x3e, byte(i+1)
				path := filepath.Join(root, name)
				if err := os.WriteFile(path, raw, 0500); err != nil {
					t.Fatal(err)
				}
				originals[path] = bytes.Clone(raw)
				binaryCommit := commit
				if name == "ynx-consensus-perf-client" {
					binaryCommit = pqNetworkBusinessClientCommit
				}
				m.Binaries[name] = pqNetworkBusinessBinary{Path: path, SHA256: pqBusinessHash(raw), Commit: binaryCommit, Bytes: int64(len(raw))}
			}
			executable := m.Binaries["consensus.test"].Path
			switch scenario {
			case "wrong-client-source":
				p := m.Binaries["ynx-consensus-perf-client"]
				p.Commit = commit
				m.Binaries["ynx-consensus-perf-client"] = p
			case "missing-binary":
				delete(m.Binaries, "ynx-bft-gatewayd")
			case "extra-binary":
				m.Binaries["unapproved-signer"] = m.Binaries["consensus.test"]
			case "duplicate-binary":
				m.Binaries["ynx-bft-gatewayd"] = m.Binaries["consensus.test"]
			case "wrong-running-test":
				executable = filepath.Join(root, "different-test")
			case "changed-ELF", "not-ELF":
				p := m.Binaries["ynx-bft-gatewayd"]
				raw := bytes.Clone(originals[p.Path])
				if scenario == "changed-ELF" {
					raw[62] ^= 1
				} else {
					raw[0] = '#'
					p.SHA256 = pqBusinessHash(raw)
					m.Binaries["ynx-bft-gatewayd"] = p
				}
				if err := os.Chmod(p.Path, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(p.Path, raw, 0500); err != nil {
					t.Fatal(err)
				}
				originals[p.Path] = raw
			case "symlink-binary":
				p := m.Binaries["ynx-bft-gatewayd"]
				alias := p.Path + ".alias"
				if err := os.Symlink(p.Path, alias); err != nil {
					t.Fatal(err)
				}
				p.Path = alias
				m.Binaries["ynx-bft-gatewayd"] = p
			case "source-drift":
				if err := os.WriteFile(filepath.Join(source, "internal/consensus/pq_network_e2e_test.go"), []byte("changed actual source"), 0600); err != nil {
					t.Fatal(err)
				}
			case "source-alias":
				m.SourceRoot += "/."
			}
			raw, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "manifest-alias" {
				raw = bytes.Replace(raw, []byte(`"sourceRoot"`), []byte(`"SourceRoot"`), 1)
			} else if scenario == "duplicate-field" {
				raw = append([]byte(`{"version":"ignored",`), raw[1:]...)
			}
			pin := pqBusinessHash(raw)
			if scenario == "wrong-manifest-pin" {
				pin = strings.Repeat("f", 64)
			}
			_, err = pqBusinessManifest(raw, pin, commit, source, executable)
			if (err == nil) != (scenario == "valid-data") {
				t.Fatal("wrong pre-node manifest admission for", scenario, err)
			}
			for path, want := range originals {
				got, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(got, want) {
					t.Fatal("pin-only preflight changed original input")
				}
			}
		})
	}
}
