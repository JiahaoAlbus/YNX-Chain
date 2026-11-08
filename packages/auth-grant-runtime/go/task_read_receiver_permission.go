//go:build darwin || linux

package grantruntime

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"sync"
	"time"
)

// Independently reviewed Root mapping. Profile/current are Root-controlled
// POSTBUILD public originals: their content hashes are not compiled into the
// image whose own vnode/hash appears in signed scope21 (no selfhash cycle).
type receiverLocatedOriginal struct {
	Parent receiverDirectory
	Leaf   string
}
type receiverRootIdentity struct {
	RootID    string `json:"rootId"`
	RootOwner string `json:"rootOwner"`
	NetworkID string `json:"networkId"`
}
type receiverNativeNode struct {
	Origin        string `json:"origin"`
	SPKI          string `json:"spki"`
	NativeChainID string `json:"nativeChainId"`
}
type receiverAuthorityRelease struct {
	Root, Enrollment, Node, Runner     protectedRef
	Profile, Head                      receiverLocatedOriginal
	Runtime                            []protectedRef
	Policy                             json.RawMessage
	RootIdentity                       receiverRootIdentity
	SubjectOwner, SourceID, InstanceID string
	ProcessUID                         uint32
	NativeNode                         receiverNativeNode
}
type receiverSourcePrevious struct {
	Sequence        uint64 `json:"sequence"`
	Floor           uint64 `json:"floor"`
	Head            string `json:"head"`
	TimeFloor       int64  `json:"timeFloor"`
	ExecutionHeight string `json:"executionHeight"`
}
type receiverScopeVersion struct {
	Authority      string `json:"authority"`
	Revision       string `json:"revision"`
	PolicyRevision string `json:"policyRevision"`
}
type receiverScopeProcess struct {
	PID   int    `json:"pid"`
	UID   uint32 `json:"uid"`
	GID   uint32 `json:"gid"`
	Start string `json:"start"`
	Image struct {
		Path   string `json:"path"`
		Bytes  int64  `json:"bytes"`
		SHA256 string `json:"sha256"`
	} `json:"image"`
}
type receiverScopeDirectory struct {
	Path   string `json:"path"`
	Device string `json:"device"`
	Inode  string `json:"inode"`
	UID    uint32 `json:"uid"`
	GID    uint32 `json:"gid"`
	Mode   uint32 `json:"mode"`
}
type receiverScopeRoute struct {
	Method       string `json:"method"`
	Path         string `json:"path"`
	MaxBodyBytes int64  `json:"maxBodyBytes"`
	TimeoutMS    int64  `json:"timeoutMS"`
}
type receiverScopeLimits struct {
	MaxHeaderBytes      int   `json:"maxHeaderBytes"`
	ReadHeaderTimeoutMS int64 `json:"readHeaderTimeoutMS"`
	ReadTimeoutMS       int64 `json:"readTimeoutMS"`
	WriteTimeoutMS      int64 `json:"writeTimeoutMS"`
	IdleTimeoutMS       int64 `json:"idleTimeoutMS"`
}

