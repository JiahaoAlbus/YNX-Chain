package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/p2p"
	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

func wireObservationTestDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestOperatorWireObservationFlagsDefaultAndFailClosed(t *testing.T) {
	dir := wireObservationTestDir(t)
	good := []string{"--wire-observation-output", filepath.Join(dir, "wire.json"), "--wire-observation-scope", operatorWireObservationScope}
	for _, name := range []string{"default", "complete", "only-output", "only-scope", "wrong-scope", "relative", "unclean", "duplicate-output", "duplicate-scope", "existing", "state-alias", "lock-alias"} {
		t.Run(name, func(t *testing.T) {
			p := pqOptions{recoveryFD: -1}
			flags := pflag.NewFlagSet("start", pflag.ContinueOnError)
			flags.SetOutput(io.Discard)
			registerWireObservationFlags(flags, &p)
			args := append([]string(nil), good...)
			switch name {
			case "default":
				args = nil
			case "only-output":
				args = args[:2]
			case "only-scope":
				args = args[2:]
			case "wrong-scope":
				args[3] = "public-network"
			case "relative":
				args[1] = "wire.json"
			case "unclean":
				args[1] = dir + "/../wire.json"
			case "duplicate-output":
				args = append(args, args[:2]...)
			case "duplicate-scope":
				args = append(args, args[2:]...)
			case "existing":
				args[1] = filepath.Join(dir, "original.json")
				if err := os.WriteFile(args[1], []byte("original-UNKNOWN"), 0600); err != nil {
					t.Fatal(err)
				}
			case "state-alias":
				p.state = args[1]
			case "lock-alias":
				p.state = filepath.Join(dir, "state.json")
				args[1] = p.state + ".writer.lock"
			}
			err := flags.Parse(args)
			if err == nil {
				err = p.validateWireObservation()
			}
			if name == "default" {
				if err != nil || p.enabled() || p.wireObservationConfigured() {
					t.Fatal("disabled observation changed legacy flags", err)
				}
				if o, err := prepareOperatorWireObservation(nil, p); err != nil || o != nil {
					t.Fatal("disabled observation accessed config/files", err)
				}
			} else if name == "complete" {
				if err != nil || !p.enabled() || !p.wireObservationConfigured() || p.validate() == nil {
					t.Fatal("complete observer flags must still require the original independent node pins", err)
				}
			} else if err == nil {
				t.Fatal("ambiguous/missing/overwriting observation flags accepted")
			}
		})
	}
	// The actual normal entry must reject invalid observation before acquiring
	// any state writer lease, constructing a node, or falling back to stock.
	p := pqOptions{recoveryFD: -1, state: filepath.Join(dir, "unopened-state"), wireObservationOutput: filepath.Join(dir, "unused.json")}
	if err := runPQNode(&cobra.Command{}, p); err == nil {
		t.Fatal("partial normal CLI observation was accepted")
	}
	for _, path := range []string{p.state, p.state + ".writer.lock", p.wireObservationOutput} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("invalid flags mutated original state/output", err)
		}
	}
}

type wireObservationFixture struct {
	config  *cfg.Config
	options pqOptions
	wire    []byte
}

// Receive/InitPeer only consult the source ID. Other methods deliberately have
// no implementation: this is not a live connection or a substitute transport.
type wireObservationPeer struct{ p2p.Peer }

func (wireObservationPeer) ID() p2p.ID {
	return p2p.ID("2121212121212121212121212121212121212121")
}

