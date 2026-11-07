//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmttypes "github.com/cometbft/cometbft/types"
)

type startupResultBrokenWriter struct{}

func (startupResultBrokenWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestPQLabStartupTimingNormalRegistrationAndUnknown(t *testing.T) {
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(parent, "lab")
	var created bytes.Buffer
	if err = run([]string{"create", "--synthetic", "--root", root, "--transactions", "1", "--batch-size", "1"}, &created); err != nil {
		t.Fatal(err)
	}
	var c createResult
	if err = json.Unmarshal(created.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(c.Plan.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := os.ReadFile(c.Plan.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	var m chain.ConsensusMigrationState
	if err = json.Unmarshal(migrationRaw, &m); err != nil {
		t.Fatal(err)
	}
	b, err := consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: c.Plan.CometGenesisSHA256, OriginalGenesisHash: c.Plan.OriginalGenesisHash, MigrationStateHash: c.Plan.MigrationStateHash}, m)
	if err != nil {
		t.Fatal(err)
	}
	params := doc.ConsensusParams.ToProto()
	init := &abci.RequestInitChain{ChainId: doc.ChainID, Time: doc.GenesisTime, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: doc.AppState}
	var validators []*cmttypes.Validator
	for _, v := range doc.Validators {
		validators = append(validators, cmttypes.NewValidator(v.PubKey, v.Power))
		key, e := cryptoenc.PubKeyToProto(v.PubKey)
		if e != nil {
			t.Fatal(e)
		}
		init.Validators = append(init.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	for _, n := range c.Plan.Nodes {
		app, e := consensus.NewPersistentApplicationWithBootstrap(m, n.StatePath, b)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = app.InitChain(context.Background(), init); e != nil {
			t.Fatal(e)
		}
		if _, e = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: doc.InitialHeight, Time: doc.GenesisTime, NextValidatorsHash: cmttypes.NewValidatorSet(validators).Hash()}); e != nil {
			t.Fatal(e)
		}
		if _, e = app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
	}
	args := []string{"registration", "--synthetic", "--root", root, "--plan-sha256", c.PlanSHA256, "--node", "0", "--approved-at", fmtHeight(doc.InitialHeight + 1), "--timings"}
	var out bytes.Buffer
	if err = run(args, &out); err != nil {
		t.Fatal(err)
	}
	var reply map[string]json.RawMessage
	if err = json.Unmarshal(out.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	var metrics consensus.PQLabMetricsSnapshot
	if err = json.Unmarshal(reply["timings"], &metrics); err != nil {
		t.Fatal(err)
	}
	if metrics.Stages["registration.freshCheckpointFullValidation"].Calls != 8 || metrics.Stages["lab.bootstrapFullValidation"].Calls != 1 {
		t.Fatal("normal CLI lost actual phase metrics", metrics)
	}
	resultPath := filepath.Join(c.Plan.Nodes[0].Home, "registration", "registration.json")
	saved, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatal(err)
	}
	delete(reply, "timings")
	delete(reply, "calleeElapsedNs")
	rawReply, _ := json.Marshal(reply)
	var original map[string]json.RawMessage
	if err = json.Unmarshal(saved, &original); err != nil {
		t.Fatal(err)
	}
	canonical, _ := json.Marshal(original)
	if !bytes.Equal(rawReply, canonical) {
		t.Fatal("timing wrapper changed normal durable result")
	}
	if err = run(args, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "REFUSED_OR_UNKNOWN_NO_RETRY") {
		t.Fatal("UNKNOWN re-signed", err)
	}
	after, _ := os.ReadFile(resultPath)
	if !bytes.Equal(saved, after) {
		t.Fatal("retry changed original result")
	}
	// One new operation with a broken caller output still leaves exactly its
	// original durable signed result. It may only be reconciled, not re-signed.
	args[7] = "1"
	if err = run(args, startupResultBrokenWriter{}); err != io.ErrClosedPipe {
		t.Fatal("lost stdout changed first cause", err)
	}
	original1, err := os.ReadFile(filepath.Join(c.Plan.Nodes[1].Home, "registration", "registration.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = run(args, &bytes.Buffer{}); err == nil {
		t.Fatal("lost acknowledgement retried signing")
	}
	after1, _ := os.ReadFile(filepath.Join(c.Plan.Nodes[1].Home, "registration", "registration.json"))
	if !bytes.Equal(original1, after1) {
		t.Fatal("UNKNOWN original changed")
	}
}
func fmtHeight(h int64) string { raw, _ := json.Marshal(h); return string(raw) }

func TestPQLabStartupTimingFlagsAndMissingSourcesFailClosed(t *testing.T) {
	for _, args := range [][]string{
		{"registration", "--timings"},
		{"registration", "--synthetic", "--root", "/missing", "--plan-sha256", strings.Repeat("1", 64), "--node", "0", "--approved-at", "4", "--timings"},
		{"activate", "--synthetic", "--root", "/missing", "--plan-sha256", strings.Repeat("1", 64), "--timings"},
		{"activate", "--synthetic", "--root", "/missing", "--timings", "--timings"},
		{"create", "--synthetic", "--root", "/missing", "--timings"},
	} {
		var out bytes.Buffer
		if err := run(args, &out); err == nil || out.Len() != 0 {
			t.Fatal("invalid measured caller emitted result", args, err)
		}
	}
}
