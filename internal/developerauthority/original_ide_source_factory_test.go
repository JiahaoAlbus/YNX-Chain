package developerauthority

// Actual factory/13 methods/SQL calls/held-file process/TLS paths. Root, Native
// captures and crypto are explicit PUBLIC boundary fixtures, never admission.
import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type ideSourceFixtureDB struct {
	mu               sync.Mutex
	records          map[string][]byte
	heads, approvals map[string][]byte
	failCAS          bool
	cas              int
	observations     map[string][]byte
}
type ideSourceConnector struct{ s *ideSourceFixtureDB }
type ideSourceDriver struct{}
type ideSourceConn struct{ s *ideSourceFixtureDB }

func (ideSourceDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("PUBLIC only connector")
}
func (c ideSourceConnector) Connect(context.Context) (driver.Conn, error) {
	return &ideSourceConn{c.s}, nil
}
func (ideSourceConnector) Driver() driver.Driver { return ideSourceDriver{} }
func (*ideSourceConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("PUBLIC no prepare")
}
func (*ideSourceConn) Close() error              { return nil }
func (*ideSourceConn) Begin() (driver.Tx, error) { return nil, errors.New("PUBLIC CAS only") }

type ideSourceRows struct {
	values []driver.Value
	done   bool
}

func (r *ideSourceRows) Columns() []string {
	a := make([]string, len(r.values))
	for i := range a {
		a[i] = "PUBLIC"
	}
	return a
}
func (*ideSourceRows) Close() error { return nil }
func (r *ideSourceRows) Next(dst []driver.Value) error {
	if r.done || r.values == nil {
		return io.EOF
	}
	r.done = true
	copy(dst, r.values)
	return nil
}
func (c *ideSourceConn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	s := func(i int) string { return a[i].Value.(string) }
	out := func(b []byte) driver.Rows {
		if b == nil {
			return &ideSourceRows{values: []driver.Value{nil, nil}, done: true}
		}
		return &ideSourceRows{values: []driver.Value{bytes.Clone(b), hash(b)}}
	}
	switch q {
	case "SELECT revision FROM public.auth_ide_original_source_schema WHERE singleton=1":
		return &ideSourceRows{values: []driver.Value{int64(1)}}, nil
	case originalIDESourceRead:
		return out(c.s.records[s(2)+"/"+s(3)+"/"+s(4)]), nil
	case originalIDEHeadRead:
		return out(c.s.heads[s(2)]), nil
	case originalIDEApprovalHeadRead:
		return out(c.s.approvals[s(2)+"/"+s(3)]), nil
	case originalIDEHeadCAS:
		k := s(2)
		if hash(c.s.heads[k]) != s(3) || c.s.failCAS {
			return nil, errors.New("PUBLIC CAS conflict after selection")
		}
		raw := a[6].Value.([]byte)
		if hash(raw) != s(7) {
			return nil, errors.New("PUBLIC observation hash mismatch")
		}
		if c.s.observations == nil {
			c.s.observations = map[string][]byte{}
		}
		c.s.observations[s(7)] = bytes.Clone(raw)
		c.s.heads[k] = bytes.Clone(a[4].Value.([]byte))
		c.s.cas++
		return out(c.s.heads[k]), nil
	case originalIDEApprovalHeadCAS:
		k := s(2) + "/" + s(3)
		if hash(c.s.approvals[k]) != s(4) || c.s.failCAS {
			return nil, errors.New("PUBLIC approval CAS conflict")
		}
		raw := a[7].Value.([]byte)
		if hash(raw) != s(8) {
			return nil, errors.New("PUBLIC approval observation hash mismatch")
		}
		if c.s.observations == nil {
			c.s.observations = map[string][]byte{}
		}
		c.s.observations[s(8)] = bytes.Clone(raw)
		c.s.approvals[k] = bytes.Clone(a[5].Value.([]byte))
		c.s.cas++
		return out(c.s.approvals[k]), nil
	}
	return nil, errors.New("PUBLIC unexpected SQL")
}