func newWireObservationFixture(t *testing.T) wireObservationFixture {
	t.Helper()
	root := wireObservationTestDir(t)
	source, err := consensus.NewPQLabWorkloadSource(consensus.PQLabWorkloadOptions{Owners: 1, Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	plan, err := consensus.GeneratePQLabNetwork(source.Migration, consensus.PQLabNetworkOptions{RootDir: filepath.Join(root, "lab"), BaseP2P: 37220, BaseRPC: 37320})
	if err != nil {
		t.Fatal(err)
	}
	bound, err := os.ReadFile(plan.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	if err = json.Unmarshal(bound, &migration); err != nil {
		t.Fatal(err)
	}
	corpusDir := filepath.Join(root, "corpus")
	corpus, err := source.WriteCorpus(corpusDir, migration)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := os.ReadFile(filepath.Join(corpusDir, corpus.Transactions[0].Envelope.Path))
	if err != nil {
		t.Fatal(err)
	}
	n := plan.Nodes[0]
	config := cfg.DefaultConfig()
	reader := viper.New()
	reader.SetConfigFile(filepath.Join(n.Home, "config", "config.toml"))
	if err = reader.ReadInConfig(); err != nil {
		t.Fatal(err)
	}
	if err = reader.Unmarshal(config); err != nil {
		t.Fatal(err)
	}
	config.SetRoot(n.Home)
	options := pqOptions{migration: plan.MigrationFile, state: n.StatePath, genesisHash: plan.CometGenesisSHA256,
		originalGenesisHash: plan.OriginalGenesisHash, migrationHash: plan.MigrationStateHash, recoveryFD: -1,
		wireObservationOutput: filepath.Join(root, "wire.json"), wireObservationScope: operatorWireObservationScope}
	return wireObservationFixture{config: config, options: options, wire: wire}
}

func TestOperatorWireObservationActualPinnedConstructorAndReactor(t *testing.T) {
	f := newWireObservationFixture(t)
	before := bootstrapOriginalBytes(t, f.config, f.options)
	o, err := prepareOperatorWireObservation(f.config, f.options)
	if err != nil {
		t.Fatal(err)
	}
	defer o.close()
	node, custody, err := constructBootstrapNode(f.config, log.NewNopLogger(), f.options)
	if err != nil {
		t.Fatal("normal pinned single-App constructor", err)
	}
	defer custody.Close()
	defer func() { node.OnStop(); _ = node.ProxyApp().Stop() }()
	if node.IsRunning() || node.BlockStore().Height() != 0 {
		t.Fatal("constructor unexpectedly started a network")
	}
	if err = o.install(node); err != nil {
		t.Fatal("normal pre-Start observer installation failed", err)
	}
	if err = o.install(node); err == nil {
		t.Fatal("observer was replaced/reset")
	}
	reactor := node.MempoolReactor().(*mempool.Reactor)
	peer := wireObservationPeer{}
	reactor.InitPeer(peer)
	original := bytes.Clone(f.wire)
	txHash := consensus.SignedTransactionHash(original)
	msg := &protomem.Txs{Txs: [][]byte{f.wire}}
	reactor.Receive(p2p.Envelope{ChannelID: mempool.MempoolChannel, Src: peer, Message: msg})
	deadline := time.Now().Add(2 * time.Second)
	for node.Mempool().Size() != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if node.Mempool().Size() != 1 {
		t.Fatal("real account AND transaction was not admitted by original CheckTx")
	}
	reactor.Receive(p2p.Envelope{ChannelID: mempool.MempoolChannel, Src: peer, Message: msg})
	reactor.Receive(p2p.Envelope{ChannelID: mempool.MempoolChannel, Message: &protomem.Txs{}})
	snapshot := o.observer.Snapshot()
	if !snapshot.Attached || snapshot.PhysicalBytesMeasured || snapshot.Overflow || snapshot.Received.Messages != 3 ||
		snapshot.Received.Transactions != 2 || snapshot.Received.TransactionBytes != uint64(2*len(original)) ||
		snapshot.CheckTxCalls != 2 || snapshot.CheckTxReturnNil != 1 || snapshot.CheckTxReturnError != 1 || snapshot.EmptyReceived != 1 {
		t.Fatalf("actual reactor observation differs from original calls: %+v", snapshot)
	}
	reaped := node.Mempool().ReapMaxTxs(-1)
	if len(reaped) != 1 || !bytes.Equal(reaped[0], original) || !bytes.Equal(f.wire, original) || consensus.SignedTransactionHash(reaped[0]) != txHash {
		t.Fatal("observer modified or replaced original transaction/ID")
	}
	if err = o.writeAfterStop(); err == nil {
		t.Fatal("unstarted constructor emitted a completed lifetime")
	}
	if _, err = os.Lstat(f.options.wireObservationOutput); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("per-message/startup observer wrote output")
	}
	assertBootstrapOriginalBytes(t, before)
}

func TestOperatorWireObservationActualScopeAndLoopbackRefusals(t *testing.T) {
	f := newWireObservationFixture(t)
	for _, name := range []string{"public-migration", "foreign-chain", "wrong-genesis-pin", "wrong-native-pin", "wrong-migration-pin", "public-p2p", "public-rpc", "dns-peer", "public-peer", "state-sync", "genesis-alias"} {
		t.Run(name, func(t *testing.T) {
			p := f.options
			c := *f.config
			p2p, rpc, stateSync := *c.P2P, *c.RPC, *c.StateSync
			c.P2P, c.RPC, c.StateSync = &p2p, &rpc, &stateSync
			switch name {
			case "public-migration", "foreign-chain":
				raw, err := os.ReadFile(p.migration)
				if err != nil {
					t.Fatal(err)
				}
				var m chain.ConsensusMigrationState
				if err = json.Unmarshal(raw, &m); err != nil {
					t.Fatal(err)
				}
				if name == "public-migration" {
					m.Network.IsPublicNet = true
				} else {
					m.Network.ChainID = 6423
				}
				raw, err = json.Marshal(m)
				if err != nil {
					t.Fatal(err)
				}
				p.migration = filepath.Join(wireObservationTestDir(t), "changed.json")
				if err = os.WriteFile(p.migration, raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "wrong-genesis-pin":
				p.genesisHash = strings.Repeat("a", 64)
			case "wrong-native-pin":
				p.originalGenesisHash = strings.Repeat("a", 64)
			case "wrong-migration-pin":
				p.migrationHash = strings.Repeat("a", 64)
			case "public-p2p":
				c.P2P.ListenAddress = "tcp://0.0.0.0:37220"
			case "public-rpc":
				c.RPC.ListenAddress = "tcp://0.0.0.0:37320"
			case "dns-peer":
				c.P2P.PersistentPeers = strings.Repeat("a", 40) + "@localhost:37221"
			case "public-peer":
				c.P2P.PersistentPeers = strings.Repeat("a", 40) + "@192.0.2.10:37221"
			case "state-sync":
				c.StateSync.Enable = true
			case "genesis-alias":
				p.wireObservationOutput = c.GenesisFile()
			}
			if o, err := prepareOperatorWireObservation(&c, p); err == nil || o != nil {
				if o != nil {
					_ = o.close()
				}
				t.Fatal("scope string bypassed actual pinned source/loopback checks")
			}
			if _, err := os.Lstat(f.options.wireObservationOutput); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("refused scope wrote an observation")
			}
		})
	}
}

// Lifecycle unit probe only. It never starts a Node or claims network evidence;
// the actual node/real reactor installation is exercised separately above.
type wireObservationStopProbe struct {
	running bool
	quit    chan struct{}
	err     error
	calls   int
	onStop  func()
}

func (s *wireObservationStopProbe) IsRunning() bool       { return s.running }
func (s *wireObservationStopProbe) Quit() <-chan struct{} { return s.quit }
func (s *wireObservationStopProbe) Stop() error {
	s.calls++
	if s.onStop != nil {
		s.onStop()
	}
	if s.err != nil {
		return s.err
	}
	s.running = false
	close(s.quit)
	return nil
}

func newWireObservationWriteProbe(t *testing.T) *operatorWireObservation {
	t.Helper()
	dir := wireObservationTestDir(t)
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	o := &operatorWireObservation{path: filepath.Join(dir, "wire.json"), root: root, directory: file, parent: info, observer: &mempool.WireObserver{}, installed: true, ran: true}
	// Attach the original observer; never fabricate a replacement snapshot.
	reactor := mempool.NewReactor(cfg.DefaultMempoolConfig(), nil)
	if err = reactor.SetWireObserver(o.observer); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = o.close() })
	return o
}

