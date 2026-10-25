package developerauthority

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"time"
)

type originalIDEArtifactResult struct{ Version, Purpose, Request, Manifest, Public, Ref, Registration, Revision, KeyVersion, Invocation, Signature string }

func originalIDEReadArtifactResult(raw, request, manifest, signature []byte, key Publisher, ref string) (originalIDEArtifactResult, error) {
	var r originalIDEArtifactResult
	if decodeExactObject(raw, 262144, map[string]any{"version": &r.Version, "purpose": &r.Purpose, "requestOriginal": &r.Request, "manifestOriginal": &r.Manifest, "publisherOriginal": &r.Public, "actualApprovalRef": &r.Ref, "publisherRegistrationRef": &r.Registration, "publisherRevision": &r.Revision, "publisherKeyVersion": &r.KeyVersion, "invocationOriginal": &r.Invocation, "signatureOriginal": &r.Signature}) != nil || r.Version != "YNX-IDE-ARTIFACT-RELEASE-RESULT/v1" || r.Purpose != "ARTIFACT-RELEASE" || !bytes.Equal([]byte(r.Request), request) || !bytes.Equal([]byte(r.Manifest), manifest) || r.Invocation != r.Manifest || !bytes.Equal([]byte(r.Signature), signature) || r.Ref != ref || r.Registration != key.RegistrationRef || r.Revision != strconv.FormatUint(key.Revision, 10) {
		return r, ErrDenied
	}
	public, e := base64.RawURLEncoding.DecodeString(r.Public)
	version, ve := strconv.ParseUint(r.KeyVersion, 10, 64)
	if e != nil || ve != nil || version == 0 || strconv.FormatUint(version, 10) != r.KeyVersion || base64.RawURLEncoding.EncodeToString(public) != r.Public || !bytes.Equal(public, key.PublicOriginal) {
		return r, ErrDenied
	}
	if _, e = originalIDEArtifactMember(signature); e != nil {
		return r, e
	}
	return r, nil
}
func (o *OriginalIDEPublicationSourceOwner) OriginalPublicationPublisherID(ctx context.Context, p Principal, signature []byte) (string, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	member, e := originalIDEArtifactMember(signature)
	if e != nil {
		return "", e
	}
	if e = o.check(ctx); e != nil {
		return "", e
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return "", e
	}
	r, v, e := o.project(ctx, p)
	if e != nil || v.Publisher == nil {
		return "", ErrDenied
	}
	k := v.Publisher
	public, e := base64.RawURLEncoding.DecodeString(k.Public)
	if e != nil || hash(public) != k.Hash {
		return "", ErrDenied
	}
	raw, e := originalIDEJSON(map[string]string{"operation": "ide-artifact-signed-manifest-data/v1", "signatureOriginal": base64.RawURLEncoding.EncodeToString(member), "expectedPublicOriginal": base64.RawURLEncoding.EncodeToString(public)})
	if e != nil {
		return "", e
	}
	out, e := o.verifier.invokeDATA(ctx, raw, 28673, true, originalIDESignedManifestOutput)
	r.current = bytes.Clone(out)
	if e != nil {
		return "", e
	}
	var result struct {
		Account   string `json:"account"`
		Project   string `json:"projectId"`
		Publisher string `json:"publisherId"`
	}
	if json.Unmarshal(out, &result) != nil || result.Account != p.Account || result.Project != k.Project || result.Publisher != k.ID {
		return "", ErrDenied
	}
	before := r.projection
	if e = o.current(ctx, r); e != nil || !originalIDESameSource(before, r.projection) {
		return "", ErrDenied
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return "", e
	}
	if time.Now().UnixMilli() >= r.projection.Expires || time.Now().UnixMilli() >= k.Expires || time.Now().UnixMilli() >= p.ExpiresMS {
		return "", ErrDenied
	}
	return result.Publisher, nil
}
func originalIDESignedManifestOutput(raw []byte, before time.Time) string {
	if !bytes.HasSuffix(raw, []byte("\n")) {
		return "IDE_SIGNED_MANIFEST_OUTPUT"
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return "IDE_SIGNED_MANIFEST_OUTPUT"
	}
	var manifest string
	if json.Unmarshal(fields["manifestOriginal"], &manifest) != nil {
		return "IDE_SIGNED_MANIFEST_OUTPUT"
	}
	delete(fields, "manifestOriginal")
	b, e := base64.RawURLEncoding.DecodeString(manifest)
	if e != nil || base64.RawURLEncoding.EncodeToString(b) != manifest || len(b) == 0 || len(b) > 16384 {
		return "IDE_SIGNED_MANIFEST_OUTPUT"
	}
	if _, e = artifactManifest(b); e != nil {
		return "IDE_SIGNED_MANIFEST_OUTPUT"
	}
	rest, e := originalIDEJSON(fields)
	if e != nil {
		return "IDE_SIGNED_MANIFEST_OUTPUT"
	}
	return checkOriginalArtifactProcessOutput(append(rest, '\n'), before)
}
func originalIDESameSource(a, b originalIDEProjection) bool {
	return a.SourceID == b.SourceID && a.InstanceID == b.InstanceID && a.Profile == b.Profile && a.Generation == b.Generation && a.Sequence == b.Sequence && a.Floor == b.Floor && a.Head == b.Head && a.SubjectOwner == b.SubjectOwner && a.SubjectKeyVersion == b.SubjectKeyVersion && bytes.Equal(a.Selection, b.Selection) && b.Status == "active"
}

