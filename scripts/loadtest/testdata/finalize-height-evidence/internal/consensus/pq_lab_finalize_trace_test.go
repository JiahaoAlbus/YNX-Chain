//go:build unix

package consensus

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func traceTestBytes(t *testing.T, path string) []byte {
	t.Helper()
	r, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func traceTestRows(t *testing.T, path string) []PQLabFinalizeTraceRecord {
	t.Helper()
	f, e := os.Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 64<<10), pqLabFinalizeTraceLimit/2)
	var rows []PQLabFinalizeTraceRecord
	for s.Scan() {
		var row PQLabFinalizeTraceRecord
		if e = pqLabDecode(s.Bytes(), &row); e != nil {
			t.Fatal(e)
		}
		rows = append(rows, row)
	}
	if e = s.Err(); e != nil {
		t.Fatal(e)
	}
	return rows
}

// Captures the ACTUAL normal BlockExecutor -> ABCI call. The request is not
// assembled by this recorder and no test clock, field or transaction is edited.
type traceTestApplication struct {
	*Application
	requests, responses [][]byte
}

func (a *traceTestApplication) FinalizeBlock(ctx context.Context, r *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	raw, e := r.Marshal()
	if e != nil {
		return nil, e
	}
	a.requests = append(a.requests, raw)
	result, e := a.Application.FinalizeBlock(ctx, r)
	if e != nil {
		return nil, e
	}
	raw, e = result.Marshal()
	if e != nil {
		return nil, e
	}
	a.responses = append(a.responses, raw)
	return result, nil
}