func TestOperatorWireObservationNormalStopOneOutputAndPublicSchema(t *testing.T) {
	o := newWireObservationWriteProbe(t)
	probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
	probe.onStop = func() {
		if _, err := os.Lstat(o.path); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("observation preceded original Stop completion")
		}
	}
	if err := stopPQNodeWithObservation(probe, o); err != nil || probe.calls != 1 {
		t.Fatal("normal stop/output failed", err)
	}
	raw, err := os.ReadFile(o.path)
	if err != nil {
		t.Fatal(err)
	}
	var result operatorWireObservationResult
	if err = decodeStrict(raw, &result); err != nil || result.Version != operatorWireObservationVersion ||
		result.Scope != operatorWireObservationScope || !result.SyntheticOnly || result.IndependentFinality || result.PhysicalBytesMeasured ||
		!result.Snapshot.Attached || result.Snapshot != o.observer.Snapshot() {
		t.Fatal("aggregate kind or detached original snapshot changed", err)
	}
	if info, err := os.Lstat(o.path); err != nil || info.Mode().Perm() != 0600 || len(raw) > 64<<10 {
		t.Fatal("observation output is not bounded/private", err)
	}
	// Only fixed schema/scope/boundary strings can occur: no user transaction,
	// peer, path, key, identity, or credential string has a serialization slot.
	var document any
	if err = json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{operatorWireObservationVersion: true, operatorWireObservationScope: true,
		"after-normal-node-stop;completed-calls-only;in-flight-excluded": true, "YNX-MEMPOOL-WIRE-OBSERVATION/v1": true}
	var visit func(any)
	visit = func(value any) {
		switch v := value.(type) {
		case string:
			if !allowed[v] {
				t.Fatal("non-fixed/private string entered aggregate")
			}
		case map[string]any:
			for _, child := range v {
				visit(child)
			}
		case []any:
			t.Fatal("per-message/peer array entered aggregate")
		}
	}
	visit(document)
	if err = stopPQNodeWithObservation(probe, o); err == nil {
		t.Fatal("second final write attempt was silently accepted")
	}
	after, err := os.ReadFile(o.path)
	if err != nil || !bytes.Equal(raw, after) || probe.calls != 1 {
		t.Fatal("second call rewrote original output/repeated Stop", err)
	}
}

