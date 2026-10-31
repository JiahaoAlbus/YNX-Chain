package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/mempool"
	nm "github.com/cometbft/cometbft/node"
	"github.com/spf13/pflag"
)

const operatorWireObservationScope = "synthetic-loopback-lab/v1"
const operatorWireObservationVersion = "YNX-COMET-WIRE-OBSERVATION/v1"

func registerWireObservationFlags(flags *pflag.FlagSet, options *pqOptions) {
	flags.Var(&initializationStringFlag{target: &options.wireObservationOutput}, "wire-observation-output", "disabled by default; fresh absolute aggregate output written only after normal node stop")
	flags.Var(&initializationStringFlag{target: &options.wireObservationScope}, "wire-observation-scope", "explicit synthetic-loopback-lab/v1 scope; not physical bytes, finality or authority")
}

func (p pqOptions) wireObservationConfigured() bool {
	return p.wireObservationOutput != "" || p.wireObservationScope != ""
}

func (p pqOptions) validateWireObservation() error {
	if !p.wireObservationConfigured() {
		return nil
	}
	path := p.wireObservationOutput
	if p.wireObservationScope != operatorWireObservationScope || !utf8.ValidString(path) || len(path) > 4096 ||
		strings.ContainsRune(path, 0) || strings.TrimSpace(path) != path || !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Dir(path) == path {
		return errors.New("wire observation requires explicit synthetic loopback scope and a canonical absolute fresh output")
	}
	for _, original := range []string{p.migration, p.state, p.schedule, p.binding, p.vault, p.transportKey, p.peerPin,
		p.runtimePlan, p.invoiceSchedule, p.heightHaltControl, p.proofLivePolicy} {
		if original == "" {
			continue
		}
		absolute, err := filepath.Abs(original)
		if err != nil || path == absolute || path == absolute+".writer.lock" || path == absolute+".read.lock" || path == absolute+".lock" {
			return errors.New("wire observation output must not alias original state, custody, inputs or locks")
		}
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return errors.New("wire observation output exists or is unavailable; preserve the original/UNKNOWN result")
	}
	parent := filepath.Dir(path)
	resolved, err := filepath.EvalSymlinks(parent)
	info, statErr := os.Lstat(parent)
	if err != nil || resolved != parent || statErr != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
		return errors.New("wire observation parent must already exist without aliases or group/world write access")
	}
	return nil
}

// Validate only configured numeric loopback endpoints; do not resolve DNS or
// open a connection. This observes an explicitly isolated lab, not public P2P.
func wireObservationLoopback(address string, optional bool) bool {
	if address == "" {
		return optional
	}
	if strings.Contains(address, "://") {
		u, err := url.Parse(address)
		if err != nil || u.Scheme != "tcp" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return false
		}
		address = u.Host
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	n, err := strconv.Atoi(port)
	return ip != nil && ip.IsLoopback() && err == nil && n > 0 && n <= 65535 && strconv.Itoa(n) == port
}

func validateWireObservationNetwork(config *cfg.Config, p pqOptions) error {
	if config == nil || config.P2P == nil || config.RPC == nil || config.StateSync == nil || config.Instrumentation == nil || config.StateSync.Enable {
		return errors.New("wire observation requires a complete non-state-sync loopback lab configuration")
	}
	for _, path := range []string{config.GenesisFile(), config.PrivValidatorKeyFile(), config.PrivValidatorStateFile(),
		config.NodeKeyFile(), config.P2P.AddrBookFile()} {
		if p.wireObservationOutput == path || p.wireObservationOutput == path+".writer.lock" {
			return errors.New("wire observation output aliases original node identity or lock")
		}
	}
	for _, endpoint := range []struct {
		address  string
		optional bool
	}{
		{config.P2P.ListenAddress, false}, {config.P2P.ExternalAddress, true},
		{config.RPC.ListenAddress, true}, {config.RPC.GRPCListenAddress, true}, {config.RPC.PprofListenAddress, true},
	} {
		if !wireObservationLoopback(endpoint.address, endpoint.optional) {
			return errors.New("wire observation endpoints must be numeric loopback addresses")
		}
	}
	if config.Instrumentation.Prometheus && !wireObservationLoopback(config.Instrumentation.PrometheusListenAddr, false) ||
		p.remote() && !wireObservationLoopback(p.remoteAddress, false) {
		return errors.New("wire observation metrics/signer endpoints must remain loopback")
	}
	for _, list := range []string{config.P2P.Seeds, config.P2P.PersistentPeers} {
		if list == "" {
			continue
		}
		for _, peer := range strings.Split(list, ",") {
			parts := strings.Split(peer, "@")
			if len(parts) != 2 || parts[0] == "" || !wireObservationLoopback(parts[1], false) {
				return errors.New("wire observation configured peers must remain loopback")
			}
		}
	}
	return nil
}