func traceTestActualBlockExecutor(t *testing.T, p PQLabNetworkPlan, pin string, rows []PQLabFinalizeTraceRecord) {
	t.Helper()
	_, m, b, e := loadPQLab(p.RootDir, pin)
	if e != nil {
		t.Fatal(e)
	}
	schedule := traceTestBytes(t, filepath.Join(p.RootDir, "activation", "schedule.json"))
	var activation PQLabActivation
	if e = json.Unmarshal(traceTestBytes(t, filepath.Join(p.RootDir, "activation", "activation.json")), &activation); e != nil {
		t.Fatal(e)
	}
	auth, e := NewPQEngineAuthorization(schedule, activation.ScheduleHash)
	if e != nil {
		t.Fatal(e)
	}
	app, e := newPersistentApplicationWithAuthorization(m, "", b, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	app.pqEngineAuthorization = auth
	recorder := &traceTestApplication{Application: app}
	conns := proxy.NewAppConns(proxy.NewLocalClientCreator(recorder), proxy.NopMetrics())
	if e = conns.Start(); e != nil {
		t.Fatal(e)
	}
	defer conns.Stop()
	db, blocksDB := dbm.NewMemDB(), dbm.NewMemDB()
	defer db.Close()
	defer blocksDB.Close()
	rawStore := sm.NewStore(db, sm.StoreOptions{})
	source := &engineSourceRecorder{app: app}
	wrapped := sm.WithConsensusAuthorityStore(rawStore, source)
	blocks := blockstore.NewBlockStore(blocksDB)
	doc, e := cmttypes.GenesisDocFromJSON(traceTestBytes(t, p.GenesisFile))
	if e != nil {
		t.Fatal(e)
	}
	initial, e := sm.MakeGenesisState(doc)
	if e != nil {
		t.Fatal(e)
	}
	initial.AppHash = nil
	if e = rawStore.Save(initial); e != nil {
		t.Fatal(e)
	}
	handshake := cmtconsensus.NewHandshaker(rawStore, initial, blocks, doc)
	handshake.SetConsensusAuthoritySource(source)
	if e = handshake.Handshake(conns); e != nil {
		t.Fatal(e)
	}
	for i, row := range rows {
		var bp cmtproto.Block
		if e = bp.Unmarshal(row.Block); e != nil {
			t.Fatal(e)
		}
		block, e := cmttypes.BlockFromProto(&bp)
		if e != nil {
			t.Fatal(e)
		}
		lb, e := DecodePQTrustedLightBlock(row.LightBlock)
		if e != nil {
			t.Fatal(e)
		}
		parts, e := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if e != nil {
			t.Fatal(e)
		}
		id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
		blocks.SaveBlock(block, parts, lb.Commit)
		state, e := wrapped.Load()
		if e != nil {
			t.Fatal(e)
		}
		executor := sm.NewBlockExecutor(wrapped, log.NewNopLogger(), conns.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, blocks)
		if _, e = executor.ApplyBlock(state, id, block); e != nil {
			t.Fatal("normal original BlockExecutor", row.Height, e)
		}
		if len(recorder.requests) != i+1 || !bytes.Equal(recorder.requests[i], row.Request) || !bytes.Equal(recorder.responses[i], row.Response) {
			t.Fatal("reconstruction differs from actual normal complete ABCI call", row.Height)
		}
		var want, actual abci.RequestFinalizeBlock
		if e = want.Unmarshal(row.Request); e != nil {
			t.Fatal(e)
		}
		if e = actual.Unmarshal(recorder.requests[i]); e != nil {
			t.Fatal(e)
		}
		for field, values := range map[string][2]any{"Txs": {want.Txs, actual.Txs}, "DecidedLastCommit": {want.DecidedLastCommit, actual.DecidedLastCommit}, "Misbehavior": {want.Misbehavior, actual.Misbehavior}, "Hash": {want.Hash, actual.Hash}, "Height": {want.Height, actual.Height}, "Time": {want.Time, actual.Time}, "NextValidatorsHash": {want.NextValidatorsHash, actual.NextValidatorsHash}, "ProposerAddress": {want.ProposerAddress, actual.ProposerAddress}} {
			if !reflect.DeepEqual(values[0], values[1]) {
				t.Fatal("normal request field differs", row.Height, field)
			}
		}
		full, e := encodeCommittedStateJSON(app.committed)
		if e != nil || int64(len(full)) != row.StateBytes || pqLabSHA(full) != row.StateSHA256 || app.committed.AppHash != row.AppHash {
			t.Fatal("normal per-height complete state differs", row.Height, e)
		}
	}
}

func traceTestTamper(t *testing.T, original, dir string, change func(*PQLabFinalizeTrace, []PQLabFinalizeTraceRecord) []PQLabFinalizeTraceRecord) string {
	t.Helper()
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	entries, e := os.ReadDir(original)
	if e != nil {
		t.Fatal(e)
	}
	for _, entry := range entries {
		if e = pqLabWrite(filepath.Join(dir, entry.Name()), traceTestBytes(t, filepath.Join(original, entry.Name()))); e != nil {
			t.Fatal(e)
		}
	}
	var receipt PQLabFinalizeTrace
	if e = json.Unmarshal(traceTestBytes(t, filepath.Join(dir, "result.json")), &receipt); e != nil {
		t.Fatal(e)
	}
	rows := traceTestRows(t, filepath.Join(dir, "records.jsonl"))
	rows = change(&receipt, rows)
	var all bytes.Buffer
	for _, row := range rows {
		raw, e := json.Marshal(row)
		if e != nil {
			t.Fatal(e)
		}
		all.Write(raw)
		all.WriteByte('\n')
	}
	raw := all.Bytes()
	if e = os.WriteFile(filepath.Join(dir, "records.jsonl"), raw, 0600); e != nil {
		t.Fatal(e)
	}
	receipt.Records = pqFinalizeFile("records.jsonl", raw)
	raw, e = json.Marshal(receipt)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(dir, "result.json"), raw, 0600); e != nil {
		t.Fatal(e)
	}
	return pqLabSHA(raw)
}