func TestOperatorWireObservationFailureAndUnknownPreserveOriginal(t *testing.T) {
	for _, name := range []string{"stop-error", "not-stopped", "not-started", "late-existing", "late-symlink", "directory-replaced", "sync-unknown"} {
		t.Run(name, func(t *testing.T) {
			o := newWireObservationWriteProbe(t)
			probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
			original := []byte("original-UNKNOWN")
			var originalPath string
			switch name {
			case "stop-error":
				probe.err = errors.New("original Node.Stop failure")
			case "not-stopped":
				probe.running = false
			case "not-started":
				o.ran = false
			case "late-existing":
				originalPath = o.path
				if err := os.WriteFile(originalPath, original, 0600); err != nil {
					t.Fatal(err)
				}
			case "late-symlink":
				originalPath = filepath.Join(filepath.Dir(o.path), "original")
				if err := os.WriteFile(originalPath, original, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(originalPath, o.path); err != nil {
					t.Fatal(err)
				}
			case "directory-replaced":
				parent := filepath.Dir(o.path)
				moved := parent + "-retained"
				if err := os.Rename(parent, moved); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(parent, 0700); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.RemoveAll(moved) }) // isolated test fixture only
			case "sync-unknown":
				// Actual fsync-on-closed-descriptor failure AFTER file.Write/Sync;
				// no mocked successful persistence or injected application callback.
				if err := o.directory.Close(); err != nil {
					t.Fatal(err)
				}
			}
			err := stopPQNodeWithObservation(probe, o)
			if err == nil || probe.err != nil && !errors.Is(err, probe.err) {
				t.Fatal("original lifecycle/persistence failure disappeared", err)
			}
			if originalPath != "" {
				got, err := os.ReadFile(originalPath)
				if err != nil || !bytes.Equal(got, original) {
					t.Fatal("original/UNKNOWN overwritten", err)
				}
			} else if name == "sync-unknown" {
				raw, readErr := os.ReadFile(o.path)
				if readErr != nil || !bytes.Contains(raw, []byte(operatorWireObservationVersion)) || !strings.Contains(err.Error(), "UNKNOWN") {
					t.Fatal("uncertain exact result was not retained", err, readErr)
				}
				if retryErr := stopPQNodeWithObservation(probe, o); retryErr == nil {
					t.Fatal("UNKNOWN was retried")
				}
				after, readErr := os.ReadFile(o.path)
				if readErr != nil || !bytes.Equal(raw, after) {
					t.Fatal("UNKNOWN original changed on retry", readErr)
				}
			} else if _, err := os.Lstat(o.path); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("uncompleted lifecycle produced a successful aggregate", err)
			}
		})
	}
	for _, running := range []bool{false, true} {
		probe := &wireObservationStopProbe{running: running}
		if running {
			probe.quit = make(chan struct{})
		}
		if err := stopPQNodeWithObservation(probe, nil); err != nil || probe.calls != map[bool]int{false: 0, true: 1}[running] {
			t.Fatal("disabled observer changed original Stop behavior", err)
		}
	}
}

