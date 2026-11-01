//go:build linux && ynx_live_wire_observation

package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
)

// Matching-fork composition test only: this original normal node is NEVER
// started. Its real getter must return UNKNOWN, not manufactured running DATA.
func TestOperatorWireLiveTypedNormalNodeBeforeStartIsUnknown(t *testing.T) {
	f := newWireObservationFixture(t)
	f.options.wireObservationLiveControl = filepath.Join(wireObservationTestDir(t), "control")
	if e := os.Mkdir(f.options.wireObservationLiveControl, 0700); e != nil {
		t.Fatal(e)
	}
	o, err := prepareOperatorWireObservation(f.config, f.options)
	if err != nil {
		t.Fatal(err)
	}
	defer o.close()
	n, custody, err := constructBootstrapNode(f.config, log.NewNopLogger(), f.options)
	if err != nil {
		t.Fatal(err)
	}
	defer custody.Close()
	defer func() { n.OnStop(); _ = n.ProxyApp().Stop() }()
	if err = o.install(n); err != nil {
		t.Fatal(err)
	}
	get, err := newOperatorWireLiveGetter(n.MempoolReactor().(*mempool.Reactor))
	if err != nil {
		t.Fatal(err)
	}
	s, err := get()
	if err != nil {
		t.Fatal(err)
	}
	var original mempool.LiveWireObservation
	if err = json.Unmarshal(s.raw, &original); err != nil {
		t.Fatal(err)
	}
	if s.complete || original.Complete || original.Status != "UNKNOWN" || original.Reason != "reactor_not_running" || original.ProducerPID != uint64(os.Getpid()) || original.ReactorLifetimeID == 0 || original.ObserverLifetimeID == nil || original.ReactorRunningAtStart || original.ReactorRunningAtEnd {
		t.Fatalf("unstarted real getter became live evidence: %+v", original)
	}
	if _, err = o.startLive(context.Background()); err == nil {
		t.Fatal("unstarted normal node launched live producer")
	}
	if _, err = os.Stat(filepath.Join(f.options.wireObservationLiveControl, "producer.json")); !os.IsNotExist(err) {
		t.Fatal("unstarted node wrote running producer identity", err)
	}
}
