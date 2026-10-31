//go:build unix

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Four ordinary application writers, no Node.Start, TCP, fabricated history or
// consensus claim. The sender's public checkpoint loader reads these originals.
func pqLabSenderCommandFixture(t *testing.T, online bool) (createResult, string, int64, string) {
	t.Helper()
	root := filepath.Join(pqLabWorkloadCommandTemp(t), "lab")
	args := []string{"create", "--synthetic", "--root", root, "--owners", "2", "--transactions", "2", "--batch-size", "2"}
	if online {
		args = append(args, "--online")
	}
	var output bytes.Buffer
	if err := run(args, &output); err != nil {
		t.Fatal(err)
	}
	var result createResult
	if json.Unmarshal(output.Bytes(), &result) != nil {
		t.Fatal("create result")
	}
	migrationRaw, err := os.ReadFile(result.Plan.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	if json.Unmarshal(migrationRaw, &migration) != nil {
		t.Fatal("migration")
	}
	genesis, err := os.ReadFile(result.Plan.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(genesis)
	if err != nil {
		t.Fatal(err)
	}
	bootstrap, err := consensus.NewConsensusBootstrap(genesis, consensus.ConsensusBootstrapPins{CometGenesisSHA256: result.Plan.CometGenesisSHA256, OriginalGenesisHash: result.Plan.OriginalGenesisHash, MigrationStateHash: result.Plan.MigrationStateHash}, migration)
	if err != nil {
		t.Fatal(err)
	}
	var appHash string
	validators := make([]*cmttypes.Validator, len(doc.Validators))
	for i, v := range doc.Validators {
		validators[i] = cmttypes.NewValidator(v.PubKey, v.Power)
	}
	validatorHash := cmttypes.NewValidatorSet(validators).Hash()
	for _, node := range result.Plan.Nodes {
		app, err := consensus.NewPersistentApplicationWithBootstrap(migration, node.StatePath, bootstrap)
		if err != nil {
			t.Fatal(err)
		}
		params := doc.ConsensusParams.ToProto()
		req := &abci.RequestInitChain{Time: doc.GenesisTime, ChainId: doc.ChainID, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: doc.AppState}
		for _, v := range doc.Validators {
			key, err := cryptoenc.PubKeyToProto(v.PubKey)
			if err != nil {
				t.Fatal(err)
			}
			req.Validators = append(req.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
		}
		if _, err = app.InitChain(context.Background(), req); err != nil {
			t.Fatal(err)
		}
		if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: doc.InitialHeight, Time: doc.GenesisTime.Add(time.Second), NextValidatorsHash: validatorHash}); err != nil {
			t.Fatal(err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		info, err := app.Info(context.Background(), &abci.RequestInfo{})
		if err != nil {
			t.Fatal(err)
		}
		h := hex.EncodeToString(info.LastBlockAppHash)
		if appHash != "" && appHash != h {
			t.Fatal("four actual checkpoints differ")
		}
		appHash = h
	}
	manifest, err := os.ReadFile(filepath.Join(root, "workload", "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(manifest)
	return result, hex.EncodeToString(sum[:]), doc.InitialHeight, appHash
}

func TestPQLabOnlineSenderCommandOriginalLostAckAndUnknown(t *testing.T) {
	created, pin, height, appHash := pqLabSenderCommandFixture(t, true)
	credential, err := os.Open(filepath.Join(created.Plan.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer credential.Close()
	args := []string{"--synthetic", "--root", created.Plan.RootDir, "--plan-sha256", created.PlanSHA256, "--workload-sha256", pin, "--owner", "0", "--credential-fd", strconv.Itoa(int(credential.Fd()))}
	request := consensus.PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("d", 64), OwnerIndex: 0, FirstNonce: 2, Members: 2}
	command := pqLabSenderCommand{Version: "YNX-PQ-LAB-SENDER-COMMAND/v1", Operation: "sign", Request: request, CheckpointHeight: height, CheckpointAppHash: appHash}
	raw, _ := json.Marshal(command)
	if err = runPQLabSenderInput(args, bytes.NewReader(append(raw, '\n')), pqLabBrokenWorkloadOutput{}); err == nil {
		t.Fatal("lost output acknowledgement hidden")
	}
	directory := filepath.Join(created.Plan.RootDir, "workload", "sender-public", "0000", request.OperationID)
	original, err := os.ReadFile(filepath.Join(directory, "transaction.abci"))
	if err != nil {
		t.Fatal("lost acknowledgement removed original", err)
	}
	command.Operation = "recover"
	command.CheckpointHeight = 0
	command.CheckpointAppHash = ""
	raw, _ = json.Marshal(command)
	var out bytes.Buffer
	if err = runPQLabSenderInput(args, bytes.NewReader(raw), &out); err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Code   string                      `json:"code"`
		Result consensus.PQLabSenderResult `json:"result"`
	}
	if json.Unmarshal(out.Bytes(), &reply) != nil || reply.Code != "ORIGINAL_RECOVERED" || reply.Result.AuthorityGranted {
		t.Fatal("normal cold sender failed", out.String())
	}
	after, err := os.ReadFile(filepath.Join(directory, "transaction.abci"))
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("cold retry re-signed original")
	}
	wrongPinArgs := append([]string(nil), args...)
	for i := range wrongPinArgs {
		if wrongPinArgs[i] == "--plan-sha256" {
			wrongPinArgs[i+1] = strings.Repeat("0", 64)
		}
	}
	out.Reset()
	if err = runPQLabSenderInput(wrongPinArgs, bytes.NewReader(raw), &out); err == nil || out.Len() != 0 {
		t.Fatal("recovery ignored independent original lab pin")
	}
	// A second operation cannot escape the unresolved proof of the first.
	command.Operation = "sign"
	command.Request.OperationID = strings.Repeat("e", 64)
	command.CheckpointHeight = height
	command.CheckpointAppHash = appHash
	raw, _ = json.Marshal(command)
	out.Reset()
	if err = runPQLabSenderInput(args, bytes.NewReader(raw), &out); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Bytes(), []byte(`"code":"UNKNOWN"`)) {
		t.Fatal("unconfirmed result allowed blind next signing", out.String())
	}
	// Existing authenticated evidence is preserved even if it becomes corrupt.
	resultPath := filepath.Join(directory, "RESULT.json")
	result, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatal(err)
	}
	result[len(result)-3] ^= 1
	if err = os.WriteFile(resultPath, result, 0600); err != nil {
		t.Fatal(err)
	}
	command.Operation = "recover"
	command.Request = request
	command.CheckpointHeight = 0
	command.CheckpointAppHash = ""
	raw, _ = json.Marshal(command)
	out.Reset()
	if err = runPQLabSenderInput(args, bytes.NewReader(raw), &out); err != nil || !bytes.Contains(out.Bytes(), []byte(`"code":"UNKNOWN"`)) {
		t.Fatal("corrupt original was replaced", err, out.String())
	}
	retained, err := os.ReadFile(resultPath)
	if err != nil || !bytes.Equal(result, retained) {
		t.Fatal("UNKNOWN evidence changed")
	}
	if _, err = readPQLabSenderCredential(int(credential.Fd()), filepath.Join(created.Plan.RootDir, "foreign")); err == nil {
		t.Fatal("foreign FD identity accepted")
	}
	out.Reset()
	duplicate := append(bytes.Clone(raw[:len(raw)-1]), []byte(`,"operation":"sign"}`)...)
	if err = runPQLabSenderInput(args, bytes.NewReader(duplicate), &out); err == nil || out.Len() != 0 {
		t.Fatal("duplicate command key accepted")
	}
}

func TestPQLabPreSignedCommandCurrentCheckpoint(t *testing.T) {
	created, pin, height, hash := pqLabSenderCommandFixture(t, false)
	args := []string{"--synthetic", "--root", created.Plan.RootDir, "--plan-sha256", created.PlanSHA256, "--workload-sha256", pin, "--index", "0", "--checkpoint-height", strconv.FormatInt(height, 10), "--checkpoint-app-hash", hash}
	var out bytes.Buffer
	if err := run(append([]string{"presigned"}, args...), &out); err != nil {
		t.Fatal(err)
	}
	var result consensus.PQLabSenderResult
	if json.Unmarshal(out.Bytes(), &result) != nil || result.Status != "pre-signed-original" || result.Transaction != created.Workload.Transactions[0] || result.AuthorityGranted {
		t.Fatal("normal pre-signed readback missing")
	}
	args[len(args)-1] = strings.Repeat("0", 64)
	out.Reset()
	if err := run(append([]string{"presigned"}, args...), &out); err == nil || out.Len() != 0 {
		t.Fatal("wrong checkpoint accepted")
	}
	if _, err := os.Stat(filepath.Join(created.Plan.RootDir, "workload", "private-senders")); !os.IsNotExist(err) {
		t.Fatal("pre-signed readback created signing custody")
	}
}

func pqLabWorkloadCommandTemp(t *testing.T) string {
	t.Helper()
	p, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPQLabWorkloadCommandInputsAndNoMutation(t *testing.T) {
	dir := pqLabWorkloadCommandTemp(t)
	file := filepath.Join(dir, "public.json")
	if err := os.WriteFile(file, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias")
	if err := os.Symlink(file, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := readPQLabWorkloadFile(alias, 10); err == nil {
		t.Fatal("alias accepted")
	}
	if _, err := readPQLabWorkloadFile(file, 1); err == nil {
		t.Fatal("oversize accepted")
	}
	if raw, err := readPQLabWorkloadFile(file, 2); err != nil || string(raw) != "{}" {
		t.Fatal("normal bounded read failed", err)
	}
	output := filepath.Join(dir, "out")
	good := []string{"--synthetic", "--materials", file, "--materials-sha256", strings.Repeat("0", 64), "--proof", file, "--output", output}
	for _, args := range [][]string{nil, good, append(append([]string(nil), good...), "--materials", file), append(append([]string(nil), good...), "--now", "1"), good[1:]} {
		var out bytes.Buffer
		if err := runPQLabProofContext(args, &out); err == nil || out.Len() != 0 {
			t.Fatal("invalid trust input reported success")
		}
		if _, err := os.Stat(output); !os.IsNotExist(err) {
			t.Fatal("bad input mutated output")
		}
	}
}

// The consensus test's opt-in supplies a REAL synthetic BlockExecutor proof.
// No static fixture, fake successful JSON, network or private key is used here.
func TestPQLabWorkloadCommandRealProofInputs(t *testing.T) {
	fixture := os.Getenv("YNX_PQ_LAB_PROOF_FIXTURE_OUT")
	if fixture == "" {
		t.Skip("requires public proof emitted by TestPQLabWorkloadProofOriginalCLIInputsAndNegatives")
	}
	materialPath := filepath.Join(fixture, "operator-materials.json")
	raw, err := readPQLabWorkloadFile(materialPath, consensus.MaxPQLabProofMaterialsBytes)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(raw)
	pin := hex.EncodeToString(h[:])
	output := filepath.Join(pqLabWorkloadCommandTemp(t), "context")
	args := []string{"--synthetic", "--materials", materialPath, "--materials-sha256", pin, "--proof", filepath.Join(fixture, "proof.json"), "--output", output}
	var out bytes.Buffer
	if err = runPQLabProofContext(args, &out); err != nil {
		t.Fatal("real normal proof producer failed", err)
	}
	var result consensus.PQLabProofExport
	if err = json.Unmarshal(out.Bytes(), &result); err != nil || !result.Result.Finalized || !result.Result.ExecutionSuccessful || result.AuthorityGranted || result.ActualNetworkExecutionClaim {
		t.Fatal("incorrect normal producer result", err)
	}
	original, err := os.ReadFile(filepath.Join(output, "trust-context.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = runPQLabProofContext(args, &bytes.Buffer{}); err == nil {
		t.Fatal("existing original/UNKNOWN context overwritten")
	}
	after, err := os.ReadFile(filepath.Join(output, "trust-context.json"))
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("retained trust original changed")
	}
	// A lost caller acknowledgement preserves the same completed output.
	args[len(args)-1] = filepath.Join(pqLabWorkloadCommandTemp(t), "lost-ack")
	if err = runPQLabProofContext(args, pqLabBrokenWorkloadOutput{}); err == nil {
		t.Fatal("failed acknowledgement hidden")
	}
	if _, err = os.Stat(filepath.Join(args[len(args)-1], "PUBLIC-PROOF-INPUTS.json")); err != nil {
		t.Fatal("lost acknowledgement removed completed original", err)
	}
}

type pqLabBrokenWorkloadOutput struct{}

func (pqLabBrokenWorkloadOutput) Write([]byte) (int, error) {
	return 0, errors.New("synthetic output acknowledgement lost")
}
