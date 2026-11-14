package developerauthority

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"net/http"
	"time"
)

const deploymentExecuteApprovalEntry = "scripts/original-cloud-deployment-execution-approval-v2.mjs"

type DeploymentV2ExecuteApprovalHandoff struct {
	owner                    *DeploymentV2Authority
	request                  *http.Request
	input                    DeploymentV2ExecutionRequest
	principal                Principal
	record                   *originalIDESourceRecord
	scope                    originalDeploymentV2ExecutionScope
	store                    *originalApprovalStore
	query                    *originalApprovalQueryDATA
	original, processPartial []byte
	ready, closed            bool
	first                    error
	phase                    string
	started                  time.Time
}

// Actual public signed partial survives late failure. Returning its bytes is
// never a ready permit; Authorize still requires the SAME live owned handoff.
func (h *DeploymentV2ExecuteApprovalHandoff) CopyOriginalPublicPartial() []byte {
	if h == nil || h.owner == nil {
		return nil
	}
	h.owner.mu.Lock()
	defer h.owner.mu.Unlock()
	if !h.owner.approvals[h] {
		return nil
	}
	return bytes.Clone(h.original)
}

func (h *DeploymentV2ExecuteApprovalHandoff) Original() []byte {
	if h == nil || h.owner == nil {
		return nil
	}
	h.owner.mu.Lock()
	defer h.owner.mu.Unlock()
	if !h.owner.approvals[h] || !h.ready || h.closed || h.first != nil {
		return nil
	}
	return bytes.Clone(h.original)
}
func (h *DeploymentV2ExecuteApprovalHandoff) Close() error {
	if h == nil || h.owner == nil {
		return ErrDenied
	}
	h.owner.mu.Lock()
	defer h.owner.mu.Unlock()
	if !h.owner.approvals[h] {
		return ErrDenied
	}
	if !h.closed {
		h.closed = true
		h.ready = false
		if h.store != nil {
			if e := h.store.Close(); e != nil && h.first == nil {
				h.first = e
			}
		}
	}
	return h.first
}
func (h *DeploymentV2ExecuteApprovalHandoff) Status() DeploymentV2PermitPartial {
	if h == nil || h.owner == nil {
		return DeploymentV2PermitPartial{FailureCode: "DENIED"}
	}
	h.owner.mu.Lock()
	defer h.owner.mu.Unlock()
	if !h.owner.approvals[h] {
		return DeploymentV2PermitPartial{FailureCode: "DENIED"}
	}
	code := ""
	if h.first != nil {
		code = "EXECUTE_APPROVAL_HANDOFF_UNKNOWN"
	}
	return DeploymentV2PermitPartial{Phase: h.phase, FailureCode: code, ExecuteApprovalSHA256: hash(h.original), Ready: h.ready, Closed: h.closed}
}
func deploymentApprovalOutput(raw []byte, _ time.Time) string {
	var version, result, code string
	var data, authorized bool
	if !bytes.HasSuffix(raw, []byte("\n")) || decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), 1048576, map[string]any{"version": &version, "resultOriginal": &result, "errorCode": &code, "dataOnly": &data, "authorized": &authorized}) != nil || version != "YNX-CLOUD-DEPLOYMENT-EXECUTE-APPROVAL-RESULT/v2" || result == "" || code != "" || !data || authorized {
		return "EXECUTE_APPROVAL_OUTPUT"
	}
	return ""
}
func (o *OriginalSourceVerifierOwner) invokeDeploymentApproval(ctx context.Context, input []byte) ([]byte, error) {
	// Never relabel an earlier attempt's stdout as this attempt's partial when
	// custody fails before a new child can start. This pinner is V2-owned.
	o.mu.Lock()
	o.processStdout = nil
	o.processStderr = nil
	o.mu.Unlock()
	out, e := o.invokePinnedOriginalDATA(ctx, input, 1048576, false, deploymentApprovalOutput, deploymentExecuteApprovalEntry)
	if e != nil {
		o.mu.Lock()
		out = bytes.Clone(o.processStdout)
		o.mu.Unlock()
	}
	return out, e
}
func deploymentApprovalResult(raw []byte) []byte {
	var e struct {
		Original string `json:"resultOriginal"`
	}
	if json.Unmarshal(raw, &e) != nil || len(e.Original) > 393216 {
		return nil
	}
	return []byte(e.Original)
}