// Typed projection of the SOLE SDK exact scope21, never another encoder/parser
// of the E8/Root/N1 frames. The normal pinned runner invokes the sole verifier.
type receiverSignedScope struct {
	Version          uint32               `json:"version"`
	NetworkID        string               `json:"networkId"`
	SubjectOwner     string               `json:"subjectOwner"`
	SourceID         string               `json:"sourceId"`
	InstanceID       string               `json:"instanceId"`
	Authority        string               `json:"authority"`
	Realm            string               `json:"realm"`
	Tenant           string               `json:"tenant"`
	SourceVersion    receiverScopeVersion `json:"sourceVersion"`
	SourceProjection struct {
		Bytes  int    `json:"bytes"`
		SHA256 string `json:"sha256"`
	} `json:"sourceProjection"`
	ReceiverResource string                 `json:"receiverResource"`
	Namespace        string                 `json:"namespace"`
	Service          string                 `json:"service"`
	Local            receiverScopeProcess   `json:"local"`
	Peer             receiverScopeProcess   `json:"peer"`
	SocketParent     receiverScopeDirectory `json:"socketParent"`
	SocketLeaf       string                 `json:"socketLeaf"`
	Routes           []receiverScopeRoute   `json:"routes"`
	HTTPLimits       receiverScopeLimits    `json:"httpLimits"`
	IssuedMS         string                 `json:"issuedMS"`
	ExpiresMS        string                 `json:"expiresMS"`
}
type receiverSourceProjection struct {
	RootIdentity      receiverRootIdentity `json:"rootIdentityDATA"`
	Selection         json.RawMessage      `json:"selection"`
	PrincipalID       string               `json:"principalId"`
	SubjectOwner      string               `json:"subjectOwner"`
	SubjectKeyVersion string               `json:"subjectKeyVersion"`
	Generation        uint64               `json:"generation"`
	Sequence          uint64               `json:"sequence"`
	Floor             uint64               `json:"floor"`
	Head              string               `json:"head"`
	Status            string               `json:"status"`
	TimeFloor         int64                `json:"timeFloor"`
	ExpiresAtMS       int64                `json:"expiresAtMs"`
	ProfileDigest     string               `json:"profileDigest"`
	SourceID          string               `json:"sourceId"`
	InstanceID        string               `json:"instanceId"`
	ExecutionHeight   string               `json:"executionHeight"`
	DataOnly          bool                 `json:"dataOnly"`
	NativeAdmission   bool                 `json:"nativeAdmission"`
}
type receiverQualificationResult struct {
	Projection        receiverSourceProjection `json:"projection"`
	CurrentRaw        string                   `json:"currentRaw"`
	ScopeOriginal     string                   `json:"scopeOriginal"`
	ScopeHead         string                   `json:"scopeHead"`
	EffectExpiresAtMS int64                    `json:"effectExpiresAtMs"`
	DataOnly          bool                     `json:"dataOnly"`
	RootAdmission     bool                     `json:"RootAdmission"`
	SourceAdmission   bool                     `json:"SourceAdmission"`
	NativeAdmission   bool                     `json:"NativeAdmission"`
	ListenCapability  bool                     `json:"listenCapability"`
}
type receiverPermission struct {
	mu                           sync.Mutex
	owner                        *TaskReadReceiverRuntime
	row                          receiverAuthorityRelease
	files                        []*receiverFile
	originals                    [4]string
	previous                     receiverSourcePrevious
	projection                   receiverSourceProjection
	scope                        receiverSignedScope
	originalScope                string
	partial                      []byte
	diagnostic                   []byte
	ready, retired, busy, closed bool
	epoch                        uint64
	first, firstClose            error
	runtimeRoot                  string
}

const receiverSourcePurpose = "task-read-receiver-source-v1"
const receiverQualificationRunnerSHA256 = "6daec82a7bc430f000bb4c59f44c9691728f4e17cf5138d7206ec61fef3d3dcd"

var errReceiverPermission = errors.New("TASK_READ_RECEIVER_PURPOSE_SOURCE_DENIED")

