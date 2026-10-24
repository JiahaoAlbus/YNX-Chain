package developerauthority

// Normal factory continuation, not a new issuer/protocol or caller trust seam.
// Original Catalog remains the ACL owner; a successful artifact check alone
// never bypasses its independent resource approval and final ACL fences.
import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
)

var ErrOriginalPublicationNotSupplied = errors.New("original dedicated publication source not supplied")
var ErrOriginalResourceNotSupplied = errors.New("original independent resource approval producer not supplied")

type originalFactoryPublication struct {
	source, scope           []byte
	caller                  string
	selected                originalControlSourceProjection
	store                   *originalApprovalStore
	pending                 map[string]*originalFactoryArtifactApproval
	originals               [][]byte
	firstCause, closeResult error
	closed                  bool
}
type originalFactoryArtifactApproval struct {
	principal                            Principal
	access                               Access
	publisher                            Publisher
	binding                              ArtifactBinding
	manifest, request, result, signature []byte
	ref                                  string
	value                                VerifiedPublication
	attempts                             []*originalFactoryApprovalAttempt
	cause                                error
}
type originalFactoryApprovalAttempt struct {
	nonce         string
	before, after *originalApprovalRow
	raw           []byte
	cause         error
}

func (*originalFactoryPublication) String() string {
	return "originalFactoryPublication{original custody redacted}"
}
func (v *originalFactoryPublication) GoString() string { return v.String() }
func (*originalFactoryArtifactApproval) String() string {
	return "originalFactoryArtifactApproval{originals/UNKNOWN redacted}"
}
func (v *originalFactoryArtifactApproval) GoString() string { return v.String() }
func (v *originalFactoryPublication) close() error {
	if v == nil {
		return nil
	}
	if v.closed {
		return v.closeResult
	}
	v.closed = true
	if v.store != nil {
		v.closeResult = v.store.Close()
	}
	if v.closeResult == nil && v.firstCause != nil {
		v.closeResult = ErrUnknown
	}
	return v.closeResult
}
func selectedApprovalScope(s originalControlSourceProjection) ([]byte, error) {
	var selection struct {
		Authority struct {
			Scope string `json:"scopeOriginal"`
		} `json:"publicationApprovalAuthority"`
	}
	if json.Unmarshal(s.Selection, &selection) != nil || len(selection.Authority.Scope) == 0 || len(selection.Authority.Scope) > 16384 {
		return nil, ErrDenied
	}
	return []byte(selection.Authority.Scope), nil
}
func openOriginalFactoryPublication(ctx context.Context, db *sql.DB, c *OriginalProjectControlRuntime, source []byte, caller string) (*originalFactoryPublication, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || c == nil || c.db != db || !text(caller) || len(source) == 0 || len(source) > originalVerifierInputLimit {
		return nil, ErrDenied
	}
	var fields map[string]json.RawMessage
	var profile string
	var policy struct {
		Signature struct {
			Purpose string `json:"purpose"`
		} `json:"signatureContract"`
	}
	if json.Unmarshal(source, &fields) != nil || json.Unmarshal(fields["profileRaw"], &profile) != nil || profile == "" || json.Unmarshal(fields["policy"], &policy) != nil || policy.Signature.Purpose != "ide-publication-approval-authority-v1" {
		return nil, ErrDenied
	}
	v := &originalFactoryPublication{source: append([]byte(nil), source...), caller: caller, pending: map[string]*originalFactoryArtifactApproval{}}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closeSelected || c.firstCause != nil || c.verifier == nil || c.now == nil {
		v.firstCause = ErrUnknown
		return v, ErrUnknown
	}
	before := c.now()
	raw, e := c.verifier.InvokeOriginalCurrentDATA(ctx, v.source)
	if len(raw) > 0 {
		v.originals = append(v.originals, append([]byte(nil), raw...))
	}
	if e == nil {
		v.selected, e = controlSourceProjection(bytes.TrimSuffix(raw, []byte("\n")), before)
	}
	if e == nil && (v.selected.Profile != hash([]byte(profile)) || v.selected.Status != "active") {
		e = ErrDenied
	}
	if e == nil {
		v.scope, e = selectedApprovalScope(v.selected)
	}
	if e == nil && !v.peerMatches(v.selected, c.verifier.config) {
		e = ErrDenied
	}
	if e == nil {
		v.store, e = openOriginalApprovalStore(ctx, db, originalApprovalStoreConfig{v.selected.SourceID, v.selected.InstanceID, v.selected.Profile})
	}
	now := c.now().UnixMilli()
	if e == nil && (ctx.Err() != nil || now < before.UnixMilli() || now < v.selected.TimeFloor || now >= v.selected.Expires) {
		e = ErrUnknown
	}
	if e != nil {
		v.firstCause = e
	}
	return v, e
}