func TestOperatorWireObservationPathAndEndpointBoundaries(t *testing.T) {
	dir := wireObservationTestDir(t)
	for _, address := range []string{"tcp://127.0.0.1:1", "tcp://[::1]:65535", "127.0.0.1:26656", "[::1]:26656"} {
		if !wireObservationLoopback(address, false) {
			t.Fatal("canonical loopback refused")
		}
	}
	for _, address := range []string{"", "tcp://localhost:1", "tcp://0.0.0.0:1", "tcp://127.0.0.1:01", "http://127.0.0.1:1", "tcp://127.0.0.1:0", "tcp://127.0.0.1:65536", "tcp://127.0.0.1:1/path", "tcp://user@127.0.0.1:1", "tcp://127.0.0.1:1?query"} {
		if wireObservationLoopback(address, false) {
			t.Fatal("foreign/ambiguous endpoint accepted")
		}
	}
	link := filepath.Join(dir, "alias")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	p := pqOptions{wireObservationScope: operatorWireObservationScope, wireObservationOutput: filepath.Join(link, "wire.json")}
	if p.validateWireObservation() == nil {
		t.Fatal("symlink parent accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "wire.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("path validation wrote output")
	}
}

func TestOperatorWireObservationExactOutputReadback(t *testing.T) {
	for _, kind := range []string{"original", "changed-bytes", "replaced-leaf", "symlink", "partial", "changed-mode"} {
		t.Run(kind, func(t *testing.T) {
			dir := wireObservationTestDir(t)
			root, err := os.OpenRoot(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			file, err := root.OpenFile("wire.json", os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			raw := []byte(`{"publicSyntheticCounter":1}`)
			if _, err = file.Write(raw); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "changed-bytes":
				if _, err = file.WriteAt([]byte("2"), int64(len(raw)-2)); err != nil {
					t.Fatal(err)
				}
			case "replaced-leaf", "symlink":
				if err = os.Rename(filepath.Join(dir, "wire.json"), filepath.Join(dir, "retained.json")); err != nil {
					t.Fatal(err)
				}
				if kind == "symlink" {
					err = os.Symlink(filepath.Join(dir, "retained.json"), filepath.Join(dir, "wire.json"))
				} else {
					err = os.WriteFile(filepath.Join(dir, "wire.json"), raw, 0600)
				}
				if err != nil {
					t.Fatal(err)
				}
			case "partial":
				if err = file.Truncate(int64(len(raw) - 1)); err != nil {
					t.Fatal(err)
				}
			case "changed-mode":
				if err = file.Chmod(0644); err != nil {
					t.Fatal(err)
				}
			}
			err = verifyWireObservationFile(root, "wire.json", file, raw)
			if (err == nil) != (kind == "original") {
				t.Fatal("output readback identity/content mismatch", kind, err)
			}
			if _, err = file.Stat(); err != nil {
				t.Fatal("failed readback destroyed/closed original", err)
			}
		})
	}
}