func acquireReceiverPermission(ctx context.Context, r *TaskReadReceiverRuntime, uid uint32) (q *receiverPermission, err error) {
	q = &receiverPermission{owner: r, row: r.selection.Permission, previous: receiverSourcePrevious{ExecutionHeight: "0"}}
	defer func() {
		if err != nil {
			q.first = err
			q.retired = true
		}
	}()
	s := q.row
	if ctx == nil || s.ProcessUID != uint32(os.Geteuid()) || s.RootIdentity.RootID == "" || s.RootIdentity.RootOwner == "" || len(s.RootIdentity.NetworkID) != 64 || s.SubjectOwner == "" || s.SourceID == "" || s.InstanceID == "" || len(s.Runtime) == 0 || len(s.Runtime) > 4096 {
		return q, ErrTaskReadReceiverNotSupplied
	}
	if hex.EncodeToString(r.proof.projection.ChainID) != s.RootIdentity.NetworkID {
		return q, errReceiverPermission
	}
	var policy struct {
		RootDigest        string `json:"rootDigest"`
		EnrollmentDigest  string `json:"enrollmentDigest"`
		Endpoint          string `json:"endpoint"`
		SPKI              string `json:"spki"`
		ApplicationID     string `json:"applicationId"`
		ProductID         string `json:"productId"`
		Platform          string `json:"platform"`
		SignatureContract struct {
			Purpose         string `json:"purpose"`
			EnrollmentFrame string `json:"enrollmentFrame"`
			ProfileFrame    string `json:"profileFrame"`
			CurrentFrame    string `json:"currentFrame"`
		} `json:"signatureContract"`
	}
	if json.Unmarshal(s.Policy, &policy) != nil || policy.SignatureContract.Purpose != receiverSourcePurpose || policy.RootDigest != s.Root.SHA256 || policy.EnrollmentDigest != s.Enrollment.SHA256 || policy.SignatureContract.EnrollmentFrame == "" || policy.SignatureContract.ProfileFrame == "" || policy.SignatureContract.CurrentFrame == "" || policy.ApplicationID == "" || policy.ProductID == "" || (policy.Platform != "macos" && policy.Platform != "linux") || len(policy.SPKI) != 64 {
		return q, errReceiverPermission
	}
	wantPlatform := "linux"
	if runtime.GOOS == "darwin" {
		wantPlatform = "macos"
	}
	if policy.Platform != wantPlatform {
		return q, errReceiverPermission
	}
	u, e := url.Parse(policy.Endpoint)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return q, errReceiverPermission
	}
	if filepath.Base(s.Runner.Path) != "original-task-read-receiver-qualification-runner.mjs" || s.Runner.SHA256 != receiverQualificationRunnerSHA256 || filepath.Dir(s.Runner.Path) == "." {
		return q, errReceiverPermission
	}
	q.runtimeRoot = filepath.Dir(s.Runner.Path)
	hold := func(ref protectedRef, max int64, image bool) (*receiverFile, error) {
		h, e := openReceiverFile(ref, uid, max, image)
		if h != nil {
			q.files = append(q.files, h)
		}
		return h, e
	}
	root, e := hold(s.Root, 16384, false)
	if e != nil {
		return q, e
	}
	q.originals[0] = string(root.raw)
	enrollment, e := hold(s.Enrollment, 393216, false)
	if e != nil {
		return q, e
	}
	q.originals[1] = string(enrollment.raw)
	for i, p := range []receiverLocatedOriginal{s.Profile, s.Head} {
		h, e := holdReceiverLocatedFile(p.Parent, p.Leaf, uid, 393216)
		if h != nil {
			q.files = append(q.files, h)
		}
		if e != nil {
			return q, e
		}
		q.originals[i+2] = string(h.raw)
	}
	if _, e = hold(s.Node, 128<<20, true); e != nil {
		return q, e
	}
	if _, e = hold(s.Runner, 1<<20, false); e != nil {
		return q, e
	}
	required := map[string]bool{"original-auth-identity-source-verifier.mjs": false, "original-auth-identity-source-v2-verifier.mjs": false, "original-auth-source-v2-dispatch.mjs": false, "original-task-read-receiver-source-contract.mjs": false, "original-task-read-receiver-permission-collector.mjs": false, "original-ide-auth-proof-dispatch.mjs": false, "pq-wallet-policy.js": false, "pq-registered-member.js": false, "package.json": false}
	seen := map[string]bool{}
	var total int64
	for _, ref := range s.Runtime {
		if seen[ref.Path] || ref.Bytes < 1 || total > 384<<20-ref.Bytes {
			return q, errReceiverPermission
		}
		seen[ref.Path] = true
		total += ref.Bytes
		if _, e = hold(ref, 16<<20, false); e != nil {
			return q, e
		}
		if _, ok := required[filepath.Base(ref.Path)]; ok {
			required[filepath.Base(ref.Path)] = true
		}
	}
	for _, ok := range required {
		if !ok {
			return q, errReceiverPermission
		}
	}
	if !seen[filepath.Join(q.runtimeRoot, "original-auth-source-v2-dispatch.mjs")] || !seen[filepath.Join(q.runtimeRoot, "original-task-read-receiver-source-contract.mjs")] {
		return q, errReceiverPermission
	}
	for _, name := range []string{"original-auth-identity-source-verifier.mjs", "original-auth-identity-source-v2-verifier.mjs", "original-task-read-receiver-permission-collector.mjs", "original-ide-auth-proof-dispatch.mjs"} {
		if !seen[filepath.Join(q.runtimeRoot, name)] {
			return q, errReceiverPermission
		}
	}
	for _, name := range []string{"pq-wallet-policy.js", "pq-registered-member.js"} {
		if !seen[filepath.Join(filepath.Dir(q.runtimeRoot), "src", name)] {
			return q, errReceiverPermission
		}
	}
	if !seen[filepath.Join(filepath.Dir(q.runtimeRoot), "package.json")] {
		return q, errReceiverPermission
	}
	if e = q.current(ctx); e != nil {
		return q, e
	}
	return q, nil
}
func (r *TaskReadReceiverRuntime) expectedReceiverScope(row receiverAuthorityRelease) receiverSignedScope {
	p := r.record
	s := receiverSignedScope{Version: 1, NetworkID: row.RootIdentity.NetworkID, SubjectOwner: row.SubjectOwner, SourceID: row.SourceID, InstanceID: row.InstanceID, Authority: p.Authority, Realm: p.Realm, Tenant: p.Tenant, SourceVersion: receiverScopeVersion{p.SourceVersion.Authority, p.SourceVersion.Revision, p.SourceVersion.PolicyRevision}, ReceiverResource: p.Resource, Namespace: p.Namespace, Service: taskReadService, SocketParent: receiverScopeDirectory{p.SocketParent.Path, strconv.FormatUint(p.SocketParent.Device, 10), strconv.FormatUint(p.SocketParent.Inode, 10), p.SocketParent.UID, p.SocketParent.GID, p.SocketParent.Mode}, SocketLeaf: p.SocketLeaf, HTTPLimits: receiverScopeLimits{p.MaxHeaderBytes, p.ReadHeaderTimeoutMS, p.ReadTimeoutMS, p.WriteTimeoutMS, p.IdleTimeoutMS}, IssuedMS: p.IssuedMS, ExpiresMS: p.ExpiresMS}
	s.SourceProjection.Bytes = len(r.proof.held.raw)
	s.SourceProjection.SHA256 = digest(r.proof.held.raw)
	proc := func(v receiverProcess) receiverScopeProcess {
		out := receiverScopeProcess{PID: v.PID, UID: v.UID, GID: v.GID, Start: v.Start}
		out.Image.Path = v.Image.Path
		out.Image.Bytes = v.Image.Bytes
		out.Image.SHA256 = v.Image.SHA256
		return out
	}
	s.Local = proc(p.Local)
	s.Peer = proc(p.Peer)
	for _, v := range p.Routes {
		s.Routes = append(s.Routes, receiverScopeRoute{v.Method, v.Path, v.MaxBodyBytes, v.TimeoutMS})
	}
	return s
}
func (q *receiverPermission) physicalCurrent() error {
	if q.owner == nil || q.row.ProcessUID != uint32(os.Geteuid()) {
		return errReceiverPermission
	}
	if e := q.owner.source.Current(context.Background()); e != nil {
		return e
	}
	if e := q.owner.proof.current(context.Background()); e != nil {
		return e
	}
	if e := q.owner.registration.current(); e != nil {
		return e
	}
	for _, h := range q.files {
		if e := h.current(); e != nil {
			return e
		}
	}
	return nil
}
func (q *receiverPermission) request(previous receiverSourcePrevious) ([]byte, error) {
	r := q.owner
	source := map[string]any{"operation": "auth-source-v2-native-node/v1", "node": q.row.NativeNode, "rootRaw": q.originals[0], "enrollmentRaw": q.originals[1], "profileRaw": q.originals[2], "headRaw": q.originals[3], "policy": q.row.Policy, "previous": previous}
	task := map[string]any{"rootIdentity": q.row.RootIdentity, "subjectOwner": q.row.SubjectOwner, "authority": r.selection.Authority, "realm": r.selection.Realm, "tenant": r.selection.Tenant, "version": receiverScopeVersion{r.selection.SourceVersion.Authority, r.selection.SourceVersion.Revision, r.selection.SourceVersion.PolicyRevision}, "projectionOriginalB64": base64.RawURLEncoding.EncodeToString(r.proof.held.raw), "observedMS": r.proof.projection.Snapshot.ObservedAt, "expiresMS": r.proof.projection.Snapshot.Expires}
	return canonicalReceiverRequest(map[string]any{"source": source, "taskSource": task, "receiverRegistrationOriginal": string(r.registration.raw)})
}
func canonicalReceiverRequest(v any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	var plain any
	d := json.NewDecoder(bytes.NewReader(b.Bytes()))
	d.UseNumber()
	if err := d.Decode(&plain); err != nil {
		return nil, err
	}
	b.Reset()
	if err := e.Encode(plain); err != nil {
		return nil, err
	}
	raw := bytes.TrimSuffix(b.Bytes(), []byte("\n"))
	var out []byte
	for i := 0; i < len(raw); {
		if raw[i] == '\\' && i+1 < len(raw) {
			if i+6 <= len(raw) && (string(raw[i:i+6]) == "\\u2028" || string(raw[i:i+6]) == "\\u2029") {
				if raw[i+5] == '8' {
					out = append(out, 0xe2, 0x80, 0xa8)
				} else {
					out = append(out, 0xe2, 0x80, 0xa9)
				}
				i += 6
				continue
			}
			out = append(out, raw[i:i+2]...)
			i += 2
			continue
		}
		out = append(out, raw[i])
		i++
	}
	if len(out) > 4<<20 {
		return nil, errReceiverPermission
	}
	return out, nil
}

