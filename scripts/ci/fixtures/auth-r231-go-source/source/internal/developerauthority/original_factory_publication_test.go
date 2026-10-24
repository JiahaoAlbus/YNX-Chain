package developerauthority

// PUBLIC metadata fixtures only, not Root, signer or admission. Real normal
// factory methods, protected store/SQL API, fixed child pinner and original
// HTTP/TLS principal/current path execute. Prior genuine N1 math remains R227.
import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"
)

func r229Request(p Principal, expiry int64) []byte {
	raw, _ := json.Marshal(map[string]string{"version": "YNX-AUTH-IDENTITY/v2", "algorithmVersion": "YNX-BATCH/v0.1", "networkId": strings.Repeat("a", 64), "owner": "0x" + strings.Repeat("1", 40), "keyVersion": "9007199254740993", "executionHeight": "0", "principalId": p.Account, "productId": "developer", "applicationId": "com.ynxweb4.developer.testnetpreview", "deviceId": p.DeviceID, "requestId": "PUBLIC-Original-UPPERCASE-UUID-Not-ApprovalRef", "purpose": "AUTH-PROTECTED-KEY-CALL", "requestDigest": strings.Repeat("b", 64), "credentialDigest": strings.Repeat("c", 64), "nonce": base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)), "issuedAtMs": strconv.FormatInt(time.Now().UnixMilli()-1, 10), "expiresAtMs": strconv.FormatInt(expiry, 10)})
	return raw
}

