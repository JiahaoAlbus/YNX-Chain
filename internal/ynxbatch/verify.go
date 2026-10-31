package ynxbatch

import (
	"bytes"
	"container/list"
	"errors"
	"strconv"
	"sync"
)

var (
	ErrUntrusted  = errors.New("untrusted or inactive YNX registration")
	ErrHandle     = errors.New("unknown or stale YNX authenticated handle")
	ErrMembership = errors.New("YNX dual tree membership failed")
)

// Registration is supplied by trusted chain state, never by the certificate's
// submitter. This is a local API, not a new consensus wire format.
type Registration struct {
	AlgorithmVersion, Owner, Purpose, PolicyRevision string
	ChainID, PKA, PKB                                []byte
	Enabled                                          bool
	ActiveFrom                                       uint64
	RevokedAt                                        *uint64
}
type TrustRequest struct {
	ChainID        []byte
	Owner, Purpose string
	Height         uint64
}
type VerifierOptions struct {
	ChainID             []byte
	Purpose             string
	ResolveTrustedOwner func(TrustRequest) (Registration, error)
	CacheEntries        int
	Optimized           bool
	// CertificateCache may be shared by short-lived verifiers. CacheScope must
	// be a 32-byte trusted policy/root commitment, never supplied by a submitter.
	// The complete registration is additionally bound and refreshed on every use.
	CertificateCache *CertificateCache
	CacheScope       []byte
	// ParallelProvider optionally shares a fixed budget for real independent
	// signature branches. Nil preserves sequential verification.
	ParallelProvider *ParallelProvider
}
type authenticatedState struct {
	c     Certificate
	trust []byte
	hash  *dualHasher
}

// AuthenticatedHandle has no public writable state. Only its issuing Verifier
// can accept it, and every use refreshes the current registration at the height.
type AuthenticatedHandle struct {
	issuer *Verifier
	epoch  uint64
	state  *authenticatedState
}
type cacheEntry struct {
	key   string
	state *authenticatedState
}
type VerifierStats struct {
	CachedCertificates         int
	SignatureChecks, CacheHits uint64
}
type Verifier struct {
	mu               sync.Mutex
	chainID          []byte
	purpose          string
	resolve          func(TrustRequest) (Registration, error)
	cacheEntries     int
	optimized        bool
	cache            map[string]*list.Element
	lru              *list.List
	epoch            uint64
	checks, hits     uint64
	certificateCache *CertificateCache
	cacheScope       []byte
	parallelProvider *ParallelProvider
}

