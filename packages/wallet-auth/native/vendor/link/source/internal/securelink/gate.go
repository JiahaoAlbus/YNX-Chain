// Package securelink enforces service-edge policy on connections authenticated
// by the native S3 TLS endpoint. A transport identity never grants business or
// funds authority. HTTP headers and caller-supplied TLS snapshots are not inputs.
package securelink

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

var (
	ErrDenied      = errors.New("secure link: denied")
	ErrUnavailable = errors.New("secure link: authority unavailable")
	ErrRevoked     = errors.New("secure link: revoked")
	ErrExpired     = errors.New("secure link: expired")
	ErrReplay      = errors.New("secure link: replay or sequence mismatch")
	ErrBounds      = errors.New("secure link: bounds exceeded")
)

const (
	Group  = "SecP384r1MLKEM1024"
	Cipher = "TLS_AES_256_GCM_SHA384"
)

// Route is an exact HTTP method and escaped path. Wildcards are deliberately
// absent. Product owners translate typed business actions into these routes.
type Route struct{ Method, Path, Risk string }

// Root has an explicit end to its acceptance window. Two entries permit bounded
// rotation; replacing a policy immediately closes connections no longer trusted.
type Root struct {
	Fingerprint string
	Until       time.Time
}
type Edge struct {
	ID, LocalSAN, PeerSAN string
	Epoch                 uint64
	Roots                 []Root
	Routes                []Route
}
type Policy struct{ Edges []Edge }

type Peer struct {
	ServiceID, SubjectAltName, CertDigest, RootDigest, Edge string
	Epoch                                                   uint64
	Expires                                                 time.Time
}

type connectionRecord struct {
	peer Peer
	conn *native.Conn
}
type Gate struct {
	mu              sync.Mutex
	edges           map[string]Edge
	connections     map[native.ConnectionID]connectionRecord
	revokedCerts    map[string]bool
	revokedServices map[string]uint64
	read            *readManager
}

func NewGate(policy Policy) (*Gate, error) {
	edges, err := validatePolicy(policy)
	if err != nil {
		return nil, err
	}
	return &Gate{edges: edges, connections: make(map[native.ConnectionID]connectionRecord), revokedCerts: make(map[string]bool), revokedServices: make(map[string]uint64)}, nil
}

func validatePolicy(p Policy) (map[string]Edge, error) {
	if len(p.Edges) == 0 || len(p.Edges) > 256 {
		return nil, fmt.Errorf("%w: service edges", ErrBounds)
	}
	out := make(map[string]Edge, len(p.Edges))
	for _, e := range p.Edges {
		if e.ID == "" || !exactSAN(e.LocalSAN) || !exactSAN(e.PeerSAN) || e.Epoch == 0 || len(e.Roots) == 0 || len(e.Roots) > 2 || len(e.Routes) == 0 || len(e.Routes) > 4096 {
			return nil, fmt.Errorf("%w: invalid edge policy", ErrDenied)
		}
		if _, ok := out[e.ID]; ok {
			return nil, fmt.Errorf("%w: duplicate edge", ErrDenied)
		}
		roots := make(map[string]bool)
		for _, r := range e.Roots {
			if !digest(r.Fingerprint, 64) || r.Until.IsZero() || roots[r.Fingerprint] {
				return nil, fmt.Errorf("%w: explicit root fingerprint and window required", ErrDenied)
			}
			roots[r.Fingerprint] = true
		}
		routes := make(map[string]bool)
		for _, r := range e.Routes {
			if !validRoute(r) || routes[r.Method+" "+r.Path] {
				return nil, fmt.Errorf("%w: invalid or duplicate route", ErrDenied)
			}
			routes[r.Method+" "+r.Path] = true
		}
		e.Roots = append([]Root(nil), e.Roots...)
		e.Routes = append([]Route(nil), e.Routes...)
		out[e.ID] = e
	}
	return out, nil
}