func r229Scope(r *originalFactoryArtifactApproval, s originalControlSourceProjection) []byte {
	raw, _ := json.Marshal(map[string]any{"version": "YNX-IDE-PUBLICATION-APPROVAL-SCOPE/v1", "kind": "artifact", "sourcePurpose": "ide-publication-approval-authority-v1", "sourceId": s.SourceID, "instanceId": s.InstanceID, "generation": "1", "callerIdentity": "PUBLIC_NODE_NOT_ROOT", "principalSHA256": objectHash(r.principal), "account": r.principal.Account, "deviceId": r.principal.DeviceID, "projectId": r.binding.ProjectID, "projectRevision": "1", "projectCurrentRef": r.access.CurrentReference, "publisherId": r.publisher.PublisherID, "publisherPublicSHA256": r.publisher.PublicSHA256, "publisherRegistrationRef": r.publisher.RegistrationRef, "publisherRevision": "9007199254740993", "publisherKeyVersion": "1", "manifestSHA256": hash(r.manifest), "artifactSHA256": r.binding.ContentDigest, "artifactVersion": r.binding.Version, "publishPurpose": r.binding.PublishPurpose, "targetEnvironment": r.binding.TargetEnvironment, "byteSize": r.binding.ByteSize, "originalRequestSHA256": hash(r.request), "originalInvocationSHA256": hash(r.manifest), "actualApprovalRef": r.ref, "confirmationRef": "PUBLIC_CONFIRM", "revocationRef": "PUBLIC_REVOKE", "approvedAtMs": time.Now().UnixMilli() - 1, "expiresAtMs": r.publisher.ExpiresMS})
	return raw
}
func r229Fixture(t *testing.T) (*OriginalDeveloperSourceFactory, *originalFactoryArtifactApproval, *approvalFixture) {
	t.Helper()
	f, _, p, k, sig := r218SelectorFixture(t, false)
	if _, e := f.OriginalPublicationPublisherID(context.Background(), p, sig); e != nil {
		t.Fatal("original selector fixture", e)
	}
	sel := f.publisher.publicationSelections[objectHash(p)+":"+hash(sig)]
	m := sel.mathematics
	a := Access{Principal: p, ProjectID: k.ProjectID, OwnerAccount: p.Account, CurrentReference: "PUBLIC_REFERENCE", ProjectRevision: 1, CatalogRevision: 1, Read: true, Publish: true, ExpiresMS: p.ExpiresMS}
	// Approval cannot outlive the narrower existing publisher window.
	packet := r227PublicationPacket(t, k, m.manifest, sig)
	env, e := publicationInput(packet)
	if e != nil {
		t.Fatal(e)
	}
	request := r229Request(p, k.ExpiresMS)
	var original map[string]string
	if json.Unmarshal([]byte(env.ResultOriginal), &original) != nil {
		t.Fatal("result")
	}
	original["requestOriginal"] = string(request)
	result, _ := json.Marshal(original)
	env.RequestOriginal = string(request)
	env.ResultOriginal = string(result)
	r := &originalFactoryArtifactApproval{principal: p, access: a, publisher: k, binding: m.binding, manifest: append([]byte(nil), m.manifest...), request: []byte(env.RequestOriginal), result: []byte(env.ResultOriginal), signature: append([]byte(nil), sig...), ref: env.ActualApprovalRef}
	selected := originalControlSourceProjection{SourceID: "PUBLIC_APPROVAL_SOURCE", InstanceID: "PUBLIC_APPROVAL_INSTANCE", Profile: hash([]byte("PUBLIC_APPROVAL_PROFILE")), Principal: p.Account, Owner: sel.first.Owner, KeyVersion: "1", Generation: 1, Sequence: 1, Floor: 0, Status: "active", Height: "1", TimeFloor: time.Now().UnixMilli(), Expires: k.ExpiresMS, Data: true}
	scopeRaw := r229Scope(r, selected)
	scope, e := parseOriginalFactoryArtifactScope(scopeRaw)
	if e != nil {
		t.Fatal(e)
	}
	row := originalApprovalRow{scope: originalApprovalScopeDATA{scopeRaw, hash(scopeRaw), r.ref, scope.Confirmation, scope.Revocation, scope.Approved, scope.Expires}, sequence: 1, floor: 0, decision: "approved", requestState: "returned", resultOriginal: append([]byte(nil), r.result...), resultSHA256: hash(r.result), observedMS: time.Now().UnixMilli()}
	row.stateSHA256 = row.digest()
	selected.Head = row.stateSHA256
	state := &approvalFixture{schema: 1, records: map[string]approvalFixtureRecord{selected.SourceID + "/" + selected.InstanceID + "/" + r.ref: {row, selected.Profile}}}
	db := sql.OpenDB(approvalConnector{state})
	t.Cleanup(func() { db.Close() })
	store, e := openOriginalApprovalStore(context.Background(), db, originalApprovalStoreConfig{selected.SourceID, selected.InstanceID, selected.Profile})
	if e != nil {
		t.Fatal(e)
	}
	project, _ := json.Marshal(map[string]any{"projection": r216ProjectProjection(p, k), "currentRaw": "PUBLIC_NOT_ROOT"})
	snapshot, _ := json.Marshal(selected)
	script := fixtureRead + `const q=JSON.parse(input),crypto=await import('node:crypto'),h=x=>crypto.createHash('sha256').update(x).digest('hex');let out;if(q.operation==='ide-publication-approval-current-native-node/v1'){const now=Date.now(),scope=JSON.parse(q.expectedScopeOriginal),before=` + string(snapshot) + `;before.timeFloor=now;before.selection={publicationApprovalAuthority:{scopeOriginal:q.expectedScopeOriginal},identityPeerBinding:q.source.peer};const current=JSON.stringify({nonce:q.nonce}),approval=JSON.stringify({version:'YNX-IDE-APPROVAL-CURRENT/v1',binding:{},scopeOriginal:q.expectedScopeOriginal,currentOriginal:current,memberOriginal:'PUBLIC_NOT_MATH'});out={version:'YNX-IDE-APPROVAL-VERIFICATION-DATA/v1',completed:true,sourceBefore:{projection:before,currentRaw:'PUBLIC_NOT_ROOT'},sourceAfter:{projection:before,currentRaw:'PUBLIC_NOT_ROOT'},approvalOriginal:approval,projection:{kind:'artifact',scopeSHA256:h(q.expectedScopeOriginal),statementSHA256:h(current),resultOriginalSHA256:q.previous.resultOriginalSHA256,sequence:q.previous.sequence,floor:q.previous.floor,decision:q.previous.decision,requestState:q.previous.requestState,statementExecutionHeight:'1',observedExecutionHeight:'1',timeFloor:now,expiresAtMs:scope.expiresAtMs,readyForSourceVerification:true,dataOnly:true,signatureVerified:true,authorized:false,nativeAdmission:false,publicationAuthorized:false,resourceAuthorized:false},failureCode:'',dataOnly:true,authorized:false,nativeAdmission:false};}else{out=` + string(project) + `;out.projection.timeFloor=Date.now();}process.stdout.write(JSON.stringify(out)+'\n');`
	verifier, _, _ := openFixtureProcess(t, script)
	f.control.verifier = verifier
	entry := ""
	for _, x := range verifier.config.SDKFiles {
		if x.Path == originalVerifierEntry {
			entry = x.SHA256
		}
	}
	peer := map[string]any{"nodeCodeIdentity": "PUBLIC_NODE_NOT_ROOT", "nodeSHA256": verifier.config.Node.SHA256, "entrySHA256": entry}
	source, _ := json.Marshal(map[string]any{"peer": peer})
	selection, _ := json.Marshal(map[string]any{"publicationApprovalAuthority": map[string]any{"scopeOriginal": string(scopeRaw)}, "identityPeerBinding": peer})
	selected.Selection = selection
	f.publication = &originalFactoryPublication{source: source, scope: scopeRaw, caller: "PUBLIC_NODE_NOT_ROOT", selected: selected, store: store, pending: map[string]*originalFactoryArtifactApproval{}}
	return f, r, state
}
func r229Verify(f *OriginalDeveloperSourceFactory, r *originalFactoryArtifactApproval) (VerifiedPublication, error) {
	return f.VerifyOriginalArtifactApproval(context.Background(), r.principal, r.access, r.publisher, r.binding, r.manifest, r.request, r.result, r.signature, r.ref)
}
func r231FailureDiagnostics(t *testing.T, f *OriginalDeveloperSourceFactory, r *originalFactoryArtifactApproval) {
	t.Helper()
	v := f.control.verifier
	v.mu.Lock()
	t.Logf("PUBLIC fixed child: phase=%s exit=%d waited=%t causeType=%T contextType=%T stdoutBytes=%d stdoutSHA=%s stderrBytes=%d", v.phase, v.processExitCode, v.processWaited, v.firstCause, v.processContextCause, len(v.processStdout), hash(v.processStdout), len(v.processStderr))
	v.mu.Unlock()
	pending := f.publication.pending[r.ref]
	if pending != nil {
		t.Logf("PUBLIC pending: attempts=%d principalExpiry=%d publisherExpiry=%d now=%d", len(pending.attempts), r.principal.ExpiresMS, r.publisher.ExpiresMS, f.control.now().UnixMilli())
		for i, a := range pending.attempts {
			t.Logf("PUBLIC attempt%d: nonceSelected=%t beforePresent=%t afterPresent=%t rawBytes=%d rawSHA=%s causeType=%T", i, a.nonce != "", a.before != nil, a.after != nil, len(a.raw), hash(a.raw), a.cause)
			if len(a.raw) > 0 && len(a.raw) <= 131072 {
				t.Logf("PUBLIC test-only original response retained: %s", a.raw)
			}
		}
	}
}
func TestR229ActualFactoryArtifactCurrentAndResourceRefusal(t *testing.T) {
	f, r, state := r229Fixture(t)
	v, e := r229Verify(f, r)
	if e != nil {
		r231FailureDiagnostics(t, f, r)
		t.Fatal("actual factory", e)
	}
	retained := f.publication.pending[r.ref]
	if len(retained.attempts) != 1 || len(retained.attempts[0].raw) == 0 || retained.attempts[0].before == nil || retained.attempts[0].after == nil || retained.cause != nil {
		t.Fatal("actual custody")
	}
	if v.ResultOriginalSHA256 != hash(r.result) || v.SignatureSHA256 != hash(r.signature) || v.PublisherRevision != r.publisher.Revision || v.RequestID != "PUBLIC-Original-UPPERCASE-UUID-Not-ApprovalRef" || v.RequestID == r.ref {
		t.Fatal("unbound result")
	}
	if e = f.AssertOriginalArtifactApprovalCurrent(context.Background(), r.principal, v); e != nil {
		r231FailureDiagnostics(t, f, r)
		t.Fatal("actual current", e)
	}
	if _, e = f.VerifyOriginalResourceApproval(context.Background(), r.principal, v); e != ErrOriginalResourceNotSupplied {
		t.Fatal("resource aliased artifact", e)
	}
	if e = f.AssertOriginalResourceApprovalCurrent(context.Background(), r.principal, ResourceApproval{}); e != ErrOriginalResourceNotSupplied {
		t.Fatal(e)
	}
	if state.writes != 0 {
		t.Fatal("consumer issued approval/wrote durable state")
	}
}