type receiverBoundedOutput struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *receiverBoundedOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		left := b.limit - b.Len()
		if left > 0 {
			b.Buffer.Write(p[:left])
		}
		b.overflow = true
		return 0, errReceiverPermission
	}
	return b.Buffer.Write(p)
}
func (q *receiverPermission) run(ctx context.Context, previous receiverSourcePrevious) (out receiverQualificationResult, partial []byte, err error) {
	input, e := q.request(previous)
	if e != nil {
		return out, nil, e
	}
	bounded, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, q.row.Node.Path, q.row.Runner.Path)
	cmd.Env = []string{}
	cmd.Stdin = bytes.NewReader(input)
	stdout, stderr := &receiverBoundedOutput{limit: 1 << 20}, &receiverBoundedOutput{limit: 16384}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err = cmd.Run()
	q.mu.Lock()
	q.diagnostic = append([]byte(nil), stderr.Bytes()...)
	q.mu.Unlock()
	partial = append([]byte(nil), stdout.Bytes()...)
	if err != nil || stdout.overflow || stderr.overflow {
		if ctx.Err() != nil {
			return out, partial, ctx.Err()
		}
		return out, partial, errors.Join(errReceiverPermission, err)
	}
	d := json.NewDecoder(bytes.NewReader(partial))
	d.DisallowUnknownFields()
	if d.Decode(&out) != nil || d.Decode(new(any)) != io.EOF {
		return out, partial, errReceiverPermission
	}
	return out, partial, nil
}
func (q *receiverPermission) current(ctx context.Context) error {
	if q == nil || ctx == nil {
		return errReceiverPermission
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	q.mu.Lock()
	if q.first != nil {
		e := q.first
		q.mu.Unlock()
		return e
	}
	if q.retired || q.closed || q.busy {
		q.mu.Unlock()
		return ErrTaskReadReceiverDraining
	}
	q.busy = true
	epoch := q.epoch
	previous := q.previous
	q.mu.Unlock()
	var result receiverQualificationResult
	var raw []byte
	err := q.physicalCurrent()
	if err == nil {
		result, raw, err = q.run(ctx, previous)
	}
	if err == nil {
		err = q.physicalCurrent()
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.busy = false
	if len(raw) > 0 {
		q.partial = append([]byte(nil), raw...)
	}
	if err != nil {
		if ctx.Err() == nil {
			q.first = err
			q.retired = true
		}
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if epoch != q.epoch || q.retired || q.closed {
		return ErrRetired
	}
	if err = q.accept(result, previous); err != nil {
		q.first = err
		q.retired = true
		return err
	}
	q.ready = true
	return nil
}
func (q *receiverPermission) accept(v receiverQualificationResult, previous receiverSourcePrevious) error {
	p := v.Projection
	row := q.row
	r := q.owner
	at := time.Now().UnixMilli()
	if !v.DataOnly || v.RootAdmission || v.SourceAdmission || v.NativeAdmission || v.ListenCapability || !p.DataOnly || p.NativeAdmission || p.Status != "active" || p.RootIdentity != row.RootIdentity || p.PrincipalID != row.SubjectOwner || p.SubjectOwner != row.SubjectOwner || p.SourceID != row.SourceID || p.InstanceID != row.InstanceID || p.SubjectKeyVersion == "" || p.Generation == 0 || p.Sequence == 0 || p.Floor > p.Sequence || p.Sequence < previous.Sequence || p.Floor < previous.Floor || p.TimeFloor < previous.TimeFloor || p.TimeFloor > at || p.ExpiresAtMS <= at || p.Head != v.ScopeHead || v.ScopeHead != digest([]byte(v.ScopeOriginal)) || v.CurrentRaw == "" || v.EffectExpiresAtMS <= at || v.EffectExpiresAtMS > p.ExpiresAtMS {
		return errReceiverPermission
	}
	height, e := exactUint(p.ExecutionHeight)
	if e != nil {
		return e
	}
	oldHeight, e := exactUint(previous.ExecutionHeight)
	if e != nil || height < oldHeight {
		return errReceiverPermission
	}
	if p.Sequence == previous.Sequence && previous.Head != "" && p.Head != previous.Head {
		return errReceiverPermission
	}
	var scope receiverSignedScope
	d := json.NewDecoder(bytes.NewReader([]byte(v.ScopeOriginal)))
	d.DisallowUnknownFields()
	if d.Decode(&scope) != nil || d.Decode(new(any)) != io.EOF {
		return errReceiverPermission
	}
	if !reflect.DeepEqual(scope, r.expectedReceiverScope(row)) {
		return errReceiverPermission
	}
	scopeEnd, e := exactUint(scope.ExpiresMS)
	if e != nil || uint64(v.EffectExpiresAtMS) > scopeEnd {
		return errReceiverPermission
	}
	sourceEnd, e := exactUint(r.proof.projection.Snapshot.Expires)
	if e != nil || uint64(v.EffectExpiresAtMS) > sourceEnd {
		return errReceiverPermission
	}
	keyVersion, e := exactUint(p.SubjectKeyVersion)
	if e != nil || keyVersion == 0 || p.Generation > 9007199254740991 || p.Sequence > 9007199254740991 {
		return errReceiverPermission
	}
	var selection struct {
		Association     json.RawMessage `json:"association"`
		ExpectedRequest json.RawMessage `json:"expectedRequest"`
		Scope           json.RawMessage `json:"taskReadReceiverV1"`
	}
	d = json.NewDecoder(bytes.NewReader(p.Selection))
	d.DisallowUnknownFields()
	if d.Decode(&selection) != nil || d.Decode(new(any)) != io.EOF || !bytes.Equal(selection.Scope, []byte(v.ScopeOriginal)) {
		return errReceiverPermission
	}
	if q.ready && (q.originalScope != v.ScopeOriginal || q.projection.ProfileDigest != p.ProfileDigest || q.projection.Generation != p.Generation || q.projection.SubjectKeyVersion != p.SubjectKeyVersion) {
		return errReceiverPermission
	}
	if len(p.ProfileDigest) != 64 || len(p.Head) != 64 {
		return errReceiverPermission
	}
	q.scope = scope
	q.originalScope = v.ScopeOriginal
	q.projection = p
	q.previous = receiverSourcePrevious{p.Sequence, p.Floor, p.Head, p.TimeFloor, p.ExecutionHeight}
	return nil
}
func (q *receiverPermission) retire() {
	if q == nil {
		return
	}
	q.mu.Lock()
	q.retired = true
	q.epoch++
	q.mu.Unlock()
}
func (q *receiverPermission) close() error {
	if q == nil {
		return nil
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.retired = true
	if q.closed {
		return q.firstClose
	}
	if q.busy {
		return ErrTaskReadReceiverDraining
	}
	for i := len(q.files) - 1; i >= 0; i-- {
		if e := q.files[i].close(); e != nil {
			if q.firstClose == nil {
				q.firstClose = e
			}
			return q.firstClose
		}
	}
	q.closed = true
	return q.firstClose
}
