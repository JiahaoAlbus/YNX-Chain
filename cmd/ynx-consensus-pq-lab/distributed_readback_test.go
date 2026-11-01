//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestPQLabDistributedReadbackCommandSnapshotAndPublicComparison(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source, err := consensus.NewPQLabWorkloadSource(consensus.PQLabWorkloadOptions{Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	executableRaw, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	comet := filepath.Join(parent, "nonexecuted-comet-pin-input")
	cometRaw := []byte("synthetic public pin input only; never executed")
	if err = os.WriteFile(comet, cometRaw, 0600); err != nil {
		t.Fatal(err)
	}
	hostname, err := os.Hostname()
	if err != nil {
		t.Fatal(err)
	}
	r := consensus.PQLabDistributedRequest{OperationID: distributedHash([]byte(parent)), SourceCommit: "ebd19f47559d5e97082e5c61fff106fb4aee6f7f", SourceTree: "bdafb9c790b825eb277be358535b51983912beed", CometBinarySHA256: distributedHash(cometRaw), LabBinarySHA256: distributedHash(executableRaw), GenesisTime: time.Now().UTC().Add(-time.Minute).Truncate(time.Second).Format(time.RFC3339)}
	for i := 0; i < 4; i++ {
		r.Hosts = append(r.Hosts, consensus.PQLabDistributedHost{Index: i, HostID: "observation-" + strconv.Itoa(i), Hostname: hostname, UID: uint32(os.Geteuid()), GID: uint32(os.Getegid()), RootDir: filepath.Join(parent, "host-"+strconv.Itoa(i)), CometBinary: comet, LabBinary: executable, P2PPort: 32656 + i, RPCPort: 32757 + i})
	}
	r, err = consensus.NewPQLabDistributedRequest(source.Migration, r)
	if err != nil {
		t.Fatal(err)
	}
	requestRaw, _ := json.Marshal(r)
	var identities [][]byte
	var identityPins []string
	for i := 0; i < 4; i++ {
		id, e := consensus.GeneratePQLabDistributedIdentity(requestRaw, distributedHash(requestRaw), i)
		if e != nil {
			t.Fatal(e)
		}
		raw, e := json.Marshal(id)
		if e != nil {
			t.Fatal(e)
		}
		identities = append(identities, raw)
		identityPins = append(identityPins, distributedHash(raw))
	}
	plan, err := consensus.BuildPQLabDistributedPlan(source.Migration, requestRaw, distributedHash(requestRaw), identities, identityPins)
	if err != nil {
		t.Fatal(err)
	}
	planRaw, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	planPin := distributedHash(planRaw)
	_, migration, bootstrap, err := consensus.DecodePQLabDistributedPlan(planRaw, planPin)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(plan.GenesisRaw)
	if err != nil {
		t.Fatal(err)
	}
	params := doc.ConsensusParams.ToProto()
	initReq := &abci.RequestInitChain{Time: doc.GenesisTime, ChainId: doc.ChainID, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: doc.AppState}
	var validators []*cmttypes.Validator
	for _, v := range doc.Validators {
		key, e := cryptoenc.PubKeyToProto(v.PubKey)
		if e != nil {
			t.Fatal(e)
		}
		initReq.Validators = append(initReq.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
		validators = append(validators, cmttypes.NewValidator(v.PubKey, v.Power))
	}
	var inputs []consensus.PQLabDistributedPublicInput
	var firstArgs []string
	var allPublic [][]byte
	for i := 0; i < 4; i++ {
		local, e := consensus.ImportPQLabDistributedPlan(planRaw, planPin, i)
		if e != nil {
			t.Fatal(e)
		}
		app, e := consensus.NewPersistentApplicationWithBootstrap(migration, local.Node.StatePath, bootstrap)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = app.InitChain(context.Background(), initReq); e != nil {
			t.Fatal(e)
		}
		if _, e = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: plan.InitialHeight, Time: doc.GenesisTime.Add(time.Second), NextValidatorsHash: cmttypes.NewValidatorSet(validators).Hash()}); e != nil {
			t.Fatal(e)
		}
		if _, e = app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
		original, e := os.ReadFile(local.Node.StatePath)
		if e != nil {
			t.Fatal(e)
		}
		output := filepath.Join(parent, "public-"+strconv.Itoa(i))
		args := []string{"distributed-readback", "capture", "--synthetic", "--root", local.Host.RootDir, "--plan-sha256", planPin, "--mode", "snapshot", "--output", output}
		if i == 0 {
			firstArgs = append([]string(nil), args...)
			e = run(args, distributedBrokenOutput{})
			if e == nil || !strings.Contains(e.Error(), "lost stdout") {
				t.Fatal("lost output acknowledgement", e)
			}
		} else if e = run(args, io.Discard); e != nil {
			t.Fatal("normal source snapshot command", e)
		}
		raw, e := os.ReadFile(filepath.Join(output, "result.json"))
		if e != nil {
			t.Fatal("original result survives output failure", e)
		}
		var receipt consensus.PQLabDistributedReadback
		if e = json.Unmarshal(raw, &receipt); e != nil || receipt.WriterExcluded || receipt.SigningWriterExcluded || receipt.ColdReopened || receipt.NodeStarted || receipt.AuthorityGranted || receipt.PublicNetwork || receipt.Heights != nil {
			t.Fatal("snapshot claimed stopped/finality", e)
		}
		after, e := os.ReadFile(local.Node.StatePath)
		if e != nil || !bytes.Equal(original, after) {
			t.Fatal("source changed", e)
		}
		inputs = append(inputs, consensus.PQLabDistributedPublicInput{Directory: output, ReceiptSHA256: distributedHash(raw)})
		allPublic = append(allPublic, raw)
	}
	if err = run(firstArgs, io.Discard); err == nil {
		t.Fatal("UNKNOWN output acknowledgement replayed capture")
	}
	current, err := os.ReadFile(filepath.Join(inputs[0].Directory, "result.json"))
	if err != nil || !bytes.Equal(current, allPublic[0]) {
		t.Fatal("original receipt replaced", err)
	}
	planPath, inputsPath := filepath.Join(parent, "plan.json"), filepath.Join(parent, "receipts.json")
	inputsRaw, _ := json.Marshal(inputs)
	if err = os.WriteFile(planPath, planRaw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(inputsPath, inputsRaw, 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"distributed-readback", "compare", "--synthetic", "--plan", planPath, "--plan-sha256", planPin, "--receipts", inputsPath, "--receipts-sha256", distributedHash(inputsRaw)}
	// No coordinator private-source access: all four source roots disappear.
	for _, h := range r.Hosts {
		if err = os.Rename(h.RootDir, h.RootDir+"-offline"); err != nil {
			t.Fatal(err)
		}
	}
	var output bytes.Buffer
	if err = run(args, &output); err != nil {
		t.Fatal("normal PUBLIC-only comparison", err)
	}
	var compared consensus.PQLabDistributedComparison
	if err = json.Unmarshal(output.Bytes(), &compared); err != nil || !compared.FullStateEqual || compared.FullHeightEqual || compared.AllStoppedAndCold || compared.AuthorityGranted || !compared.SyntheticOnly {
		t.Fatal("comparison scope", err)
	}
	args[len(args)-1] = strings.Repeat("a", 64)
	if err = run(args, io.Discard); err == nil {
		t.Fatal("independent public pin ignored")
	}
}

func TestPQLabDistributedReadbackCommandClosedFlags(t *testing.T) {
	for _, args := range [][]string{
		{}, {"capture"}, {"capture", "--synthetic", "--synthetic"}, {"capture", "--synthetic", "--mode", "snapshot", "--trust-numerator", "1"}, {"capture", "--synthetic", "--mode", "snapshot", "--from-height", "1"}, {"compare", "--synthetic", "--unknown", "x"}, {"compare", "--synthetic", "--plan", "one", "--plan", "two"},
	} {
		if err := runPQLabDistributedReadback(args, io.Discard); err == nil {
			t.Fatalf("accepted ambiguous or incomplete arguments: %q", args)
		}
	}
}
