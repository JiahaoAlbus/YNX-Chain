package node

import (
	"errors"
	"sync"
)

// proofSourceConsumerLifetime protects one optional read-only consumer. The
// zero value leaves ordinary nodes unchanged. Its callback must retire and
// join its own work without waiting for Node.Quit or calling Node.Stop: Quit is
// closed only after OnStop has returned.
type proofSourceConsumerLifetime struct {
	mu                           sync.Mutex
	started, retired, registered bool
	close                        func() error
	join                         sync.Once
	err                          error
}

// RegisterProofSourceConsumer installs the original operator's one read-only
// consumer before startup. It grants no consensus or Native authority and
// cannot replace or renew a registered consumer after a failed request.
func (n *Node) RegisterProofSourceConsumer(retireAndJoin func() error) error {
	if n == nil || retireAndJoin == nil {
		return errors.New("original node and read-only consumer required")
	}
	l := &n.proofSourceConsumer
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.started || l.retired || l.registered || n.IsRunning() {
		return errors.New("read-only consumer must be registered exactly once before node startup")
	}
	l.close = retireAndJoin
	l.registered = true
	return nil
}

func (l *proofSourceConsumerLifetime) start() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.retired && l.registered {
		return errors.New("node read-only consumers already retired")
	}
	l.started = true
	return nil
}

func (l *proofSourceConsumerLifetime) retireAndJoin() error {
	l.join.Do(func() {
		l.mu.Lock()
		l.retired = true
		close := l.close
		l.mu.Unlock()
		if close != nil {
			l.err = close()
		}
	})
	return l.err
}
