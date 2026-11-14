package node

import (
	"context"
	"errors"
	"sync"
	"time"
)

// PayProductBorrower is lifecycle-only: it grants neither authority nor a
// product handler. Its actual owner must release all borrowed Node resources.
type PayProductBorrower interface {
	Retire()
	Shutdown(context.Context) error
	CoreReleased() bool
}

type payProductBorrowerLifetime struct {
	mu                           sync.Mutex
	started, retired, registered bool
	owner                        PayProductBorrower
	join                         sync.Once
}

// RegisterPayProductBorrower registers one existing product borrower before
// Node.Start. It is independent of the proof Source consumer slot.
func (n *Node) RegisterPayProductBorrower(owner PayProductBorrower) error {
	if n == nil || owner == nil {
		return errors.New("original node and Pay borrower required")
	}
	l := &n.payProductBorrower
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.started || l.retired || l.registered || n.IsRunning() {
		return errors.New("Pay borrower must be registered exactly once before startup")
	}
	l.owner = owner
	l.registered = true
	return nil
}

func (l *payProductBorrowerLifetime) start() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.retired && l.registered {
		return errors.New("Pay borrower already retired")
	}
	l.started = true
	return nil
}

// Quit closes only after OnStop returns. Never wait for Quit here: hold the
// Node's stores and app until the original borrower reports actual release.
func (l *payProductBorrowerLifetime) retireAndJoin() {
	l.join.Do(func() {
		l.mu.Lock()
		l.retired = true
		owner := l.owner
		l.mu.Unlock()
		if owner == nil {
			return
		}
		owner.Retire()
		for !owner.CoreReleased() {
			_ = owner.Shutdown(context.Background())
			if !owner.CoreReleased() {
				time.Sleep(time.Second)
			}
		}
	})
}