func exactSAN(s string) bool {
	if len(s) == 0 || len(s) > 253 || strings.ContainsAny(s, "* /\\\x00\r\n\t:@") || s != strings.ToLower(s) || strings.HasSuffix(s, ".") {
		return false
	}
	for _, label := range strings.Split(s, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}
func digest(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func validRoute(r Route) bool {
	if r.Risk != "read" && r.Risk != "write" && r.Risk != "asset" {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch && r.Method != http.MethodDelete {
		return false
	}
	if r.Risk == "read" && r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	return len(r.Path) > 0 && r.Path[0] == '/' && !strings.ContainsAny(r.Path, "?#\r\n\x00") && !strings.Contains(r.Path, "//") && !strings.Contains(r.Path, "..")
}
func (e Edge) route(method, path string) (Route, bool) {
	for _, r := range e.Routes {
		if r.Method == method && r.Path == path {
			return r, true
		}
	}
	return Route{}, false
}

// AuthenticateServicePeer (LINK-01) derives all identity/negotiation evidence
// from a live native connection. Edge and operation come from trusted routing.
func (g *Gate) AuthenticateServicePeer(ctx context.Context, conn *native.Conn, edge, method, path string) (Peer, error) {
	if err := ctx.Err(); err != nil {
		return Peer{}, err
	}
	if conn == nil {
		return Peer{}, ErrDenied
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	s := conn.Snapshot()
	p, err := g.authenticateLocked(s, edge, method, path, time.Now())
	if err != nil {
		return Peer{}, err
	}
	if prior, ok := g.connections[conn.ID()]; ok && prior.peer.Edge != edge {
		return Peer{}, ErrDenied
	}
	if _, exists := g.connections[conn.ID()]; !exists && len(g.connections) >= 4096 {
		return Peer{}, ErrBounds
	}
	g.connections[conn.ID()] = connectionRecord{peer: p, conn: conn}
	return p, nil
}

// Only the native.Conn entry point above is exported. Synthetic State values in
// unit tests exercise policy logic, not a production identity injection API.
func (g *Gate) authenticateLocked(s native.State, edge, method, path string, now time.Time) (Peer, error) {
	e, ok := g.edges[edge]
	if !ok {
		return Peer{}, ErrDenied
	}
	if !s.Verified || !s.Mutual || !s.AllChainMLDSA87 || s.PeerSignature != "mldsa87" || s.Resumed || s.Protocol != "TLSv1.3" || s.Group != Group || s.Cipher != Cipher || s.LocalSAN != e.LocalSAN || s.PeerSAN != e.PeerSAN || !digest(s.PeerFingerprint, 64) {
		return Peer{}, ErrDenied
	}
	if _, ok := e.route(method, path); !ok {
		return Peer{}, ErrDenied
	}
	if !now.Before(s.NotAfter) {
		return Peer{}, ErrExpired
	}
	trusted := false
	for _, r := range e.Roots {
		if r.Fingerprint == s.RootFingerprint && now.Before(r.Until) {
			trusted = true
			break
		}
	}
	if !trusted {
		return Peer{}, ErrDenied
	}
	if g.revokedCerts[s.PeerFingerprint] || g.revokedServices[e.PeerSAN] >= e.Epoch {
		return Peer{}, ErrRevoked
	}
	return Peer{ServiceID: e.PeerSAN, SubjectAltName: s.PeerSAN, CertDigest: s.PeerFingerprint, RootDigest: s.RootFingerprint, Edge: edge, Epoch: e.Epoch, Expires: s.NotAfter}, nil
}

// ForgetConnection is called by server/transport close hooks. Handles and
// challenges belong to that exact connection and cannot outlive it.
func (g *Gate) ForgetConnection(conn *native.Conn) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.connections, conn.ID())
	if g.read != nil {
		g.read.forgetLocked(conn)
	}
}

// RevokeService is a trusted control-plane operation, never an HTTP handler.
// Epochs cannot decrease, and corresponding open connections are actively shut.
func (g *Gate) RevokeService(san string, epoch uint64) (int, error) {
	if !exactSAN(san) || epoch == 0 {
		return 0, ErrDenied
	}
	g.mu.Lock()
	if epoch < g.revokedServices[san] {
		g.mu.Unlock()
		return 0, ErrDenied
	}
	g.revokedServices[san] = epoch
	var closing []*native.Conn
	for c, r := range g.connections {
		if r.peer.SubjectAltName == san && r.peer.Epoch <= epoch {
			closing = append(closing, r.conn)
			delete(g.connections, c)
			if g.read != nil {
				g.read.forgetLocked(r.conn)
			}
		}
	}
	g.mu.Unlock()
	for _, c := range closing {
		_ = c.Close()
	}
	return len(closing), nil
}
func (g *Gate) RevokeCertificate(fingerprint string) (int, error) {
	if !digest(fingerprint, 64) {
		return 0, ErrDenied
	}
	g.mu.Lock()
	g.revokedCerts[fingerprint] = true
	var closing []*native.Conn
	for c, r := range g.connections {
		if r.peer.CertDigest == fingerprint {
			closing = append(closing, r.conn)
			delete(g.connections, c)
			if g.read != nil {
				g.read.forgetLocked(r.conn)
			}
		}
	}
	g.mu.Unlock()
	for _, c := range closing {
		_ = c.Close()
	}
	return len(closing), nil
}

func (g *Gate) ReplacePolicy(policy Policy) error {
	edges, err := validatePolicy(policy)
	if err != nil {
		return err
	}
	g.mu.Lock()
	for id, old := range g.edges {
		if e, ok := edges[id]; ok && e.Epoch <= old.Epoch {
			g.mu.Unlock()
			return fmt.Errorf("%w: policy epoch must advance", ErrDenied)
		}
	}
	g.edges = edges
	// Policy/action changes invalidate every affected connection and read handle.
	closing := make([]*native.Conn, 0, len(g.connections))
	for _, record := range g.connections {
		closing = append(closing, record.conn)
		if g.read != nil {
			g.read.forgetLocked(record.conn)
		}
	}
	g.connections = make(map[native.ConnectionID]connectionRecord)
	g.mu.Unlock()
	for _, c := range closing {
		_ = c.Close()
	}
	return nil
}

func canonicalU(s string) (uint64, error) {
	if s == "" || len(s) > 20 || (len(s) > 1 && s[0] == '0') {
		return 0, ErrDenied
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, ErrDenied
		}
	}
	u, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, ErrBounds
	}
	return u, nil
}