type originalIDEApprovalScope struct {
	Version           string `json:"version"`
	Kind              string `json:"kind"`
	SourcePurpose     string `json:"sourcePurpose"`
	SourceID          string `json:"sourceId"`
	InstanceID        string `json:"instanceId"`
	Caller            string `json:"callerIdentity"`
	Principal         string `json:"principalSHA256"`
	Account           string `json:"account"`
	Device            string `json:"deviceId"`
	Project           string `json:"projectId"`
	ProjectRevision   string `json:"projectRevision"`
	ProjectCurrent    string `json:"projectCurrentRef"`
	Publisher         string `json:"publisherId"`
	PublicSHA         string `json:"publisherPublicSHA256"`
	Registration      string `json:"publisherRegistrationRef"`
	PublisherRevision string `json:"publisherRevision"`
	KeyVersion        string `json:"publisherKeyVersion"`
	Manifest          string `json:"manifestSHA256"`
	Artifact          string `json:"artifactSHA256"`
	ArtifactVersion   string `json:"artifactVersion"`
	Purpose           string `json:"publishPurpose"`
	Environment       string `json:"targetEnvironment"`
	Bytes             int64  `json:"byteSize"`
	Request           string `json:"originalRequestSHA256"`
	Invocation        string `json:"originalInvocationSHA256"`
	Ref               string `json:"actualApprovalRef"`
	Confirmation      string `json:"confirmationRef"`
	Revocation        string `json:"revocationRef"`
	Approved          int64  `json:"approvedAtMs"`
	Expires           int64  `json:"expiresAtMs"`
	ResourceID        string `json:"resourceId"`
	ResourceRef       string `json:"resourceApprovalRef"`
	Runtime           int    `json:"runtimeSeconds"`
	ValidUntil        int64  `json:"resourceValidUntilMs"`
	Charge            bool   `json:"requiresAdditionalCharge"`
}
type originalIDEApprovalProjection struct {
	Kind     string `json:"kind"`
	Scope    string `json:"scopeSHA256"`
	Result   string `json:"resultOriginalSHA256"`
	Sequence string `json:"sequence"`
	Floor    string `json:"floor"`
	Decision string `json:"decision"`
	State    string `json:"requestState"`
	Time     int64  `json:"timeFloor"`
	Expires  int64  `json:"expiresAtMs"`
	Ready    bool   `json:"readyForSourceVerification"`
}

