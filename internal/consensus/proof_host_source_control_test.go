//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

type proofHostLiveFixture struct {
	source    *proofHostSourceFixture
	app       *Application
	node      *node.Node
	pv        *proofSourceNoSigningPV
	databases map[string]dbm.DB
	stop      func()
}

// Real original BlockExecutor/dual commits, normal owning Node construction,
// no Node.Start, network listener, daemon or source-selected signer capability.
func newProofHostLiveFixture(t *testing.T) *proofHostLiveFixture {
	t.Helper()
	f := newProofHostSourceFixture(t, "atomic-json", "")
	h := f.f.light.harness
	app, err := NewPersistentApplicationWithEngineAuthorization(h.f.migration, f.plan.StateFile, h.f.bootstrap, f.f.light.authorization)
	if err != nil {
		t.Fatal(err)
	}
	config := cmtconfig.DefaultConfig().SetRoot(filepath.Dir(f.plan.CometDataDirectory))
	config.TxIndex.Indexer = "null"
	config.P2P.PexReactor = false
	config.RPC.ListenAddress = ""
	config.RPC.PprofListenAddress = ""
	if err = os.MkdirAll(filepath.Dir(config.GenesisFile()), 0700); err != nil {
		t.Fatal(err)
	}
	proofSourceWrite(t, config.GenesisFile(), h.f.raw)
	key := cmted.PrivKey(bytes.Clone(h.f.legacy[string(h.f.bootstrap.record.Members[0].Address)]))
	pv := &proofSourceNoSigningPV{delegate: privval.NewFilePV(key, filepath.Join(config.RootDir, "unused-key.json"), filepath.Join(config.RootDir, "unused-sign.json"))}
	dbs := make(map[string]dbm.DB)
	provider := func(ctx *cmtconfig.DBContext) (dbm.DB, error) {
		db, e := cmtconfig.DefaultDBProvider(ctx)
		if e == nil {
			dbs[ctx.ID] = db
		}
		return db, e
	}
	n, err := newPQNodeWithDatabase(config, app, pv, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, log.NewNopLogger(), provider)
	if err != nil {
		t.Fatal(err)
	}
	var stopOnce sync.Once
	stop := func() { stopOnce.Do(func() { n.OnStop(); _ = n.ProxyApp().Stop() }) }
	t.Cleanup(stop)
	pv.blocked = true
	return &proofHostLiveFixture{f, app, n, pv, dbs, stop}
}
func (f *proofHostLiveFixture) policy(t *testing.T, id byte, change func(*ProofHostSourcePlan)) (ProofHostLivePolicy, string, string) {
	t.Helper()
	session := strings.Repeat(string(id), 64)
	plan := f.source.plan
	if change != nil {
		change(&plan)
	}
	planPath := filepath.Join(f.source.root, "live-plan-"+session+".json")
	raw := proofSourceJSON(t, plan)
	proofSourceWrite(t, planPath, raw)
	p := ProofHostLivePolicy{Version: ProofHostLivePolicyVersion, SourcePlanFile: planPath, SourcePlanSHA256: proofHostSHA(raw), ControlFile: filepath.Join(filepath.Dir(plan.StateFile), "proof-host-source-"+session+".json"), Destination: filepath.Join(f.source.root, "delivery-"+session), SessionID: session, CaptureTimeoutSeconds: "30"}
	path := filepath.Join(f.source.root, "live-policy-"+session+".json")
	body := proofSourceJSON(t, p)
	proofSourceWrite(t, path, body)
	return p, path, proofHostSHA(body)
}

func TestProofHostLiveNormalPrivateRequestActualNodeDelivery(t *testing.T) {
	f := newProofHostLiveFixture(t)
	p, path, pin := f.policy(t, 'a', nil)
	c, err := NewProofHostLiveControl(f.node, f.app, path, pin)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if present, err := c.captureRequest(context.Background()); err != nil || present {
		t.Fatal("absent optional request must not execute", present, err)
	}
	publication, err := PublishProofHostLiveRequest(path, pin)
	if runtime.GOOS != "linux" {
		if err == nil || publication.Outcome != "" {
			t.Fatal("unsupported atomic publisher silently enabled")
		}
		return
	}
	if err != nil || publication.Outcome != "request_published" || publication.Delivery != nil || publication.NativeRootAuthorized {
		t.Fatal("request falsely claimed DATA delivery or authority", err)
	}
	before := proofSourceTree(t, filepath.Join(f.source.root, "original"))
	calls := f.pv.calls
	if err = c.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-c.Done():
	case <-time.After(15 * time.Second):
		t.Fatal("bounded normal control did not finish")
	}
	if err = c.Err(); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(p.Destination+".attempt", "result.json"))
	if err != nil {
		t.Fatal(err)
	}
	var result ProofHostLiveResult
	if err = json.Unmarshal(body, &result); err != nil || result.Outcome != "data_delivered" || result.Delivery == nil || !result.PublicDataOnly || result.NativeRootAuthorized || result.Delivery.NativeRootAuthorized {
		t.Fatal("wrong DATA result", err)
	}
	if f.node.IsRunning() || calls != f.pv.calls {
		t.Fatal("control started node or queried signing custody")
	}
	if !reflect.DeepEqual(before, proofSourceTree(t, filepath.Join(f.source.root, "original"))) {
		t.Fatal("normal control changed original ledger/request")
	}
	retained := proofSourceTree(t, p.Destination)
	if _, err = PublishProofHostLiveRequest(path, pin); err == nil {
		t.Fatal("same original request was automatically reusable")
	}
	if _, err = c.captureRequest(context.Background()); err == nil {
		t.Fatal("same controller re-executed completed request")
	}
	if err = c.Close(); err != nil {
		t.Fatal(err)
	}
	if err = c.Start(context.Background()); err == nil {
		t.Fatal("retired control restarted")
	}
	if !reflect.DeepEqual(retained, proofSourceTree(t, p.Destination)) {
		t.Fatal("retire/reentry changed original delivery")
	}
}

