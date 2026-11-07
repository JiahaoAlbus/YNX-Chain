package securelink

import (
	"container/list"
	"context"
	"crypto/sha512"
	"encoding/binary"
	"sync"
)

type PublicWire struct {
	Payload, SignatureA, SignatureB []byte
	Context                         string
}
type Pair struct {
	Suite            string
	PublicA, PublicB []byte
}

// StaticVerifier is supplied by the original protocol/crypto owner. VerifyBoth
// independently verifies A and B over the original signing context. LINK does
// not implement replacement cryptography or cache mutable business authority.
type StaticVerifier interface {
	VerifyBoth(context.Context, PublicWire, Pair, Ref) (bool, error)
}
type staticCall struct {
	done chan struct{}
	ok   bool
	err  error
}
type staticEntry struct{ key [64]byte }
type StaticCache struct {
	mu       sync.Mutex
	verifier StaticVerifier
	capacity int
	entries  map[[64]byte]*list.Element
	lru      *list.List
	inflight map[[64]byte]*staticCall
	slots    chan struct{}
}

func NewStaticCache(verifier StaticVerifier, capacity, parallel int) (*StaticCache, error) {
	if verifier == nil {
		return nil, ErrUnavailable
	}
	if capacity < 1 || capacity > 65536 || parallel < 1 || parallel > 64 {
		return nil, ErrBounds
	}
	return &StaticCache{verifier: verifier, capacity: capacity, entries: make(map[[64]byte]*list.Element), lru: list.New(), inflight: make(map[[64]byte]*staticCall), slots: make(chan struct{}, parallel)}, nil
}

func staticKey(w PublicWire, p Pair, current Ref) ([64]byte, error) {
	if p.Suite != "YNX-BATCH/v0.1" || len(w.Payload) == 0 || len(w.SignatureA) == 0 || len(w.SignatureB) == 0 || len(p.PublicA) == 0 || len(p.PublicB) == 0 || w.Context == "" || current.Realm == "" || current.Kind == "" || current.ID == "" {
		return [64]byte{}, ErrDenied
	}
	if _, err := canonicalU(current.Rev); err != nil {
		return [64]byte{}, err
	}
	fields := [][]byte{[]byte("YNX-LINK-STATIC/v1"), w.Payload, w.SignatureA, w.SignatureB, []byte(w.Context), []byte(p.Suite), p.PublicA, p.PublicB, []byte(current.Realm), []byte(current.Tenant), []byte(current.Kind), []byte(current.ID), []byte(current.Rev)}
	h := sha512.New()
	var total uint64
	var n [8]byte
	for _, v := range fields {
		total += uint64(len(v))
		if total > 16<<20 {
			return [64]byte{}, ErrBounds
		}
		binary.BigEndian.PutUint64(n[:], uint64(len(v)))
		_, _ = h.Write(n[:])
		_, _ = h.Write(v)
	}
	var key [64]byte
	copy(key[:], h.Sum(nil))
	return key, nil
}

// VerifyStaticOnce (LINK-06) caches only a successful result for the full bytes,
// both public keys, signing context and policy reference. Concurrent identical
// cold calls share one local verification; distinct accounts never share keys.
func (c *StaticCache) VerifyStaticOnce(ctx context.Context, w PublicWire, p Pair, current Ref) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	// Copies prevent mutable caller buffers changing after key calculation.
	if len(w.Payload) > 16<<20 || len(w.SignatureA) > 1<<20 || len(w.SignatureB) > 1<<20 || len(p.PublicA) > 1<<20 || len(p.PublicB) > 1<<20 {
		return false, ErrBounds
	}
	w.Payload = append([]byte(nil), w.Payload...)
	w.SignatureA = append([]byte(nil), w.SignatureA...)
	w.SignatureB = append([]byte(nil), w.SignatureB...)
	p.PublicA = append([]byte(nil), p.PublicA...)
	p.PublicB = append([]byte(nil), p.PublicB...)
	key, err := staticKey(w, p, current)
	if err != nil {
		return false, err
	}
	c.mu.Lock()
	if e := c.entries[key]; e != nil {
		c.lru.MoveToFront(e)
		c.mu.Unlock()
		return true, nil
	}
	if call := c.inflight[key]; call != nil {
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-call.done:
			return call.ok, call.err
		}
	}
	// Bound both active verifications and waiting distinct misses. Callers retry
	// explicitly after NO_CAPACITY; no unbounded worker or pending-input queue.
	if len(c.inflight) >= cap(c.slots)*2 {
		c.mu.Unlock()
		return false, ErrBounds
	}
	call := &staticCall{done: make(chan struct{})}
	c.inflight[key] = call
	c.mu.Unlock()
	select {
	case c.slots <- struct{}{}:
		call.ok, call.err = c.verifier.VerifyBoth(ctx, w, p, current)
		<-c.slots
	case <-ctx.Done():
		call.err = ctx.Err()
	}
	c.mu.Lock()
	if call.ok && call.err == nil {
		c.entries[key] = c.lru.PushFront(staticEntry{key})
		if c.lru.Len() > c.capacity {
			last := c.lru.Back()
			delete(c.entries, last.Value.(staticEntry).key)
			c.lru.Remove(last)
		}
	}
	delete(c.inflight, key)
	close(call.done)
	c.mu.Unlock()
	return call.ok, call.err
}