const originalIDEApprovalHeadRead = `SELECT previous_original,sha256 FROM public.auth_ide_original_approval_heads WHERE source_id=$1 AND instance_id=$2 AND kind=$3 AND approval_ref=$4`
const originalIDEApprovalHeadCAS = `WITH changed AS (
 UPDATE public.auth_ide_original_approval_heads SET previous_original=$6,sha256=$7 WHERE source_id=$1 AND instance_id=$2 AND kind=$3 AND approval_ref=$4 AND sha256=$5 RETURNING *
), observed AS (
 INSERT INTO public.auth_ide_original_source_observations(source_id,instance_id,kind,reference,original,sha256)
 SELECT source_id,instance_id,kind,approval_ref,$8,$9 FROM changed RETURNING sha256
) SELECT c.previous_original,c.sha256 FROM changed c JOIN observed o ON o.sha256=$9`

func (o *OriginalIDEPublicationSourceOwner) approval(ctx context.Context, kind string, p Principal, binding string) (originalIDEApprovalScope, originalIDEApprovalProjection, error) {
	var scope originalIDEApprovalScope
	var value originalIDEApprovalProjection
	r, e := o.record(ctx, kind, p.Account, binding)
	if e != nil {
		return scope, value, e
	}
	var attachment struct {
		Scope string `json:"scopeOriginal"`
	}
	if originalIDEStrict(r.input.Attachment, &attachment) != nil || len(attachment.Scope) == 0 || len(attachment.Scope) > 16384 || json.Unmarshal([]byte(attachment.Scope), &scope) != nil || scope.Kind != kind || scope.Principal != objectHash(p) || scope.Account != p.Account || scope.Device != p.DeviceID || scope.Caller != o.config.CallerIdentity {
		return scope, value, ErrDenied
	}
	if e = o.current(ctx, r); e != nil {
		return scope, value, e
	}
	sourceBefore := r.projection
	var previous json.RawMessage
	var previousHash string
	if e = o.db.QueryRowContext(ctx, originalIDEApprovalHeadRead, o.config.SourceID, o.config.InstanceID, kind, scope.Ref).Scan(&previous, &previousHash); e != nil || len(previous) == 0 || hash(previous) != previousHash {
		return scope, value, ErrDenied
	}
	var nonce [32]byte
	if _, e = rand.Read(nonce[:]); e != nil {
		return scope, value, o.fail(e)
	}
	raw, e := originalIDEJSON(map[string]any{"operation": "ide-publication-approval-current-native-node/v1", "source": o.sourceInput(r), "expectedScopeOriginal": attachment.Scope, "nonce": base64.RawURLEncoding.EncodeToString(nonce[:]), "previous": previous})
	if e != nil {
		return scope, value, e
	}
	out, e := o.verifier.InvokeOriginalApprovalCurrentDATA(ctx, raw)
	r.current = bytes.Clone(out)
	if e != nil {
		return scope, value, e
	}
	var result struct {
		Projection originalIDEApprovalProjection `json:"projection"`
	}
	if json.Unmarshal(out, &result) != nil {
		return scope, value, ErrDenied
	}
	value = result.Projection
	if value.Kind != kind || value.Scope != hash([]byte(attachment.Scope)) || !value.Ready || value.Decision != "approved" || (value.State != "signed-unhanded" && value.State != "returned") || value.Expires > scope.Expires || value.Expires <= time.Now().UnixMilli() {
		return scope, value, ErrDenied
	}
	next, e := originalIDEJSON(map[string]any{"sequence": value.Sequence, "floor": value.Floor, "decision": value.Decision, "requestState": value.State, "resultOriginalSHA256": value.Result, "scopeSHA256": value.Scope, "timeFloor": value.Time})
	if e != nil {
		return scope, value, e
	}
	var observed []byte
	var observedHash string
	if e = o.db.QueryRowContext(ctx, originalIDEApprovalHeadCAS, o.config.SourceID, o.config.InstanceID, kind, scope.Ref, previousHash, next, hash(next), out, hash(out)).Scan(&observed, &observedHash); e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return scope, value, ErrConflict
		}
		return scope, value, o.fail(e)
	}
	if !bytes.Equal(observed, next) || observedHash != hash(next) {
		return scope, value, o.fail(ErrUnknown)
	}
	if e = o.current(ctx, r); e != nil || !originalIDESameSource(sourceBefore, r.projection) {
		return scope, value, ErrDenied
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return scope, value, e
	}
	if time.Now().UnixMilli() >= value.Expires {
		return scope, value, ErrDenied
	}
	return scope, value, nil
}
func (o *OriginalIDEPublicationSourceOwner) VerifyOriginalArtifactApproval(ctx context.Context, p Principal, a Access, key Publisher, b ArtifactBinding, manifest, request, result, signature []byte, ref string) (VerifiedPublication, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	var empty VerifiedPublication
	if e := o.check(ctx); e != nil {
		return empty, e
	}
	native, e := originalIDEReadArtifactResult(result, request, manifest, signature, key, ref)
	if e != nil {
		return empty, e
	}
	parsed, e := artifactManifest(manifest)
	if e != nil || parsed != b || a.Principal != p || !a.Publish || a.ProjectID != b.ProjectID {
		return empty, ErrDenied
	}
	if _, e = o.publisher(ctx, p, key); e != nil {
		return empty, e
	}
	member, e := originalIDEArtifactMember(signature)
	if e != nil {
		return empty, e
	}
	mathOriginal, e := o.verifier.InspectOriginalArtifactDATA(ctx, member, manifest, key.PublicOriginal)
	if e != nil {
		return empty, e
	}
	var mathResult struct {
		Account    string `json:"account"`
		Project    string `json:"projectId"`
		Publisher  string `json:"publisherId"`
		KeyVersion string `json:"publisherKeyVersion"`
	}
	if json.Unmarshal(mathOriginal, &mathResult) != nil || mathResult.Account != p.Account || mathResult.Project != key.ProjectID || mathResult.Publisher != key.PublisherID || mathResult.KeyVersion != native.KeyVersion {
		return empty, ErrDenied
	}
	scope, current, e := o.approval(ctx, "artifact", p, ref)
	if e != nil {
		return empty, e
	}
	var requestData struct {
		ID string `json:"requestId"`
	}
	if json.Unmarshal(request, &requestData) != nil || !text(requestData.ID) {
		return empty, ErrDenied
	}
	if current.Result != hash(result) || scope.Ref != ref || scope.Manifest != hash(manifest) || scope.Request != hash(request) || scope.Invocation != hash(manifest) || scope.Project != b.ProjectID || scope.ProjectRevision != strconv.FormatUint(a.ProjectRevision, 10) || scope.ProjectCurrent != a.CurrentReference || scope.Publisher != key.PublisherID || scope.PublicSHA != key.PublicSHA256 || scope.Registration != key.RegistrationRef || scope.PublisherRevision != strconv.FormatUint(key.Revision, 10) || scope.KeyVersion != native.KeyVersion || scope.Artifact != b.ContentDigest || scope.ArtifactVersion != b.Version || scope.Purpose != b.PublishPurpose || scope.Environment != b.TargetEnvironment || scope.Bytes != b.ByteSize {
		return empty, ErrDenied
	}
	if _, e = o.publisher(ctx, p, key); e != nil {
		return empty, e
	}
	expires := current.Expires
	for _, limit := range []int64{p.ExpiresMS, a.ExpiresMS, key.ExpiresMS} {
		if limit < expires {
			expires = limit
		}
	}
	v := VerifiedPublication{Account: p.Account, DeviceID: p.DeviceID, RequestID: requestData.ID, PublisherID: key.PublisherID, PublisherPublicSHA256: key.PublicSHA256, ProjectCurrentReference: a.CurrentReference, PrincipalSHA256: objectHash(p), ManifestSHA256: hash(manifest), RequestSHA256: hash(request), ResultSHA256: hash(result), SignatureSHA256: hash(signature), ActualApprovalRef: ref, ConfirmationRef: scope.Confirmation, RevocationRef: scope.Revocation, PublisherRevision: key.Revision, ExpiresMS: expires}
	if time.Now().UnixMilli() >= expires {
		return empty, ErrDenied
	}
	return v, nil
}
func (o *OriginalIDEPublicationSourceOwner) AssertOriginalArtifactApprovalCurrent(ctx context.Context, p Principal, v VerifiedPublication) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	scope, current, e := o.approval(ctx, "artifact", p, v.ActualApprovalRef)
	if e != nil {
		return e
	}
	if current.Result != v.ResultSHA256 || scope.Principal != v.PrincipalSHA256 || scope.Manifest != v.ManifestSHA256 || scope.Request != v.RequestSHA256 || scope.Publisher != v.PublisherID || scope.PublicSHA != v.PublisherPublicSHA256 || scope.PublisherRevision != strconv.FormatUint(v.PublisherRevision, 10) || scope.ProjectCurrent != v.ProjectCurrentReference || scope.Confirmation != v.ConfirmationRef || scope.Revocation != v.RevocationRef || current.Expires < v.ExpiresMS || time.Now().UnixMilli() >= v.ExpiresMS {
		return ErrDenied
	}
	return nil
}
func (o *OriginalIDEPublicationSourceOwner) VerifyOriginalResourceApproval(ctx context.Context, p Principal, v VerifiedPublication) (ResourceApproval, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	var empty ResourceApproval
	s, current, e := o.approval(ctx, "resource", p, v.RequestID)
	if e != nil {
		return empty, e
	}
	if s.Principal != v.PrincipalSHA256 || s.Manifest != v.ManifestSHA256 || s.Request != v.RequestSHA256 || s.Publisher != v.PublisherID || s.PublicSHA != v.PublisherPublicSHA256 || s.PublisherRevision != strconv.FormatUint(v.PublisherRevision, 10) || s.ProjectCurrent != v.ProjectCurrentReference || s.Charge || s.Runtime < 1 || s.Runtime > 300 {
		return empty, ErrDenied
	}
	expires := current.Expires
	if expires > v.ExpiresMS {
		expires = v.ExpiresMS
	}
	r := ResourceApproval{Account: p.Account, ProjectID: s.Project, RequestID: v.RequestID, ManifestSHA256: v.ManifestSHA256, ResourceID: s.ResourceID, ResourceApprovalRef: s.ResourceRef, ConfirmationRef: s.Confirmation, RevocationRef: s.Revocation, RuntimeSeconds: s.Runtime, ResourceValidUntilMS: s.ValidUntil, ExpiresMS: expires, RequiresAdditionalCharge: s.Charge}
	if time.Now().UnixMilli() >= r.ExpiresMS || int64(r.RuntimeSeconds) > (r.ResourceValidUntilMS-time.Now().UnixMilli())/1000 {
		return empty, ErrDenied
	}
	return r, nil
}
func (o *OriginalIDEPublicationSourceOwner) AssertOriginalResourceApprovalCurrent(ctx context.Context, p Principal, r ResourceApproval) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	s, current, e := o.approval(ctx, "resource", p, r.RequestID)
	if e != nil {
		return e
	}
	if s.Account != r.Account || s.Project != r.ProjectID || s.Manifest != r.ManifestSHA256 || s.ResourceID != r.ResourceID || s.ResourceRef != r.ResourceApprovalRef || s.Confirmation != r.ConfirmationRef || s.Revocation != r.RevocationRef || s.Runtime != r.RuntimeSeconds || s.ValidUntil != r.ResourceValidUntilMS || s.Charge || r.RequiresAdditionalCharge || current.Expires < r.ExpiresMS || time.Now().UnixMilli() >= r.ExpiresMS || int64(r.RuntimeSeconds) > (r.ResourceValidUntilMS-time.Now().UnixMilli())/1000 {
		return ErrDenied
	}
	return nil
}