// Server-side producer; no caller bytes supply approval. Independent protected
// review + dedicated registered current-role signature are mandatory in the
// fixed SDK producer. It is NOT enough that a Source profile says approved.
// Query/handoff once belongs Auth; P04's execution journal/slot is untouched.
func (a *DeploymentV2Authority) AcquireOriginalDeploymentV2ExecuteApproval(ctx context.Context, r *http.Request, input DeploymentV2ExecutionRequest) (*DeploymentV2ExecuteApprovalHandoff, error) {
	if a == nil || ctx == nil || ctx.Err() != nil || !deploymentV2Headers(r, input) || len(input.ExecuteApprovalOriginal) != 0 || len(input.PayloadOriginal) == 0 || len(input.PayloadOriginal) > 16384 || len(input.MemberOriginal) == 0 || len(input.MemberOriginal) > 98304 || len(input.ActualArtifact) > 67108864 {
		return nil, ErrDenied
	}
	in := input
	in.PayloadOriginal = bytes.Clone(input.PayloadOriginal)
	in.MemberOriginal = bytes.Clone(input.MemberOriginal)
	in.ActualArtifact = bytes.Clone(input.ActualArtifact)
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || a.first != nil || a.approvals == nil {
		return nil, ErrDenied
	}
	h := &DeploymentV2ExecuteApprovalHandoff{owner: a, request: r, input: in, phase: "SELECTED", started: time.Now()}
	a.approvals[h] = true
	fail := func(e error) (*DeploymentV2ExecuteApprovalHandoff, error) { h.first = e; h.ready = false; return h, e }
	p, e := a.principal(ctx, r)
	if e != nil {
		return fail(e)
	}
	h.principal = p
	record, s, e := a.sourceScope(ctx, p, in)
	h.record = record
	h.scope = s
	if e != nil {
		return fail(e)
	}
	var scope struct {
		ActualApprovalRef string `json:"actualApprovalRef"`
		ConfirmationRef   string `json:"confirmationRef"`
		RevocationRef     string `json:"revocationRef"`
		IssuedAtMS        int64  `json:"issuedAtMs"`
		ExpiresAtMS       int64  `json:"expiresAtMs"`
	}
	if json.Unmarshal([]byte(s.ExecuteApprovalScopeOriginal), &scope) != nil || !approvalUUID.MatchString(scope.ActualApprovalRef) || !text(scope.ConfirmationRef) || !text(scope.RevocationRef) {
		return fail(ErrDenied)
	}
	m, e := ynxDeploymentV2Decode(in.PayloadOriginal, s.PayloadBinding)
	if e != nil {
		return fail(e)
	}
	project, _, publisher, _, _, e := deploymentV2Records(s, m, p, time.Now().UnixMilli())
	if e != nil {
		return fail(e)
	}
	access, e := a.catalog.CurrentProject(ctx, r, project.CatalogProjectID)
	if e != nil || access.Principal != p || !access.Publish || !access.Runtime || access.CurrentReference != project.LedgerCurrentRef {
		return fail(ErrDenied)
	}
	if e = deploymentV2Verify(s, in, publisher); e != nil {
		return fail(e)
	}
	// Selection is NOT approval and touches NO P04 execution slot. Reserve the
	// original Auth handoff before any role signature can exist; changing nonce,
	// profile bytes or approval UUID cannot retry this original request after UNKNOWN.
	template := a.source.config.Templates["deployment-v2"]
	var selected string
	e = a.source.db.QueryRowContext(ctx, `INSERT INTO public.auth_ide_deployment_v2_handoffs(source_id,instance_id,request_id,scope_sha256,member_sha256,phase) VALUES($1,$2,$3,$4,$5,'entered') ON CONFLICT DO NOTHING RETURNING request_id`, template.SourceID, template.InstanceID, in.RequestID, hash([]byte(s.ExecuteApprovalScopeOriginal)), hash(in.MemberOriginal)).Scan(&selected)
	if e != nil || selected != in.RequestID {
		if e == sql.ErrNoRows {
			return fail(ErrConflict)
		}
		return fail(ErrUnknown)
	}
	h.phase = "DURABLE_HANDOFF_ENTERED"
	var nonce [32]byte
	if _, e = rand.Read(nonce[:]); e != nil {
		return fail(e)
	}
	t := a.source.config.Templates["deployment-v2"]
	store, e := openOriginalApprovalStore(ctx, a.source.db, originalApprovalStoreConfig{t.SourceID, t.InstanceID, record.profile})
	h.store = store
	if e != nil {
		return fail(e)
	}
	q, e := prepareOriginalDeploymentV2ApprovalQuery(ctx, store, originalApprovalScopeDATA{[]byte(s.ExecuteApprovalScopeOriginal), hash([]byte(s.ExecuteApprovalScopeOriginal)), scope.ActualApprovalRef, scope.ConfirmationRef, scope.RevocationRef, scope.IssuedAtMS, scope.ExpiresAtMS}, record.digest, in.MemberOriginal, base64.RawURLEncoding.EncodeToString(nonce[:]))
	h.query = q
	if e != nil {
		return fail(e)
	}
	h.phase = "ORIGINAL_QUERY_SIGNING_SELECTED"
	now := time.Now().UnixMilli()
	current, _ := originalIDEJSON(map[string]any{"version": "YNX-CLOUD-DEPLOYMENT-EXECUTE-APPROVAL-CURRENT/v2", "kind": "deployment-execute-v2", "scopeSHA256": hash([]byte(s.ExecuteApprovalScopeOriginal)), "actualApprovalRef": scope.ActualApprovalRef, "confirmationRef": scope.ConfirmationRef, "revocationRef": scope.RevocationRef, "decision": "approved", "requestState": "signed-unhanded", "resultOriginalSHA256": hash(in.MemberOriginal), "sequence": "2", "floor": "0", "nonce": base64.RawURLEncoding.EncodeToString(nonce[:]), "issuedAtMs": now, "expiresAtMs": min(now+30000, scope.ExpiresAtMS)})
	previous := map[string]any{"sequence": "0", "floor": "0", "timeFloor": int64(0)}
	call, _ := originalIDEJSON(map[string]any{"operation": "cloud-deployment-execute-approval-issue/v2", "profileDigest": record.profile, "currentOriginal": string(current), "previous": previous})
	out, e := a.approvalVerifier.invokeDeploymentApproval(ctx, call)
	h.processPartial = bytes.Clone(out)
	h.original = deploymentApprovalResult(out)
	h.phase = "ISSUER_RETURNED_PARTIAL"
	if e != nil {
		return fail(e)
	}
	var envelope struct {
		Scope   string `json:"scopeOriginal"`
		Current string `json:"currentOriginal"`
	}
	if json.Unmarshal(h.original, &envelope) != nil || envelope.Scope != s.ExecuteApprovalScopeOriginal || envelope.Current != string(current) {
		return fail(ErrDenied)
	}
	// Independent verification re-observes the real registered current role and
	// BOTH Source fences; process success is not accepted as a granting boolean.
	verify, _ := originalIDEJSON(map[string]any{"operation": "cloud-deployment-execute-approval-verify/v2", "source": a.source.sourceInput(record), "envelopeOriginal": string(h.original), "scopeOriginal": s.ExecuteApprovalScopeOriginal, "nonce": base64.RawURLEncoding.EncodeToString(nonce[:]), "previous": previous})
	verified, e := a.approvalVerifier.invokeDeploymentApproval(ctx, verify)
	h.processPartial = bytes.Clone(verified)
	if e != nil {
		return fail(e)
	}
	var verification struct {
		Signature  bool   `json:"signatureVerified"`
		Ready      bool   `json:"readyForSourceVerification"`
		Scope      string `json:"scopeSHA256"`
		Envelope   string `json:"envelopeSHA256"`
		Authorized bool   `json:"authorized"`
	}
	if json.Unmarshal(deploymentApprovalResult(verified), &verification) != nil || !verification.Signature || !verification.Ready || verification.Authorized || verification.Scope != hash([]byte(s.ExecuteApprovalScopeOriginal)) || verification.Envelope != hash(h.original) {
		return fail(ErrDenied)
	}
	q.envelopeOriginal = bytes.Clone(h.original)
	q.envelopeSHA256 = hash(h.original)
	if e = store.completeQuery(ctx, q, h.original); e != nil {
		return fail(e)
	}
	var completed []byte
	var completedHash string
	e = a.source.db.QueryRowContext(ctx, `UPDATE public.auth_ide_deployment_v2_handoffs SET phase='terminal',original=$6,original_sha256=$7 WHERE source_id=$1 AND instance_id=$2 AND request_id=$3 AND scope_sha256=$4 AND member_sha256=$5 AND phase='entered' RETURNING original,original_sha256`, template.SourceID, template.InstanceID, in.RequestID, hash([]byte(s.ExecuteApprovalScopeOriginal)), hash(in.MemberOriginal), h.original, hash(h.original)).Scan(&completed, &completedHash)
	if e != nil || !bytes.Equal(completed, h.original) || completedHash != hash(h.original) {
		return fail(ErrUnknown)
	}
	h.phase = "DURABLE_HANDOFF"
	h.ready = true
	if e = a.approvalCurrentLocked(ctx, h); e != nil {
		return fail(e)
	}
	return h, nil
}
func (a *DeploymentV2Authority) approvalCurrentLocked(ctx context.Context, h *DeploymentV2ExecuteApprovalHandoff) error {
	if h == nil || !a.approvals[h] || h.owner != a || h.closed || h.first != nil || !h.ready || h.store == nil || h.query == nil {
		return ErrDenied
	}
	if e := h.store.assertCompletedCurrent(ctx, h.query); e != nil {
		return e
	}
	var saved []byte
	var savedHash, phase string
	t := a.source.config.Templates["deployment-v2"]
	if e := a.source.db.QueryRowContext(ctx, `SELECT original,original_sha256,phase FROM public.auth_ide_deployment_v2_handoffs WHERE source_id=$1 AND instance_id=$2 AND request_id=$3`, t.SourceID, t.InstanceID, h.input.RequestID).Scan(&saved, &savedHash, &phase); e != nil || phase != "terminal" || savedHash != hash(h.original) || !bytes.Equal(saved, h.original) {
		return ErrDenied
	}
	p, e := a.principal(ctx, h.request)
	if e != nil || p != h.principal {
		return ErrDenied
	}
	r, s, e := a.sourceScope(ctx, p, h.input)
	if e != nil || s != h.scope || !originalIDESameSource(h.record.projection, r.projection) {
		return ErrDenied
	}
	var c struct {
		Expires int64  `json:"expiresAtMs"`
		Nonce   string `json:"nonce"`
	}
	var envelope struct {
		Current string `json:"currentOriginal"`
	}
	if json.Unmarshal(h.original, &envelope) != nil || json.Unmarshal([]byte(envelope.Current), &c) != nil || time.Now().UnixMilli() >= c.Expires || time.Since(h.started) >= time.Duration(c.Expires-h.started.UnixMilli())*time.Millisecond || ctx.Err() != nil {
		return ErrDenied
	}
	verify, _ := originalIDEJSON(map[string]any{"operation": "cloud-deployment-execute-approval-verify/v2", "source": a.source.sourceInput(r), "envelopeOriginal": string(h.original), "scopeOriginal": s.ExecuteApprovalScopeOriginal, "nonce": c.Nonce, "previous": map[string]any{"sequence": "2", "floor": "0", "timeFloor": h.query.observedMS}})
	out, e := a.approvalVerifier.invokeDeploymentApproval(ctx, verify)
	h.processPartial = bytes.Clone(out)
	if e != nil {
		return e
	}
	var verified struct {
		Signature  bool   `json:"signatureVerified"`
		Envelope   string `json:"envelopeSHA256"`
		Scope      string `json:"scopeSHA256"`
		Authorized bool   `json:"authorized"`
	}
	if json.Unmarshal(deploymentApprovalResult(out), &verified) != nil || !verified.Signature || verified.Authorized || verified.Envelope != hash(h.original) || verified.Scope != hash([]byte(s.ExecuteApprovalScopeOriginal)) {
		return ErrDenied
	}
	if e = h.store.assertCompletedCurrent(ctx, h.query); e != nil {
		return e
	}
	last, scope, e := a.sourceScope(ctx, p, h.input)
	if e != nil || scope != h.scope || !originalIDESameSource(h.record.projection, last.projection) || ctx.Err() != nil || time.Now().UnixMilli() >= c.Expires || time.Since(h.started) >= time.Duration(c.Expires-h.started.UnixMilli())*time.Millisecond {
		return ErrDenied
	}
	return nil
}

// Exact helper uses the sole Core codec; no duplicated binary implementation.
func ynxDeploymentV2Decode(raw []byte, b DeploymentV2ObjectBinding) (DeploymentV2Manifest, error) {
	return ynxbatch.DecodeDeploymentManifestV2DATA(raw, &b)
}