func (v *originalFactoryPublication) peerMatches(s originalControlSourceProjection, c OriginalSourceVerifierConfig) bool {
	var selection struct {
		Peer struct {
			Node  string `json:"nodeCodeIdentity"`
			SHA   string `json:"nodeSHA256"`
			Entry string `json:"entrySHA256"`
		} `json:"identityPeerBinding"`
	}
	if json.Unmarshal(s.Selection, &selection) != nil || selection.Peer.Node != v.caller || selection.Peer.SHA != c.Node.SHA256 {
		return false
	}
	for _, f := range c.SDKFiles {
		if f.Path == originalVerifierEntry {
			return selection.Peer.Entry == f.SHA256
		}
	}
	return false
}

// Compare the actual independent project Source to Catalog's same-call ACL
// result, not merely the display project id. Catalog still owns its SQL ACL.
func originalFactoryPublicationAccessMatches(s originalControlSourceProjection, a Access) bool {
	var selection struct {
		Authority struct {
			Project json.RawMessage `json:"project"`
		} `json:"projectAuthority"`
	}
	if json.Unmarshal(s.Selection, &selection) != nil {
		return false
	}
	var project, owner, origin, ref, revision, catalog string
	var read, publish, runtime bool
	var expiry int64
	return decodeExactObject(selection.Authority.Project, 4096, map[string]any{"projectId": &project, "ownerAccount": &owner, "runtimeOrigin": &origin, "currentReference": &ref, "projectRevision": &revision, "catalogRevision": &catalog, "read": &read, "publish": &publish, "runtime": &runtime, "expiresMS": &expiry}) == nil && project == a.ProjectID && owner == a.OwnerAccount && origin == a.RuntimeOrigin && ref == a.CurrentReference && revision == strconv.FormatUint(a.ProjectRevision, 10) && catalog == strconv.FormatUint(a.CatalogRevision, 10) && read == a.Read && publish == a.Publish && runtime == a.Runtime && a.ExpiresMS <= expiry
}

// Exact counterpart of the existing SDK scope. No resource fields or loose
// map aliases are accepted for artifact approval. Signed originals stay raw.
type originalFactoryArtifactScope struct {
	Version, Kind, Purpose, Source, Instance, Generation, Caller, Principal, Account, Device, Project, ProjectRevision, ProjectRef             string
	Publisher, PublicSHA, Registration, Revision, KeyVersion, Manifest, Artifact, ArtifactVersion, PublishPurpose, Target, Request, Invocation string
	Ref, Confirmation, Revocation                                                                                                              string
	Bytes, Approved, Expires                                                                                                                   int64
}