func TestProofHostLiveWrongCheckpointKeepsUnknownAndNeverRetargets(t *testing.T) {
	for _, kind := range []string{"wrong-hash", "wrong-height"} {
		t.Run(kind, func(t *testing.T) {
			f := newProofHostLiveFixture(t)
			p, path, pin := f.policy(t, 'b', func(plan *ProofHostSourcePlan) {
				if kind == "wrong-hash" {
					plan.EngineAppHash = strings.Repeat("c", 64)
				} else {
					h, e := strconv.ParseInt(plan.EngineHeight, 10, 64)
					if e != nil {
						t.Fatal(e)
					}
					plan.EngineHeight = strconv.FormatInt(h+1, 10)
				}
			})
			c, err := NewProofHostLiveControl(f.node, f.app, path, pin)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			// Exact request bytes come from the same independently checked policy. The
			// positive publication mechanism is covered above; this test isolates the
			// normal reader's real source error on every Unix target.
			proofSourceWrite(t, p.ControlFile, proofSourceJSON(t, c.in.request()))
			before := proofSourceTree(t, filepath.Join(f.source.root, "original"))
			if _, err = c.captureRequest(context.Background()); err == nil || !strings.Contains(err.Error(), "checkpoint differs") {
				t.Fatal("exact wrong-H/hash plan was reinterpreted", err)
			}
			if _, e := os.Lstat(p.Destination); !os.IsNotExist(e) {
				t.Fatal("invalid source created delivery")
			}
			first, err := os.ReadFile(filepath.Join(p.Destination+".attempt", "failure.json"))
			if err != nil || !bytes.Contains(first, []byte(`"outcome":"unknown"`)) {
				t.Fatal("UNKNOWN first cause not retained", err)
			}
			if _, err = c.captureRequest(context.Background()); err == nil {
				t.Fatal("UNKNOWN was retried")
			}
			readback, err := os.ReadFile(filepath.Join(p.Destination+".attempt", "failure.json"))
			if err != nil || !bytes.Equal(first, readback) || !reflect.DeepEqual(before, proofSourceTree(t, filepath.Join(f.source.root, "original"))) {
				t.Fatal("rejected retry changed first cause or source", err)
			}
		})
	}
}

