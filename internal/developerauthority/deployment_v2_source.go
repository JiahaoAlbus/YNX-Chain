package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"io"
	"net/http"
	"strconv"
	"time"
)

type originalDeploymentV2Role struct {
	Schema           string          `json:"schema"`
	Ref              DeploymentV2Ref `json:"ref"`
	Epoch            string          `json:"epoch"`
	KeyRole          string          `json:"keyRole"`
	SubjectOwner     string          `json:"subjectOwner"`
	NetworkID        string          `json:"networkId"`
	PKA              string          `json:"pkA"`
	PKB              string          `json:"pkB"`
	LedgerCurrentRef string          `json:"ledgerCurrentRef"`
	Status           string          `json:"status"`
	IssuedAtMS       int64           `json:"issuedAtMs"`
	ExpiresAtMS      int64           `json:"expiresAtMs"`
}
type originalDeploymentV2Project struct {
	Schema           string          `json:"schema"`
	Ref              DeploymentV2Ref `json:"ref"`
	Realm            string          `json:"realm"`
	Tenant           string          `json:"tenant"`
	Account          string          `json:"account"`
	CatalogProjectID string          `json:"catalogProjectId"`
	Publisher        DeploymentV2Ref `json:"publisher"`
	Issuer           DeploymentV2Ref `json:"issuer"`
	Permissions      []string        `json:"permissions"`
	ResourceRef      DeploymentV2Ref `json:"resourceRef"`
	LedgerCurrentRef string          `json:"ledgerCurrentRef"`
	Status           string          `json:"status"`
	IssuedAtMS       int64           `json:"issuedAtMs"`
	ExpiresAtMS      int64           `json:"expiresAtMs"`
}
type originalDeploymentV2Resource struct {
	Schema                   string                    `json:"schema"`
	Ref                      DeploymentV2Ref           `json:"ref"`
	Realm                    string                    `json:"realm"`
	Tenant                   string                    `json:"tenant"`
	Project                  DeploymentV2Ref           `json:"project"`
	ResourceID               string                    `json:"resourceId"`
	ResourceApprovalRef      string                    `json:"resourceApprovalRef"`
	ObjectKey                string                    `json:"objectKey"`
	Content                  DeploymentV2ObjectBinding `json:"content"`
	QuotaBytes               string                    `json:"quotaBytes"`
	RuntimeSeconds           int                       `json:"runtimeSeconds"`
	ResourceValidUntilMS     int64                     `json:"resourceValidUntilMs"`
	RequiresAdditionalCharge bool                      `json:"requiresAdditionalCharge"`
	LedgerCurrentRef         string                    `json:"ledgerCurrentRef"`
	Status                   string                    `json:"status"`
	IssuedAtMS               int64                     `json:"issuedAtMs"`
	ExpiresAtMS              int64                     `json:"expiresAtMs"`
}
type originalDeploymentV2ExecutionScope struct {
	Version                      string                    `json:"version"`
	Purpose                      string                    `json:"purpose"`
	RequestID                    string                    `json:"requestId"`
	PrincipalSHA256              string                    `json:"principalSHA256"`
	PayloadOriginal              string                    `json:"payloadOriginal"`
	PayloadBinding               DeploymentV2ObjectBinding `json:"payloadBinding"`
	MemberSHA256                 string                    `json:"memberSHA256"`
	ExpectedSlotRevision         string                    `json:"expectedSlotRevision"`
	RollbackTarget               string                    `json:"rollbackTarget"`
	ProjectOriginal              string                    `json:"projectOriginal"`
	PublisherOriginal            string                    `json:"publisherOriginal"`
	IssuerOriginal               string                    `json:"issuerOriginal"`
	ResourceOriginal             string                    `json:"resourceOriginal"`
	ExecuteApprovalScopeOriginal string                    `json:"executeApprovalScopeOriginal"`
}

