package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"time"
)

// Actual current reader uses the existing dedicated project-authority Source
// verifier plus the original Catalog binding. Neither DB rows nor signed
// project DATA alone can promote a captured purpose key to registered current.
const originalFactoryPublisherBindingSQL = `SELECT b.registry_revision
 FROM public.auth_ide_publisher_catalog_bindings b
 JOIN developer_publishers p ON p.project_id=b.project_id AND p.publisher_id=b.publisher_id
 JOIN public.auth_ide_publisher_captures c ON c.source_id=b.source_id AND c.instance_id=b.instance_id AND c.execution_id=b.capture_execution_id
 WHERE b.project_id=$1 AND b.publisher_id=$2 AND b.account=$3 AND b.public_sha256=$4
 AND b.registration_ref=$5 AND b.publisher_revision=$6 AND b.grant_expires_ms=$7
 AND b.binding_state='active' AND b.registry_revision>=1
 AND p.account=b.account AND p.public_sha256=b.public_sha256 AND p.public_original=$8
 AND p.registration_ref=b.registration_ref AND p.revision=b.publisher_revision
 AND p.expires_ms=b.grant_expires_ms AND p.key_role='ide-artifact-publisher' AND p.revoked=false
 AND c.registration_ref=b.registration_ref AND c.public_sha256=b.public_sha256
 AND c.profile_sha256=b.profile_sha256 AND c.capture_head=b.capture_head
 AND c.grant_expires_ms=b.grant_expires_ms AND c.capture_state='captured' AND c.capture_revision=1`

func originalFactoryProjectPublisherMatches(source originalControlSourceProjection, p Principal, k Publisher, at int64) bool {
	var selection struct {
		Authority json.RawMessage `json:"projectAuthority"`
	}
	if json.Unmarshal(source.Selection, &selection) != nil {
		return false
	}
	var principal, project, publisher json.RawMessage
	var endpoint, spki string
	if decodeExactObject(selection.Authority, 65536, map[string]any{"principal": &principal, "project": &project, "publisher": &publisher, "endpoint": &endpoint, "spki": &spki}) != nil || !approvalHex.MatchString(spki) || endpoint == "" {
		return false
	}
	var account, device, session, current, accountGeneration, sessionGeneration string
	var expires int64
	if decodeExactObject(principal, 4096, map[string]any{"account": &account, "deviceId": &device, "sessionRef": &session, "currentRef": &current, "accountGeneration": &accountGeneration, "sessionGeneration": &sessionGeneration, "expiresMS": &expires}) != nil || account != p.Account || device != p.DeviceID || session != p.SessionRef || current != p.CurrentRef || accountGeneration != strconv.FormatUint(p.AccountGeneration, 10) || sessionGeneration != strconv.FormatUint(p.SessionGeneration, 10) || expires <= at || expires > p.ExpiresMS {
		return false
	}
	var projectID, owner, origin, reference, projectRevision, catalogRevision string
	var read, publish, runtime bool
	if decodeExactObject(project, 4096, map[string]any{"projectId": &projectID, "ownerAccount": &owner, "runtimeOrigin": &origin, "currentReference": &reference, "projectRevision": &projectRevision, "catalogRevision": &catalogRevision, "read": &read, "publish": &publish, "runtime": &runtime, "expiresMS": &expires}) != nil || projectID != k.ProjectID || !text(owner) || !text(reference) || (!read && !publish && !runtime) || !publish || expires <= at || (origin != "" && !canonicalOrigin(origin)) {
		return false
	}
	for _, s := range []string{projectRevision, catalogRevision} {
		v, e := strconv.ParseUint(s, 10, 64)
		if e != nil || v == 0 || strconv.FormatUint(v, 10) != s {
			return false
		}
	}
	var publisherID, role, public, publicSHA, registration, revision string
	var revoked bool
	if decodeExactObject(publisher, 16384, map[string]any{"account": &account, "projectId": &projectID, "publisherId": &publisherID, "keyRole": &role, "publicOriginal": &public, "publicSHA256": &publicSHA, "registrationRef": &registration, "revision": &revision, "expiresMS": &expires, "revoked": &revoked}) != nil || account != k.Account || account != p.Account || projectID != k.ProjectID || publisherID != k.PublisherID || role != "ide-artifact-publisher" || k.KeyRole != role || publicSHA != k.PublicSHA256 || registration != k.RegistrationRef || revision != strconv.FormatUint(k.Revision, 10) || expires != k.ExpiresMS || expires <= at || revoked || k.Revoked {
		return false
	}
	raw, e := base64.RawURLEncoding.Strict().DecodeString(public)
	return e == nil && len(raw) > 0 && len(raw) <= 8192 && base64.RawURLEncoding.EncodeToString(raw) == public && bytes.Equal(raw, k.PublicOriginal) && hash(raw) == publicSHA && source.Principal == p.Account && source.Status == "active" && source.Expires > at && source.TimeFloor <= at
}