func TestPQLabFinalizeTraceOriginalCompleteRequestsColdReplayAndRefusals(t *testing.T) {
	root := filepath.Join(pqLabWorkloadTemp(t), "lab")
	p, original := pqLabStoppedExportFixture(t, root)
	var tip CommittedState
	if e := json.Unmarshal(traceTestBytes(t, p.Nodes[0].StatePath), &tip); e != nil {
		t.Fatal(e)
	}
	before := inspectionInventory(t, p.MigrationFile, p.GenesisFile, p.Nodes[0].Home, p.Nodes[1].Home, p.Nodes[2].Home, p.Nodes[3].Home)
	output := os.Getenv("YNX_PQ_LAB_FINALIZE_TRACE_FIXTURE_OUT")
	if output == "" {
		output = filepath.Join(pqLabWorkloadTemp(t), "trace")
	}
	o := PQLabFinalizeTraceOptions{RootDir: root, PlanSHA256: original.PlanSHA256, ActivationSHA256: original.ActivationSHA256, OutputDir: output, ExpectedHeight: tip.Height, ExpectedAppHash: tip.AppHash}
	result, e := ExportPQLabFinalizeTrace(context.Background(), o)
	if e != nil {
		t.Fatal("normal complete original export", e)
	}
	if result.NodeStarted || result.AuthorityGranted || result.PublicNetwork || !result.SourceReadOnly || !result.ColdReopened || result.StoppedNodes != 4 || result.RequestSource != pqLabFinalizeReconstruction || result.RuntimePlan != nil || result.RuntimePlanHash != "" {
		t.Fatal("trace scope changed")
	}
	manifest := traceTestBytes(t, filepath.Join(output, "result.json"))
	pin := pqLabSHA(manifest)
	rows := traceTestRows(t, filepath.Join(output, result.Records.Name))
	if len(rows) != int(result.LastHeight-result.FirstHeight+1) {
		t.Fatal("not every original height retained")
	}
	traceTestActualBlockExecutor(t, p, o.PlanSHA256, rows)
	for i := 0; i < 2; i++ {
		dest := filepath.Join(pqLabWorkloadTemp(t), "replay")
		replayed, e := ReplayPQLabFinalizeTrace(context.Background(), output, pin, dest)
		if e != nil {
			t.Fatal("normal standalone replay", e)
		}
		if !replayed.CompleteStateBytesReconstructed || !replayed.FullResponsesCompared || replayed.NormalizationApplied || replayed.LiveNetworkPairQualified || replayed.AuthorityGranted || replayed.NodeStarted {
			t.Fatal("replay scope changed")
		}
		if !bytes.Equal(traceTestBytes(t, filepath.Join(dest, "replay.jsonl")), traceTestBytes(t, filepath.Join(output, "records.jsonl"))) || !bytes.Equal(traceTestBytes(t, filepath.Join(dest, "final-state.json")), traceTestBytes(t, filepath.Join(output, "final-state.json"))) {
			t.Fatal("same complete original trajectory bytes changed")
		}
		retained := traceTestBytes(t, filepath.Join(dest, "result.json"))
		if _, e = ReplayPQLabFinalizeTrace(context.Background(), output, pin, dest); e == nil || !bytes.Equal(retained, traceTestBytes(t, filepath.Join(dest, "result.json"))) {
			t.Fatal("lost stdout/retry overwrote original replay")
		}
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, p.MigrationFile, p.GenesisFile, p.Nodes[0].Home, p.Nodes[1].Home, p.Nodes[2].Home, p.Nodes[3].Home)) {
		t.Fatal("read-only trace changed original source/custody bytes")
	}
	t.Run("existing-output-UNKNOWN", func(t *testing.T) {
		if _, e := ExportPQLabFinalizeTrace(context.Background(), o); e == nil {
			t.Fatal("reentered original output")
		}
		if !bytes.Equal(manifest, traceTestBytes(t, filepath.Join(output, "result.json"))) {
			t.Fatal("original receipt overwritten")
		}
	})
	t.Run("wrong-exact-height", func(t *testing.T) {
		bad := o
		bad.ExpectedHeight++
		bad.OutputDir = filepath.Join(pqLabWorkloadTemp(t), "bad")
		if _, e := ExportPQLabFinalizeTrace(context.Background(), bad); e == nil {
			t.Fatal("wrong height accepted")
		}
		if _, e := os.Stat(filepath.Join(bad.OutputDir, "intent.json")); e != nil {
			t.Fatal("partial attempt not retained")
		}
		if _, e := os.Stat(filepath.Join(bad.OutputDir, "result.json")); !errors.Is(e, os.ErrNotExist) {
			t.Fatal("failed source became result")
		}
	})
	t.Run("active-original-DB", func(t *testing.T) {
		db, e := dbm.NewGoLevelDB("state", filepath.Join(p.Nodes[1].Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		defer db.Close()
		bad := o
		bad.OutputDir = filepath.Join(pqLabWorkloadTemp(t), "active")
		if _, e := ExportPQLabFinalizeTrace(context.Background(), bad); e == nil {
			t.Fatal("active DB lock bypassed")
		}
	})
	for _, field := range []string{"Txs", "DecidedLastCommit", "Misbehavior", "Hash", "Height", "Time", "NextValidatorsHash", "ProposerAddress"} {
		t.Run("request-"+field, func(t *testing.T) {
			dir := filepath.Join(pqLabWorkloadTemp(t), "changed")
			changedPin := traceTestTamper(t, output, dir, func(_ *PQLabFinalizeTrace, rows []PQLabFinalizeTraceRecord) []PQLabFinalizeTraceRecord {
				var req abci.RequestFinalizeBlock
				if e := req.Unmarshal(rows[0].Request); e != nil {
					t.Fatal(e)
				}
				switch field {
				case "Txs":
					req.Txs = append(req.Txs, []byte("not original"))
				case "DecidedLastCommit":
					req.DecidedLastCommit.Round++
				case "Misbehavior":
					req.Misbehavior = append(req.Misbehavior, abci.Misbehavior{})
				case "Hash":
					req.Hash[0] ^= 1
				case "Height":
					req.Height++
				case "Time":
					req.Time = req.Time.Add(1)
				case "NextValidatorsHash":
					req.NextValidatorsHash[0] ^= 1
				case "ProposerAddress":
					req.ProposerAddress[0] ^= 1
				}
				rows[0].Request, e = req.Marshal()
				if e != nil {
					t.Fatal(e)
				}
				return rows
			})
			if _, e := ReplayPQLabFinalizeTrace(context.Background(), dir, changedPin, filepath.Join(pqLabWorkloadTemp(t), "replay")); e == nil || !strings.Contains(e.Error(), "FinalizeBlock request differs") {
				t.Fatal("whole original request field not bound", field, e)
			}
		})
	}
	for _, mode := range []string{"full-response-log", "state-bytes", "state-hash", "missing-height", "duplicate-height", "bad-original-signature", "original-chain"} {
		t.Run(mode, func(t *testing.T) {
			dir := filepath.Join(pqLabWorkloadTemp(t), "changed")
			changedPin := traceTestTamper(t, output, dir, func(_ *PQLabFinalizeTrace, rows []PQLabFinalizeTraceRecord) []PQLabFinalizeTraceRecord {
				switch mode {
				case "original-chain":
					var block cmtproto.Block
					if e := block.Unmarshal(rows[0].Block); e != nil {
						t.Fatal(e)
					}
					lb, e := DecodePQTrustedLightBlock(rows[0].LightBlock)
					if e != nil {
						t.Fatal(e)
					}
					block.Header.ChainID += "-other"
					lb.Header.ChainID = block.Header.ChainID
					changed, e := cmttypes.BlockFromProto(&block)
					if e != nil {
						t.Fatal(e)
					}
					parts, e := changed.MakePartSet(cmttypes.BlockPartSizeBytes)
					if e != nil {
						t.Fatal(e)
					}
					// Keep the public structure valid so the independent chain
					// binding is tested before signature verification. No re-sign.
					lb.Commit.BlockID = cmttypes.BlockID{Hash: changed.Hash(), PartSetHeader: parts.Header()}
					rows[0].Block, e = block.Marshal()
					if e != nil {
						t.Fatal(e)
					}
					rows[0].LightBlock, e = cmtjson.Marshal(lb)
					if e != nil {
						t.Fatal(e)
					}
				case "full-response-log":
					for i := range rows {
						var r abci.ResponseFinalizeBlock
						if e := r.Unmarshal(rows[i].Response); e != nil {
							t.Fatal(e)
						}
						if len(r.TxResults) > 0 {
							r.TxResults[0].Log = "unaltered-AppHash does not authorize replacing this Log"
							rows[i].Response, e = r.Marshal()
							if e != nil {
								t.Fatal(e)
							}
							break
						}
					}
				case "state-bytes":
					rows[0].StateBytes++
				case "state-hash":
					rows[0].StateSHA256 = strings.Repeat("a", 64)
				case "missing-height":
					return rows[1:]
				case "duplicate-height":
					return append(rows[:1], rows...)
				case "bad-original-signature":
					lb, e := DecodePQTrustedLightBlock(rows[len(rows)-1].LightBlock)
					if e != nil {
						t.Fatal(e)
					}
					lb.Commit.Signatures[0].Signature[len(lb.Commit.Signatures[0].Signature)-1] ^= 1
					rows[len(rows)-1].LightBlock, e = cmtjson.Marshal(lb)
					if e != nil {
						t.Fatal(e)
					}
				}
				return rows
			})
			if _, e := ReplayPQLabFinalizeTrace(context.Background(), dir, changedPin, filepath.Join(pqLabWorkloadTemp(t), "replay")); e == nil {
				t.Fatal("rehash laundered altered original", mode)
			} else if mode == "original-chain" && !strings.Contains(e.Error(), "chain differs from independently pinned genesis") {
				t.Fatal("original chain must be checked against pinned genesis", e)
			}
		})
	}
}

func TestPQLabFinalizeTraceHeldStreamAndBoundedPartial(t *testing.T) {
	root := pqLabWorkloadTemp(t)
	path := filepath.Join(root, "records.jsonl")
	raw := []byte("original complete stream\n")
	if e := pqLabWrite(path, raw); e != nil {
		t.Fatal(e)
	}
	input, e := pqFinalizeOpenStream(path, pqFinalizeFile("records.jsonl", raw))
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(path, []byte("original UNKNOWN changed\n"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = input.close(); e == nil {
		t.Fatal("changed held source accepted")
	}
	output := filepath.Join(root, "partial.jsonl")
	stream, e := pqFinalizeNewStream(output)
	if e != nil {
		t.Fatal(e)
	}
	stream.size = int64(pqLabFinalizeTraceLimit) - 1
	if e = stream.append(PQLabFinalizeTraceRecord{Height: 1}); e == nil {
		t.Fatal("unbounded trace accepted")
	}
	if e = stream.close(); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(output); e != nil {
		t.Fatal("partial output deleted")
	}
	large := filepath.Join(root, "oversize")
	f, e := os.OpenFile(large, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	if e = f.Truncate(int64(pqLabFinalizeTraceLimit) + 1); e != nil {
		t.Fatal(e)
	}
	f.Close()
	if _, e = pqFinalizeOpenStream(large, PQLabFinalizeTraceFile{Name: "records.jsonl", Bytes: int64(pqLabFinalizeTraceLimit) + 1, SHA256: strings.Repeat("a", 64)}); e == nil {
		t.Fatal("oversize original did not fail before read")
	}
}

func traceHeightPublicFixture(t *testing.T) (string, chain.ConsensusMigrationState, *ConsensusBootstrap, PQLabFinalizeTrace) {
	t.Helper()
	original := os.Getenv("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE")
	if original == "" {
		t.Fatal("exact PUBLIC trace directory is required for height evidence controls")
	}
	directory := filepath.Join(pqLabWorkloadTemp(t), "original")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	names := []string{"intent.json", "result.json", "migration.json", "genesis.json", "schedule.json", "init-chain.pb", "initial-state.json", "final-state.json", "records.jsonl"}
	for _, name := range names {
		if err := pqLabWrite(filepath.Join(directory, name), traceTestBytes(t, filepath.Join(original, name))); err != nil {
			t.Fatal(err)
		}
	}
	raw := traceTestBytes(t, filepath.Join(directory, "result.json"))
	if pqLabSHA(raw) != "11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6" {
		t.Fatal("original PUBLIC trace pin differs")
	}
	var trace PQLabFinalizeTrace
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(traceTestBytes(t, filepath.Join(directory, "migration.json")), &migration); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := NewConsensusBootstrap(traceTestBytes(t, filepath.Join(directory, "genesis.json")), trace.Pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	return directory, migration, bootstrap, trace
}

func TestPQLabFinalizeTraceHeightEvidencePUBLICNineStatesAndCold(t *testing.T) {
	directory, _, _, trace := traceHeightPublicFixture(t)
	output := filepath.Join(pqLabWorkloadTemp(t), "replay")
	result, err := ReplayPQLabFinalizeTrace(context.Background(), directory, pqLabSHA(traceTestBytes(t, filepath.Join(directory, "result.json"))), output)
	if err != nil {
		t.Fatal("actual original nine-height replay", err)
	}
	if !result.CompleteStateBytesReconstructed || !result.FullResponsesCompared || result.AuthorityGranted || result.NodeStarted {
		t.Fatal("original replay scope changed")
	}
	if !bytes.Equal(traceTestBytes(t, filepath.Join(output, "replay.jsonl")), traceTestBytes(t, filepath.Join(directory, "records.jsonl"))) {
		t.Fatal("original complete records changed")
	}
	if pqLabSHA(traceTestBytes(t, filepath.Join(output, "result.json"))) != "e787b349efac338c7358353b86e937a119c961d556aec165e8c964ea3cc8ed88" || pqLabSHA(traceTestBytes(t, filepath.Join(output, "intent.json"))) != "32d388da6f4a52e854cea31ee69d346d75a09c2a0f33e4ccf51e3d015b3e81f7" {
		t.Fatal("old replay receipt or intent bytes changed")
	}
	rows := traceTestRows(t, filepath.Join(directory, "records.jsonl"))
	lines := bytes.Split(bytes.TrimSuffix(traceTestBytes(t, filepath.Join(output, "cold-reconstruction.jsonl")), []byte{'\n'}), []byte{'\n'})
	entries, err := os.ReadDir(filepath.Join(output, "height-states"))
	if err != nil || len(rows) != 9 || len(lines) != len(rows) || len(entries) != len(rows) || trace.FirstHeight != 4 || trace.LastHeight != 12 {
		t.Fatal("complete nine-height evidence missing", err)
	}
	for i, row := range rows {
		t.Run(strconv.FormatInt(row.Height, 10), func(t *testing.T) {
			raw := traceTestBytes(t, filepath.Join(output, "height-states", strconv.FormatInt(row.Height, 10)+".json"))
			if int64(len(raw)) != row.StateBytes || pqLabSHA(raw) != row.StateSHA256 {
				t.Fatal("full live height state differs")
			}
			var cold pqFinalizeColdReconstruction
			if err := pqLabDecode(lines[i], &cold); err != nil {
				t.Fatal(err)
			}
			if cold.Height != row.Height || cold.StateBytes != row.StateBytes || cold.StateSHA256 != row.StateSHA256 || cold.AppHash != row.AppHash || cold.ColdStateBytes != row.StateBytes || cold.ColdStateSHA256 != row.StateSHA256 || cold.ColdAppHash != row.AppHash || !cold.BytesEqual {
				t.Fatal("normal loader evidence differs")
			}
			if cold.ColdLoadNs <= 0 || cold.ColdEncodeNs <= 0 || cold.ColdCompareNs <= 0 {
				t.Fatal("actual cold operation elapsed time was not recorded")
			}
			var fields map[string]any
			if err := json.Unmarshal(lines[i], &fields); err != nil || len(fields) != 11 {
				t.Fatal("cold row is not closed eleven fields")
			}
			for _, key := range []string{"height", "stateBytes", "coldStateBytes", "coldLoadNs", "coldEncodeNs", "coldCompareNs"} {
				if _, ok := fields[key].(string); !ok {
					t.Fatal("decimal string field changed", key)
				}
			}
		})
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	partial := filepath.Join(pqLabWorkloadTemp(t), "cancelled")
	if _, err := ReplayPQLabFinalizeTrace(cancelled, directory, pqLabSHA(traceTestBytes(t, filepath.Join(directory, "result.json"))), partial); !errors.Is(err, context.Canceled) {
		t.Fatal("original cancellation lost", err)
	}
	if _, err := os.Stat(filepath.Join(partial, "result.json")); !os.IsNotExist(err) {
		t.Fatal("cancelled replay published a receipt")
	}
}

type traceHeightFailedWriter struct{ failure error }

func (w traceHeightFailedWriter) Write([]byte) (int, error) { return 0, w.failure }

func TestPQLabFinalizeTraceHeightEvidencePUBLICColdRefusals(t *testing.T) {
	directory, migration, bootstrap, _ := traceHeightPublicFixture(t)
	raw := traceTestBytes(t, filepath.Join(directory, "final-state.json"))
	rows := traceTestRows(t, filepath.Join(directory, "records.jsonl"))
	original := rows[len(rows)-1]
	for _, name := range []string{"live-hash", "wrong-height", "wrong-apphash", "invalid-normal-state", "output-failure", "no-overwrite"} {
		t.Run(name, func(t *testing.T) {
			row := original
			stateRaw := append([]byte(nil), raw...)
			output := pqLabWorkloadTemp(t)
			private := pqLabWorkloadTemp(t)
			if err := os.Mkdir(filepath.Join(output, "height-states"), 0700); err != nil {
				t.Fatal(err)
			}
			var receipts bytes.Buffer
			var writer io.Writer = &receipts
			failure := errors.New("synthetic public receipt output refused")
			switch name {
			case "live-hash":
				row.StateSHA256 = strings.Repeat("0", 64)
			case "wrong-height":
				row.Height--
			case "wrong-apphash":
				row.AppHash = strings.Repeat("0", 64)
			case "invalid-normal-state":
				var state map[string]json.RawMessage
				if err := json.Unmarshal(stateRaw, &state); err != nil {
					t.Fatal(err)
				}
				state["appHash"] = json.RawMessage(`"` + strings.Repeat("0", 64) + `"`)
				var err error
				stateRaw, err = json.Marshal(state)
				if err != nil {
					t.Fatal(err)
				}
				row.StateBytes = int64(len(stateRaw))
				row.StateSHA256 = pqLabSHA(stateRaw)
			case "output-failure":
				writer = traceHeightFailedWriter{failure}
			case "no-overwrite":
				if err := pqLabWrite(filepath.Join(output, "height-states", "12.json"), []byte("retain-original")); err != nil {
					t.Fatal(err)
				}
			}
			err := pqFinalizeRetainHeightState(output, private, migration, bootstrap, row, stateRaw, writer)
			if err == nil || receipts.Len() != 0 {
				t.Fatal("invalid cold evidence accepted")
			}
			if name == "output-failure" && !errors.Is(err, failure) {
				t.Fatal("output first cause lost", err)
			}
			if name == "no-overwrite" && string(traceTestBytes(t, filepath.Join(output, "height-states", "12.json"))) != "retain-original" {
				t.Fatal("existing partial overwritten")
			}
		})
	}
}