func TestProofHostLiveRefusesChangedPolicyTargetAndResidualRequest(t *testing.T) {
	for i, name := range []string{"wrong-pin", "request-retarget", "policy-replaced", "residual-partial", "residual-attempt", "wrong-mode"} {
		t.Run(name, func(t *testing.T) {
			f := newProofHostLiveFixture(t)
			p, path, pin := f.policy(t, byte('a'+i), nil)
			switch name {
			case "wrong-pin":
				pin = strings.Repeat("e", 64)
			case "residual-partial":
				proofSourceWrite(t, p.ControlFile+".partial", []byte("UNKNOWN"))
			case "residual-attempt":
				if err := os.Symlink("missing", p.Destination+".attempt"); err != nil {
					t.Fatal(err)
				}
			case "wrong-mode":
				p.Version = "self-authorized-root"
				raw := proofSourceJSON(t, p)
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
				pin = proofHostSHA(raw)
			}
			c, err := NewProofHostLiveControl(f.node, f.app, path, pin)
			if name != "request-retarget" && name != "policy-replaced" {
				if err == nil {
					_ = c.Close()
					t.Fatal("unsafe source policy/residue accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			r := c.in.request()
			if name == "request-retarget" {
				r.OperationID = "unapproved-other-operation"
			} else {
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				replacement := path + ".replacement"
				proofSourceWrite(t, replacement, raw)
				if err = os.Rename(replacement, path); err != nil {
					t.Fatal(err)
				}
			}
			proofSourceWrite(t, p.ControlFile, proofSourceJSON(t, r))
			if _, err = c.captureRequest(context.Background()); err == nil {
				t.Fatal("changed original policy/request accepted")
			}
			if _, err = os.Lstat(p.Destination + ".attempt"); !os.IsNotExist(err) {
				t.Fatal("invalid request reached export attempt")
			}
		})
	}
}

func TestProofHostLiveNodeStopRetiresReaderBeforeOriginalStoresClose(t *testing.T) {
	f := newProofHostLiveFixture(t)
	p, path, pin := f.policy(t, 'd', nil)
	c, err := NewProofHostLiveControl(f.node, f.app, path, pin)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	proofSourceWrite(t, p.ControlFile, proofSourceJSON(t, c.in.request()))
	// Enter the exact read lifetime used by captureRequest. The barrier keeps
	// a real original-store reader in flight deterministically; no sleep guesses
	// whether a goroutine has reached Application.RLock.
	if err = c.beginRead(); err != nil {
		t.Fatal(err)
	}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(c.finishRead) }
	defer release()
	view, err := f.node.ProofSourceView()
	if err != nil {
		t.Fatal(err)
	}
	before, err := view.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	stateBytes, err := f.databases["state"].Get([]byte("stateKey"))
	if err != nil || len(stateBytes) == 0 {
		t.Fatal("missing real original checkpoint", err)
	}
	stopped := make(chan struct{})
	go func() { f.stop(); close(stopped) }()
	deadline := time.After(3 * time.Second)
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		c.mu.Lock()
		retired := c.retired
		c.mu.Unlock()
		if retired {
			break
		}
		select {
		case <-deadline:
			t.Fatal("actual Node.OnStop did not retire its consumer")
		case <-ticker.C:
		}
	}
	select {
	case <-stopped:
		t.Fatal("Node.OnStop returned before its original reader joined")
	default:
	}
	during, err := view.LoadState()
	if err != nil || before.LastBlockHeight != during.LastBlockHeight || !bytes.Equal(before.AppHash, during.AppHash) || !before.LastBlockID.Equals(during.LastBlockID) {
		t.Fatal("original checkpoint closed/changed before reader joined", err)
	}
	still, err := f.databases["state"].Get([]byte("stateKey"))
	if err != nil || !bytes.Equal(still, stateBytes) {
		t.Fatal("actual state DB closed before consumer joined", err)
	}
	if block := view.LoadBlock(before.LastBlockHeight); block == nil || !bytes.Equal(block.Hash(), before.LastBlockID.Hash) {
		t.Fatal("actual block DB closed before consumer joined")
	}
	if err = c.beginRead(); err == nil {
		c.finishRead()
		t.Fatal("retirement admitted another source reader")
	}
	release()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("normal stop failed to join released reader")
	}
	if _, err = f.databases["state"].Get([]byte("stateKey")); err == nil {
		t.Fatal("normal stop did not close actual original state DB")
	}
	if err = c.Close(); err != nil {
		t.Fatal("repeated retirement closed originals twice", err)
	}
	if err = f.node.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
		t.Fatal("stopped Node accepted a new source consumer")
	}
	f.stop() // fixture's normal cleanup may join again, never call transport.Close twice
	if _, err = os.Lstat(p.Destination); !os.IsNotExist(err) {
		t.Fatal("retired capture published a delivery")
	}
	if _, err = os.Stat(p.ControlFile); err != nil {
		t.Fatal("retirement removed original request", err)
	}
	if _, err = c.captureRequest(context.Background()); err == nil {
		t.Fatal("retired source renewed itself")
	}
}

func TestProofHostLivePrivateDirectoryRejectsSpecialBits(t *testing.T) {
	for _, mode := range []os.FileMode{0755, 0700 | os.ModeSticky, 0700 | os.ModeSetgid, 0700 | os.ModeSetuid} {
		t.Run(mode.String(), func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(root, mode); err != nil {
				t.Fatal(err)
			}
			if err := proofHostLivePrivateDirectory(root); err == nil {
				t.Fatal("non-private or special-mode directory accepted", mode)
			}
		})
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := proofHostLivePrivateDirectory(root); err != nil {
		t.Fatal("normal original private directory rejected", err)
	}
}

func TestProofHostLivePublisherPreservesResidualOriginalBytes(t *testing.T) {
	f := newProofHostLiveFixture(t)
	for i, kind := range []string{"partial", "request", "attempt"} {
		t.Run(kind, func(t *testing.T) {
			p, path, pin := f.policy(t, byte('1'+i), nil)
			original := []byte("original UNKNOWN bytes, never replace or remove")
			switch kind {
			case "partial":
				proofSourceWrite(t, p.ControlFile+".partial", original)
			case "request":
				proofSourceWrite(t, p.ControlFile, original)
			case "attempt":
				if err := os.Mkdir(p.Destination+".attempt", 0700); err != nil {
					t.Fatal(err)
				}
				proofSourceWrite(t, filepath.Join(p.Destination+".attempt", "intent.json"), original)
			}
			before := proofSourceTree(t, f.source.root)
			result, err := PublishProofHostLiveRequest(path, pin)
			if err == nil || result.Outcome != "" || result.Delivery != nil || result.NativeRootAuthorized {
				t.Fatal("existing original was treated as a new publication", err)
			}
			if !reflect.DeepEqual(before, proofSourceTree(t, f.source.root)) {
				t.Fatal("failed publisher changed original bytes or UNKNOWN artifacts")
			}
		})
	}
}
