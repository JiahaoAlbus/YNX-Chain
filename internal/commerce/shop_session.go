package commerce

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"math"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Inventory records an already accepted Auth product session, never a bearer,
// issuer, approval or Source. Only digests survive in persistence.
type ShopSessionRecord struct {
	ID, SessionDigest, WalletDigest, ActorDigest, Role, Realm, Tenant, MembershipDigest string
	Generation                                                                          uint64
	ExpiresAt                                                                           time.Time
	Revoked                                                                             bool
}

// Set only by the existing accepted-v2 verifier, after signature/action checks.
// No public constructor, caller JSON or Source projection can create it.
type verifiedShopSessionIssuer struct{ digest string }
type originalShopSessionDomain struct {
	realm, tenant string
	current       func(context.Context) error
	retired       atomic.Bool
}

// DATA copied from an opaque current hold. It cannot acquire another session.
type OriginalShopSessionDATA struct {
	Realm, Tenant, Account, Actor, Role string
	Generation                          uint64
	ExpiresAt                           time.Time
}

// OriginalShopSession is a same-process hold. It is never serialized into Main
// or obtained by looking up an account/Source epoch. The Store remains borrowed.
type OriginalShopSession struct {
	store    *Store
	domain   *originalShopSessionDomain
	verified *verifiedBusinessRequest
	id       string
	data     OriginalShopSessionDATA
	deadline time.Time
	retired  atomic.Bool
	mu       sync.Mutex
	active   int
	closed   bool
	cancel   context.CancelFunc
	ctx      context.Context
	first    error
}

func sessionActorDigest(actor string) string { return effectDigest("shop-session-actor-v1", actor) }
func sessionRecordID(domain *originalShopSessionDomain, binding string) string {
	return effectDigest("shop-session-inventory-v1", domain.realm, domain.tenant, binding)
}

