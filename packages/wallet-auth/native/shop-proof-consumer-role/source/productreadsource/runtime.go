package productreadsource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os/exec"
	"path/filepath"
	"sort"
	"time"
)

type originalPin struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

// Independent reviewed production registration; never filled by public JSON,
// ENV, normal constructor parameters, LocalCaller or the Wallet WPC table.
type release struct {
	sourceID, applicationID, productID, platform, endpoint, spki, nodeOrigin, nodeSPKI, nativeChainID string
	enrollmentFrame, profileFrame, currentFrame                                                       string
	root, enrollment, profile, head, node, verifier, manifest, resource                               originalPin
	resourceRef                                                                                       string
	uid                                                                                               uint32
}

var originalProductReleases = []release{}

type resourceOrder struct {
	ProductID   string `json:"productId"`
	SourceOrder string `json:"sourceOrder"`
	Actor       string `json:"actor"`
	Role        string `json:"role"`
	StoreID     string `json:"storeId"`
}
type resourceOriginal struct {
	Version              int             `json:"version"`
	ProtectedResourceRef string          `json:"protectedResourceRef"`
	NetworkID            string          `json:"networkId"`
	Account              string          `json:"account"`
	Realm                string          `json:"realm"`
	Tenant               string          `json:"tenant"`
	Epoch                uint64          `json:"epoch"`
	Socket               string          `json:"socket"`
	Service              string          `json:"service"`
	PeerUID              uint32          `json:"peerUID"`
	PeerPID              int             `json:"peerPID"`
	Orders               []string        `json:"orders"`
	Bindings             []resourceOrder `json:"bindings"`
}
type previous struct {
	Sequence        uint64 `json:"sequence"`
	Floor           uint64 `json:"floor"`
	Head            string `json:"head"`
	TimeFloor       int64  `json:"timeFloor"`
	ExecutionHeight string `json:"executionHeight"`
}
type boundedOutput struct {
	bytes.Buffer
	limit int
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, ErrDenied
	}
	return b.Buffer.Write(p)
}
func (a *Authority) load(p originalPin) ([]byte, error) {
	if p.Bytes < 1 || p.Bytes > 256<<20 {
		return nil, ErrDenied
	}
	for _, h := range a.files.files {
		if h.path == p.Path {
			if h.digest != p.SHA256 || h.id == nil || h.id.Size() != p.Bytes {
				return nil, ErrDenied
			}
			if e := h.current(); e != nil {
				return nil, e
			}
			return bytes.Clone(h.raw), nil
		}
	}
	b, e := a.files.hold(p.Path, p.SHA256, p.Bytes)
	if e != nil || int64(len(b)) != p.Bytes {
		if e == nil {
			e = ErrDenied
		}
		return nil, e
	}
	return b, nil
}
func (a *Authority) runtime(ctx context.Context) (map[string]json.RawMessage, error) {
	r := a.release
	if filepath.Base(r.verifier.Path) != "original-auth-identity-source-verifier.mjs" || r.root.Bytes > 16384 || r.enrollment.Bytes > 393216 || r.profile.Bytes > 393216 || r.head.Bytes > 393216 || r.manifest.Bytes > 1048576 || r.resource.Bytes > 1048576 || r.verifier.Bytes > 131072 || r.node.Bytes > 134217728 {
		return nil, ErrDenied
	}
	if r.sourceID == "" || r.applicationID == "" || r.productID == "" || (r.platform != "linux" && r.platform != "macos" && r.platform != "windows") || r.endpoint == "" || r.spki == "" || r.uid != 0 {
		return nil, ErrNotSupplied
	}
	root, e := a.load(r.root)
	if e != nil {
		return nil, e
	}
	enrollment, e := a.load(r.enrollment)
	if e != nil {
		return nil, e
	}
	profile, e := a.load(r.profile)
	if e != nil {
		return nil, e
	}
	head, e := a.load(r.head)
	if e != nil {
		return nil, e
	}
	if _, e = a.load(r.node); e != nil {
		return nil, e
	}
	if _, e = a.load(r.verifier); e != nil {
		return nil, e
	}
	raw, e := a.load(r.manifest)
	if e != nil {
		return nil, e
	}
	var m struct {
		Version string        `json:"version"`
		Files   []originalPin `json:"files"`
	}
	if decode(raw, &m) != nil || m.Version != "YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1" || len(m.Files) == 0 || len(m.Files) > 4096 {
		return nil, ErrDenied
	}
	base := filepath.Dir(filepath.Dir(r.verifier.Path))
	seen := map[string]bool{}
	last := ""
	var total int64
	for _, p := range m.Files {
		if p.Path <= last || filepath.IsAbs(p.Path) || filepath.Clean(p.Path) != p.Path || p.Bytes < 1 || p.Bytes > 16<<20 {
			return nil, ErrDenied
		}
		file := filepath.Join(base, p.Path)
		rel, e := filepath.Rel(base, file)
		if e != nil || rel == ".." || len(rel) > 3 && rel[:3] == "../" {
			return nil, ErrDenied
		}
		last = p.Path
		total += p.Bytes
		if total > 256<<20 {
			return nil, ErrDenied
		}
		seen[p.Path] = true
		p.Path = file
		if _, e = a.load(p); e != nil {
			return nil, e
		}
	}
	for _, p := range []string{"package.json", "native/original-auth-identity-source-verifier.mjs", "native/original-auth-identity-source-v2-verifier.mjs", "native/original-auth-source-v2-dispatch.mjs", "native/original-wallet-product-source-contract.mjs"} {
		if !seen[p] {
			return nil, ErrNotSupplied
		}
	}
	before := previous{ExecutionHeight: "0"}
	if a.previous != nil {
		before = *a.previous
	}
	encoded, e := encodeOriginalSDKInput(r, root, enrollment, profile, head, before)
	if e != nil || len(encoded) > 2<<20 {
		return nil, ErrDenied
	}
	if e = a.files.current(); e != nil {
		return nil, e
	}
	call, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	cmd := exec.CommandContext(call, r.node.Path, r.verifier.Path)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "NODE_NO_WARNINGS=1"}
	cmd.Stdin = bytes.NewReader(encoded)
	out := &boundedOutput{limit: 2 << 20}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if cmd.Run() != nil {
		return nil, ErrDenied
	}
	if e = a.files.current(); e != nil {
		return nil, e
	}
	var result struct {
		Projection map[string]json.RawMessage `json:"projection"`
		CurrentRaw string                     `json:"currentRaw"`
	}
	if decode(out.Bytes(), &result) != nil || result.CurrentRaw == "" {
		return nil, ErrDenied
	}
	return result.Projection, nil
}
func (a *Authority) refresh(ctx context.Context) error {
	if ctx == nil {
		return ErrDenied
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	if a.parent == nil {
		return ErrDenied
	}
	if e := a.parent.Err(); e != nil {
		return e
	}
	p, e := a.runtime(ctx)
	if e != nil {
		return e
	}
	scope, next, expires, e := readOriginalSDKProjection(p, a.release)
	if e != nil {
		return e
	}
	resourceRaw, e := a.load(a.release.resource)
	if e != nil {
		return e
	}
	var resource resourceOriginal
	if decode(resourceRaw, &resource) != nil || validateResource(resource, scope) != nil {
		return ErrDenied
	}
	now := time.Now()
	until := time.UnixMilli(expires)
	if now.UnixMilli() < next.TimeFloor || !now.Before(until) {
		return ErrDenied
	}
	if until.After(now.Add(5 * time.Second)) {
		until = now.Add(5 * time.Second)
	} else {
		until = now.Add(until.Sub(now))
	}
	if e = a.files.current(); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	finger := map[string]any{}
	for _, k := range []string{"sourceId", "instanceId", "profileDigest", "subjectOwner", "subjectKeyVersion", "generation", "sequence", "floor", "head", "selection"} {
		finger[k] = p[k]
	}
	b, _ := json.Marshal(finger)
	sum := sha256.Sum256(b)
	f := hex.EncodeToString(sum[:])
	a.adoptOriginalObservation(scope, resource, f, now, until)
	a.previous = &next
	return nil
}

// Stable only across identical independently verified semantic observations.
// Every child still has its OWN immutable deadline; A->B->A never revives A.
func (a *Authority) adoptOriginalObservation(scope ScopeDATA, resource resourceOriginal, fingerprint string, now, until time.Time) {
	old := a.state.Load()
	observed := &semanticObservation{1}
	if old != nil && old.fingerprint == fingerprint && old.observation != nil {
		observed = old.observation
	}
	a.state.Store(&epoch{observation: observed, until: until, wallStart: now.UnixMilli(), scope: scope, resource: resource, fingerprint: fingerprint})
}
func validateResource(r resourceOriginal, s ScopeDATA) error {
	if r.Version != 1 || r.ProtectedResourceRef != s.ProtectedResourceRef || r.NetworkID != s.NetworkID || r.Account != s.Account || !token.MatchString(r.Realm) || !token.MatchString(r.Tenant) || r.Epoch == 0 || !filepath.IsAbs(r.Socket) || filepath.Clean(r.Socket) != r.Socket || !token.MatchString(r.Service) || r.PeerPID < 1 || len(r.Orders) == 0 || len(r.Orders) > 64 || len(r.Bindings) != len(r.Orders) || !sort.StringsAreSorted(r.Orders) {
		return ErrDenied
	}
	seen := map[string]bool{}
	for _, o := range r.Orders {
		if !token.MatchString(o) || seen[o] {
			return ErrDenied
		}
		seen[o] = true
	}
	seen = map[string]bool{}
	for _, b := range r.Bindings {
		if b.ProductID != "shop.order" || !token.MatchString(b.SourceOrder) || !token.MatchString(b.Actor) || (b.Role != "buyer" && b.Role != "seller") || !token.MatchString(b.StoreID) || seen[b.SourceOrder] || !scopeAllows(s, b.ProductID, b.SourceOrder) {
			return ErrDenied
		}
		seen[b.SourceOrder] = true
	}
	for _, o := range r.Orders {
		if !seen[o] {
			return ErrDenied
		}
	}
	return nil
}