func deploymentV2ASCII(s string) bool {
	if len(s) < 16 || len(s) > 128 {
		return false
	}
	for _, b := range []byte(s) {
		if b < 33 || b > 126 {
			return false
		}
	}
	return true
}
func deploymentV2U64(s string) bool {
	n, e := strconv.ParseUint(s, 10, 64)
	return e == nil && n != ^uint64(0) && strconv.FormatUint(n, 10) == s
}
func deploymentV2Headers(r *http.Request, in DeploymentV2ExecutionRequest) bool {
	if r == nil || r.Method != "POST" || r.URL == nil || r.URL.RawQuery != "" || r.URL.Fragment != "" {
		return false
	}
	id, ok := originalSingleHeader(r.Header, "Idempotency-Key")
	rev, rok := originalSingleHeader(r.Header, "X-Expected-Deployment-Revision")
	roll, rr := originalSingleHeader(r.Header, "X-Rollback-To")
	return ok && rok && id == in.RequestID && rev == in.ExpectedSlotRevision && ((!rr && in.RollbackTarget == "") || (rr && roll == in.RollbackTarget)) && deploymentV2ASCII(id) && deploymentV2U64(rev) && (in.RollbackTarget == "" || deploymentV2ASCII(in.RollbackTarget) && in.RollbackTarget != id)
}
func deploymentV2Binding(p Principal, in DeploymentV2ExecutionRequest) string {
	raw, _ := originalIDEJSON(map[string]string{"requestId": in.RequestID, "principalSHA256": objectHash(p), "payloadSHA256": hash(in.PayloadOriginal), "memberSHA256": hash(in.MemberOriginal), "expectedSlotRevision": in.ExpectedSlotRevision, "rollbackTarget": in.RollbackTarget})
	return hash(raw)
}
func deploymentV2Canonical(raw []byte, out any) bool {
	if len(raw) == 0 || len(raw) > 393216 || originalIDEStrict(raw, out) != nil {
		return false
	}
	var v any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if d.Decode(&v) != nil {
		return false
	}
	b, e := originalIDEJSON(v)
	return e == nil && bytes.Equal(b, raw)
}

// Normal constructor requires the ORIGINAL concrete Source13+Catalog pair.
// No interface/callback/ENV/decoded JSON can stand in for that owner.
func OpenOriginalDeploymentV2Authority(ctx context.Context, c *Catalog) (*DeploymentV2Authority, error) {
	if ctx == nil || ctx.Err() != nil || c == nil {
		return nil, ErrDenied
	}
	source, ok := c.source.(*OriginalIDEPublicationSourceOwner)
	if !ok {
		return nil, ErrDenied
	}
	a := &DeploymentV2Authority{catalog: c, source: source, permits: make(map[*DeploymentV2ExecutionPermit]bool), approvals: make(map[*DeploymentV2ExecuteApprovalHandoff]bool)}
	if source.config.Version != "YNX-IDE-PUBLICATION-SOURCE/v2" || source.verifier == nil || source.config.Templates["deployment-v2"].SourceID == "" || source.config.Templates["deployment-v2-read"].SourceID == "" {
		a.first = ErrDenied
		return a, ErrDenied
	}
	var e error
	a.approvalVerifier, e = OpenOriginalSourceVerifier(source.verifier.config)
	if e != nil {
		a.first = e
		return a, e
	}
	entryPinned := false
	for _, p := range source.verifier.config.SDKFiles {
		if p.Path == deploymentExecuteApprovalEntry {
			entryPinned = true
		}
	}
	if !entryPinned {
		a.first = ErrOriginalVerifierConfiguration
		return a, a.first
	}
	if e := source.AssertSourceCurrent(ctx); e != nil {
		a.first = e
		return a, e
	}
	return a, nil
}