func parseOriginalFactoryArtifactScope(raw []byte) (originalFactoryArtifactScope, error) {
	var s originalFactoryArtifactScope
	e := decodeExactObject(raw, 16384, map[string]any{"version": &s.Version, "kind": &s.Kind, "sourcePurpose": &s.Purpose, "sourceId": &s.Source, "instanceId": &s.Instance, "generation": &s.Generation, "callerIdentity": &s.Caller, "principalSHA256": &s.Principal, "account": &s.Account, "deviceId": &s.Device, "projectId": &s.Project, "projectRevision": &s.ProjectRevision, "projectCurrentRef": &s.ProjectRef, "publisherId": &s.Publisher, "publisherPublicSHA256": &s.PublicSHA, "publisherRegistrationRef": &s.Registration, "publisherRevision": &s.Revision, "publisherKeyVersion": &s.KeyVersion, "manifestSHA256": &s.Manifest, "artifactSHA256": &s.Artifact, "artifactVersion": &s.ArtifactVersion, "publishPurpose": &s.PublishPurpose, "targetEnvironment": &s.Target, "byteSize": &s.Bytes, "originalRequestSHA256": &s.Request, "originalInvocationSHA256": &s.Invocation, "actualApprovalRef": &s.Ref, "confirmationRef": &s.Confirmation, "revocationRef": &s.Revocation, "approvedAtMs": &s.Approved, "expiresAtMs": &s.Expires})
	if e != nil || s.Version != "YNX-IDE-PUBLICATION-APPROVAL-SCOPE/v1" || s.Kind != "artifact" || s.Purpose != "ide-publication-approval-authority-v1" || !approvalUUID.MatchString(s.Ref) || !text(s.Confirmation) || !text(s.Revocation) || s.Approved <= 0 || s.Expires <= s.Approved || s.Expires-s.Approved > 30000 {
		return s, ErrDenied
	}
	return s, nil
}