// Called with factory mutex held; no callbacks/another server/alternate Source.
func (o *OriginalDeveloperSourceFactory) readOriginalFactoryPublisherCurrent(ctx context.Context, p Principal, k Publisher) (originalControlSourceProjection, error) {
	v := o.publisher
	control := o.control
	control.mu.Lock()
	defer control.mu.Unlock()
	if control.closeSelected || control.firstCause != nil || control.now == nil {
		return originalControlSourceProjection{}, ErrUnknown
	}
	before := control.now()
	raw, e := control.verifier.InvokeOriginalCurrentDATA(ctx, v.projectSource)
	if len(raw) > 0 {
		v.lastProjectOriginal = append([]byte(nil), raw...)
		v.projectOriginals = append(v.projectOriginals, append([]byte(nil), raw...))
	}
	if e != nil {
		return originalControlSourceProjection{}, e
	}
	s, e := controlSourceProjection(bytes.TrimSuffix(raw, []byte("\n")), before)
	if e != nil || s.Profile != v.projectProfile || !originalFactoryProjectPublisherMatches(s, p, k, time.Now().UnixMilli()) {
		return s, ErrDenied
	}
	if e = control.observeCurrent(ctx, &originalControlCurrent{sourceID: s.SourceID, instanceID: s.InstanceID, profile: s.Profile, generation: s.Generation, sequence: s.Sequence, floor: s.Floor, head: s.Head}); e != nil {
		return s, e
	}
	after := control.now().UnixMilli()
	if ctx.Err() != nil || after < before.UnixMilli() || !principalValid(p, after) || !originalFactoryProjectPublisherMatches(s, p, k, after) {
		v.firstCause = ErrUnknown
		return s, ErrUnknown
	}
	return s, nil
}

func (o *OriginalDeveloperSourceFactory) AssertPublisherCurrent(ctx context.Context, p Principal, k Publisher) error {
	if o == nil || ctx == nil || ctx.Err() != nil || !principalValid(p, time.Now().UnixMilli()) || k.Revision == 0 || !text(k.RegistrationRef) || k.Account != p.Account || k.Revoked || k.ExpiresMS <= time.Now().UnixMilli() || hash(k.PublicOriginal) != k.PublicSHA256 {
		return ErrDenied
	}
	k.PublicOriginal = append([]byte(nil), k.PublicOriginal...)
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.publisherUsable() {
		return ErrUnknown
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return e
	}
	first, e := o.readOriginalFactoryPublisherCurrent(ctx, p, k)
	if e != nil {
		return e
	}
	readBinding := func() (int64, error) {
		var revision int64
		e := o.publisher.store.db.QueryRowContext(ctx, originalFactoryPublisherBindingSQL, k.ProjectID, k.PublisherID, k.Account, k.PublicSHA256, k.RegistrationRef, k.Revision, k.ExpiresMS, k.PublicOriginal).Scan(&revision)
		if e == nil && revision < 1 {
			e = ErrDenied
		}
		return revision, e
	}
	revision, e := readBinding()
	if e != nil {
		return e
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return ErrUnknown
	}
	last, e := o.readOriginalFactoryPublisherCurrent(ctx, p, k)
	if e != nil {
		return ErrUnknown
	}
	if first.SourceID != last.SourceID || first.InstanceID != last.InstanceID || first.Profile != last.Profile || first.Owner != last.Owner || first.KeyVersion != last.KeyVersion || first.Generation != last.Generation || first.Sequence != last.Sequence || first.Floor != last.Floor || first.Head != last.Head || !bytes.Equal(first.Selection, last.Selection) {
		return ErrUnknown
	}
	a, ae := strconv.ParseUint(first.Height, 10, 64)
	b, be := strconv.ParseUint(last.Height, 10, 64)
	if ae != nil || be != nil || b < a || last.TimeFloor < first.TimeFloor {
		return ErrUnknown
	}
	final, e := readBinding()
	if e != nil || final != revision {
		return ErrUnknown
	}
	finalAt := o.control.now().UnixMilli()
	if ctx.Err() != nil || finalAt < last.TimeFloor || last.Profile != o.publisher.projectProfile || !principalValid(p, finalAt) || !originalFactoryProjectPublisherMatches(last, p, k, finalAt) {
		return ErrUnknown
	}
	return nil
}

var _ OriginalSource = (*OriginalDeveloperSourceFactory)(nil)
var _ originalPublisherCatalogParticipant = (*OriginalDeveloperSourceFactory)(nil)
