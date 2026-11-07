package securelink

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

type Ref struct{ Realm, Tenant, Kind, ID, Rev string }
type ReadIdentity struct{ Realm, Tenant, Agent, AgentEpoch, Grant, GrantRev, Audience string }
type ReadBinding struct {
	Domain                                                             string
	Identity                                                           ReadIdentity
	Edge, PeerSAN, PeerFingerprint, PolicyEpoch, ChannelBinding, Nonce string
	Expires                                                            time.Time
}
type ReadChallenge struct {
	ID      string
	Binding ReadBinding
	Payload []byte
}
type Tool struct{ ID, Revision, Method, Path, Risk string }

// ReadAuthority is the original Auth owner, not a LINK-created verifier or
// authorization table. Both source signatures, exact challenge bytes, active
// Agent/epoch, Grant/version/audience/scope and current resource permissions must
// be checked. VerifyReadProof must reject either missing signature. CheckRead
// runs for every request, including warm cache hits, with current authority.
type ReadAuthority interface {
	VerifyReadProof(context.Context, ReadBinding, []byte) error
	CheckRead(context.Context, ReadBinding, Tool, Ref) error
}
type pendingRead struct {
	conn    *native.Conn
	binding ReadBinding
}
type readSession struct {
	conn     *native.Conn
	binding  ReadBinding
	sequence uint64
}
type readManager struct {
	authority ReadAuthority
	tools     map[string]Tool
	pending   map[string]pendingRead
	sessions  map[string]*readSession
	byConn    map[native.ConnectionID]string
	floors    map[string]uint64
	limit     int
}

