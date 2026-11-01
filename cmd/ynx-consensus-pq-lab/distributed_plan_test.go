//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmttypes "github.com/cometbft/cometbft/types"
)

type distributedBrokenOutput struct{}

func (distributedBrokenOutput) Write([]byte) (int, error) {
	return 0, errors.New("synthetic lost stdout acknowledgement")
}

func TestPQLabDistributedCommandPublicExchangeAndLocalUnknown(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source, err := consensus.NewPQLabWorkloadSource(consensus.PQLabWorkloadOptions{Transfers: 2, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	migrationRaw, err := source.Migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	migration := filepath.Join(parent, "unbound-migration.json")
	if err = os.WriteFile(migration, migrationRaw, 0600); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	executableRaw, err := readPQLabWorkloadFile(executable, 128<<20)
	if err != nil {
		t.Fatal(err)
	}
	comet := filepath.Join(parent, "nonexecuted-public-runtime-input")
	cometRaw := []byte("public synthetic pin fixture; not an executable or qualification")
	if err = os.WriteFile(comet, cometRaw, 0600); err != nil {
		t.Fatal(err)
	}
	hostname, err := os.Hostname()
	if err != nil {
		t.Fatal(err)
	}
	r := consensus.PQLabDistributedRequest{OperationID: distributedHash([]byte(parent)), SourceCommit: "ebd19f47559d5e97082e5c61fff106fb4aee6f7f", SourceTree: "bdafb9c790b825eb277be358535b51983912beed", CometBinarySHA256: distributedHash(cometRaw), LabBinarySHA256: distributedHash(executableRaw), GenesisTime: time.Now().UTC().Add(-time.Minute).Truncate(time.Second).Format(time.RFC3339)}
	for i := 0; i < 4; i++ {
		r.Hosts = append(r.Hosts, consensus.PQLabDistributedHost{Index: i, HostID: "host-" + strconv.Itoa(i), Hostname: hostname, UID: uint32(os.Geteuid()), GID: uint32(os.Getegid()), RootDir: filepath.Join(parent, "host-"+strconv.Itoa(i)), CometBinary: comet, LabBinary: executable, P2PPort: 31656 + i, RPCPort: 31757 + i})
	}
	templateRaw, _ := json.Marshal(r)
	template := filepath.Join(parent, "template.json")
	if err = os.WriteFile(template, templateRaw, 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	requestDir := filepath.Join(parent, "public-request")
	args := []string{"distributed", "request", "--synthetic", "--migration", migration, "--migration-sha256", distributedHash(migrationRaw), "--template", template, "--template-sha256", distributedHash(templateRaw), "--output", requestDir}
	if err = run(args, &out); err != nil {
		t.Fatal("normal public request command", err)
	}
	var result distributedPublicOutput
	if err = json.Unmarshal(out.Bytes(), &result); err != nil || !result.SyntheticOnly || result.NodeStarted || result.PhysicalHostsVerified {
		t.Fatal("public result truth", err)
	}
	requestPath, requestPin := result.File.Path, result.File.SHA256
	var identities []distributedPublicInput
	for i := 0; i < 4; i++ {
		args = []string{"distributed", "identity", "--synthetic", "--request", requestPath, "--request-sha256", requestPin, "--node", strconv.Itoa(i)}
		out.Reset()
		if i == 0 {
			if err = run(args, distributedBrokenOutput{}); err == nil || !strings.Contains(err.Error(), "lost stdout") {
				t.Fatal("failed output was swallowed", err)
			}
		} else if err = run(args, &out); err != nil {
			t.Fatal("normal local identity command", err)
		}
		path := filepath.Join(r.Hosts[i].RootDir, "identity.json")
		raw, e := os.ReadFile(path)
		if e != nil {
			t.Fatal("completed original identity lost on unknown output", e)
		}
		if e = run(args, io.Discard); e == nil {
			t.Fatal("unknown identity result re-generated keys")
		}
		after, e := os.ReadFile(path)
		if e != nil || !bytes.Equal(raw, after) {
			t.Fatal("unknown identity original overwritten", e)
		}
		identities = append(identities, distributedPublicInput{path, distributedHash(raw)})
	}
	identitiesRaw, _ := json.Marshal(identities)
	identitiesPath := filepath.Join(parent, "identities.json")
	if err = os.WriteFile(identitiesPath, identitiesRaw, 0600); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	planDir := filepath.Join(parent, "public-plan")
	args = []string{"distributed", "plan", "--synthetic", "--migration", migration, "--migration-sha256", distributedHash(migrationRaw), "--request", requestPath, "--request-sha256", requestPin, "--identities", identitiesPath, "--identities-sha256", distributedHash(identitiesRaw), "--output", planDir}
	if err = run(args, &out); err != nil {
		t.Fatal("normal public coordinator", err)
	}
	if err = json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	planPath, planPin := result.File.Path, result.File.SHA256
	planRaw, err := os.ReadFile(planPath)
	if err != nil {
		t.Fatal(err)
	}
	p, m, b, err := consensus.DecodePQLabDistributedPlan(planRaw, planPin)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		out.Reset()
		if err = run([]string{"distributed", "import", "--synthetic", "--plan", planPath, "--plan-sha256", planPin, "--node", strconv.Itoa(i)}, &out); err != nil {
			t.Fatal("normal original host import", err)
		}
		var local consensus.PQLabDistributedLocalRecord
		if err = json.Unmarshal(out.Bytes(), &local); err != nil {
			t.Fatal(err)
		}
		if local.NodeStarted || local.PhysicalHostAgreement || local.Host.Index != i || local.Node.RecoveryFD != 3 {
			t.Fatal("local import claimed execution")
		}
		if _, err = consensus.LoadPQLabDistributedLocal(local.Host.RootDir, planPin); err != nil {
			t.Fatal("normal cold source", err)
		}
	}
	// Actual ABCI state authorizes only this host's current next-height original
	// registration. This is not an engine commit/finality claim.
	root := r.Hosts[0].RootDir
	statePath := filepath.Join(root, "node", "data", "application.json")
	app, err := consensus.NewPersistentApplicationWithBootstrap(m, statePath, b)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(p.GenesisRaw)
	if err != nil {
		t.Fatal(err)
	}
	params := doc.ConsensusParams.ToProto()
	var members []*cmttypes.Validator
	initRequest := &abci.RequestInitChain{Time: doc.GenesisTime, ChainId: doc.ChainID, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: bytes.Clone(doc.AppState)}
	for _, v := range doc.Validators {
		members = append(members, cmttypes.NewValidator(v.PubKey, v.Power))
		key, e := cryptoenc.PubKeyToProto(v.PubKey)
		if e != nil {
			t.Fatal(e)
		}
		initRequest.Validators = append(initRequest.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	if _, err = app.InitChain(context.Background(), initRequest); err != nil {
		t.Fatal(err)
	}
	if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: p.InitialHeight, Time: time.Now().UTC(), NextValidatorsHash: cmttypes.NewValidatorSet(members).Hash()}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	stateRaw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var state consensus.CommittedState
	if err = json.Unmarshal(stateRaw, &state); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if err = run([]string{"distributed", "registration", "--synthetic", "--root", root, "--plan-sha256", planPin, "--checkpoint-height", strconv.FormatInt(state.Height, 10), "--checkpoint-app-hash", state.AppHash}, &out); err != nil {
		t.Fatal("normal registry command", err)
	}
	var reg consensus.PQLabValidatorRegistration
	if err = json.Unmarshal(out.Bytes(), &reg); err != nil {
		t.Fatal(err)
	}
	checked, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: reg.Transaction})
	if err != nil || checked.Code != 0 {
		t.Fatal("actual complete Ed approval/double PoP admission", err, checked)
	}
	wire, err := consensus.DecodeValidatorRegistryTransaction(reg.Transaction)
	if err != nil {
		t.Fatal(err)
	}
	for _, branch := range []string{"ed-authority", "ml-dsa", "slh-dsa"} {
		changed, e := ynxconsensusauth.DecodeRegistration(wire)
		if e != nil {
			t.Fatal(e)
		}
		switch branch {
		case "ed-authority":
			changed.LegacyApproval[0] ^= 1
		case "ml-dsa":
			changed.PossessionMLDSA87[0] ^= 1
		case "slh-dsa":
			changed.PossessionSLHDSASHA2256f[0] ^= 1
		}
		bad, e := changed.MarshalBinary()
		if e != nil {
			t.Fatal(e)
		}
		bad, e = consensus.EncodeValidatorRegistryTransaction(bad)
		if e != nil {
			t.Fatal(e)
		}
		refused, e := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: bad})
		if e != nil || refused.Code == 0 {
			t.Fatal("registration branch was skipped", branch, e)
		}
	}
	stateAfter, err := os.ReadFile(statePath)
	if err != nil || !bytes.Equal(stateRaw, stateAfter) {
		t.Fatal("CheckTx mutated committed original", err)
	}
	entries, err := os.ReadDir(planDir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "plan.json" {
		t.Fatal("coordinator emitted nonpublic input", err)
	}
	if bytes.Contains(planRaw, []byte("PKCS8")) || bytes.Contains(planRaw, []byte("priv_key")) {
		t.Fatal("private custody entered public exchange")
	}
}

func TestPQLabDistributedCommandRefusesUnpinnedAndForeignSource(t *testing.T) {
	for _, args := range [][]string{
		{"distributed", "identity", "--request", "/missing", "--node", "0"},
		{"distributed", "identity", "--synthetic", "--synthetic", "--node", "0"},
		{"distributed", "import", "--synthetic", "--unknown", "1"},
		{"distributed", "unknown", "--synthetic"},
		{"distributed", "registration", "--synthetic", "--root", "relative"},
	} {
		if err := run(args, io.Discard); err == nil {
			t.Fatal("invalid normal command admitted", args)
		}
	}
	r := consensus.PQLabDistributedRequest{Hosts: []consensus.PQLabDistributedHost{{LabBinary: "/unrelated/source"}}}
	if err := distributedExecutingBinary(r, 0); err == nil {
		t.Fatal("different current executable relabeled as pinned source")
	}
}
