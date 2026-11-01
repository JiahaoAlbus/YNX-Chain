//go:build unix

package consensus

import (
	"errors"
	"os"
	"sync"
)

const pqLabStaticScope = "YNX-PQ-LAB-PUBLIC-STATIC-MATH/v1"
const pqLabStaticMaxBytes = 32 << 20
const pqLabStaticMaxFiles = 16

// ErrPQLabStaticCacheBound applies only to the explicit bounded cache API.
// The original no-cache APIs retain their original validation/input limits.
var ErrPQLabStaticCacheBound = errors.New("bounded lab static cache cannot retain all original sources; use explicit uncached validation")

// PQLabStaticCache retains at most ONE original synthetic root/plan, at most
// 16 held public files / 32 MiB raw sources, and its privately validated owner.
// The owner's existing bounded certificate caches are reused unchanged. This
// is a lab caller optimization, not a Wallet key cache or current-state cache.
// Close/eviction invalidates issued checkpoints. No private material is held.
type PQLabStaticCache struct {
	mu                     sync.Mutex
	closed                 bool
	generation             uint64
	entry                  *pqLabStaticEntry
	hits, misses, bypasses uint64
}
type PQLabStaticCacheStats struct {
	Scope         string `json:"scope"`
	Entries       int    `json:"entries"`
	HeldFiles     int    `json:"heldFiles"`
	OriginalBytes int64  `json:"originalBytes"`
	Hits          uint64 `json:"hits"`
	Misses        uint64 `json:"misses"`
	Bypasses      uint64 `json:"bypasses"`
	Closed        bool   `json:"closed"`
}
type pqLabStaticEntry struct {
	root, pin  string
	plan       PQLabNetworkPlan
	witness    *validatedMigration
	originals  []*proofHostOriginal
	bytes      int64
	owner      *PQLabStaticCache
	generation uint64
	cached     bool
}
type pqLabStaticReads struct {
	originals []*proofHostOriginal
	bytes     int64
	cacheable bool
}

func NewPQLabStaticCache() *PQLabStaticCache { return &PQLabStaticCache{} }
func (r *pqLabStaticReads) close() error {
	var err error
	for _, f := range r.originals {
		err = errors.Join(err, f.file.Close())
	}
	r.originals = nil
	r.bytes = 0
	return err
}
func (r *pqLabStaticReads) read(path string, maximum int64) ([]byte, error) {
	if !r.cacheable {
		return nil, ErrPQLabStaticCacheBound
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > pqLabStaticMaxBytes-r.bytes || len(r.originals) >= pqLabStaticMaxFiles {
		r.cacheable = false
		// Never issue a reusable witness after dropping its exact originals.
		// This is a cache refusal, not a change to the no-cache API limits.
		return nil, errors.Join(ErrPQLabStaticCacheBound, r.close())
	}
	// The held reader enforces its own captured-file size and LimitReader bound,
	// including replacement/growth after the preliminary pathname budget stat.
	f, err := readProofHostOriginal(path, "", min(maximum, int64(pqLabStaticMaxBytes)-r.bytes))
	if err != nil {
		return nil, err
	}
	// A held public witness adds identity/hash guards; it does not relax the
	// original pqLabRead private=true requirement. Check the captured/opened
	// identity (not just the earlier pathname stat) before retaining anything.
	if f.info.Mode().Perm() != 0600 {
		return nil, errors.Join(errors.New("private operator file must be original single-link 0600 file"), f.file.Close())
	}
	r.originals = append(r.originals, f)
	r.bytes += int64(len(f.raw))
	return f.raw, nil
}
func (e *pqLabStaticEntry) unchangedFiles() error {
	if err := requireInspectionPath(e.root); err != nil {
		return err
	}
	for _, f := range e.originals {
		if err := requireInspectionPath(f.path); err != nil {
			return err
		}
		if err := f.unchanged(); err != nil {
			return err
		}
	}
	return nil
}
func (e *pqLabStaticEntry) current() error {
	if e == nil || e.owner == nil || e.witness == nil || !e.cached {
		return errors.New("missing original static owner")
	}
	c := e.owner
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.generation != e.generation || e.cached && c.entry != e {
		return errors.New("original static owner closed or evicted")
	}
	return e.unchangedFiles()
}
func (c *PQLabStaticCache) load(root, pin string, metrics *PQLabMetrics) (*pqLabStaticEntry, error) {
	if c == nil {
		return nil, errors.New("explicit original static cache owner required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, errors.New("original static cache is closed")
	}
	if c.entry != nil && (c.entry.root != root || c.entry.pin != pin) {
		var closeErr error
		for _, f := range c.entry.originals {
			closeErr = errors.Join(closeErr, f.file.Close())
		}
		c.entry = nil
		c.generation++
		if closeErr != nil {
			return nil, closeErr
		}
	}
	if c.entry != nil {
		done := pqLabMeasure(metrics, "lab.staticOwnerHitRevalidateSources")
		err := c.entry.unchangedFiles()
		done()
		if err != nil {
			return nil, err
		}
		c.hits++
		return c.entry, nil
	}
	c.misses++
	reads := &pqLabStaticReads{cacheable: true}
	complete := false
	defer func() {
		if !complete {
			_ = reads.close()
		}
	}()
	p, m, b, err := loadPQLabObserved(root, pin, metrics, reads)
	if err != nil {
		if errors.Is(err, ErrPQLabStaticCacheBound) {
			c.bypasses++
		}
		return nil, err
	}
	if !reads.cacheable {
		c.bypasses++
		return nil, ErrPQLabStaticCacheBound
	}
	done := pqLabMeasure(metrics, "lab.validatedMigrationOwnerBuild")
	witness, err := newValidatedMigration(m, b)
	done()
	if err != nil {
		return nil, err
	}
	entry := &pqLabStaticEntry{root: root, pin: pin, plan: p, witness: witness, originals: reads.originals, bytes: reads.bytes, owner: c, generation: c.generation, cached: reads.cacheable}
	if err = entry.unchangedFiles(); err != nil {
		return nil, err
	}
	c.entry = entry
	complete = true
	return entry, nil
}
func (c *PQLabStaticCache) Close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	c.generation++
	var err error
	if c.entry != nil {
		for _, f := range c.entry.originals {
			err = errors.Join(err, f.file.Close())
		}
		c.entry = nil
	}
	return err
}
func (c *PQLabStaticCache) Stats() PQLabStaticCacheStats {
	out := PQLabStaticCacheStats{Scope: pqLabStaticScope}
	if c == nil {
		return out
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	out.Hits, out.Misses, out.Bypasses, out.Closed = c.hits, c.misses, c.bypasses, c.closed
	if c.entry != nil {
		out.Entries = 1
		out.HeldFiles = len(c.entry.originals)
		out.OriginalBytes = c.entry.bytes
	}
	return out
}