func NewVerifier(o VerifierOptions) (*Verifier, error) {
	if len(o.ChainID) != 32 || !validASCII(o.Purpose, 64) || o.ResolveTrustedOwner == nil || o.CacheEntries < 0 || o.CacheEntries > 64 {
		return nil, invalid("verifier configuration")
	}
	if o.CertificateCache != nil && (!o.CertificateCache.enabled() || len(o.CacheScope) != 32) || o.CertificateCache == nil && len(o.CacheScope) != 0 {
		return nil, invalid("certificate cache scope")
	}
	if o.ParallelProvider != nil && !o.ParallelProvider.enabled() {
		return nil, invalid("parallel provider configuration")
	}
	return &Verifier{chainID: clone(o.ChainID), purpose: o.Purpose, resolve: o.ResolveTrustedOwner, cacheEntries: o.CacheEntries, optimized: o.Optimized,
		cache: make(map[string]*list.Element), lru: list.New(), epoch: 1, certificateCache: o.CertificateCache, cacheScope: clone(o.CacheScope), parallelProvider: o.ParallelProvider}, nil
}
func (v *Verifier) current(c Certificate, height uint64) ([]byte, error) {
	if !bytes.Equal(c.ChainID, v.chainID) || c.Purpose != v.purpose {
		return nil, ErrUntrusted
	}
	r, err := v.resolve(TrustRequest{ChainID: clone(v.chainID), Owner: c.Owner, Purpose: v.purpose, Height: height})
	if err != nil {
		return nil, err
	}
	if !r.Enabled || r.AlgorithmVersion != Version || r.Owner != c.Owner || r.Purpose != c.Purpose || !validASCII(r.PolicyRevision, 128) ||
		!bytes.Equal(r.ChainID, c.ChainID) || !bytes.Equal(r.PKA, c.PKA) || !bytes.Equal(r.PKB, c.PKB) || height < r.ActiveFrom {
		return nil, ErrUntrusted
	}
	revoked := "none"
	if r.RevokedAt != nil {
		at := *r.RevokedAt
		if at < r.ActiveFrom || height >= at {
			return nil, ErrUntrusted
		}
		revoked = strconv.FormatUint(at, 10)
	}
	return EncodeFields([]byte(r.AlgorithmVersion), r.ChainID, []byte(r.Owner), r.PKA, r.PKB, []byte(r.Purpose), []byte(r.PolicyRevision),
		[]byte(strconv.FormatUint(r.ActiveFrom, 10)), []byte(revoked))
}
func (v *Verifier) AuthenticateCertificate(wire []byte, height uint64) (*AuthenticatedHandle, error) {
	if v == nil {
		return nil, ErrHandle
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.resolve == nil || v.epoch == 0 {
		return nil, ErrHandle
	}
	c, err := DecodeCertificate(wire)
	if err != nil {
		return nil, err
	}
	trust, err := v.current(c, height)
	if err != nil {
		return nil, err
	}
	frozen, err := EncodeCertificate(c)
	if err != nil {
		return nil, err
	}
	var keyBytes []byte
	if v.certificateCache != nil {
		keyBytes, err = EncodeFields(v.cacheScope, frozen, trust)
	} else {
		keyBytes, err = EncodeFields(frozen, trust)
	}
	if err != nil {
		return nil, err
	}
	key := string(keyBytes)
	var state *authenticatedState
	if entry := v.cache[key]; entry != nil {
		v.lru.MoveToBack(entry)
		state = entry.Value.(cacheEntry).state
		v.hits++
	} else {
		var generation uint64
		sharedHit := false
		if v.certificateCache != nil {
			generation, sharedHit = v.certificateCache.lookup(key)
		}
		if !sharedHit {
			keys, err := importPublic(c.Context)
			if err != nil {
				return nil, err
			}
			v.checks += 2
			if err = verifySignaturesWithProvider(c, keys, v.parallelProvider); err != nil {
				return nil, err
			}
		}
		now, err := v.current(c, height)
		if err != nil {
			return nil, err
		}
		if !bytes.Equal(now, trust) {
			return nil, ErrUntrusted
		}
		h, err := newDualHasher(c.Context, c.N, v.optimized)
		if err != nil {
			return nil, err
		}
		if v.certificateCache != nil && !sharedHit {
			v.certificateCache.remember(key, generation)
		}
		state = &authenticatedState{c: c, trust: trust, hash: h}
		if v.cacheEntries > 0 {
			v.cache[key] = v.lru.PushBack(cacheEntry{key: key, state: state})
			if v.lru.Len() > v.cacheEntries {
				front := v.lru.Front()
				delete(v.cache, front.Value.(cacheEntry).key)
				v.lru.Remove(front)
			}
		}
	}
	return &AuthenticatedHandle{issuer: v, epoch: v.epoch, state: state}, nil
}
func (v *Verifier) state(h *AuthenticatedHandle, height uint64) (*authenticatedState, error) {
	if h == nil || h.issuer != v || h.epoch != v.epoch || h.state == nil || v.resolve == nil {
		return nil, ErrHandle
	}
	now, err := v.current(h.state.c, height)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(now, h.state.trust) {
		return nil, ErrHandle
	}
	return h.state, nil
}
func (v *Verifier) VerifyMember(h *AuthenticatedHandle, message []byte, proof Proof, height uint64) error {
	if v == nil {
		return ErrHandle
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	s, err := v.state(h, height)
	if err != nil {
		return err
	}
	if len(message) > MaxMessageBytes {
		return invalid("message size")
	}
	if err = validateProof(proof, s.c.N); err != nil {
		return err
	}
	// Defensive copies keep callers from mutating any retained authenticated data.
	// Concurrent mutation during the copy is a Go data race and is not supported.
	m := clone(message)
	a, b := copyMessages(proof.PathA), copyMessages(proof.PathB)
	ra, err := pathRoot(s.hash.a, proof.Index, m, a)
	if err != nil {
		return err
	}
	rb, err := pathRoot(s.hash.b, proof.Index, m, b)
	if err != nil {
		return err
	}
	if !bytes.Equal(ra[:], s.c.RootA) || !bytes.Equal(rb[:], s.c.RootB) {
		return ErrMembership
	}
	_, err = v.state(h, height)
	return err
}
func (v *Verifier) VerifyWholeBatch(wire []byte, messages [][]byte, height uint64) error {
	c, err := DecodeCertificate(wire)
	if err != nil {
		return err
	}
	if err = ValidateMessages(messages, c.N); err != nil {
		return err
	}
	input := copyMessages(messages)
	h, err := v.AuthenticateCertificate(wire, height)
	if err != nil {
		return err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	s, err := v.state(h, height)
	if err != nil {
		return err
	}
	ta, err := buildTree(s.hash.a, input)
	if err != nil {
		return err
	}
	tb, err := buildTree(s.hash.b, input)
	if err != nil {
		return err
	}
	if !bytes.Equal(ta.root(), s.c.RootA) || !bytes.Equal(tb.root(), s.c.RootB) {
		return ErrMembership
	}
	_, err = v.state(h, height)
	return err
}
func (v *Verifier) VerifyOne(wire []byte, height uint64) error {
	m, err := DecodeMember(wire)
	if err != nil {
		return err
	}
	cert, err := EncodeCertificate(m.Certificate)
	if err != nil {
		return err
	}
	h, err := v.AuthenticateCertificate(cert, height)
	if err != nil {
		return err
	}
	return v.VerifyMember(h, m.Message, m.Proof, height)
}
func (v *Verifier) VerifyWhole(wire []byte, height uint64) error {
	w, err := DecodeWhole(wire)
	if err != nil {
		return err
	}
	cert, err := EncodeCertificate(w.Certificate)
	if err != nil {
		return err
	}
	return v.VerifyWholeBatch(cert, w.Messages, height)
}

// Clear invalidates all issued handles in addition to dropping successful cache
// entries. The cache is an optimization, not an execution or anti-replay permit.
func (v *Verifier) Clear() {
	if v == nil {
		return
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.cache = make(map[string]*list.Element)
	v.lru = list.New()
	v.epoch++
}
func (v *Verifier) Stats() VerifierStats {
	if v == nil {
		return VerifierStats{}
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	return VerifierStats{len(v.cache), v.checks, v.hits}
}
