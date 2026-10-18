package chain

import (
	"crypto/sha256"
	"encoding/json"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const pqCertificateCacheEntries = 16
const pqPolicyScopeSlots = 2
const pqPolicyScopeDomain = "YNX-ACCOUNT-POLICY-CERTIFICATE-CACHE/v1"

// PQCertificateCache is disposable, application-owned verification work. Never
// put it into ledger JSON, AppHash, replication, or an authorization response.
// Its zero value is usable and it must not be copied after first use.
type PQCertificateCache struct {
	mu           sync.Mutex
	certificates *ynxbatch.CertificateCache
	scopes       [pqPolicyScopeSlots]pqPolicyScopeMemo
	computed     uint64
}

// Policy records/tombstones are immutable. Legal in-place append changes a
// length; global enable/version/network changes alter this stamp. Replacing or
// reloading existing record contents must call Invalidate before reuse.
type pqPolicyScopeStamp struct {
	version              string
	network              [32]byte
	networkLength        int
	enableAt             uint64
	records, revocations int
}

type pqPolicyScopeMemo struct {
	policy *ynxauth.State
	stamp  pqPolicyScopeStamp
	root   *pqPolicyScopeRoot
}

// A root contains no policy pointer. Only ClonePolicy may share this lazy root
// between policies; two memo slots retain at most two policy pointers/roots.
type pqPolicyScopeRoot struct {
	scope [32]byte
	ready bool
}

type PQCertificateCacheStats struct {
	Certificates         ynxbatch.CertificateCacheStats
	RetainedPolicyScopes int
	ScopeComputations    uint64
}

func NewPQCertificateCache() *PQCertificateCache { return &PQCertificateCache{} }

func pqScopeStamp(policy *ynxauth.State) pqPolicyScopeStamp {
	stamp := pqPolicyScopeStamp{version: policy.Version, networkLength: len(policy.NetworkID), enableAt: policy.EnableAt, records: len(policy.Records), revocations: len(policy.Revocations)}
	copy(stamp.network[:], policy.NetworkID)
	return stamp
}

func (c *PQCertificateCache) rememberScopeLocked(memo pqPolicyScopeMemo) {
	// Keep at most the two most recent borrowed immutable policy pointers. There
	// is no clone-keyed growing map and no retained JSON or additional state copy.
	for i := range c.scopes {
		if c.scopes[i].policy == memo.policy {
			for j := i; j > 0; j-- {
				c.scopes[j] = c.scopes[j-1]
			}
			c.scopes[0] = memo
			return
		}
	}
	for i := len(c.scopes) - 1; i > 0; i-- {
		c.scopes[i] = c.scopes[i-1]
	}
	c.scopes[0] = memo
}

// VerifierCache derives a scope from trusted local state. The caller holds its
// state lock or supplies an immutable policy. It never accepts a submitter scope.
// nil receivers preserve the complete uncached verification path.
func (c *PQCertificateCache) VerifierCache(policy *ynxauth.State) (*ynxbatch.CertificateCache, []byte, error) {
	if c == nil {
		return nil, nil, nil
	}
	if policy == nil {
		return nil, nil, ynxauth.ErrPolicy
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.certificates == nil {
		cache, err := ynxbatch.NewCertificateCache(pqCertificateCacheEntries)
		if err != nil {
			return nil, nil, err
		}
		c.certificates = cache
	}
	stamp := pqScopeStamp(policy)
	var root *pqPolicyScopeRoot
	for _, memo := range c.scopes {
		if memo.policy == policy && memo.stamp == stamp {
			root = memo.root
			break
		}
	}
	if root != nil && root.ready {
		c.rememberScopeLocked(pqPolicyScopeMemo{policy: policy, stamp: stamp, root: root})
		return c.certificates, append([]byte(nil), root.scope[:]...), nil
	}
	// This is local cache framing, not a new protocol wire or consensus root.
	// Match Clone's empty-slice normalization without changing ledger JSON.
	canonical := *policy
	if len(canonical.Records) == 0 {
		canonical.Records = nil
	}
	if len(canonical.Revocations) == 0 {
		canonical.Revocations = nil
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return nil, nil, err
	}
	wire, err := ynxbatch.EncodeFields([]byte(pqPolicyScopeDomain), encoded)
	if err != nil {
		return nil, nil, err
	}
	if root == nil {
		root = &pqPolicyScopeRoot{}
	}
	root.scope, root.ready = sha256.Sum256(wire), true
	c.computed++
	c.rememberScopeLocked(pqPolicyScopeMemo{policy: policy, stamp: stamp, root: root})
	return c.certificates, append([]byte(nil), root.scope[:]...), nil
}

// ClonePolicy performs the trusted clone itself. There is no public operation
// for attaching a chosen scope to an externally supplied target policy. Clones
// made for CheckTx/Prepare/Process/Finalize can share the same immutable root
// without JSON hashing the full policy on every transaction simulation.
func (c *PQCertificateCache) ClonePolicy(source *ynxauth.State) *ynxauth.State {
	if source == nil {
		return nil
	}
	cloned := source.Clone()
	if c != nil {
		c.mu.Lock()
		stamp := pqScopeStamp(source)
		var root *pqPolicyScopeRoot
		for _, memo := range c.scopes {
			if memo.policy == source && memo.stamp == stamp {
				root = memo.root
				break
			}
		}
		if root == nil {
			root = &pqPolicyScopeRoot{}
		}
		// No hashing here: legacy and ordinary N=1 simulation must not pay for a
		// scope that they never use. The first shareable proof computes it once.
		c.rememberScopeLocked(pqPolicyScopeMemo{policy: source, stamp: stamp, root: root})
		c.rememberScopeLocked(pqPolicyScopeMemo{policy: &cloned, stamp: pqScopeStamp(&cloned), root: root})
		c.mu.Unlock()
	}
	return &cloned
}

func (c *PQCertificateCache) VerifyMember(policy *ynxauth.State, owner, purpose string, message, wire []byte, height uint64) error {
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return err
	}
	return c.VerifyDecodedMember(policy, owner, purpose, message, member, height)
}

// VerifyDecodedMember is the production member path. Ordinary N=1 certificates
// bypass shared caching and scope hashing. N>1 members can share a certificate;
// complete message, policy/height and both membership paths are always checked.
func (c *PQCertificateCache) VerifyDecodedMember(policy *ynxauth.State, owner, purpose string, message []byte, member ynxbatch.Member, height uint64) error {
	if policy == nil {
		return ynxauth.ErrPolicy
	}
	if member.Certificate.N == 1 {
		return policy.VerifyDecodedMemberWithCache(owner, purpose, message, member, height, nil, nil)
	}
	cache, scope, err := c.VerifierCache(policy)
	if err != nil {
		return err
	}
	return policy.VerifyDecodedMemberWithCache(owner, purpose, message, member, height, cache, scope)
}

// Invalidate is required when loading/replacing existing record contents in
// place. Policy assignment/rollback paths also use it as an explicit boundary.
// UNKNOWN is not rolled back here: current state remains the authority.
func (c *PQCertificateCache) Invalidate() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.scopes = [pqPolicyScopeSlots]pqPolicyScopeMemo{}
	c.certificates.Clear()
}

func (c *PQCertificateCache) Stats() PQCertificateCacheStats {
	if c == nil {
		return PQCertificateCacheStats{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	retained := 0
	for _, scope := range c.scopes {
		if scope.policy != nil {
			retained++
		}
	}
	return PQCertificateCacheStats{Certificates: c.certificates.Stats(), RetainedPolicyScopes: retained, ScopeComputations: c.computed}
}

func (d *Devnet) verifyPQMemberLocked(owner, purpose string, message []byte, member ynxbatch.Member, height uint64) error {
	if d.pqCertificateCache == nil {
		d.pqCertificateCache = NewPQCertificateCache()
	}
	return d.pqCertificateCache.VerifyDecodedMember(d.accountPolicy, owner, purpose, message, member, height)
}

// ValidateConsensusHistoricalPQTransactionWithCache retains the same historical
// execution checks as the existing bridge and only reuses successful dual
// certificate authentication. The caller supplies its original trusted policy.
func ValidateConsensusHistoricalPQTransactionWithCache(tx Transaction, state *ynxauth.State, height uint64, chainID int64, cache *PQCertificateCache) error {
	return validateHistoricalPQTransactionWithCache(tx, state, height, chainID, cache)
}