func TestR229OriginalRequest17FieldsCanonicalAndNoFabricatedID(t *testing.T) {
	now := time.Now().UnixMilli()
	p := Principal{Account: "PUBLIC_ACCOUNT", DeviceID: "PUBLIC_DEVICE", ExpiresMS: now + 29000}
	raw := r229Request(p, now+25000)
	id, expiry, e := originalFactoryPublicationRequest(raw, p, now)
	if e != nil || id != "PUBLIC-Original-UPPERCASE-UUID-Not-ApprovalRef" || expiry != now+25000 {
		t.Fatal("original id", e)
	}
	for _, mutate := range []func(map[string]string){func(m map[string]string) { m["requestId"] = "with space" }, func(m map[string]string) { m["purpose"] = "AUTH-LOGIN" }, func(m map[string]string) { m["deviceId"] = "FOREIGN" }, func(m map[string]string) { m["keyVersion"] = "01" }, func(m map[string]string) { m["nonce"] = base64.RawURLEncoding.EncodeToString(make([]byte, 32)) }, func(m map[string]string) { delete(m, "requestDigest") }, func(m map[string]string) { m["proofOriginal"] = "NO_ALIAS" }} {
		var m map[string]string
		json.Unmarshal(raw, &m)
		mutate(m)
		bad, _ := json.Marshal(m)
		if _, _, e = originalFactoryPublicationRequest(bad, p, now); e == nil {
			t.Fatal("substituted request")
		}
	}
	for _, bad := range [][]byte{append([]byte(" "), raw...), bytes.Replace(raw, []byte(`"version":`), []byte(`"version":"x","version":`), 1)} {
		if _, _, e = originalFactoryPublicationRequest(bad, p, now); e == nil {
			t.Fatal("noncanonical/duplicate")
		}
	}
	if _, _, e = originalFactoryPublicationRequest(raw, p, expiry); e == nil {
		t.Fatal("late original request renewed")
	}
}
func TestR229ScopeOriginalSubstitutionStickyNoNonceReplay(t *testing.T) {
	f, r, _ := r229Fixture(t)
	r.result = append(r.result, ' ')
	if _, e := r229Verify(f, r); e == nil {
		t.Fatal("original result substituted")
	}
	retained := f.publication.pending[r.ref]
	if retained == nil || retained.cause == nil || len(retained.attempts) != 1 || retained.attempts[0].nonce != "" {
		t.Fatal("failed before nonce custody")
	}
	first := retained.cause
	if _, e := r229Verify(f, r); e != first || len(retained.attempts) != 1 {
		t.Fatal("failed attempt reentered")
	}
	r.result = bytes.TrimSpace(r.result)
	if _, e := r229Verify(f, r); e != ErrConflict {
		t.Fatal("replacement cleared failed request", e)
	}
}
func TestR229ScopeAndIndependentPeerAccessAllBindings(t *testing.T) {
	f, r, _ := r229Fixture(t)
	s, e := parseOriginalFactoryArtifactScope(f.publication.scope)
	if e != nil || !r.scopeMatches(s, f.publication.selected, time.Now().UnixMilli()) {
		t.Fatal("base", e)
	}
	for _, mutate := range []func(*originalFactoryArtifactScope){func(x *originalFactoryArtifactScope) { x.Principal = strings.Repeat("f", 64) }, func(x *originalFactoryArtifactScope) { x.Request = strings.Repeat("f", 64) }, func(x *originalFactoryArtifactScope) { x.ProjectRef = "FOREIGN" }, func(x *originalFactoryArtifactScope) { x.KeyVersion = "01" }, func(x *originalFactoryArtifactScope) { x.Expires = r.publisher.ExpiresMS + 1 }, func(x *originalFactoryArtifactScope) { x.Approved = time.Now().UnixMilli() + 1 }} {
		bad := s
		mutate(&bad)
		if r.scopeMatches(bad, f.publication.selected, time.Now().UnixMilli()) {
			t.Fatal("scope substituted")
		}
	}
	wrong := r.access
	wrong.CurrentReference = "FOREIGN"
	if originalFactoryPublicationAccessMatches(f.publisher.publicationSelections[objectHash(r.principal)+":"+hash(r.signature)].first, wrong) {
		t.Fatal("ACL DTO substituted")
	}
	f.publication.caller = "OTHER_NODE"
	if f.publication.peerMatches(f.publication.selected, f.control.verifier.config) {
		t.Fatal("node caller conflated Wallet")
	}
	duplicate := bytes.Replace(f.publication.scope, []byte(`"kind":`), []byte(`"kind":"artifact","kind":`), 1)
	if _, e := parseOriginalFactoryArtifactScope(duplicate); e == nil {
		t.Fatal("duplicate scope")
	}
}
func TestR229DurableRevocationAndTerminalTimeCannotRenew(t *testing.T) {
	f, r, state := r229Fixture(t)
	v, e := r229Verify(f, r)
	if e != nil {
		r231FailureDiagnostics(t, f, r)
		t.Fatal(e)
	}
	state.mu.Lock()
	key := f.publication.selected.SourceID + "/" + f.publication.selected.InstanceID + "/" + r.ref
	changed := state.records[key]
	changed.w.decision = "revoked"
	changed.w.sequence++
	changed.w.stateSHA256 = changed.w.digest()
	state.records[key] = changed
	state.mu.Unlock()
	if e = f.AssertOriginalArtifactApprovalCurrent(context.Background(), r.principal, v); e == nil {
		t.Fatal("durable revoke promoted")
	}
	retained := f.publication.pending[r.ref]
	if retained.cause == nil {
		t.Fatal("first cause lost")
	}
	expired := v
	expired.ExpiresMS = time.Now().UnixMilli()
	retained.value = expired
	retained.cause = nil
	before := len(retained.attempts)
	if e = f.AssertOriginalArtifactApprovalCurrent(context.Background(), r.principal, expired); e == nil || len(retained.attempts) != before {
		t.Fatal("expired value rearmed")
	}
}

