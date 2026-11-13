//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestPQLabLiveSessionOriginalProofAndHeldScope(t *testing.T) {
	root := os.Getenv("YNX_PQLAB_LIVE_SESSION_FIXTURE_ROOT")
	if root == "" {
		root = filepath.Join(pqLabWorkloadTemp(t), "lab")
	}
	p, o, setup := pqLabLiveMaterialsFixture(t, root)
	n, app := pqLabLiveMaterialsOwningNode(t, p, o)
	control, err := NewPQLabLiveMaterialsControl(n, app, setup.Policy.Path, setup.Policy.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	before := map[string][]byte{}
	for _, node := range p.Nodes {
		for _, path := range []string{node.StatePath, node.SignerStateFile} {
			before[path], err = os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	prep := &PQLabMetrics{}
	session, err := OpenPQLabLiveMaterialsSession(context.Background(), setup.Policy.Path, setup.Policy.SHA256, prep)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if len(session.in.anchor.CommittedState) != 0 || len(control.in.anchor.CommittedState) == 0 {
		t.Fatal("only the read-only command helper may release its decoded anchor state")
	}
	if s := prep.Snapshot().Stages; s["lab.bootstrapFullValidation"].Calls != 1 || s["live.anchorFullValidation"].Calls != 1 {
		t.Fatal("original cold validation must execute once", s)
	}
	if session.Stats().Commands != 0 {
		t.Fatal("opening lane published a command")
	}
	all := &PQLabMetrics{}
	for i := 0; i < 2; i++ {
		path := filepath.Join(root, "workload", "sender-public", []string{"0000", "0001"}[i], strings.Repeat(string(rune('a'+i)), 64), "transaction.abci")
		envelope, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		_, wire, e := pqTransactionWire(envelope)
		if e != nil {
			t.Fatal(e)
		}
		request := PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: setup.Policy.SHA256, Sequence: uint32(i + 1), TransactionFile: path, TransactionSHA256: pqLabSHA(envelope), NativeWireHash: pqLabSHA(wire)}
		if i == 0 {
			future := request
			future.Sequence = 2
			if _, e = session.Publish(context.Background(), future, all); e == nil {
				t.Fatal("missing preceding durable result accepted")
			}
			foreign := request
			foreign.PolicySHA256 = strings.Repeat("a", 64)
			if _, e = session.Publish(context.Background(), foreign, all); e == nil {
				t.Fatal("foreign lane adopted")
			}
		}
		_, e = session.Publish(context.Background(), request, all)
		if runtime.GOOS == "linux" {
			if e != nil {
				t.Fatal(e)
			}
		} else {
			if e == nil || !strings.Contains(e.Error(), "requires Linux renameat2") {
				t.Fatal("normal platform refusal changed", e)
			}
			// Test-only private input for the original owning reader, after actual
			// unsupported-platform refusal. No production publication fallback.
			raw, _ := json.Marshal(request)
			if e = pqLabWrite(pqLabLiveRequestPath(filepath.Dir(setup.Policy.Path), request.Sequence), raw); e != nil {
				t.Fatal(e)
			}
		}
		if _, e = session.Publish(context.Background(), request, all); e == nil {
			t.Fatal("original publication replayed")
		}
		if present, e := control.step(context.Background()); !present || e != nil {
			t.Fatal("original owning capture", present, e)
		}
		result, e := session.Read(context.Background(), request.Sequence, all)
		if e != nil {
			t.Fatal(e)
		}
		if !result.Verified.Result.Finalized || !result.Verified.Result.ExecutionSuccessful || result.AuthorityGranted || result.FourNodeAgreementClaim || result.EngineHeight != app.committed.Height || result.EngineAppHash != app.committed.AppHash {
			t.Fatal("current full proof or authority boundary changed")
		}
		plain, e := ReadPQLabLiveMaterialsResult(setup.Policy.Path, setup.Policy.SHA256, request.Sequence)
		if e != nil || !reflect.DeepEqual(plain, result) {
			t.Fatal("original one-shot result bytes changed", e)
		}
		proof, e := os.ReadFile(result.Proof.Path)
		if e != nil {
			t.Fatal(e)
		}
		changed := bytes.Clone(proof)
		changed[0] ^= 1
		if e = os.WriteFile(result.Proof.Path, changed, 0600); e != nil {
			t.Fatal(e)
		}
		if _, e = session.Read(context.Background(), request.Sequence, all); e == nil {
			t.Fatal("held anchor bypassed changed per-request proof")
		}
		if e = os.WriteFile(result.Proof.Path, proof, 0600); e != nil {
			t.Fatal(e)
		}
		if _, e = session.Read(context.Background(), request.Sequence, all); e != nil {
			t.Fatal("original proof bytes cannot be reread", e)
		}
	}
	if stages := all.Snapshot().Stages; stages["lab.bootstrapFullValidation"].Calls != 0 || stages["live.anchorFullValidation"].Calls != 0 {
		t.Fatal("steady lane rebuilt immutable math", stages)
	}
	if _, err = session.Read(context.Background(), 3, all); err == nil {
		t.Fatal("missing result became completed")
	}
	for path, raw := range before {
		after, e := os.ReadFile(path)
		if e != nil || !bytes.Equal(raw, after) {
			t.Fatal("lane changed complete state or HRS", path, e)
		}
	}
	if os.Getenv("YNX_PQLAB_LIVE_SESSION_FIXTURE_ROOT") != "" {
		if err = pqLabWriteJSON(filepath.Join(root, "live-command-input.json"), setup); err != nil {
			t.Fatal(err)
		}
	}
	// Same raw bytes at a replacement inode cannot refresh the prepared anchor.
	anchor := filepath.Join(filepath.Dir(setup.Policy.Path), "anchor.json")
	raw, err := os.ReadFile(anchor)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(anchor+".replacement", raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(anchor+".replacement", anchor); err != nil {
		t.Fatal(err)
	}
	if _, err = session.Read(context.Background(), 1, all); err == nil {
		t.Fatal("replaced anchor kept prepared eligibility")
	}
	t.Logf("LIVE_LANE_HELD_SCOPE staticFullValidation=1 anchorFullValidation=1 steadyStaticAndAnchor=0 proofs=2 completeStateAndHRSUnchanged=true productionPublishSupported=%t noNodeStart=true", runtime.GOOS == "linux")
}

func TestPQLabLiveSessionLifecycleAndOriginalRefusal(t *testing.T) {
	var zero PQLabLiveMaterialsSession
	if _, err := zero.Read(context.Background(), 1, nil); err == nil {
		t.Fatal("zero owner accepted")
	}
	if err := zero.Close(); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(pqLabWorkloadTemp(t), "lab")
	_, _, setup := pqLabLiveMaterialsFixture(t, root)
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if s, e := OpenPQLabLiveMaterialsSession(canceled, setup.Policy.Path, setup.Policy.SHA256, nil); e == nil || s != nil {
		t.Fatal("canceled session opened")
	}
	if s, e := OpenPQLabLiveMaterialsSession(context.Background(), setup.Policy.Path, strings.Repeat("a", 64), nil); e == nil || s != nil {
		t.Fatal("foreign pin opened")
	}
	s, err := OpenPQLabLiveMaterialsSession(context.Background(), setup.Policy.Path, setup.Policy.SHA256, nil)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	if _, e := s.Read(context.Background(), 1, nil); !errors.Is(e, ErrPQLabLiveMaterialsBusy) {
		t.Fatal("concurrent request queued", e)
	}
	s.mu.Unlock()
	if _, e := s.Read(canceled, 1, nil); !errors.Is(e, context.Canceled) {
		t.Fatal("canceled read claimed result", e)
	}
	if s.Stats().Commands != 0 {
		t.Fatal("refused busy/canceled call consumed a command")
	}
	s.mu.Lock()
	s.calls = s.limit // deterministic exact command-bound exhaustion, no source change
	s.mu.Unlock()
	if _, e := s.Read(context.Background(), 1, nil); e == nil {
		t.Fatal("bounded lane kept accepting commands")
	}
	s.Retire()
	if _, e := s.Read(context.Background(), 1, nil); e == nil {
		t.Fatal("retired owner read")
	}
	// A real descriptor close debt remains sticky, never a green closed owner.
	if e := s.in.originals[0].file.Close(); e != nil {
		t.Fatal(e)
	}
	// Model an admitted synchronous call holding the same owner gate. Close
	// must wait for that gate rather than dropping inputs beneath a request.
	s.mu.Lock()
	closed := make(chan error, 1)
	go func() { closed <- s.Close() }()
	select {
	case <-closed:
		t.Fatal("Close escaped an in-flight original owner")
	case <-time.After(20 * time.Millisecond):
	}
	s.mu.Unlock()
	var e error
	select {
	case e = <-closed:
	case <-time.After(time.Second):
		t.Fatal("Close did not join completed owner")
	}
	if !errors.Is(e, os.ErrClosed) || s.Close() != e {
		t.Fatal("original close debt lost", e)
	}
	if _, e = s.Read(context.Background(), 1, nil); e == nil {
		t.Fatal("closed owner resurrected")
	}
}