// Holds only the original fixed-size observer, public identity pins and an
// opened output directory. No transaction, peer, key, or per-message log buffer
// is retained. The real reactor's observer is never replaced or reset.
type operatorWireObservation struct {
	mu        sync.Mutex
	path      string
	root      *os.Root
	directory *os.File
	parent    os.FileInfo
	chainID   string
	appHash   []byte
	observer  *mempool.WireObserver
	installed bool
	ran       bool
	attempted bool
}

func prepareOperatorWireObservation(config *cfg.Config, p pqOptions) (_ *operatorWireObservation, resultErr error) {
	if !p.wireObservationConfigured() {
		return nil, nil
	}
	if err := p.validateWireObservation(); err != nil {
		return nil, err
	}
	if err := validateWireObservationNetwork(config, p); err != nil {
		return nil, err
	}
	// Reuse the normal pinned bootstrap validator. The scope string alone is
	// never evidence that a public/foreign source is a synthetic lab.
	raw, err := readBounded(p.migration, 1<<30)
	if err != nil {
		return nil, err
	}
	var migration chain.ConsensusMigrationState
	if err = json.Unmarshal(raw, &migration); err != nil {
		return nil, err
	}
	if migration.Network.ChainID != consensus.PQLabNativeChainID || migration.Network.IsPublicNet || !strings.HasPrefix(migration.Network.Slug, "pq-lab-") {
		return nil, errors.New("wire observation refuses a public or non-synthetic migration")
	}
	genesis, err := readBounded(config.GenesisFile(), 64<<20)
	if err != nil {
		return nil, err
	}
	if _, err = consensus.NewConsensusBootstrap(genesis, p.operatorFiles(config).Pins, migration); err != nil {
		return nil, err
	}
	appHash, err := hex.DecodeString(migration.StateHash)
	if err != nil || len(appHash) != 32 {
		return nil, errors.New("wire observation original bootstrap hash is unavailable")
	}
	dir := filepath.Dir(p.wireObservationOutput)
	o := &operatorWireObservation{path: p.wireObservationOutput, chainID: fmt.Sprintf("ynx_%d-1", migration.Network.ChainID), appHash: appHash, observer: &mempool.WireObserver{}}
	defer func() {
		if resultErr != nil {
			resultErr = errors.Join(resultErr, o.close())
		}
	}()
	if o.root, err = os.OpenRoot(dir); err != nil {
		return nil, err
	}
	if o.directory, err = os.Open(dir); err != nil {
		return nil, err
	}
	if o.parent, err = o.directory.Stat(); err != nil {
		return nil, err
	}
	if err = o.parentCurrent(); err != nil {
		return nil, err
	}
	if _, err = o.root.Lstat(filepath.Base(o.path)); !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("wire observation output appeared during startup; retain original result")
	}
	return o, nil
}

func (o *operatorWireObservation) install(node *nm.Node) error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.installed || o.ran || node == nil || node.IsRunning() || node.GenesisDoc() == nil ||
		node.GenesisDoc().ChainID != o.chainID || !bytes.Equal(node.GenesisDoc().AppHash, o.appHash) {
		return errors.New("wire observation requires the original pinned node before its first Start")
	}
	reactor, ok := node.MempoolReactor().(*mempool.Reactor)
	if !ok || reactor == nil {
		return errors.New("wire observation requires the actual original mempool reactor")
	}
	if err := reactor.SetWireObserver(o.observer); err != nil {
		return err
	}
	o.installed = true
	return nil
}

func (o *operatorWireObservation) started() {
	if o != nil {
		o.mu.Lock()
		o.ran = o.installed
		o.mu.Unlock()
	}
}

type observedNodeStop interface {
	IsRunning() bool
	Stop() error
	Quit() <-chan struct{}
}

