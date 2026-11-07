//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	blockstore "github.com/cometbft/cometbft/store"
)

func TestPQLightSourcePUBLICZeroTransactionExport(t *testing.T) {
	trace := os.Getenv("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE")
	f := openPublicTraceObserver(t, trace)
	env, err := f.node.ConfigureRPC()
	if err != nil {
		t.Fatal(err)
	}
	actual, err := env.StateStore.Load()
	if err != nil {
		t.Fatal(err)
	}
	target := f.node.BlockStore().LoadBlock(12)
	trusted := f.node.BlockStore().LoadBlock(9)
	if target == nil || trusted == nil || len(target.Txs) != 0 {
		t.Fatal("original target must be a genuine zero-transaction block")
	}
	now := target.Time.Add(time.Second)
	state := f.app.committed
	f.close() // Actual store/writer ownership is released, without Node.Start.
	root := filepath.Join(t.TempDir(), "private")
	if err = os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	signing := filepath.Join(root, "public-lock-sentinel")
	proofSourceWrite(t, signing, []byte("PUBLIC exclusion sentinel; NOT HRS, custody, or production qualification"))
	proofSourceWrite(t, signing+".lock", nil)
	p := PQLightSourcePlan{Version: PQLightSourcePlanVersion, ChainID: actual.ChainID, HeaderHeight: "12", MigrationFile: filepath.Join(trace, "migration.json"), MigrationSHA256: f.receipt.Migration.SHA256, GenesisFile: filepath.Join(trace, "genesis.json"), ConsensusGenesisSHA256: f.receipt.Pins.CometGenesisSHA256, OriginalGenesisHash: f.receipt.Pins.OriginalGenesisHash, MigrationStateHash: f.receipt.Pins.MigrationStateHash, StateFile: f.path, StateLayout: "atomic-json", CometDataDirectory: f.config.DBDir(), SigningStatePath: signing, SigningLockKind: "pq-signer", ScheduleFile: filepath.Join(trace, "schedule.json"), ScheduleHash: f.receipt.ScheduleHash, ScheduleSHA256: f.receipt.Schedule.SHA256, EngineHeight: strconv.FormatInt(actual.LastBlockHeight, 10), EngineAppHash: hex.EncodeToString(actual.AppHash), TrustedHeight: "9", TrustedBlockHash: hex.EncodeToString(trusted.Hash()), TrustingPeriodNanoseconds: strconv.FormatInt(int64(time.Hour), 10), MaxClockDriftNanoseconds: "0", TrustLevelNumerator: "1", TrustLevelDenominator: "3"}
	encode := func(p PQLightSourcePlan) ([]byte, string) {
		t.Helper()
		raw, e := json.Marshal(p)
		if e != nil {
			t.Fatal(e)
		}
		return raw, proofHostSHA(raw)
	}
	reject := func(t *testing.T, q PQLightSourcePlan, pin string, clock time.Time) {
		t.Helper()
		raw, expected := encode(q)
		if pin == "" {
			pin = expected
		}
		out := filepath.Join(root, strings.ReplaceAll(t.Name(), "/", "_"))
		receipt, e := ExportStoppedPQLightSource(raw, pin, out, clock)
		if e == nil || receipt.ManifestPath != "" {
			t.Fatal("invalid source accepted")
		}
		if _, e = os.Lstat(out); !os.IsNotExist(e) {
			t.Fatal("failed capture published output")
		}
	}
	raw, pin := encode(p)
	exported := os.Getenv("YNX_PUBLIC_LIGHT_SOURCE_EXPORT")
	if exported == "" {
		exported = filepath.Join(root, "public-delivery")
	}
	t.Run("zero_tx_original_headers_and_exact_verifier_schema", func(t *testing.T) {
		receipt, e := ExportStoppedPQLightSource(raw, pin, exported, now)
		if e != nil {
			t.Fatal(e)
		}
		if receipt.Verification.HeaderHeight != 12 || receipt.Verification.StateHeight != 11 || !receipt.Verification.CommitVerified || !receipt.Verification.LightTransitionVerified || !receipt.PublicDataOnly || !receipt.SourceReadOnly || receipt.NativeRootAuthorized || receipt.DeploymentVerified {
			t.Fatal("incorrect verification or authority claim")
		}
		context := publicTraceBytes(t, receipt.ContextPath, 32<<10)
		request := publicTraceBytes(t, receipt.RequestPath, MaxPQLightProofRequestBytes+4096)
		if proofHostSHA(context) != receipt.ContextSHA256 || proofHostSHA(request) != receipt.RequestSHA256 {
			t.Fatal("delivery pins differ")
		}
		var ctx map[string]string
		var req map[string]json.RawMessage
		if json.Unmarshal(context, &ctx) != nil || len(ctx) != 24 || ctx["version"] != "YNX-CONSENSUS-PROOF-TRUST/v1" || json.Unmarshal(request, &req) != nil || len(req) != 3 {
			t.Fatal("normal verifier wire differs")
		}
		if !bytes.Equal(publicTraceBytes(t, filepath.Join(exported, "committed-state.json"), 16<<20), publicTraceBytes(t, filepath.Join(trace, "final-state.json"), 16<<20)) {
			t.Fatal("full state encoding changed")
		}
		// Only public cross-package verifier evidence; no secret/signer is exported.
		evidence, _ := json.Marshal(struct {
			Receipt PQLightSourceReceipt `json:"receipt"`
			Now     time.Time            `json:"now"`
		}{receipt, now})
		if err = os.WriteFile(filepath.Join(exported, "PUBLIC-test-receipt.json"), evidence, 0600); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("existing_or_partial_output_retained", func(t *testing.T) {
		before, e := os.ReadFile(filepath.Join(exported, "delivery.json"))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = ExportStoppedPQLightSource(raw, pin, exported, now); e == nil {
			t.Fatal("existing publication accepted")
		}
		after, _ := os.ReadFile(filepath.Join(exported, "delivery.json"))
		if !bytes.Equal(before, after) {
			t.Fatal("existing output changed")
		}
	})
	for name, change := range map[string]func(*PQLightSourcePlan){
		"wrong_engine_hash":   func(q *PQLightSourcePlan) { q.EngineAppHash = strings.Repeat("1", 64) },
		"wrong_trusted_hash":  func(q *PQLightSourcePlan) { q.TrustedBlockHash = strings.Repeat("1", 64) },
		"wrong_chain":         func(q *PQLightSourcePlan) { q.ChainID = "other-chain" },
		"missing_header":      func(q *PQLightSourcePlan) { q.HeaderHeight = "13" },
		"preactivation_state": func(q *PQLightSourcePlan) { q.HeaderHeight = "9"; q.TrustedHeight = "8" },
		"wrong_schedule":      func(q *PQLightSourcePlan) { q.ScheduleHash = strings.Repeat("1", 64) },
		"wrong_layout":        func(q *PQLightSourcePlan) { q.StateLayout = "block-journal" },
		"unknown_runtime":     func(q *PQLightSourcePlan) { q.RuntimePlanHash = strings.Repeat("1", 64) },
		"noncanonical_height": func(q *PQLightSourcePlan) { q.HeaderHeight = "012" },
	} {
		t.Run(name, func(t *testing.T) { q := p; change(&q); reject(t, q, "", now) })
	}
	t.Run("wrong_plan_pin", func(t *testing.T) { reject(t, p, strings.Repeat("1", 64), now) })
	t.Run("expired_trust", func(t *testing.T) { reject(t, p, "", now.Add(2*time.Hour)) })
	t.Run("active_application_writer", func(t *testing.T) {
		lease, e := AcquireApplicationStateWriterLease(p.StateFile)
		if e != nil {
			t.Fatal(e)
		}
		defer lease.Close()
		reject(t, p, "", now)
	})
	t.Run("active_signer_writer", func(t *testing.T) {
		close, e := existingInspectionLockFile(signing + ".lock")
		if e != nil {
			t.Fatal(e)
		}
		defer close()
		reject(t, p, "", now)
	})
	t.Run("active_blockstore_writer", func(t *testing.T) {
		db, e := dbm.NewGoLevelDB("blockstore", p.CometDataDirectory)
		if e != nil {
			t.Fatal(e)
		}
		defer db.Close()
		reject(t, p, "", now)
	})
	// Mutate each mathematical branch in actual test-only stored commits. No
	// signatures are created; all original PUBLIC commits are restored afterward.
	for _, branch := range []string{"MLDSA87", "SLHDSASHA2256f"} {
		t.Run("reject_bad_"+branch, func(t *testing.T) {
			db, e := dbm.NewGoLevelDB("blockstore", p.CometDataDirectory)
			if e != nil {
				t.Fatal(e)
			}
			bs := blockstore.NewBlockStore(db)
			original := bs.LoadSeenCommit(12)
			bad := original.Clone()
			for i := range bad.Signatures {
				if len(bad.Signatures[i].Signature) == 0 {
					continue
				}
				v, e := ynxconsensusauth.ParseEnvelope(bad.Signatures[i].Signature)
				if e != nil {
					t.Fatal(e)
				}
				if branch == "MLDSA87" {
					v.MLDSA87[0] ^= 1
				} else {
					v.SLHDSASHA2256f[0] ^= 1
				}
				bad.Signatures[i].Signature, e = v.MarshalBinary()
				if e != nil {
					t.Fatal(e)
				}
			}
			if e = bs.SaveSeenCommit(12, bad); e != nil {
				t.Fatal(e)
			}
			if e = db.Close(); e != nil {
				t.Fatal(e)
			}
			reject(t, p, "", now)
			db, e = dbm.NewGoLevelDB("blockstore", p.CometDataDirectory)
			if e != nil {
				t.Fatal(e)
			}
			bs = blockstore.NewBlockStore(db)
			if e = bs.SaveSeenCommit(12, original); e != nil {
				t.Fatal(e)
			}
			if e = db.Close(); e != nil {
				t.Fatal(e)
			}
		})
	}
	for _, layout := range []string{"snapshot-journal", "block-journal"} {
		t.Run("cold_"+layout, func(t *testing.T) {
			q := p
			q.StateLayout = layout
			q.StateFile = filepath.Join(root, layout)
			if layout == "snapshot-journal" {
				j, _, e := openSnapshotJournal(q.StateFile, f.migration)
				if e != nil {
					t.Fatal(e)
				}
				if e = j.save(state, f.migration, nil); e != nil {
					t.Fatal(e)
				}
			} else {
				j, _, e := openBlockJournal(q.StateFile, f.migration)
				if e != nil {
					t.Fatal(e)
				}
				if e = j.replaceCheckpoint(state, f.migration); e != nil {
					t.Fatal(e)
				}
			}
			lease, e := AcquireApplicationStateWriterLease(q.StateFile)
			if e != nil {
				t.Fatal(e)
			}
			if e = lease.Close(); e != nil {
				t.Fatal(e)
			}
			r, h := encode(q)
			receipt, e := ExportStoppedPQLightSource(r, h, filepath.Join(root, layout+"-delivery"), now)
			if e != nil {
				t.Fatal(e)
			}
			if receipt.Verification.BlockHash != hex.EncodeToString(target.Hash()) {
				t.Fatal("layout changed original target")
			}
		})
	}
	t.Run("strict_schema", func(t *testing.T) {
		for _, bad := range [][]byte{append(append([]byte{}, raw...), []byte("{}")...), bytes.Replace(raw, []byte(`"version":`), []byte(`"extra":true,"version":`), 1), bytes.Replace(raw, []byte(`"chainId":`), []byte(`"chainId":"duplicate","chainId":`), 1), bytes.Replace(raw, []byte(`"runtimePlanFile":""`), []byte(`"runtimePlanFile":null`), 1)} {
			if _, e := DecodePQLightSourcePlan(bad, proofHostSHA(bad)); e == nil {
				t.Fatal("noncanonical/duplicate/null schema accepted")
			}
		}
	})
}