const ideSourceChildFixture = `import{createHash}from'node:crypto';let text='';for await(const b of process.stdin)text+=b;const x=JSON.parse(text),H=v=>createHash('sha256').update(v).digest('hex'),now=Date.now();
function source(i){const p=JSON.parse(i.profileRaw);return{projection:{selection:p.selection,principalId:'PUBLIC_ACCOUNT',subjectOwner:'0x'+'1'.repeat(40),subjectKeyVersion:'1',generation:1,sequence:1,floor:0,head:'1'.repeat(64),status:'active',timeFloor:now,expiresAtMs:Math.min(p.expires,now+30000),profileDigest:H(i.profileRaw),sourceId:'PUBLIC_SOURCE',instanceId:'PUBLIC_INSTANCE',executionHeight:'0',dataOnly:true,nativeAdmission:false},currentRaw:'PUBLIC_NOT_A_ROOT_PROOF'}}
let result;if(x.operation==='auth-source-v2-native-node/v1')result=source(x);
else if(x.operation==='ide-project-control-current-native-node/v1'){const c=x.command,p=x.principal,wire=JSON.parse(x.approvalOriginal);result={version:'YNX-IDE-CONTROL-VERIFICATION-DATA/v1',completed:true,sourceBefore:source(x.source),sourceAfter:source(x.source),approvalOriginal:x.approvalOriginal,projection:{principalSHA256:wire.p,bindingSHA256:wire.c,proofSHA256:H(x.approvalOriginal),confirmationRef:'confirm',revocationRef:'revoke',requestId:c.RequestID,nonce:x.expected.nonce,decision:'approve',expiresMS:Number(c.ExpiresMS)-100,readyForSourceVerification:true,signatureVerified:true,dataOnly:true,authorized:false,committed:false,nativeAdmission:false},failureCode:'',dataOnly:true,authorized:false,nativeAdmission:false}}
else if(x.operation==='ide-protected-publisher-current-native-node/v1'){result={version:'YNX-IDE-PUBLISHER-CURRENT-VERIFICATION-DATA/v1',completed:true,sourceBefore:source(x.source),sourceAfter:source(x.source),registrationOriginal:x.registrationOriginal,projection:{account:x.command.SubjectAccount,projectId:x.command.ProjectID,publisherId:x.command.PublisherID,keyRole:'ide-artifact-publisher',publicSHA256:x.command.PublicOriginalSHA256,registrationRef:'registered',expiresAtMs:Number(x.command.GrantExpiresMS)+100,signatureVerified:true,independentCustodianPairVerified:true,dataOnly:true,authorized:false,registered:false,protectedCustodyAdmitted:false,nativeAdmission:false},failureCode:'',dataOnly:true,authorized:false,registered:false,protectedCustodyAdmitted:false,nativeAdmission:false}}
else if(x.operation==='ide-artifact-signature-data/v1'||x.operation==='ide-artifact-signed-manifest-data/v1'){const info=JSON.parse(Buffer.from(x.signatureOriginal,'base64url'));result={networkId:'1'.repeat(64),subjectOwner:'0x'+'1'.repeat(40),account:'PUBLIC-account',projectId:'project',publisherId:'publisher',publisherKeyVersion:'5',purpose:'ARTIFACT-RELEASE',keyRole:'ide-artifact-publisher',signatureVerified:true,memberCount:1,memberIndex:0,dataOnly:true,trusted:false,authorized:false,nativeAdmission:false,registered:false,current:false,publicationAuthorized:false};if(x.operation==='ide-artifact-signed-manifest-data/v1')result.manifestOriginal=Buffer.from(info.manifest).toString('base64url')}
else if(x.operation==='ide-publication-approval-current-native-node/v1'){const s=JSON.parse(x.expectedScopeOriginal),extra=JSON.parse(x.source.profileRaw).extra;const body={nonce:x.nonce};const current=JSON.stringify(body),scopeSHA=H(x.expectedScopeOriginal);const approval=JSON.stringify({version:'YNX-IDE-APPROVAL-CURRENT/v1',binding:{},scopeOriginal:x.expectedScopeOriginal,currentOriginal:current,memberOriginal:'PUBLIC_NOT_A_MEMBER'});result={version:'YNX-IDE-APPROVAL-VERIFICATION-DATA/v1',completed:true,sourceBefore:source(x.source),sourceAfter:source(x.source),approvalOriginal:approval,projection:{kind:s.kind,scopeSHA256:scopeSHA,statementSHA256:H(current),resultOriginalSHA256:extra.resultHash,sequence:'1',floor:'0',decision:'approved',requestState:'returned',statementExecutionHeight:'0',observedExecutionHeight:'0',timeFloor:now,expiresAtMs:s.expiresAtMs,readyForSourceVerification:true,dataOnly:true,signatureVerified:true,authorized:false,nativeAdmission:false,publicationAuthorized:false,resourceAuthorized:false},failureCode:'',dataOnly:true,authorized:false,nativeAdmission:false}}
else process.exit(91);process.stdout.write(JSON.stringify(result)+'\n');`