// Only V2-owned pinner/permit/handoff children are retired. The original
// Source13/Catalog/DB are borrowed and never closed or disabled by this owner.
func (a *DeploymentV2Authority) Close() error {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return a.first
	}
	a.closed = true
	for p := range a.permits {
		p.closed = true
		p.ready = false
		p.partial.Closed = true
		p.partial.Ready = false
	}
	for h := range a.approvals {
		h.closed = true
		h.ready = false
		if h.store != nil {
			if e := h.store.Close(); e != nil && a.first == nil {
				a.first = e
			}
		}
	}
	if a.approvalVerifier != nil {
		if e := a.approvalVerifier.Close(); e != nil && a.first == nil {
			a.first = e
		}
	}
	return a.first
}
func (a *DeploymentV2Authority) principal(ctx context.Context, r *http.Request) (Principal, error) {
	if a == nil || a.source == nil || a.catalog == nil || ctx == nil || ctx.Err() != nil || a.closed || a.first != nil {
		return Principal{}, ErrDenied
	}
	return a.source.borrowOriginalDeploymentV2Principal(ctx, r)
}
func (a *DeploymentV2Authority) sourceScope(ctx context.Context, p Principal, in DeploymentV2ExecutionRequest) (*originalIDESourceRecord, originalDeploymentV2ExecutionScope, error) {
	var s originalDeploymentV2ExecutionScope
	o := a.source
	o.mu.Lock()
	defer o.mu.Unlock()
	r, e := o.record(ctx, "deployment-v2", p.Account, deploymentV2Binding(p, in))
	if e != nil {
		return r, s, e
	}
	if e = o.current(ctx, r); e != nil {
		return r, s, e
	}
	var selection struct {
		Association     json.RawMessage `json:"association"`
		ExpectedRequest json.RawMessage `json:"expectedRequest"`
		Host            string          `json:"originalHostStatePath"`
		Terminal        string          `json:"originalHostTerminalDirectory"`
		Scope           json.RawMessage `json:"cloudDeploymentExecutionV2"`
	}
	if originalIDEStrict(r.projection.Selection, &selection) != nil || !deploymentV2Canonical(selection.Scope, &s) {
		return r, s, ErrDenied
	}
	if s.Version != "ynx-cloud-deployment-execution-source/v2" || s.Purpose != DeploymentV2ExecutionSourcePurpose || s.RequestID != in.RequestID || s.PrincipalSHA256 != objectHash(p) || s.MemberSHA256 != hash(in.MemberOriginal) || s.ExpectedSlotRevision != in.ExpectedSlotRevision || s.RollbackTarget != in.RollbackTarget {
		return r, s, ErrDenied
	}
	payload, e := base64.RawURLEncoding.DecodeString(s.PayloadOriginal)
	if e != nil || base64.RawURLEncoding.EncodeToString(payload) != s.PayloadOriginal || !bytes.Equal(payload, in.PayloadOriginal) {
		return r, s, ErrDenied
	}
	if e = o.deploymentRegisteredCurrents(ctx, s); e != nil {
		return r, s, e
	}
	return r, s, nil
}
func deploymentV2Records(s originalDeploymentV2ExecutionScope, m DeploymentV2Manifest, p Principal, now int64) (originalDeploymentV2Project, originalDeploymentV2Resource, originalDeploymentV2Role, originalDeploymentV2Role, int64, error) {
	var j originalDeploymentV2Project
	var r originalDeploymentV2Resource
	var publisher, issuer originalDeploymentV2Role
	if !deploymentV2Canonical([]byte(s.ProjectOriginal), &j) || !deploymentV2Canonical([]byte(s.ResourceOriginal), &r) || !deploymentV2Canonical([]byte(s.PublisherOriginal), &publisher) || !deploymentV2Canonical([]byte(s.IssuerOriginal), &issuer) {
		return j, r, publisher, issuer, 0, ErrDenied
	}
	var approval struct {
		ExpiresAtMS int64 `json:"expiresAtMs"`
	}
	var ap map[string]json.RawMessage
	if json.Unmarshal([]byte(s.ExecuteApprovalScopeOriginal), &ap) != nil || json.Unmarshal(ap["expiresAtMs"], &approval.ExpiresAtMS) != nil {
		return j, r, publisher, issuer, 0, ErrDenied
	}
	if j.Schema != "ynx-registered-deployment-execution-project/v2" || r.Schema != "ynx-registered-deployment-execution-resource/v2" || publisher.Schema != "ynx-registered-deployment-role-original/v2" || issuer.Schema != publisher.Schema || j.Ref != m.Project || j.Account != p.Account || j.Realm != m.Realm || j.Tenant != m.Tenant || j.Publisher != m.Publisher || j.Issuer != m.Issuer || r.Ref != j.ResourceRef || r.Project != m.Project || r.Realm != m.Realm || r.Tenant != m.Tenant || r.Content != m.Artifact.Content || r.ObjectKey != m.Artifact.ObjectKey || len(j.Permissions) != 1 || j.Permissions[0] != DeploymentV2ExecutionAction || publisher.Ref != m.Publisher || publisher.Epoch != m.PublisherEpoch || issuer.Ref != m.Issuer || issuer.Epoch != m.IssuerEpoch || publisher.KeyRole != "deployment-release-v2" || issuer.KeyRole != "deployment-issuer-v2" || publisher.PKA == issuer.PKA || publisher.PKB == issuer.PKB || publisher.NetworkID != issuer.NetworkID || r.RuntimeSeconds < 6 || r.RuntimeSeconds > 300 || r.RequiresAdditionalCharge || !text(r.ResourceID) || !text(r.ResourceApprovalRef) || !text(j.CatalogProjectID) || !text(j.LedgerCurrentRef) || !text(r.LedgerCurrentRef) {
		return j, r, publisher, issuer, 0, ErrDenied
	}
	limit := p.ExpiresMS
	for _, v := range []struct {
		status          string
		issued, expires int64
	}{{j.Status, j.IssuedAtMS, j.ExpiresAtMS}, {r.Status, r.IssuedAtMS, r.ExpiresAtMS}, {publisher.Status, publisher.IssuedAtMS, publisher.ExpiresAtMS}, {issuer.Status, issuer.IssuedAtMS, issuer.ExpiresAtMS}} {
		if v.status != "active" || v.issued > now || v.expires <= now {
			return j, r, publisher, issuer, 0, ErrDenied
		}
		if v.expires < limit {
			limit = v.expires
		}
	}
	for _, end := range []int64{approval.ExpiresAtMS, r.ResourceValidUntilMS - int64(r.RuntimeSeconds)*1000 + 1} {
		if end < limit {
			limit = end
		}
	}
	if limit <= now {
		return j, r, publisher, issuer, 0, ErrDenied
	}
	return j, r, publisher, issuer, limit, nil
}
func deploymentV2Verify(s originalDeploymentV2ExecutionScope, in DeploymentV2ExecutionRequest, publisher originalDeploymentV2Role) error {
	network, e := hex.DecodeString(publisher.NetworkID)
	if e != nil || len(network) != 32 {
		return ErrDenied
	}
	a, e := base64.RawURLEncoding.DecodeString(publisher.PKA)
	if e != nil || len(a) != 2592 {
		return ErrDenied
	}
	b, e := base64.RawURLEncoding.DecodeString(publisher.PKB)
	if e != nil || len(b) != 64 {
		return ErrDenied
	}
	m, e := ynxbatch.DecodeDeploymentManifestV2DATA(in.PayloadOriginal, &s.PayloadBinding)
	if e != nil {
		return e
	}
	binding := ynxbatch.DeploymentManifestV2SigningBinding{NetworkID: network, SubjectOwner: publisher.SubjectOwner, PKA: a, PKB: b, PayloadOriginal: in.PayloadOriginal, PayloadBind: s.PayloadBinding, ArtifactBind: m.Artifact.Content}
	if _, e = ynxbatch.PrepareDeploymentManifestV2Signing(in.PayloadOriginal, in.ActualArtifact, binding); e != nil {
		return e
	}
	return ynxbatch.VerifyDeploymentManifestV2Member(in.MemberOriginal, binding)
}
func (a *DeploymentV2Authority) AuthorizeExecutionV2(ctx context.Context, r *http.Request, input DeploymentV2ExecutionRequest) (*DeploymentV2ExecutionPermit, error) {
	if a == nil || ctx == nil || ctx.Err() != nil || !deploymentV2Headers(r, input) || len(input.PayloadOriginal) == 0 || len(input.PayloadOriginal) > 16384 || len(input.MemberOriginal) == 0 || len(input.MemberOriginal) > 98304 || len(input.ActualArtifact) > 67108864 || len(input.ExecuteApprovalOriginal) == 0 || len(input.ExecuteApprovalOriginal) > PublicationEnvelopeLimit {
		return nil, ErrDenied
	}
	in := input
	in.PayloadOriginal = bytes.Clone(input.PayloadOriginal)
	in.MemberOriginal = bytes.Clone(input.MemberOriginal)
	in.ActualArtifact = bytes.Clone(input.ActualArtifact)
	in.ExecuteApprovalOriginal = bytes.Clone(input.ExecuteApprovalOriginal)
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.permits == nil || a.closed || a.first != nil {
		return nil, ErrDenied
	}
	permit := &DeploymentV2ExecutionPermit{owner: a, request: r, input: in, started: time.Now(), partial: DeploymentV2PermitPartial{Phase: "SELECTED", PayloadSHA256: hash(in.PayloadOriginal), MemberSHA256: hash(in.MemberOriginal), ExecuteApprovalSHA256: hash(in.ExecuteApprovalOriginal)}}
	a.permits[permit] = true
	fail := func(e error) (*DeploymentV2ExecutionPermit, error) {
		permit.first = e
		permit.partial.FailureCode = "DEPLOYMENT_EXECUTION_V2_DENIED"
		return permit, e
	}
	p, e := a.principal(ctx, r)
	if e != nil {
		return fail(e)
	}
	permit.principal = p
	record, s, e := a.sourceScope(ctx, p, in)
	permit.record = record
	if record != nil {
		permit.partial.SourceOriginalSHA256 = hash(record.original)
		permit.partial.CurrentOriginalSHA256 = hash(record.current)
	}
	if e != nil {
		return fail(e)
	}
	permit.scope = s
	for h := range a.approvals {
		if h.ready && !h.closed && bytes.Equal(h.original, in.ExecuteApprovalOriginal) {
			permit.approval = h
			break
		}
	}
	if permit.approval == nil {
		return fail(ErrDenied)
	}
	if e = a.approvalCurrentLocked(ctx, permit.approval); e != nil {
		return fail(e)
	}
	permit.sourceProjection = record.projection
	permit.partial.Phase = "SOURCE_CURRENT"
	manifest, e := ynxbatch.DecodeDeploymentManifestV2DATA(in.PayloadOriginal, &s.PayloadBinding)
	if e != nil {
		return fail(e)
	}
	project, resource, publisher, _, expires, e := deploymentV2Records(s, manifest, p, time.Now().UnixMilli())
	if e != nil {
		return fail(e)
	}
	access, e := a.catalog.CurrentProject(ctx, r, project.CatalogProjectID)
	if e != nil || access.Principal != p || !access.Publish || !access.Runtime || access.CurrentReference != project.LedgerCurrentRef {
		return fail(ErrDenied)
	}
	permit.access = access
	if access.ExpiresMS < expires {
		expires = access.ExpiresMS
	}
	if record.projection.Expires < expires {
		expires = record.projection.Expires
	}
	permit.expires = expires
	if e = deploymentV2Verify(s, in, publisher); e != nil {
		return fail(e)
	}
	permit.partial.Phase = "CORE_E11_AND_VERIFIED"
	permit.selection = DeploymentV2ExecutionSelection{RequestID: in.RequestID, Principal: p.Account, DeviceID: p.DeviceID, PublisherID: manifest.Publisher.ID, ResourceID: resource.ResourceID, ResourceApprovalRef: resource.ResourceApprovalRef, ExpectedSlotRevision: in.ExpectedSlotRevision, RollbackTarget: in.RollbackTarget, CatalogProjectID: project.CatalogProjectID, Manifest: manifest, ManifestBinding: s.PayloadBinding, ContentBinding: manifest.Artifact.Content, RuntimeSeconds: resource.RuntimeSeconds, ExpiresAt: time.UnixMilli(expires)}
	if e = a.recheckLocked(ctx, r, permit, false); e != nil {
		return fail(e)
	}
	permit.ready = true
	permit.partial.Ready = true
	permit.partial.Phase = "READY"
	return permit, nil
}
func (a *DeploymentV2Authority) recheckLocked(ctx context.Context, r *http.Request, p *DeploymentV2ExecutionPermit, needReady bool) error {
	if a == nil || ctx == nil || ctx.Err() != nil || a.closed || a.first != nil || p == nil || !a.permits[p] || p.owner != a || p.request != r || p.closed || p.first != nil || needReady && !p.ready || !deploymentV2Headers(r, p.input) {
		return ErrDenied
	}
	principal, e := a.principal(ctx, r)
	if e != nil || principal != p.principal {
		return ErrDenied
	}
	if e = a.catalog.RecheckProject(ctx, r, p.access); e != nil {
		return e
	}
	if e = a.approvalCurrentLocked(ctx, p.approval); e != nil {
		return e
	}
	record, s, e := a.sourceScope(ctx, principal, p.input)
	if record != nil {
		p.partial.CurrentOriginalSHA256 = hash(record.current)
	}
	if e != nil || record == nil || !originalIDESameSource(p.sourceProjection, record.projection) || s != p.scope {
		return ErrDenied
	}
	m, e := ynxbatch.DecodeDeploymentManifestV2DATA(p.input.PayloadOriginal, &s.PayloadBinding)
	if e != nil {
		return e
	}
	_, _, _, _, end, e := deploymentV2Records(s, m, principal, time.Now().UnixMilli())
	if e != nil {
		return e
	}
	if _, e = ynxbatch.AssertDeploymentArtifactV2DATA(p.input.PayloadOriginal, p.input.ActualArtifact); e != nil {
		return e
	}
	now := time.Now()
	if ctx.Err() != nil || now.UnixMilli() >= p.expires || now.UnixMilli() >= end || time.Since(p.started) >= time.Duration(p.expires-p.started.UnixMilli())*time.Millisecond {
		return ErrDenied
	}
	return nil
}
func (a *DeploymentV2Authority) RecheckExecutionV2(ctx context.Context, r *http.Request, p *DeploymentV2ExecutionPermit) error {
	if a == nil {
		return ErrDenied
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	e := a.recheckLocked(ctx, r, p, true)
	if e != nil && p != nil && a.permits[p] && p.first == nil {
		p.first = e
		p.ready = false
		p.partial.Ready = false
		p.partial.FailureCode = "DEPLOYMENT_EXECUTION_V2_CURRENT_CHANGED"
	}
	return e
}
func (a *DeploymentV2Authority) borrowArtifact(ctx context.Context, p *DeploymentV2ExecutionPermit) (io.Reader, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if e := a.recheckLocked(ctx, p.request, p, true); e != nil {
		return nil, e
	}
	return bytes.NewReader(p.input.ActualArtifact), nil
}

// Recovery is ACL/read-only. It NEVER consumes an execution approval, obtains
// a new permit, advances deployment journal, dispatches or reserves a resource.
func (a *DeploymentV2Authority) AuthorizeDeploymentV2Read(ctx context.Context, r *http.Request, op DeploymentV2OriginalOperation) error {
	if a == nil || ctx == nil || r == nil || r.Method != "GET" || !deploymentV2ASCII(op.RequestID) || !text(op.CatalogProjectID) || !text(op.ResourceID) {
		return ErrDenied
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	p, e := a.principal(ctx, r)
	if e != nil || p.Account != op.Principal {
		return ErrDenied
	}
	projectCurrent, e := a.recoverySource(ctx, p, op)
	if e != nil {
		return e
	}
	access, e := a.catalog.CurrentProject(ctx, r, op.CatalogProjectID)
	if e != nil || !access.Read || access.Principal != p || access.CurrentReference != projectCurrent {
		return ErrDenied
	}
	if e = a.source.AssertPrincipalCurrent(ctx, p); e != nil {
		return e
	}
	if e = a.catalog.RecheckProject(ctx, r, access); e != nil {
		return e
	}
	lastCurrent, e := a.recoverySource(ctx, p, op)
	if e != nil || lastCurrent != projectCurrent {
		return ErrDenied
	}
	if ctx.Err() != nil || time.Now().UnixMilli() >= min(p.ExpiresMS, access.ExpiresMS) {
		return ErrDenied
	}
	return nil
}