// Keep the original stop order and errors. Disabled observation does not read
// a snapshot, touch the filesystem or wait on any additional lifecycle handle.
func stopPQNodeWithObservation(node observedNodeStop, o *operatorWireObservation) error {
	var stopErr error
	if node.IsRunning() {
		stopErr = node.Stop()
	}
	if o == nil || stopErr != nil {
		return stopErr
	}
	select {
	case <-node.Quit(): // BaseService closes this only AFTER Node.OnStop returns.
		return o.writeAfterStop()
	default:
		return errors.New("wire observation has no completed normal Node.Stop; no output written")
	}
}

type operatorWireObservationResult struct {
	Version               string               `json:"version"`
	Scope                 string               `json:"scope"`
	CaptureBoundary       string               `json:"captureBoundary"`
	SyntheticOnly         bool                 `json:"syntheticOnly"`
	IndependentFinality   bool                 `json:"independentFinality"`
	PhysicalBytesMeasured bool                 `json:"physicalBytesMeasured"`
	Snapshot              mempool.WireSnapshot `json:"snapshot"`
}

func (o *operatorWireObservation) parentCurrent() error {
	if o.root == nil || o.directory == nil || o.parent == nil {
		return errors.New("wire observation original output directory is unavailable")
	}
	path := filepath.Dir(o.path)
	resolved, resolveErr := filepath.EvalSymlinks(path)
	current, statErr := os.Lstat(path)
	held, heldErr := o.root.Stat(".")
	if resolveErr != nil || resolved != path || statErr != nil || heldErr != nil || !os.SameFile(o.parent, current) ||
		!os.SameFile(o.parent, held) || !current.IsDir() || current.Mode().Perm()&0022 != 0 {
		return errors.New("wire observation original output directory changed; preserve UNKNOWN")
	}
	return nil
}

func (o *operatorWireObservation) writeAfterStop() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.installed || !o.ran || o.attempted {
		return errors.New("wire observation requires one actual started lifetime and one final write attempt")
	}
	o.attempted = true // an uncertain write must never be retried or overwritten
	if err := o.parentCurrent(); err != nil {
		return err
	}
	snapshot := o.observer.Snapshot() // ONE detached capture, after normal stop.
	if !snapshot.Attached || snapshot.PhysicalBytesMeasured {
		return errors.New("wire observation attachment or measurement kind is invalid")
	}
	raw, err := json.Marshal(operatorWireObservationResult{Version: operatorWireObservationVersion,
		Scope: operatorWireObservationScope, CaptureBoundary: "after-normal-node-stop;completed-calls-only;in-flight-excluded", SyntheticOnly: true, Snapshot: snapshot})
	if err != nil || len(raw) > 64<<10 {
		return errors.New("wire observation aggregate cannot be encoded within its fixed output bound")
	}
	raw = append(raw, '\n')
	file, err := o.root.OpenFile(filepath.Base(o.path), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("wire observation final output refused; original/UNKNOWN retained: %w", err)
	}
	n, writeErr := file.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	resultErr := errors.Join(writeErr, file.Sync(), verifyWireObservationFile(o.root, filepath.Base(o.path), file, raw),
		file.Close(), o.directory.Sync(), o.parentCurrent())
	if resultErr != nil {
		return fmt.Errorf("wire observation persistence UNKNOWN; retain exact original and do not retry: %w", resultErr)
	}
	if snapshot.Overflow {
		return errors.New("wire observation counters overflowed; retained output is not a complete baseline")
	}
	return nil
}

// Read back only the newly created descriptor, never an arbitrary path/alias.
// A replaced leaf or changed bytes remain UNKNOWN, even when Write succeeded.
func verifyWireObservationFile(root *os.Root, name string, file *os.File, raw []byte) error {
	held, heldErr := file.Stat()
	current, pathErr := root.Lstat(name)
	if heldErr != nil || pathErr != nil || !held.Mode().IsRegular() || !current.Mode().IsRegular() ||
		!os.SameFile(held, current) || held.Size() != int64(len(raw)) || held.Mode().Perm() != 0600 || current.Mode() != held.Mode() {
		return errors.New("wire observation output identity, length or protection changed")
	}
	got := make([]byte, len(raw)) // the fixed aggregate is bounded before creation
	if _, err := file.ReadAt(got, 0); err != nil || !bytes.Equal(got, raw) {
		return errors.New("wire observation exact original output readback failed")
	}
	return nil
}

func (o *operatorWireObservation) close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	var result error
	if o.root != nil {
		result = errors.Join(result, o.root.Close())
		o.root = nil
	}
	if o.directory != nil {
		result = errors.Join(result, o.directory.Close())
		o.directory = nil
	}
	return result
}