func TestR229ActualChildCompletionLateClockNeverPublishes(t *testing.T) {
	for _, backwards := range []bool{false, true} {
		name := "expiry"
		if backwards {
			name = "clock-rollback"
		}
		t.Run(name, func(t *testing.T) {
			f, r, _ := r229Fixture(t)
			start := time.Now()
			f.control.now = func() time.Time {
				retained := f.publication.pending[r.ref]
				if retained != nil && len(retained.attempts) > 0 && len(retained.attempts[len(retained.attempts)-1].raw) > 0 {
					if backwards {
						return start.Add(-time.Hour)
					}
					return time.UnixMilli(r.publisher.ExpiresMS)
				}
				return time.Now()
			}
			if v, e := r229Verify(f, r); e == nil || v != (VerifiedPublication{}) {
				t.Fatal("post-child clock accepted")
			}
			retained := f.publication.pending[r.ref]
			if retained == nil || retained.cause == nil || len(retained.attempts) != 1 || len(retained.attempts[0].raw) == 0 || retained.value != (VerifiedPublication{}) {
				t.Fatal("actual completed raw/failed result lost")
			}
			attempts := len(retained.attempts)
			if _, e := r229Verify(f, r); e == nil || len(retained.attempts) != attempts {
				t.Fatal("late failure resubmitted")
			}
		})
	}
}
func TestR229PublicationCloseRetainsCauseAndBorrowedPool(t *testing.T) {
	state := &approvalFixture{schema: 1, records: map[string]approvalFixtureRecord{}}
	db := sql.OpenDB(approvalConnector{state})
	defer db.Close()
	store, e := openOriginalApprovalStore(context.Background(), db, originalApprovalStoreConfig{"PUBLIC_SOURCE", "PUBLIC_INSTANCE", strings.Repeat("a", 64)})
	if e != nil {
		t.Fatal(e)
	}
	first := errors.New("PUBLIC first acquisition failure")
	v := &originalFactoryPublication{store: store, firstCause: first}
	e = v.close()
	if e != ErrUnknown || v.close() != e || v.firstCause != first || !v.closed {
		t.Fatal("first close changed", e)
	}
	var revision int
	if e = db.QueryRowContext(context.Background(), `SELECT revision FROM public.auth_ide_approval_schema WHERE singleton=1`).Scan(&revision); e != nil || revision != 1 {
		t.Fatal("borrowed pool closed", e)
	}
}
