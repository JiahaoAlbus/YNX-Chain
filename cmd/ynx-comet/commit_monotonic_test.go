package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/cometbft/cometbft/libs/log"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestCommitMonotonicRequiresDistinctSyntheticOriginal(t *testing.T) {
	dir := wireObservationTestDir(t)
	p := pqOptions{recoveryFD: -1, commitMonotonicOutput: filepath.Join(dir, "clock.json")}
	if p.validateCommitObservation() == nil {
		t.Fatal("monotonic output without original Commit scope accepted")
	}
	p.commitObservationOutput = filepath.Join(dir, "commit.json")
	p.commitObservationScope = operatorWireObservationScope
	p.commitMonotonicOutput = p.commitObservationOutput
	if p.validateCommitObservation() == nil {
		t.Fatal("overlapping outputs accepted")
	}
}

func TestCommitMonotonicRealBlockExecutorSyntheticTransfer(t *testing.T) {
	f := newCommitObservationFixture(t)
	dir := t.TempDir()
	app, observer, options := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(dir, "state"), true)
	options.commitMonotonicOutput = filepath.Join(filepath.Dir(options.commitObservationOutput), "monotonic.json")
	var err error
	observer.monotonic, err = prepareOperatorCommitMonotonic(options)
	if err != nil {
		t.Fatal(err)
	}
	// A synthetic revision is supplied only to this test fixture. Production
	// requires a synthetic linker declaration and otherwise reports UNKNOWN;
	// the reader must separately prove the manifest, binary and process binding.
	observer.monotonic.clock = newCommitMonotonicClock(strings.Repeat("a", 40))
	before := observer.monotonic.capture()
	next, _, err := executeObservedEngineCommit(t, f, app, wrapOperatorCommitLogger(log.NewNopLogger(), observer), cmttypes.Txs{f.transfer})
	if err != nil {
		t.Fatal(err)
	}
	after := observer.monotonic.capture()
	observer.started()
	if err = observer.writeAfterStop(); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Status, SourceRevision, OriginalGenesisHash string
		ProcessID                                   int
		IndependentFinality                         bool
		Samples                                     []struct {
			Height  int64  `json:"height"`
			AppHash string `json:"appHash"`
			NS      string `json:"monotonicNs"`
		} `json:"samples"`
	}
	raw, err := os.ReadFile(options.commitMonotonicOutput)
	if err != nil || json.Unmarshal(raw, &result) != nil || len(result.Samples) != 1 {
		t.Fatalf("missing separate output: %v %s", err, raw)
	}
	if result.Samples[0].Height != next.LastBlockHeight || result.Samples[0].AppHash != observer.result.Samples[0].AppHash {
		t.Fatal("clock lost original height or AppHash")
	}
	if result.ProcessID != os.Getpid() || result.SourceRevision != strings.Repeat("a", 40) || result.OriginalGenesisHash != f.migration.OriginalGenesisHash || result.IndependentFinality {
		t.Fatal("clock lost original process, source or genesis identity", string(raw))
	}
	if runtime.GOOS != "linux" {
		if result.Status != "UNKNOWN" || result.Samples[0].NS != "" {
			t.Fatal("unsupported platform fabricated clock", string(raw))
		}
	} else {
		assertCommitMonotonicBetween(t, before, result.Samples[0].NS, after)
		if result.Status != "OBSERVED" {
			t.Fatal("Linux clock unavailable", string(raw))
		}
	}
	if observer.writeAfterStop() == nil {
		t.Fatal("repeated output accepted")
	}
}

func TestCommitMonotonicMissingSourceIsUnknown(t *testing.T) {
	clock := newCommitMonotonicClock("")
	reading := clock.read()
	if reading.NS != "" || reading.Reason == "" {
		t.Fatal("missing source supplied a usable clock", reading)
	}
}

func TestCommitMonotonicDeclaredSourceValidation(t *testing.T) {
	old := operatorCommitBuildSource
	defer func() { operatorCommitBuildSource = old }()
	for _, value := range []string{"", strings.Repeat("a", 39), strings.Repeat("G", 40), strings.Repeat("a", 41)} {
		operatorCommitBuildSource = value
		if binarySourceRevision() != "" {
			t.Fatal("malformed build declaration accepted", value)
		}
	}
	operatorCommitBuildSource = strings.Repeat("a", 40)
	if binarySourceRevision() != operatorCommitBuildSource {
		t.Fatal("exact linker declaration not retained")
	}
}