// Read the existing SDK17 request contract, never manufacture a request id
// from approvalRef/hash. The dedicated verified scope binds ALL original bytes
// including its source-context requestDigest; do not replace that digest with
// a manifest hash or confuse the identity Source key with a publisher key.
func originalFactoryPublicationRequest(raw []byte, p Principal, now int64) (string, int64, error) {
	names := []string{"version", "algorithmVersion", "networkId", "owner", "keyVersion", "executionHeight", "principalId", "productId", "applicationId", "deviceId", "requestId", "purpose", "requestDigest", "credentialDigest", "nonce", "issuedAtMs", "expiresAtMs"}
	fields := map[string]any{}
	values := map[string]*string{}
	for _, k := range names {
		v := new(string)
		values[k] = v
		fields[k] = v
	}
	if decodeExactObject(raw, 16384, fields) != nil {
		return "", 0, ErrDenied
	}
	get := func(k string) string { return *values[k] }
	visible := func(s string, cap int) bool {
		if len(s) == 0 || len(s) > cap {
			return false
		}
		for _, b := range []byte(s) {
			if b < 0x21 || b > 0x7e {
				return false
			}
		}
		return true
	}
	owner := get("owner")
	var ownerBytes []byte
	if len(owner) == 42 && strings.HasPrefix(owner, "0x") {
		ownerBytes, _ = hex.DecodeString(owner[2:])
	}
	if get("version") != "YNX-AUTH-IDENTITY/v2" || get("algorithmVersion") != "YNX-BATCH/v0.1" || !approvalHex.MatchString(get("networkId")) || len(ownerBytes) != 20 || hex.EncodeToString(ownerBytes) != owner[2:] || get("principalId") != p.Account || !visible(get("principalId"), 512) || get("deviceId") != p.DeviceID || !visible(get("deviceId"), 512) || get("productId") != "developer" || get("applicationId") != "com.ynxweb4.developer.testnetpreview" || get("purpose") != "AUTH-PROTECTED-KEY-CALL" || !visible(get("requestId"), 128) || !approvalHex.MatchString(get("requestDigest")) || !approvalHex.MatchString(get("credentialDigest")) {
		return "", 0, ErrDenied
	}
	for _, k := range []string{"keyVersion", "executionHeight"} {
		n, e := strconv.ParseUint(get(k), 10, 64)
		if e != nil || strconv.FormatUint(n, 10) != get(k) || (k == "keyVersion" && n == 0) {
			return "", 0, ErrDenied
		}
	}
	nonce, e := base64.RawURLEncoding.Strict().DecodeString(get("nonce"))
	if e != nil || len(nonce) != 32 || bytes.Equal(nonce, make([]byte, 32)) || base64.RawURLEncoding.EncodeToString(nonce) != get("nonce") {
		return "", 0, ErrDenied
	}
	issued, ie := strconv.ParseInt(get("issuedAtMs"), 10, 64)
	expires, ee := strconv.ParseInt(get("expiresAtMs"), 10, 64)
	if ie != nil || ee != nil || strconv.FormatInt(issued, 10) != get("issuedAtMs") || strconv.FormatInt(expires, 10) != get("expiresAtMs") || issued < 0 || issued > 9007199254740991 || expires > 9007199254740991 || expires <= issued || expires-issued > 30000 || now < issued || now >= expires || expires > p.ExpiresMS {
		return "", 0, ErrDenied
	}
	sort.Strings(names)
	var canonical strings.Builder
	canonical.WriteByte('{')
	for i, k := range names {
		if i > 0 {
			canonical.WriteByte(',')
		}
		key, _ := originalApprovalTransportString(k)
		value, _ := originalApprovalTransportString(get(k))
		canonical.WriteString(key)
		canonical.WriteByte(':')
		canonical.WriteString(value)
	}
	canonical.WriteByte('}')
	if !bytes.Equal(raw, []byte(canonical.String())) {
		return "", 0, ErrDenied
	}
	return get("requestId"), expires, nil
}
func (r *originalFactoryArtifactApproval) scopeMatches(s originalFactoryArtifactScope, source originalControlSourceProjection, now int64) bool {
	original, e := decodeOriginalPublicationResult(r.result)
	_, requestExpiry, re := originalFactoryPublicationRequest(r.request, r.principal, now)
	return e == nil && re == nil && s.Expires <= requestExpiry && principalValid(r.principal, now) && r.access.Principal == r.principal && r.access.Publish && r.access.ExpiresMS > now && r.publisher.ExpiresMS > now && !r.publisher.Revoked && original.matchesPublisher(r.publisher) && bytes.Equal(original.signature, r.signature) && original.request == string(r.request) && original.manifest == string(r.manifest) && original.approval == r.ref &&
		s.Source == source.SourceID && s.Instance == source.InstanceID && s.Generation == strconv.FormatUint(source.Generation, 10) && s.Principal == objectHash(r.principal) && s.Account == r.principal.Account && s.Device == r.principal.DeviceID && s.Project == r.access.ProjectID && s.Project == r.binding.ProjectID && s.Project == r.publisher.ProjectID && s.ProjectRevision == strconv.FormatUint(r.access.ProjectRevision, 10) && s.ProjectRef == r.access.CurrentReference && s.Publisher == r.publisher.PublisherID && s.PublicSHA == r.publisher.PublicSHA256 && s.Registration == r.publisher.RegistrationRef && s.Revision == strconv.FormatUint(r.publisher.Revision, 10) && s.KeyVersion == original.keyVersion && s.Manifest == hash(r.manifest) && s.Artifact == r.binding.ContentDigest && s.ArtifactVersion == r.binding.Version && s.PublishPurpose == r.binding.PublishPurpose && s.Target == r.binding.TargetEnvironment && s.Bytes == r.binding.ByteSize && s.Request == hash(r.request) && s.Invocation == hash(r.manifest) && s.Ref == r.ref && now >= s.Approved && now < s.Expires && s.Expires <= r.principal.ExpiresMS && s.Expires <= r.access.ExpiresMS && s.Expires <= r.publisher.ExpiresMS && source.Expires > now && source.TimeFloor <= now
}
func originalFactoryApprovalInput(source, scope []byte, w *originalApprovalRow, nonce string) ([]byte, error) {
	if w == nil || !approvalNonce.MatchString(nonce) || !json.Valid(source) {
		return nil, ErrDenied
	}
	previous := `{"decision":` + strconv.Quote(w.decision) + `,"floor":` + strconv.Quote(strconv.FormatInt(w.floor, 10)) + `,"requestState":` + strconv.Quote(w.requestState) + `,"resultOriginalSHA256":` + strconv.Quote(w.resultSHA256) + `,"scopeSHA256":` + strconv.Quote(w.scope.digest) + `,"sequence":` + strconv.Quote(strconv.FormatInt(w.sequence, 10)) + `,"timeFloor":` + strconv.FormatInt(w.observedMS, 10) + `}`
	encoded, ok := originalApprovalTransportString(string(scope))
	if !ok {
		return nil, ErrDenied
	}
	return []byte(`{"expectedScopeOriginal":` + encoded + `,"nonce":"` + nonce + `","operation":"ide-publication-approval-current-native-node/v1","previous":` + previous + `,"source":` + string(source) + `}`), nil
}
func sameOriginalApprovalRow(a, b *originalApprovalRow) bool {
	return a != nil && b != nil && bytes.Equal(a.scope.original, b.scope.original) && a.scope.digest == b.scope.digest && a.scope.ref == b.scope.ref && a.scope.confirmation == b.scope.confirmation && a.scope.revocation == b.scope.revocation && a.scope.approvedMS == b.scope.approvedMS && a.scope.expiresMS == b.scope.expiresMS && a.sequence == b.sequence && a.floor == b.floor && a.decision == b.decision && a.requestState == b.requestState && a.stateSHA256 == b.stateSHA256 && a.resultSHA256 == b.resultSHA256 && bytes.Equal(a.resultOriginal, b.resultOriginal) && b.observedMS >= a.observedMS
}
func (v *originalFactoryPublication) rowMatches(r *originalFactoryArtifactApproval, w *originalApprovalRow, s originalFactoryArtifactScope, now int64) bool {
	return w != nil && w.valid(now) && bytes.Equal(w.scope.original, v.scope) && w.scope.ref == r.ref && w.scope.confirmation == s.Confirmation && w.scope.revocation == s.Revocation && w.scope.approvedMS == s.Approved && w.scope.expiresMS == s.Expires && w.decision == "approved" && (w.requestState == "signed-unhanded" || w.requestState == "returned") && bytes.Equal(w.resultOriginal, r.result) && w.resultSHA256 == hash(r.result)
}

