package main

import "sync"

// These are the original acquired owners' cleanup methods, assigned only by
// normal composition. No transport, permission or public lifecycle setter.
type originalTaskServiceCleanup struct {
	v6, receiver, runtime func() error
	once                  sync.Once
	err                   error
}

// Keep the actual closures/owners alive after an ambiguous child drain. In
// particular, a timed-out listener cannot lose its borrowed Source parent to
// deferred cleanup or GC. No replacement owner or automatic close retry.
var retainedOriginalTaskServiceCleanup sync.Map // *originalTaskServiceCleanup

func (c *originalTaskServiceCleanup) close() error {
	c.once.Do(func() {
		for _, closeOwner := range []func() error{c.v6, c.receiver, c.runtime} {
			if closeOwner == nil {
				continue
			}
			if c.err = closeOwner(); c.err != nil {
				retainedOriginalTaskServiceCleanup.Store(c, struct{}{})
				return
			}
		}
	})
	return c.err
}