type ideSourceFixture struct {
	o                                             *OriginalIDEPublicationSourceOwner
	db                                            *sql.DB
	state                                         *ideSourceFixtureDB
	p                                             Principal
	cmd                                           Command
	key                                           Publisher
	binding                                       ArtifactBinding
	manifest, request, result, signature, control []byte
	ref                                           string
	http                                          *httpPrincipalFixture
}

func ideSourceFactoryFixture(t *testing.T) *ideSourceFixture {
	t.Helper()
	ctx := context.Background()
	principal, http := principalHTTPFixtureWithLifetime(t, 3*time.Minute)
	request := actualPrincipalRequest()
	p, e := principal.CurrentExistingPrincipal(ctx, request)
	if e != nil {
		t.Fatal(e)
	}
	cfg, entry := fixtureSourceProcess(t, ideSourceChildFixture)
	state := &ideSourceFixtureDB{records: map[string][]byte{}, heads: map[string][]byte{}, approvals: map[string][]byte{}}
	db := sql.OpenDB(ideSourceConnector{state})
	t.Cleanup(func() { db.Close() })
	f := &ideSourceFixture{db: db, state: state, p: p, ref: "12345678-1234-4234-8234-123456789abc", http: http}
	// New independently captured flow, NOT a renewed prior approval. Keep
	// request/approval <=30s even though the PUBLIC session lasts longer.
	expires := time.Now().Add(30 * time.Second).UnixMilli()
	f.cmd = Command{RequestID: "control_original", Action: "project.publisher", ProjectID: "project", SubjectAccount: p.Account, PublisherID: "publisher", GrantExpiresMS: expires - 100, ExpiresMS: expires, PublicOriginalSHA256: hash([]byte("PUBLIC-R13"))}
	f.key = Publisher{Account: p.Account, ProjectID: "project", PublisherID: "publisher", KeyRole: "ide-artifact-publisher", PublicSHA256: hash([]byte("PUBLIC-R13")), RegistrationRef: "registered", PublicOriginal: []byte("PUBLIC-R13"), Revision: 9, ExpiresMS: expires}
	f.binding = ArtifactBinding{ProjectID: "project", Version: "v1", ContentDigest: strings.Repeat("a", 64), PublishPurpose: "artifact", TargetEnvironment: "testnet", ByteSize: 10}
	f.manifest, _ = originalIDEJSON(f.binding)
	f.request = []byte(`{"requestId":"req_original"}`)
	member, _ := originalIDEJSON(map[string]string{"manifest": string(f.manifest)})
	f.signature = []byte(base64.RawURLEncoding.EncodeToString(member))
	result, _ := originalIDEJSON(map[string]string{"version": "YNX-IDE-ARTIFACT-RELEASE-RESULT/v1", "purpose": "ARTIFACT-RELEASE", "requestOriginal": string(f.request), "manifestOriginal": string(f.manifest), "publisherOriginal": base64.RawURLEncoding.EncodeToString(f.key.PublicOriginal), "actualApprovalRef": f.ref, "publisherRegistrationRef": f.key.RegistrationRef, "publisherRevision": "9", "publisherKeyVersion": "5", "invocationOriginal": string(f.manifest), "signatureOriginal": string(f.signature)})
	f.result = result
	rawCmd, _ := json.Marshal(f.cmd)
	f.control, _ = originalIDEJSON(map[string]string{"p": objectHash(p), "c": objectHash(f.cmd), "commandOriginal": string(rawCmd)})
	previous := []byte(`{"sequence":1,"floor":0,"head":"` + strings.Repeat("1", 64) + `","timeFloor":0,"executionHeight":"0"}`)
	put := func(kind, subject, key string, selection any, attachment any, extra any) {
		profile, _ := originalIDEJSON(map[string]any{"selection": selection, "expires": p.ExpiresMS, "extra": extra})
		input, _ := originalIDEJSON(originalIDESourceInput{Root: "PUBLIC-ROOT", Enrollment: "PUBLIC-ENROLLMENT", Profile: string(profile), Head: "PUBLIC-HEAD", Attachment: mustIDEJSON(t, attachment)})
		state.records[kind+"/"+subject+"/"+key] = input
		state.heads[hash(profile)] = bytes.Clone(previous)
	}
	catalogBinding := strings.Repeat("c", 64)
	put("catalog", "", catalogBinding, map[string]bool{"PUBLIC": true}, map[string]any{}, nil)
	project := map[string]any{"projectId": "project", "ownerAccount": p.Account, "runtimeOrigin": "https://runtime.example", "currentReference": "project-current", "projectRevision": "3", "catalogRevision": "4", "read": true, "publish": true, "runtime": true, "expiresMS": expires}
	publisher := map[string]any{"account": p.Account, "projectId": "project", "publisherId": "publisher", "keyRole": "ide-artifact-publisher", "publicOriginal": base64.RawURLEncoding.EncodeToString(f.key.PublicOriginal), "publicSHA256": f.key.PublicSHA256, "registrationRef": f.key.RegistrationRef, "revision": "9", "expiresMS": expires, "revoked": false}
	sourcePrincipal := map[string]any{}
	for k, v := range originalIDEPrincipal(p) {
		sourcePrincipal[k] = v
	}
	sourcePrincipal["expiresMS"] = p.ExpiresMS
	put("project", p.Account, objectHash(p), map[string]any{"projectAuthority": map[string]any{"principal": sourcePrincipal, "project": project, "publisher": publisher, "endpoint": "https://developer.ynxweb4.com/", "spki": strings.Repeat("a", 64)}}, map[string]any{}, nil)
	registration, _ := originalIDEJSON(map[string]string{"publicOriginal": base64.RawURLEncoding.EncodeToString(f.key.PublicOriginal)})
	put("control", p.Account, objectHash(f.cmd), map[string]bool{"PUBLIC": true}, originalIDEControlAttachment{string(f.control), base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)), string(registration)}, nil)
	for _, kind := range []string{"artifact", "resource"} {
		scope := originalIDEApprovalScope{Kind: kind, Principal: objectHash(p), Account: p.Account, Device: p.DeviceID, Caller: "PUBLIC-CALLER", Project: "project", ProjectRevision: "3", ProjectCurrent: "project-current", Publisher: "publisher", PublicSHA: f.key.PublicSHA256, Registration: "registered", PublisherRevision: "9", KeyVersion: "5", Manifest: hash(f.manifest), Artifact: f.binding.ContentDigest, ArtifactVersion: "v1", Purpose: "artifact", Environment: "testnet", Bytes: 10, Request: hash(f.request), Invocation: hash(f.manifest), Ref: f.ref, Confirmation: "confirm", Revocation: "revoke", Expires: expires - 100, ResourceID: "resource", ResourceRef: "resource-approval", Runtime: 60, ValidUntil: expires + 300000}
		s, _ := originalIDEJSON(scope)
		key := f.ref
		if kind == "resource" {
			key = "req_original"
		}
		put(kind, p.Account, key, map[string]bool{"PUBLIC": true}, map[string]string{"scopeOriginal": string(s)}, map[string]string{"resultHash": hash(f.result)})
		state.approvals[kind+"/"+f.ref] = []byte(`{"sequence":"1","floor":"0","decision":"approved","requestState":"returned","resultOriginalSHA256":"` + hash(f.result) + `","scopeSHA256":"` + hash(s) + `","timeFloor":0}`)
	}
	templates := map[string]originalIDETemplate{}
	for kind, purpose := range map[string]string{"catalog": "ide-project-authority-v1", "project": "ide-project-authority-v1", "control": "ide-project-control-authority-v1", "artifact": "ide-publication-approval-authority-v1", "resource": "ide-publication-approval-authority-v1"} {
		templates[kind] = originalIDETemplate{"PUBLIC_SOURCE", "PUBLIC_INSTANCE", mustIDEJSON(t, map[string]any{"signatureContract": map[string]string{"purpose": purpose}}), json.RawMessage(`{}`)}
	}
	release := originalIDERelease{"YNX-IDE-PUBLICATION-SOURCE/v1", "PUBLIC_SOURCE", "PUBLIC_INSTANCE", "PUBLIC-CALLER", strings.Repeat("a", 64), catalogBinding, templates}
	path := filepath.Join(filepath.Dir(filepath.Dir(entry)), "release.json")
	if e = os.WriteFile(path, mustIDEJSON(t, release), 0600); e != nil {
		t.Fatal(e)
	}
	// Original complete-tree pinner must include every file beneath SDKRoot.
	cfg.SDKFiles = append(cfg.SDKFiles, OriginalVerifierFile{Path: "release.json", Bytes: fixturePin(t, path).Bytes, SHA256: fixturePin(t, path).SHA256})
	o, e := OpenOriginalIDEPublicationSource(ctx, db, OriginalIDEPublicationSourceConfig{fixturePin(t, path), cfg})
	if e != nil {
		if o != nil {
			_ = o.Close()
		}
		t.Fatal("constructor", e)
	}
	_ = o.principal.Close()
	o.principal = principal
	f.o = o
	t.Cleanup(func() { _ = o.Close() })
	return f
}
func mustIDEJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, e := originalIDEJSON(v)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestOriginalIDEFactoryActualConstructorAndAllThirteenMethods(t *testing.T) {
	ctx := context.Background()
	observedTotal := 0
	flows := []struct {
		name string
		run  func(*testing.T, *ideSourceFixture)
	}{
		{"principal_source_catalog", func(t *testing.T, f *ideSourceFixture) {
			if e := f.o.AssertSourceCurrent(ctx); e != nil {
				t.Fatal(e)
			}
			for i := 0; i < 2; i++ {
				p, e := f.o.CurrentExistingPrincipal(ctx, actualPrincipalRequest())
				if e != nil || p != f.p {
					t.Fatal("same HTTP reborrow", e)
				}
			}
			f.http.mu.Lock()
			auth := 0
			for _, op := range f.http.operations {
				if op == "authenticate" {
					auth++
				}
			}
			f.http.mu.Unlock()
			if auth != 1 {
				t.Fatal("PSv2 proof authenticated twice", auth)
			}
			if e := f.o.AssertPrincipalCurrent(ctx, f.p); e != nil {
				t.Fatal(e)
			}
			if e := f.o.AssertCatalogAuthorityCurrent(ctx, f.p); e != nil {
				t.Fatal(e)
			}
		}},
		{"control_and_same_approval_current", func(t *testing.T, f *ideSourceFixture) {
			a, e := f.o.AuthorizeProjectControl(ctx, f.p, f.cmd, f.control)
			if e != nil {
				t.Fatal("control", e)
			}
			if e = f.o.AssertControlCurrent(ctx, f.p, a); e != nil {
				t.Fatal("control current", e)
			}
		}},
		{"publisher_registration_and_current", func(t *testing.T, f *ideSourceFixture) {
			if _, e := f.o.VerifyProtectedPublisherOriginal(ctx, f.p, f.cmd, f.key.PublicOriginal); e != nil {
				t.Fatal("registration", e)
			}
			if e := f.o.AssertPublisherCurrent(ctx, f.p, f.key); e != nil {
				t.Fatal("publisher current", e)
			}
		}},
		{"selector_artifact_and_same_approval_current", func(t *testing.T, f *ideSourceFixture) {
			id, e := f.o.OriginalPublicationPublisherID(ctx, f.p, f.signature)
			if e != nil || id != "publisher" {
				t.Fatal("selector", id, e)
			}
			access := Access{Principal: f.p, ProjectID: "project", CurrentReference: "project-current", ProjectRevision: 3, CatalogRevision: 4, Publish: true, ExpiresMS: f.key.ExpiresMS}
			v, e := f.o.VerifyOriginalArtifactApproval(ctx, f.p, access, f.key, f.binding, f.manifest, f.request, f.result, f.signature, f.ref)
			if e != nil {
				t.Fatal("artifact", e)
			}
			if v.ResultSHA256 != hash(f.result) || v.SignatureSHA256 != hash(f.signature) {
				t.Fatal("original digest alias")
			}
			if e = f.o.AssertOriginalArtifactApprovalCurrent(ctx, f.p, v); e != nil {
				t.Fatal("artifact current", e)
			}
		}},
		{"same_artifact_resource_and_current", func(t *testing.T, f *ideSourceFixture) {
			access := Access{Principal: f.p, ProjectID: "project", CurrentReference: "project-current", ProjectRevision: 3, CatalogRevision: 4, Publish: true, ExpiresMS: f.key.ExpiresMS}
			v, e := f.o.VerifyOriginalArtifactApproval(ctx, f.p, access, f.key, f.binding, f.manifest, f.request, f.result, f.signature, f.ref)
			if e != nil {
				t.Fatal("resource original artifact prerequisite", e)
			}
			resource, e := f.o.VerifyOriginalResourceApproval(ctx, f.p, v)
			if e != nil {
				t.Fatal("resource", e)
			}
			if e = f.o.AssertOriginalResourceApprovalCurrent(ctx, f.p, resource); e != nil {
				t.Fatal("resource current", e)
			}
		}},
	}
	// Separate original workflows, not per-method permission refresh. Coupled
	// approvals/current/resource keep the SAME f, Principal and original result.
	for _, flow := range flows {
		t.Run(flow.name, func(t *testing.T) {
			f := ideSourceFactoryFixture(t)
			if f.cmd.ExpiresMS-time.Now().UnixMilli() > 30000 || f.cmd.ExpiresMS >= f.p.ExpiresMS {
				t.Fatal("fixture widened approval/session contract")
			}
			flow.run(t, f)
			f.state.mu.Lock()
			observed := len(f.state.observations)
			f.state.mu.Unlock()
			if observed < 1 {
				t.Fatal("raw current/source observations not persisted")
			}
			observedTotal += observed
			if e := f.o.Close(); e != nil {
				t.Fatal(e)
			}
			if e := f.o.Close(); e != nil {
				t.Fatal(e)
			}
			var revision int
			if e := f.db.QueryRowContext(ctx, "SELECT revision FROM public.auth_ide_original_source_schema WHERE singleton=1").Scan(&revision); e != nil {
				t.Fatal("borrowed DB closed")
			}
		})
	}
	if observedTotal < 4 {
		t.Fatal("full13 raw current/source observations lost")
	}
}
func TestOriginalIDEFactoryRawResultDriftRejectsAgainstActualApprovalCurrent(t *testing.T) {
	f := ideSourceFactoryFixture(t)
	access := Access{Principal: f.p, ProjectID: "project", CurrentReference: "project-current", ProjectRevision: 3, Publish: true, ExpiresMS: f.key.ExpiresMS}
	changed := bytes.Replace(f.result, []byte(`,"purpose"`), []byte(",\n\"purpose\""), 1)
	if bytes.Equal(changed, f.result) {
		t.Fatal("negative did not change original")
	}
	_, e := f.o.VerifyOriginalArtifactApproval(context.Background(), f.p, access, f.key, f.binding, f.manifest, f.request, changed, f.signature, f.ref)
	if e == nil {
		t.Fatal("same-value result reserialization promoted")
	}
}
func TestOriginalIDEFactoryDurableCASConflictIsUnknownAndNeverRetries(t *testing.T) {
	f := ideSourceFactoryFixture(t)
	f.state.mu.Lock()
	f.state.failCAS = true
	before := f.state.cas
	f.state.mu.Unlock()
	if e := f.o.AssertSourceCurrent(context.Background()); e != ErrUnknown {
		t.Fatal(e)
	}
	if e := f.o.AssertSourceCurrent(context.Background()); e == nil {
		t.Fatal("retried unknown")
	}
	f.state.mu.Lock()
	defer f.state.mu.Unlock()
	if f.state.cas != before {
		t.Fatal("mutated after conflict")
	}
}
func TestOriginalIDEFactoryPublisherAndPrincipalSubstitutionRejected(t *testing.T) {
	f := ideSourceFactoryFixture(t)
	bad := f.key
	bad.PublicOriginal = []byte("foreign-R13")
	if e := f.o.AssertPublisherCurrent(context.Background(), f.p, bad); e == nil {
		t.Fatal("foreign key")
	}
	p := f.p
	p.SessionGeneration++
	if e := f.o.AssertPublisherCurrent(context.Background(), p, f.key); e == nil {
		t.Fatal("foreign principal")
	}
}
func TestOriginalIDEFactoryForeignCurrentResultHashNeverAdmitsNativeResult(t *testing.T) {
	f := ideSourceFactoryFixture(t)
	key := "artifact/" + f.p.Account + "/" + f.ref
	f.state.mu.Lock()
	var input originalIDESourceInput
	if json.Unmarshal(f.state.records[key], &input) != nil {
		t.Fatal("fixture")
	}
	var profile map[string]json.RawMessage
	_ = json.Unmarshal([]byte(input.Profile), &profile)
	profile["extra"] = mustIDEJSON(t, map[string]string{"resultHash": hash([]byte("PUBLIC_FOREIGN_RESULT"))})
	before := hash([]byte(input.Profile))
	input.Profile = string(mustIDEJSON(t, profile))
	f.state.records[key] = mustIDEJSON(t, input)
	f.state.heads[hash([]byte(input.Profile))] = bytes.Clone(f.state.heads[before])
	f.state.mu.Unlock()
	access := Access{Principal: f.p, ProjectID: "project", CurrentReference: "project-current", ProjectRevision: 3, Publish: true, ExpiresMS: f.key.ExpiresMS}
	if _, e := f.o.VerifyOriginalArtifactApproval(context.Background(), f.p, access, f.key, f.binding, f.manifest, f.request, f.result, f.signature, f.ref); e == nil {
		t.Fatal("current admitted a different Native result")
	}
}