// Shop business namespace v1 uses existing authoritative state only, not
// Source comparison DATA: original chain realm and canonical merchant owner.
func (s *Store) shopStoreNamespaceLocked(id string) (string, string, bool) {
	store, ok := s.s.Stores[id]
	if !ok {
		return "", "", false
	}
	owner, err := accountaddress.Normalize(store.Owner)
	if err != nil {
		return "", "", false
	}
	return ChainName, owner, true
}
func (s *Store) shopDomainMappedLocked(realm, tenant string) bool {
	for id := range s.s.Stores {
		r, t, ok := s.shopStoreNamespaceLocked(id)
		if ok && r == realm && t == tenant {
			return true
		}
	}
	return false
}
func (s *Store) sessionMembershipLocked(actor, realm, tenant string) string {
	var rows []string
	for id, roles := range s.s.SellerRoles {
		if r, t, ok := s.shopStoreNamespaceLocked(id); !ok || r != realm || t != tenant {
			continue
		}
		role, ok := canonicalSellerRole(roles[actor])
		if ok && sellerRoleAllows(role, permissionSellerRead) {
			rows = append(rows, id+":"+role)
		}
	}
	if len(rows) == 0 {
		return ""
	}
	sort.Strings(rows)
	return effectDigest(append([]string{"shop-session-membership-v1"}, rows...)...)
}
func validateShopSessionInventory(snapshot Snapshot) error {
	for id, r := range snapshot.ShopSessions {
		if id != r.ID || len(id) != 64 || len(r.SessionDigest) != 64 || len(r.ActorDigest) != 64 || len(r.WalletDigest) != 64 || r.Realm == "" || r.Tenant == "" || (r.Role != "buyer" && r.Role != "seller") || r.Generation == 0 || r.Generation > snapshot.ShopSessionGeneration || r.ExpiresAt.IsZero() {
			return ErrInvalidState
		}
		for _, v := range []string{id, r.SessionDigest, r.ActorDigest, r.WalletDigest} {
			if !validSessionDigest(v) {
				return ErrInvalidState
			}
		}
		if r.Role == "seller" && !validSessionDigest(r.MembershipDigest) {
			return ErrInvalidState
		}
		if r.Role == "buyer" && r.MembershipDigest != "" {
			return ErrInvalidState
		}
	}
	return nil
}
func validSessionDigest(v string) bool {
	if len(v) != 64 {
		return false
	}
	for _, c := range v {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// Qualified server Source supplies the deployment comparison domain only. The
// accepted Auth proof below, plus actual Store ACL, supplies session identity.
func (s *Store) bindOriginalShopSessionDomain(a originalShopInvoiceReadAuthority, p originalShopInvoiceReadProfile) (*originalShopSessionDomain, error) {
	if a == nil || p.realm == "" || p.tenant == "" {
		return nil, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.shopDomainMappedLocked(p.realm, p.tenant) {
		return nil, ErrUnauthorized
	}
	if s.shopSessionDomain != nil {
		return nil, ErrConflict
	}
	s.shopSessionDomain = &originalShopSessionDomain{realm: p.realm, tenant: p.tenant, current: a.current}
	return s.shopSessionDomain, nil
}
func (s *Store) retireOriginalShopSessionDomain(d *originalShopSessionDomain) {
	if d == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d.retired.Store(true)
	for h := range s.shopSessionHolds {
		if h.domain == d {
			h.Retire()
		}
	}
}
func (s *Store) closeOriginalShopSessionDomain(d *originalShopSessionDomain) (error, bool) {
	if d == nil {
		return nil, true
	}
	s.mu.Lock()
	var holds []*OriginalShopSession
	for h := range s.shopSessionHolds {
		if h.domain == d {
			holds = append(holds, h)
		}
	}
	s.mu.Unlock()
	var first error
	for _, h := range holds {
		e := h.Close()
		if first == nil {
			first = e
		}
		if !h.PhysicalClosed() {
			return e, false
		}
	}
	return first, true
}
func (s *Store) releaseOriginalShopSessionDomain(d *originalShopSessionDomain) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if d != nil && s.shopSessionDomain == d {
		s.shopSessionDomain = nil
	}
}

// Called only by the normal private HTTP wrapper after fresh Auth revalidation.
// Absence of a qualified private deployment disables capture, not old business.
func (s *Store) observeOriginalShopSession(ctx context.Context, v *verifiedBusinessRequest) error {
	s.mu.Lock()
	domain := s.shopSessionDomain
	s.mu.Unlock()
	if domain == nil || domain.retired.Load() {
		return nil
	}
	if v == nil || v.shopSessionIssuer == nil || !validSessionDigest(v.shopSessionIssuer.digest) || v.walletAccount == "" || domain.retired.Load() {
		return ErrUnauthorized
	}
	if err := domain.current(ctx); err != nil {
		// A read-resource outage cannot stop unrelated already authorized API work.
		return nil
	}
	if err := v.current(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.shopDomainMappedLocked(domain.realm, domain.tenant) {
		return nil
	}
	if domain != s.shopSessionDomain || domain.retired.Load() {
		return ErrUnauthorized
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return err
	}
	staged := &Store{s: before, now: s.now}
	actor, err := staged.resolveBusinessActor(v.walletAccount)
	if err != nil {
		return err
	}
	role := v.principal.Role
	if role != "buyer" && role != "seller" {
		return ErrUnauthorized
	}
	membership := ""
	if role == "seller" {
		membership = staged.sessionMembershipLocked(actor, domain.realm, domain.tenant)
		if membership == "" {
			// Existing explicit Seller onboarding remains usable; it creates no session hold until actual membership exists.
			return nil
		}
	}
	id := sessionRecordID(domain, v.principal.SessionBinding)
	record := ShopSessionRecord{ID: id, SessionDigest: v.shopSessionIssuer.digest, WalletDigest: effectDigest("shop-session-wallet-v1", v.walletAccount), ActorDigest: sessionActorDigest(actor), Role: role, Realm: domain.realm, Tenant: domain.tenant, MembershipDigest: membership, ExpiresAt: v.principal.ExpiresAt.UTC()}
	if old, ok := s.s.ShopSessions[id]; ok {
		record.Generation = old.Generation
		if old.Revoked || old != record || !s.now().Before(old.ExpiresAt) {
			return ErrUnauthorized
		}
		return v.current(ctx)
	}
	if s.s.ShopSessionGeneration == math.MaxUint64 || !s.now().Before(record.ExpiresAt) {
		return ErrUnauthorized
	}
	record.Generation = s.s.ShopSessionGeneration + 1
	if staged.s.ShopSessions == nil {
		staged.s.ShopSessions = map[string]ShopSessionRecord{}
	}
	staged.s.ShopSessions[id] = record
	staged.s.ShopSessionGeneration = record.Generation
	if err := v.current(ctx); err != nil {
		return err
	}
	original := s.s
	s.s = staged.s
	if err := s.persistLocked(); err != nil {
		s.s = original
		return err
	}
	return nil
}

// The context key and verified issuer are private and supplied by the original
// HTTP verifier. This API cannot capture from a detached Session DATA value.
func (s *Store) CaptureOriginalShopSession(ctx context.Context) (*OriginalShopSession, error) {
	if ctx == nil {
		return nil, ErrUnauthorized
	}
	v, _ := ctx.Value(businessRequestContextKey{}).(*verifiedBusinessRequest)
	if v == nil || v.shopSessionIssuer == nil || v.revalidate == nil {
		return nil, ErrUnauthorized
	}
	if err := v.revalidate(ctx); err != nil {
		return nil, err
	}
	if err := v.current(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	domain := s.shopSessionDomain
	s.mu.Unlock()
	if domain == nil || domain.retired.Load() {
		return nil, ErrUnauthorized
	}
	if err := domain.current(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	h, err := func() (*OriginalShopSession, error) {
		id := sessionRecordID(domain, v.principal.SessionBinding)
		r, ok := s.s.ShopSessions[id]
		if !ok || r.Revoked || r.SessionDigest != v.shopSessionIssuer.digest || r.WalletDigest != effectDigest("shop-session-wallet-v1", v.walletAccount) || r.Role != v.principal.Role || !s.now().Before(r.ExpiresAt) {
			return nil, ErrUnauthorized
		}
		actor := ""
		for _, alias := range businessActorAliases(v.walletAccount) {
			if sessionActorDigest(alias) == r.ActorDigest {
				actor = alias
			}
		}
		if actor == "" || (r.Role == "seller" && s.sessionMembershipLocked(actor, r.Realm, r.Tenant) != r.MembershipDigest) {
			return nil, ErrUnauthorized
		}
		if err := v.current(ctx); err != nil {
			return nil, err
		}
		until := r.ExpiresAt
		if !v.shopSessionCaptureUntil.IsZero() && v.shopSessionCaptureUntil.Before(until) {
			until = v.shopSessionCaptureUntil
		}
		deadline := time.Now().Add(r.ExpiresAt.Sub(s.now()))
		if !v.shopSessionCaptureUntil.IsZero() && v.shopSessionCaptureUntil.Before(deadline) {
			deadline = v.shopSessionCaptureUntil
		}
		h := &OriginalShopSession{store: s, domain: domain, verified: v, id: id, data: OriginalShopSessionDATA{r.Realm, r.Tenant, v.walletAccount, actor, r.Role, r.Generation, until.UTC()}, deadline: deadline}
		h.ctx, h.cancel = context.WithCancel(context.Background())
		if s.shopSessionHolds == nil {
			s.shopSessionHolds = map[*OriginalShopSession]struct{}{}
		}
		s.shopSessionHolds[h] = struct{}{}
		return h, nil
	}()
	s.mu.Unlock()
	if err != nil {
		return h, err
	}
	// A nonnull partial always escapes before its fresh post-acquisition status.
	return h, h.Current(ctx)
}
func (h *OriginalShopSession) CurrentLocal() error {
	if h == nil || h.domain == nil || h.store == nil || h.retired.Load() || h.domain.retired.Load() || !time.Now().Before(h.deadline) {
		return ErrUnauthorized
	}
	return nil
}
func (h *OriginalShopSession) Current(ctx context.Context) error {
	if h == nil || ctx == nil {
		return ErrUnauthorized
	}
	h.mu.Lock()
	if h.closed || h.CurrentLocal() != nil {
		h.mu.Unlock()
		return ErrUnauthorized
	}
	h.active++
	h.mu.Unlock()
	defer func() { h.mu.Lock(); h.active--; h.mu.Unlock() }()
	current, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(h.ctx, cancel)
	defer stop()
	defer cancel()
	err := func() error {
		if err := h.verified.revalidate(current); err != nil {
			return err
		}
		if err := h.domain.current(current); err != nil {
			return err
		}
		if err := h.verified.current(current); err != nil {
			return err
		}
		h.store.mu.Lock()
		defer h.store.mu.Unlock()
		r, ok := h.store.s.ShopSessions[h.id]
		if !ok || !h.store.shopDomainMappedLocked(h.data.Realm, h.data.Tenant) || r.Revoked || r.Generation != h.data.Generation || r.SessionDigest != h.verified.shopSessionIssuer.digest || !h.store.now().Before(r.ExpiresAt) || h.CurrentLocal() != nil {
			return ErrUnauthorized
		}
		if r.Role == "seller" && h.store.sessionMembershipLocked(h.data.Actor, r.Realm, r.Tenant) != r.MembershipDigest {
			return ErrUnauthorized
		}
		return nil
	}()
	if err != nil {
		h.mu.Lock()
		if h.first == nil {
			h.first = err
		}
		h.mu.Unlock()
		h.Retire()
	}
	return err
}
func (h *OriginalShopSession) CurrentOrder(ctx context.Context, product, orderID string) error {
	if product != "shop.order" {
		return ErrUnauthorized
	}
	if err := h.Current(ctx); err != nil {
		return err
	}
	h.store.mu.Lock()
	defer h.store.mu.Unlock()
	if h.CurrentLocal() != nil {
		return ErrUnauthorized
	}
	o, ok := h.store.s.Orders[orderID]
	if !ok {
		return ErrNotFound
	}
	realm, tenant, mapped := h.store.shopStoreNamespaceLocked(o.StoreID)
	if !mapped || realm != h.data.Realm || tenant != h.data.Tenant {
		return ErrUnauthorized
	}
	staged := &Store{s: h.store.s, now: h.store.now}
	_, err := staged.Order(h.data.Actor, h.data.Role, orderID)
	return err
}
func (h *OriginalShopSession) DATA(ctx context.Context) (OriginalShopSessionDATA, error) {
	if err := h.Current(ctx); err != nil {
		return OriginalShopSessionDATA{}, err
	}
	return h.data, nil
}
func (h *OriginalShopSession) Retire() {
	if h != nil {
		h.retired.Store(true)
		if h.cancel != nil {
			h.cancel()
		}
	}
}
func (h *OriginalShopSession) Close() error {
	if h == nil {
		return nil
	}
	if h.store == nil {
		return ErrUnauthorized
	}
	h.Retire()
	h.mu.Lock()
	if h.active != 0 {
		h.mu.Unlock()
		return ErrConflict
	}
	h.closed = true
	first := h.first
	h.mu.Unlock()
	h.store.mu.Lock()
	delete(h.store.shopSessionHolds, h)
	h.store.mu.Unlock()
	return first
}
func (h *OriginalShopSession) PhysicalClosed() bool {
	if h == nil {
		return true
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.closed && h.active == 0
}

// The successful same Store commit retires every existing local borrower before
// returning. Inventory tombstones are included in that commit and its backup.
func (s *Store) prepareShopSessionInvalidationsLocked() map[string]ShopSessionRecord {
	before := s.s.ShopSessions
	if len(before) == 0 {
		return before
	}
	next := make(map[string]ShopSessionRecord, len(before))
	for id, r := range before {
		membership := ""
		if r.Role == "seller" {
			for _, roles := range s.s.SellerRoles {
				for actor := range roles {
					if sessionActorDigest(actor) == r.ActorDigest {
						membership = s.sessionMembershipLocked(actor, r.Realm, r.Tenant)
					}
				}
			}
		}
		if !r.Revoked && (!s.now().Before(r.ExpiresAt) || !s.shopDomainMappedLocked(r.Realm, r.Tenant) || r.Role == "seller" && membership != r.MembershipDigest) {
			r.Revoked = true
		}
		next[id] = r
	}
	s.s.ShopSessions = next
	return before
}
func (s *Store) retireInvalidShopSessionHoldsLocked() {
	for h := range s.shopSessionHolds {
		r, ok := s.s.ShopSessions[h.id]
		if !ok || r.Revoked || r.Generation != h.data.Generation {
			h.Retire()
		}
	}
}
func (s *Store) revokeShopSessionActorLocked(actor string) {
	for id, r := range s.s.ShopSessions {
		for _, a := range businessActorAliases(actor) {
			if r.ActorDigest == sessionActorDigest(a) {
				r.Revoked = true
				s.s.ShopSessions[id] = r
			}
		}
	}
}
func (s *Store) RevokeOriginalShopSession(ctx context.Context) error {
	if ctx == nil {
		return ErrUnauthorized
	}
	v, _ := ctx.Value(businessRequestContextKey{}).(*verifiedBusinessRequest)
	if v == nil || v.shopSessionIssuer == nil {
		return ErrUnauthorized
	}
	if err := v.current(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.shopSessionDomain == nil {
		return ErrUnauthorized
	}
	id := sessionRecordID(s.shopSessionDomain, v.principal.SessionBinding)
	r, ok := s.s.ShopSessions[id]
	if !ok || r.SessionDigest != v.shopSessionIssuer.digest {
		return ErrUnauthorized
	}
	if r.Revoked {
		return nil
	}
	before := r
	r.Revoked = true
	s.s.ShopSessions[id] = r
	if err := s.persistLocked(); err != nil {
		s.s.ShopSessions[id] = before
		return err
	}
	return nil
}

// Explicit own-session logout remains possible after the original Auth/actor
// has retired. Possession of this previously authenticated opaque hold can only
// revoke its exact original inventory row, never create or replace authority.
func (h *OriginalShopSession) Revoke(ctx context.Context) error {
	if h == nil || h.store == nil || ctx == nil || ctx.Err() != nil {
		return ErrUnauthorized
	}
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return ErrUnauthorized
	}
	h.active++
	h.mu.Unlock()
	defer func() { h.mu.Lock(); h.active--; h.mu.Unlock() }()
	h.Retire()
	s := h.store
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.s.ShopSessions[h.id]
	if !ok || r.Generation != h.data.Generation || r.SessionDigest != h.verified.shopSessionIssuer.digest {
		return ErrUnauthorized
	}
	if r.Revoked {
		return nil
	}
	before := r
	r.Revoked = true
	s.s.ShopSessions[h.id] = r
	if err := s.persistLocked(); err != nil {
		s.s.ShopSessions[h.id] = before
		return err
	}
	return nil
}

// Implemented only by the existing normal accepted-v2 adapter. Registration is
// from the original private Server constructor, never a caller callback/DTO.
type originalShopSessionReadVerifier interface {
	verifyOriginalShopSessionRead(*http.Request, string) (*verifiedBusinessRequest, error)
}

func (s *Store) registerOriginalShopSessionVerifier(v originalShopSessionReadVerifier) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, old := range s.shopSessionVerifiers {
		if old == v {
			return
		}
	}
	s.shopSessionVerifiers = append(s.shopSessionVerifiers, v)
}
func (s *Store) captureOriginalShopSessionForRead(ctx context.Context, r *http.Request, scope originalShopInvoiceReadScope) (*OriginalShopSession, error) {
	s.mu.Lock()
	verifiers := append([]originalShopSessionReadVerifier(nil), s.shopSessionVerifiers...)
	s.mu.Unlock()
	var first error
	for _, verifier := range verifiers {
		v, err := verifier.verifyOriginalShopSessionRead(r, scope.role)
		if err != nil {
			if first == nil {
				first = err
			}
			continue
		}
		if v == nil || v.shopSessionIssuer == nil || !sameBusinessAccount(v.walletAccount, scope.actor) {
			return nil, ErrUnauthorized
		}
		if err = v.revalidate(ctx); err != nil {
			return nil, err
		}
		if err = s.observeOriginalShopSession(ctx, v); err != nil {
			return nil, err
		}
		h, err := s.CaptureOriginalShopSession(context.WithValue(ctx, businessRequestContextKey{}, v))
		if h != nil && (h.data.Actor != scope.actor || h.data.Role != scope.role || h.data.Realm != scope.realm || h.data.Tenant != scope.tenant) {
			h.Retire()
			return h, ErrUnauthorized
		}
		return h, err
	}
	if first == nil {
		first = ErrShopInvoiceReadSourceNotSupplied
	}
	return nil, first
}