// Called under original factory mutex. Each attempt is installed before nonce
// selection and retained through failure. A failed pending approval is sticky.
func (o *OriginalDeveloperSourceFactory) currentOriginalArtifactLocked(ctx context.Context, r *originalFactoryArtifactApproval) error {
	v := o.publication
	if v == nil || v.closed || v.firstCause != nil || v.store == nil {
		return ErrOriginalPublicationNotSupplied
	}
	if r.cause != nil {
		return r.cause
	}
	a := &originalFactoryApprovalAttempt{cause: ErrUnknown}
	r.attempts = append(r.attempts, a)
	fail := func(e error) error { a.cause = e; r.cause = e; return e }
	scope, e := parseOriginalFactoryArtifactScope(v.scope)
	if e != nil || !r.scopeMatches(scope, v.selected, o.control.now().UnixMilli()) {
		return fail(ErrDenied)
	}
	selection := o.publisher.publicationSelections[objectHash(r.principal)+":"+hash(r.signature)]
	if selection == nil || selection.mathematics == nil || selection.result != nil || !bytes.Equal(selection.signature, r.signature) || selection.mathematics.binding != r.binding || !bytes.Equal(selection.mathematics.manifest, r.manifest) || scope.Caller != v.caller {
		return fail(ErrDenied)
	}
	if e = o.recheckOriginalPublicationSelection(ctx, selection); e != nil {
		return fail(e)
	}
	if !originalFactoryPublicationAccessMatches(selection.first, r.access) || !originalFactoryPublicationAccessMatches(*o.publisher.lastProjectProjection, r.access) {
		return fail(ErrDenied)
	}
	a.before, e = v.store.observeOriginal(ctx, r.ref)
	if e != nil || !v.rowMatches(r, a.before, scope, o.control.now().UnixMilli()) {
		return fail(ErrDenied)
	}
	var challenge [32]byte
	if _, e = rand.Read(challenge[:]); e != nil || bytes.Equal(challenge[:], make([]byte, 32)) {
		return fail(ErrUnknown)
	}
	a.nonce = base64.RawURLEncoding.EncodeToString(challenge[:])
	input, e := originalFactoryApprovalInput(v.source, v.scope, a.before, a.nonce)
	if e != nil {
		return fail(e)
	}
	o.control.mu.Lock()
	before := o.control.now()
	raw, e := o.control.verifier.InvokeOriginalApprovalCurrentDATA(ctx, input)
	a.raw = append([]byte(nil), raw...)
	if e != nil {
		o.control.verifier.mu.Lock()
		a.raw = append([]byte(nil), o.control.verifier.processStdout...)
		o.control.verifier.mu.Unlock()
	}
	o.control.mu.Unlock()
	if e != nil {
		return fail(e)
	}
	var out struct {
		First      json.RawMessage `json:"sourceBefore"`
		Last       json.RawMessage `json:"sourceAfter"`
		Projection struct {
			Ready    bool   `json:"readyForSourceVerification"`
			Result   string `json:"resultOriginalSHA256"`
			Sequence string `json:"sequence"`
			Floor    string `json:"floor"`
			Decision string `json:"decision"`
			State    string `json:"requestState"`
			Expires  int64  `json:"expiresAtMs"`
		} `json:"projection"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return fail(ErrDenied)
	}
	first, e := controlSourceProjection(out.First, before)
	if e != nil {
		return fail(e)
	}
	last, e := controlSourceProjection(out.Last, before)
	if e != nil {
		return fail(e)
	}
	selected, e := selectedApprovalScope(last)
	if e != nil || !bytes.Equal(selected, v.scope) || !sameOriginalProjectSelection(first, last) || !v.peerMatches(first, o.control.verifier.config) || first.SourceID != v.selected.SourceID || first.InstanceID != v.selected.InstanceID || first.Profile != v.selected.Profile || first.Generation != v.selected.Generation || first.Owner != v.selected.Owner || first.KeyVersion != v.selected.KeyVersion || first.Principal != r.principal.Account || !out.Projection.Ready || out.Projection.Result != hash(r.result) || out.Projection.Sequence != strconv.FormatInt(a.before.sequence, 10) || out.Projection.Floor != strconv.FormatInt(a.before.floor, 10) || out.Projection.Decision != a.before.decision || out.Projection.State != a.before.requestState || first.Head != a.before.stateSHA256 {
		return fail(ErrDenied)
	}
	a.after, e = v.store.observeOriginal(ctx, r.ref)
	if e != nil || !sameOriginalApprovalRow(a.before, a.after) || !v.rowMatches(r, a.after, scope, o.control.now().UnixMilli()) {
		return fail(ErrUnknown)
	}
	if e = o.recheckOriginalPublicationSelection(ctx, selection); e != nil {
		return fail(e)
	}
	if !originalFactoryPublicationAccessMatches(*o.publisher.lastProjectProjection, r.access) {
		return fail(ErrUnknown)
	}
	now := o.control.now().UnixMilli()
	if ctx.Err() != nil || now < before.UnixMilli() || now < first.TimeFloor || now < last.TimeFloor || now >= first.Expires || now >= last.Expires || now >= out.Projection.Expires || !r.scopeMatches(scope, last, now) {
		return fail(ErrUnknown)
	}
	expiry := scope.Expires
	for _, x := range []int64{v.selected.Expires, first.Expires, last.Expires, out.Projection.Expires} {
		if x < expiry {
			expiry = x
		}
	}
	requestID, _, e := originalFactoryPublicationRequest(r.request, r.principal, now)
	if e != nil {
		return fail(ErrUnknown)
	}
	r.value = VerifiedPublication{Account: r.principal.Account, DeviceID: r.principal.DeviceID, RequestID: requestID, PublisherID: r.publisher.PublisherID, PublisherPublicSHA256: r.publisher.PublicSHA256, ProjectCurrentReference: r.access.CurrentReference, PrincipalSHA256: objectHash(r.principal), ManifestSHA256: hash(r.manifest), RequestSHA256: hash(r.request), ResultOriginalSHA256: hash(r.result), SignatureSHA256: hash(r.signature), ActualApprovalRef: r.ref, ConfirmationRef: scope.Confirmation, RevocationRef: scope.Revocation, PublisherRevision: r.publisher.Revision, ExpiresMS: expiry}
	a.cause = nil
	return nil
}
func (o *OriginalDeveloperSourceFactory) VerifyOriginalArtifactApproval(ctx context.Context, p Principal, a Access, k Publisher, b ArtifactBinding, manifest, request, result, signature []byte, ref string) (VerifiedPublication, error) {
	if o == nil || ctx == nil || ctx.Err() != nil || !approvalUUID.MatchString(ref) || len(manifest) == 0 || len(manifest) > 16384 || len(request) == 0 || len(request) > 16384 || len(result) == 0 || len(result) > 262144 || len(signature) == 0 || len(signature) > 100000 || len(k.PublicOriginal) == 0 || len(k.PublicOriginal) > 8192 {
		return VerifiedPublication{}, ErrDenied
	}
	r := &originalFactoryArtifactApproval{principal: p, access: a, publisher: k, binding: b, manifest: append([]byte(nil), manifest...), request: append([]byte(nil), request...), result: append([]byte(nil), result...), signature: append([]byte(nil), signature...), ref: ref}
	r.publisher.PublicOriginal = append([]byte(nil), k.PublicOriginal...)
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.publisherUsable() || o.publication == nil {
		return VerifiedPublication{}, ErrOriginalPublicationNotSupplied
	}
	v := o.publication
	scope, e := parseOriginalFactoryArtifactScope(v.scope)
	if e != nil || scope.Ref != ref {
		return VerifiedPublication{}, ErrDenied
	}
	if old := v.pending[ref]; old != nil {
		if old.principal != p || old.access != a || objectHash(old.publisher) != objectHash(k) || old.binding != b || !bytes.Equal(old.manifest, manifest) || !bytes.Equal(old.request, request) || !bytes.Equal(old.result, result) || !bytes.Equal(old.signature, signature) {
			return VerifiedPublication{}, ErrConflict
		}
		r = old
	} else {
		v.pending[ref] = r
	}
	if e := o.currentOriginalArtifactLocked(ctx, r); e != nil {
		return VerifiedPublication{}, e
	}
	return r.value, nil
}
func (o *OriginalDeveloperSourceFactory) AssertOriginalArtifactApprovalCurrent(ctx context.Context, p Principal, value VerifiedPublication) error {
	if o == nil || ctx == nil || ctx.Err() != nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.publisherUsable() || o.publication == nil {
		return ErrOriginalPublicationNotSupplied
	}
	r := o.publication.pending[value.ActualApprovalRef]
	if r == nil || r.principal != p || r.value != value || r.cause != nil || value.ExpiresMS <= o.control.now().UnixMilli() {
		return ErrDenied
	}
	old := r.value
	if e := o.currentOriginalArtifactLocked(ctx, r); e != nil {
		return e
	}
	if r.value.ExpiresMS > old.ExpiresMS {
		r.value.ExpiresMS = old.ExpiresMS
	}
	return nil
}

// There is no actual resource-result producer/capture in the original normal
// flow yet. Never alias artifact output/UUID/hash as resource approval. These
// required interface calls explicitly refuse commissioning and preserve it.
func (*OriginalDeveloperSourceFactory) VerifyOriginalResourceApproval(context.Context, Principal, VerifiedPublication) (ResourceApproval, error) {
	return ResourceApproval{}, ErrOriginalResourceNotSupplied
}
func (*OriginalDeveloperSourceFactory) AssertOriginalResourceApprovalCurrent(context.Context, Principal, ResourceApproval) error {
	return ErrOriginalResourceNotSupplied
}

var _ OriginalPublicationSource = (*OriginalDeveloperSourceFactory)(nil)
