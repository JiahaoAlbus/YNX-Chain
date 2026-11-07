package node

import (
	"errors"
	"sync/atomic"
	"testing"

	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/libs/service"
)

func TestProofSourceConsumerLifecycleRegistrationAndRetire(t *testing.T) {
	var missing *Node
	if err := missing.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
		t.Fatal("missing owning node accepted")
	}
	n := new(Node)
	n.BaseService = *service.NewBaseService(log.NewNopLogger(), "Node", n)
	if err := n.RegisterProofSourceConsumer(nil); err == nil {
		t.Fatal("nil consumer accepted")
	}
	var calls atomic.Int32
	cause := errors.New("original reader outcome UNKNOWN")
	if err := n.RegisterProofSourceConsumer(func() error { calls.Add(1); return cause }); err != nil {
		t.Fatal(err)
	}
	if err := n.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
		t.Fatal("registered consumer replaced")
	}
	// The same lifecycle entry is the first operation in real Node.OnStart;
	// this test never starts reactors, listeners or consensus.
	if err := n.proofSourceConsumer.start(); err != nil {
		t.Fatal(err)
	}
	if err := n.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
		t.Fatal("running lifecycle accepted a new consumer")
	}
	for i := 0; i < 2; i++ {
		if err := n.proofSourceConsumer.retireAndJoin(); !errors.Is(err, cause) {
			t.Fatal("original read failure lost", err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("repeated stop called consumer again", calls.Load())
	}
	if err := n.proofSourceConsumer.start(); err == nil {
		t.Fatal("retired lifetime restarted")
	}
	if err := n.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
		t.Fatal("retired consumer renewed")
	}
	plain := new(Node)
	plain.BaseService = *service.NewBaseService(log.NewNopLogger(), "Node", plain)
	if err := plain.proofSourceConsumer.start(); err != nil {
		t.Fatal(err)
	}
	if err := plain.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
		t.Fatal("late registration accepted on originally default-off node")
	}
	if err := plain.proofSourceConsumer.retireAndJoin(); err != nil {
		t.Fatal("default-off lifecycle changed ordinary stop", err)
	}
}