// ConfigureReadFastPath cannot enable a proxy-terminated channel. It operates
// only on actual native TLS endpoints, one Agent/Grant per connection.
func (g *Gate) ConfigureReadFastPath(authority ReadAuthority, tools []Tool, limit int) error {
	if authority == nil {
		return ErrUnavailable
	}
	if limit < 1 || limit > 65536 || len(tools) == 0 || len(tools) > 4096 {
		return ErrBounds
	}
	directory := make(map[string]Tool, len(tools))
	for _, t := range tools {
		if t.ID == "" || t.Revision == "" || !validRoute(Route{t.Method, t.Path, t.Risk}) {
			return ErrDenied
		}
		if _, exists := directory[t.ID]; exists {
			return ErrDenied
		}
		directory[t.ID] = t
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.read != nil {
		return fmt.Errorf("%w: reconfiguration requires fresh gate", ErrDenied)
	}
	g.read = &readManager{authority: authority, tools: directory, pending: make(map[string]pendingRead), sessions: make(map[string]*readSession), byConn: make(map[native.ConnectionID]string), floors: make(map[string]uint64), limit: limit}
	return nil
}

func identityKey(i ReadIdentity) string {
	b, _ := json.Marshal([]string{i.Realm, i.Tenant, i.Agent})
	return string(b)
}
func validIdentity(i ReadIdentity) bool {
	epoch, e1 := canonicalU(i.AgentEpoch)
	rev, e2 := canonicalU(i.GrantRev)
	return i.Realm != "" && i.Tenant != "" && i.Agent != "" && i.Grant != "" && i.Audience != "" && epoch > 0 && rev > 0 && e1 == nil && e2 == nil
}
func randomID() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// IssueReadChallenge obtains RFC9266 tls-exporter from this TLS stack. External
// exporter bytes and claimed channel IDs are never accepted.
func (g *Gate) IssueReadChallenge(ctx context.Context, conn *native.Conn, edge, method, path string, identity ReadIdentity, ttl time.Duration) (ReadChallenge, error) {
	if !validIdentity(identity) || ttl <= 0 || ttl > 5*time.Minute {
		return ReadChallenge{}, ErrDenied
	}
	peer, err := g.AuthenticateServicePeer(ctx, conn, edge, method, path)
	if err != nil {
		return ReadChallenge{}, err
	}
	exporter, err := conn.ExportKeyingMaterial("EXPORTER-Channel-Binding", nil, 32)
	if err != nil {
		return ReadChallenge{}, err
	}
	defer clear(exporter)
	if len(exporter) != 32 {
		return ReadChallenge{}, ErrDenied
	}
	channel := sha256.Sum256(exporter)
	id, err := randomID()
	if err != nil {
		return ReadChallenge{}, err
	}
	now := time.Now()
	expires := now.Add(ttl)
	if peer.Expires.Before(expires) {
		expires = peer.Expires
	}
	binding := ReadBinding{Domain: "YNX-LINK-READ/v1", Identity: identity, Edge: edge, PeerSAN: peer.SubjectAltName, PeerFingerprint: peer.CertDigest, PolicyEpoch: fmt.Sprint(peer.Epoch), ChannelBinding: hex.EncodeToString(channel[:]), Nonce: id, Expires: expires}
	g.mu.Lock()
	defer g.mu.Unlock()
	r := g.read
	if r == nil {
		return ReadChallenge{}, ErrUnavailable
	}
	r.pruneLocked(now)
	if r.byConn[conn.ID()] != "" {
		return ReadChallenge{}, ErrDenied
	}
	if len(r.pending)+len(r.sessions) >= r.limit {
		return ReadChallenge{}, ErrBounds
	}
	if _, err := g.authenticateLocked(conn.Snapshot(), edge, method, path, now); err != nil {
		return ReadChallenge{}, err
	}
	route, _ := g.edges[edge].route(method, path)
	if route.Risk != "read" {
		return ReadChallenge{}, ErrDenied
	}
	if identity.Audience != g.edges[edge].LocalSAN || r.isRevoked(binding) {
		return ReadChallenge{}, ErrDenied
	}
	for _, p := range r.pending {
		if p.conn.ID() == conn.ID() {
			return ReadChallenge{}, ErrDenied
		}
	}
	r.pending[id] = pendingRead{conn: conn, binding: binding}
	payload, _ := json.Marshal(binding)
	return ReadChallenge{ID: id, Binding: binding, Payload: payload}, nil
}

// BindReadChannel (LINK-02) consumes a single-use server challenge. The injected
// Auth verifier sees the exact binding to be signed; no caller identity cache
// can replace its two independent signature and current-state checks.
func (g *Gate) BindReadChannel(ctx context.Context, conn *native.Conn, challengeID string, proof []byte) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if len(proof) == 0 || len(proof) > 1<<20 {
		return "", ErrBounds
	}
	g.mu.Lock()
	r := g.read
	if r == nil {
		g.mu.Unlock()
		return "", ErrUnavailable
	}
	p, ok := r.pending[challengeID]
	if !ok || conn == nil || p.conn.ID() != conn.ID() {
		g.mu.Unlock()
		return "", ErrDenied
	}
	delete(r.pending, challengeID)
	if !time.Now().Before(p.binding.Expires) || r.isRevoked(p.binding) {
		g.mu.Unlock()
		return "", ErrExpired
	}
	authority := r.authority
	g.mu.Unlock()
	if err := authority.VerifyReadProof(ctx, p.binding, append([]byte(nil), proof...)); err != nil {
		return "", err
	}
	handle, err := randomID()
	if err != nil {
		return "", err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	r = g.read
	record, ok := g.connections[conn.ID()]
	if !ok || !conn.Snapshot().Verified || record.peer.Edge != p.binding.Edge || record.peer.CertDigest != p.binding.PeerFingerprint || !time.Now().Before(p.binding.Expires) || r.isRevoked(p.binding) || r.byConn[conn.ID()] != "" {
		return "", ErrDenied
	}
	e, ok := g.edges[p.binding.Edge]
	if !ok || fmt.Sprint(e.Epoch) != p.binding.PolicyEpoch {
		return "", ErrRevoked
	}
	if g.revokedCerts[record.peer.CertDigest] || g.revokedServices[record.peer.SubjectAltName] >= e.Epoch {
		return "", ErrRevoked
	}
	r.sessions[handle] = &readSession{conn: conn, binding: p.binding}
	r.byConn[conn.ID()] = handle
	return handle, nil
}

// CheckReadFastPath (LINK-03) uses a trusted, immutable tool directory. Request
// headers cannot re-label transfer/write/deploy operations as reads. Authority,
// scope, revocation, expiry, connection and sequence are checked on every call.
func (g *Gate) CheckReadFastPath(ctx context.Context, conn *native.Conn, handle, toolID string, resource Ref, sequence string) (Ref, error) {
	seq, err := canonicalU(sequence)
	if err != nil || seq == 0 {
		return Ref{}, ErrReplay
	}
	if err = ctx.Err(); err != nil {
		return Ref{}, err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	r := g.read
	if r == nil {
		return Ref{}, ErrUnavailable
	}
	s, ok := r.sessions[handle]
	if !ok || conn == nil || s.conn.ID() != conn.ID() {
		return Ref{}, ErrDenied
	}
	if !time.Now().Before(s.binding.Expires) {
		r.forgetLocked(conn)
		_ = conn.Close()
		delete(g.connections, conn.ID())
		return Ref{}, ErrExpired
	}
	tool, ok := r.tools[toolID]
	if !ok || tool.Risk != "read" {
		return Ref{}, ErrDenied
	}
	if resource.Realm != s.binding.Identity.Realm || resource.Tenant != s.binding.Identity.Tenant || resource.Kind == "" || resource.ID == "" {
		return Ref{}, ErrDenied
	}
	if _, err = canonicalU(resource.Rev); err != nil {
		return Ref{}, ErrDenied
	}
	if r.isRevoked(s.binding) {
		return Ref{}, ErrRevoked
	}
	if _, err = g.authenticateLocked(conn.Snapshot(), s.binding.Edge, tool.Method, tool.Path, time.Now()); err != nil {
		return Ref{}, err
	}
	route, _ := g.edges[s.binding.Edge].route(tool.Method, tool.Path)
	if route.Risk != "read" {
		return Ref{}, ErrDenied
	}
	if s.sequence == math.MaxUint64 || seq != s.sequence+1 {
		return Ref{}, ErrReplay
	}
	// This call deliberately stays inside the dispatch lock: no concurrent local
	// revocation can pass its effective point before this authorization dispatch.
	if err = r.authority.CheckRead(ctx, s.binding, tool, resource); err != nil {
		return Ref{}, err
	}
	s.sequence = seq
	return Ref{Realm: resource.Realm, Tenant: resource.Tenant, Kind: "link-read-authorization", ID: handle, Rev: sequence}, nil
}

// CloseRevokedSessions (LINK-04) follows the Auth authority's epoch advance.
// It does not mint an Auth epoch or modify the original identity/grant authority.
func (g *Gate) CloseRevokedSessions(principal Ref, newEpoch string) (int, error) {
	epoch, err := canonicalU(newEpoch)
	if err != nil || epoch == 0 || principal.Realm == "" || principal.Tenant == "" || principal.ID == "" {
		return 0, ErrDenied
	}
	key := identityKey(ReadIdentity{Realm: principal.Realm, Tenant: principal.Tenant, Agent: principal.ID})
	g.mu.Lock()
	r := g.read
	if r == nil {
		g.mu.Unlock()
		return 0, ErrUnavailable
	}
	if epoch <= r.floors[key] {
		g.mu.Unlock()
		return 0, ErrDenied
	}
	r.floors[key] = epoch
	closing := make(map[*native.Conn]bool)
	for _, s := range r.sessions {
		if identityKey(s.binding.Identity) == key {
			closing[s.conn] = true
		}
	}
	for _, p := range r.pending {
		if identityKey(p.binding.Identity) == key {
			closing[p.conn] = true
		}
	}
	for c := range closing {
		r.forgetLocked(c)
		delete(g.connections, c.ID())
	}
	g.mu.Unlock()
	for c := range closing {
		_ = c.Close()
	}
	return len(closing), nil
}
func (r *readManager) isRevoked(b ReadBinding) bool {
	epoch, err := canonicalU(b.Identity.AgentEpoch)
	return err != nil || epoch < r.floors[identityKey(b.Identity)]
}
func (r *readManager) forgetLocked(c *native.Conn) {
	if h := r.byConn[c.ID()]; h != "" {
		delete(r.sessions, h)
		delete(r.byConn, c.ID())
	}
	for id, p := range r.pending {
		if p.conn.ID() == c.ID() {
			delete(r.pending, id)
		}
	}
}
func (r *readManager) pruneLocked(now time.Time) {
	for id, p := range r.pending {
		if !now.Before(p.binding.Expires) {
			delete(r.pending, id)
		}
	}
	for id, s := range r.sessions {
		if !now.Before(s.binding.Expires) {
			delete(r.sessions, id)
			delete(r.byConn, s.conn.ID())
			_ = s.conn.Close()
		}
	}
}
