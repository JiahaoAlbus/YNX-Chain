package developerauthority

import (
	"bytes"
	"context"
	"crypto/x509"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// Actual normal HTTP/TLS owner and pinned Node process are invoked. These
// child/DB/remote metadata are explicit PUBLIC fixtures, not Root/PG admission.
func r216Principal(t *testing.T, p Principal) *OriginalDeveloperHTTPAuthority {
	t.Helper()
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in originalHTTPPrincipalInput
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			w.WriteHeader(400)
			return
		}
		raw, _ := json.Marshal(p)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"version": "YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v1", "principalOriginal": string(raw), "principalSHA256": hash(raw), "profileDigest": strings.Repeat("b", 64), "currentRaw": "PUBLIC-not-Root", "method": in.Method, "path": in.Path, "bodyDigest": hash([]byte(in.Body)), "expiresAtMs": p.ExpiresMS, "dataOnly": true, "authorized": false, "nativeAdmission": false})
	}))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	t.Cleanup(server.Close)
	o, e := OpenOriginalDeveloperHTTPAuthority(OriginalDeveloperHTTPAuthorityConfig{hash(server.Certificate().RawSubjectPublicKeyInfo)})
	if e != nil {
		t.Fatal(e)
	}
	pool := x509.NewCertPool()
	pool.AddCert(server.Certificate())
	o.transport.TLSClientConfig.RootCAs = pool
	o.transport.TLSClientConfig.ServerName = server.Certificate().DNSNames[0]
	o.endpoint = server.URL + "/v1/developer/original-http-principal"
	if actual, e := o.CurrentExistingPrincipal(context.Background(), actualPrincipalRequest()); e != nil || actual != p {
		t.Fatal("one original authentication", e)
	}
	t.Cleanup(func() { o.Close() })
	return o
}

func r216Factory(t *testing.T) (*OriginalDeveloperSourceFactory, *publisherCaptureDB, Principal, Command, []byte, []byte) {
	t.Helper()
	v, input, p, c, public, proof, caller := publisherCurrentProcessFixture(t, "")
	var in struct {
		Source json.RawMessage `json:"source"`
	}
	if json.Unmarshal(input, &in) != nil {
		t.Fatal("source")
	}
	state := &publisherCaptureDB{rows: map[string][]driver.Value{}, nonces: map[string]bool{}, heads: map[string][]driver.Value{}, schema: 1}
	db := sql.OpenDB(publisherCaptureConnector{state})
	t.Cleanup(func() { db.Close() })
	s, e := openOriginalPublisherCaptureStore(context.Background(), db)
	if e != nil {
		t.Fatal(e)
	}
	f := &OriginalDeveloperSourceFactory{principal: r216Principal(t, p), control: &OriginalProjectControlRuntime{db: db, verifier: v, source: in.Source, profile: hash([]byte("PUBLIC_PROFILE")), caller: caller, now: time.Now}, publisher: &originalFactoryPublisher{store: s, pending: map[string]*originalFactoryPublisherPending{}}}
	t.Cleanup(func() { f.Close() })
	return f, state, p, c, public, proof
}

func TestR216FactoryCaptureActualNormalCallsOnceConcurrent(t *testing.T) {
	f, s, p, c, public, proof := r216Factory(t)
	var wg sync.WaitGroup
	results := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- f.captureOriginalPublisherRegistration(context.Background(), p, c, public, proof)
		}()
	}
	wg.Wait()
	close(results)
	for e := range results {
		if e != nil {
			t.Fatal(e)
		}
	}
	r := f.publisher.pending[publisherPendingKey(p, c)]
	if s.writes != 1 || s.queries != 1 || r == nil || r.observation == nil || r.attempt == nil || !r.attempt.completed.Load() || r.attempt.receipt == nil {
		t.Fatal("real retained custody/SQL once")
	}
	k, e := f.VerifyProtectedPublisherOriginal(context.Background(), p, c, public)
	if e != nil || k.RegistrationRef != r.attempt.registration || k.ExpiresMS != c.GrantExpiresMS {
		t.Fatal("actual verified capture callee", e)
	}
	public[0] ^= 1
	proof[0] ^= 1
	if !bytes.Equal(r.public, r.attempt.public) || !bytes.Equal(r.proof, r.attempt.proof) {
		t.Fatal("caller originals aliased")
	}
	if _, e = f.VerifyProtectedPublisherOriginal(context.Background(), p, c, public); e == nil {
		t.Fatal("substitution accepted")
	}
}

func TestR216FactoryCaptureUnknownPreservedAfterReadbackAndNoReentry(t *testing.T) {
	f, s, p, c, public, proof := r216Factory(t)
	s.lost = true
	if e := f.captureOriginalPublisherRegistration(context.Background(), p, c, public, proof); e != ErrUnknown {
		t.Fatal(e)
	}
	r := f.publisher.pending[publisherPendingKey(p, c)]
	if r == nil || r.attempt == nil || r.attempt.firstCause == nil {
		t.Fatal("actual failed partial lost")
	}
	if _, e := f.publisher.store.observeOriginal(context.Background(), r.attempt); e != nil {
		t.Fatal(e)
	}
	s.lost = false
	if e := f.captureOriginalPublisherRegistration(context.Background(), p, c, public, proof); e != ErrUnknown {
		t.Fatal("UNKNOWN cleared", e)
	}
	if _, e := f.VerifyProtectedPublisherOriginal(context.Background(), p, c, public); e == nil {
		t.Fatal("readback promoted UNKNOWN")
	}
	if s.writes != 1 {
		t.Fatal("replayed insert")
	}
	changed := append([]byte(nil), proof...)
	changed[0] ^= 1
	if e := f.captureOriginalPublisherRegistration(context.Background(), p, c, public, changed); e != ErrConflict {
		t.Fatal("same capture proof substitution", e)
	}
}

func TestR216FactoryMissingInflightClosedCaptureCannotPromote(t *testing.T) {
	f, s, p, c, public, proof := r216Factory(t)
	if _, e := f.VerifyProtectedPublisherOriginal(context.Background(), p, c, public); e == nil {
		t.Fatal("no capture")
	}
	if e := f.captureOriginalPublisherRegistration(context.Background(), p, c, public, proof); e != nil {
		t.Fatal(e)
	}
	r := f.publisher.pending[publisherPendingKey(p, c)]
	r.attempt.completed.Store(false)
	if _, e := f.VerifyProtectedPublisherOriginal(context.Background(), p, c, public); e == nil {
		t.Fatal("inflight receipt")
	}
	r.attempt.completed.Store(true)
	if e := f.Close(); e != nil {
		t.Fatal(e)
	}
	if e := f.Close(); e != nil {
		t.Fatal("first close result", e)
	}
	if _, e := f.VerifyProtectedPublisherOriginal(context.Background(), p, c, public); e == nil {
		t.Fatal("closed")
	}
	if e := f.captureOriginalPublisherRegistration(context.Background(), p, c, public, proof); e == nil || s.writes != 1 {
		t.Fatal("closed reentry", e)
	}
	if strings.Contains(fmt.Sprintf("%#v|%#v", f.publisher, r), string(public)) {
		t.Fatal("raw custody formatted")
	}
}

type r216ParticipantSource struct {
	*catalogPublisherSourceFixture
	factory *OriginalDeveloperSourceFactory
}

func (s *r216ParticipantSource) bindOriginalPublisherCatalog(ctx context.Context, o *originalPublisherCatalogOperation) error {
	return s.factory.bindOriginalPublisherCatalog(ctx, o)
}
func TestR216FactoryParticipantRunsOriginalCatalogTransaction(t *testing.T) {
	c, s, state := catalogPublisherFixture(t)
	a := s.attempt
	f := &OriginalDeveloperSourceFactory{principal: &OriginalDeveloperHTTPAuthority{}, control: &OriginalProjectControlRuntime{}, publisher: &originalFactoryPublisher{store: s.store, pending: map[string]*originalFactoryPublisherPending{publisherPendingKey(a.principal, a.command): {principal: a.principal, command: a.command, public: a.public, proof: a.proof, observation: a.observation, attempt: a, selected: true}}}}
	c.source = &r216ParticipantSource{s, f}
	result, e := c.ApplyControl(context.Background(), httptest.NewRequest("POST", "https://PUBLIC.invalid/", nil), s.c, s.proof, a.public)
	if e != nil || result == nil || !result.Committed || state.bindingWrites != 1 || len(f.publisher.operations) != 1 || f.publisher.operations[0].store != s.store {
		t.Fatal("factory actual private transaction participant", e)
	}
}

type r216CallerSource struct {
	*catalogPublisherSourceFixture
	authenticated, captured int
	failure                 error
}

func (s *r216CallerSource) CurrentExistingPrincipal(ctx context.Context, r *http.Request) (Principal, error) {
	s.authenticated++
	return s.catalogPublisherSourceFixture.CurrentExistingPrincipal(ctx, r)
}
func (s *r216CallerSource) captureOriginalPublisherRegistration(context.Context, Principal, Command, []byte, []byte) error {
	s.captured++
	return s.failure
}
func TestR216CatalogPublisherCallerAuthenticatesOnceAndNeverSubstitutesConsent(t *testing.T) {
	c, s, state := catalogPublisherFixture(t)
	source := &r216CallerSource{catalogPublisherSourceFixture: s, failure: ErrUnknown}
	c.source = source
	if _, e := c.ApplyPublisherControl(context.Background(), httptest.NewRequest("POST", "https://PUBLIC.invalid/", nil), s.c, s.proof, s.attempt.public, s.attempt.proof); e != ErrUnknown {
		t.Fatal(e)
	}
	if source.authenticated != 1 || source.captured != 1 || state.commits != 0 || state.bindingWrites != 0 {
		t.Fatal("second HTTP auth or consent/transaction after unknown")
	}
	if _, e := c.ApplyPublisherControl(context.Background(), httptest.NewRequest("POST", "https://PUBLIC.invalid/", nil), s.c, s.proof, s.attempt.public, nil); e == nil || source.authenticated != 1 {
		t.Fatal("absent original registration proof")
	}
}

func r216ProjectProjection(p Principal, k Publisher) originalControlSourceProjection {
	principal := map[string]any{"account": p.Account, "deviceId": p.DeviceID, "sessionRef": p.SessionRef, "currentRef": p.CurrentRef, "accountGeneration": fmt.Sprint(p.AccountGeneration), "sessionGeneration": fmt.Sprint(p.SessionGeneration), "expiresMS": p.ExpiresMS}
	project := map[string]any{"projectId": k.ProjectID, "ownerAccount": p.Account, "runtimeOrigin": "", "currentReference": "PUBLIC_REFERENCE", "projectRevision": "1", "catalogRevision": "1", "read": true, "publish": true, "runtime": false, "expiresMS": p.ExpiresMS}
	publisher := map[string]any{"account": k.Account, "projectId": k.ProjectID, "publisherId": k.PublisherID, "keyRole": k.KeyRole, "publicOriginal": base64.RawURLEncoding.EncodeToString(k.PublicOriginal), "publicSHA256": k.PublicSHA256, "registrationRef": k.RegistrationRef, "revision": fmt.Sprint(k.Revision), "expiresMS": k.ExpiresMS, "revoked": k.Revoked}
	selection, _ := json.Marshal(map[string]any{"projectAuthority": map[string]any{"principal": principal, "project": project, "publisher": publisher, "endpoint": "https://developer.ynxweb4.com/api/developer/projects", "spki": strings.Repeat("a", 64)}})
	return originalControlSourceProjection{Selection: selection, Principal: p.Account, Status: "active", Expires: p.ExpiresMS, TimeFloor: time.Now().UnixMilli(), Profile: hash([]byte("PUBLIC_PROJECT_PROFILE")), SourceID: "PUBLIC_PROJECT_SOURCE", InstanceID: "PUBLIC_INSTANCE", Owner: "0x" + strings.Repeat("1", 40), KeyVersion: "1", Generation: 1, Sequence: 1, Floor: 1, Head: strings.Repeat("a", 64), Height: "1", Data: true}
}
func TestR216DedicatedProjectPublisherExactOriginalAndTimeFence(t *testing.T) {
	_, _, p, c, public, _ := r216Factory(t)
	k := Publisher{Account: p.Account, ProjectID: c.ProjectID, PublisherID: c.PublisherID, KeyRole: "ide-artifact-publisher", PublicSHA256: hash(public), RegistrationRef: "PUBLIC_REF", PublicOriginal: public, Revision: 9007199254740993, ExpiresMS: c.GrantExpiresMS}
	s := r216ProjectProjection(p, k)
	at := time.Now().UnixMilli()
	if !originalFactoryProjectPublisherMatches(s, p, k, at) {
		t.Fatal("exact U64/original")
	}
	for _, kind := range []string{"expiry", "account", "key", "revision", "revoked", "permission", "null"} {
		t.Run(kind, func(t *testing.T) {
			changed := s
			var selection map[string]any
			_ = json.Unmarshal(s.Selection, &selection)
			a := selection["projectAuthority"].(map[string]any)
			j := a["project"].(map[string]any)
			v := a["publisher"].(map[string]any)
			switch kind {
			case "expiry":
				changed.Expires = at
			case "account":
				a["principal"].(map[string]any)["account"] = "FOREIGN"
			case "key":
				v["publicOriginal"] = base64.RawURLEncoding.EncodeToString([]byte("FOREIGN"))
			case "revision":
				v["revision"] = "9007199254740992"
			case "revoked":
				v["revoked"] = true
			case "permission":
				j["publish"] = false
			case "null":
				a["publisher"] = nil
			}
			changed.Selection, _ = json.Marshal(selection)
			if originalFactoryProjectPublisherMatches(changed, p, k, at) {
				t.Fatal("current substitution accepted")
			}
		})
	}
}

func TestR216FactoryPublisherConstructorRetainsActualSchemaPartialAndCallerPool(t *testing.T) {
	_, state, _, _, _, _ := r216Factory(t)
	db := sql.OpenDB(publisherCaptureConnector{state})
	defer db.Close()
	control := &OriginalProjectControlRuntime{db: db}
	source := []byte(`{"profileRaw":"PUBLIC_PROJECT_PROFILE","policy":{"signatureContract":{"purpose":"ide-project-authority-v1"}}}`)
	v, e := openOriginalFactoryPublisher(context.Background(), db, control, source)
	// The original schema is intentionally missing, not silently created.
	if e == nil || v == nil || v.store == nil || v.firstCause == nil {
		t.Fatal("actual failed owned partial was dropped")
	}
	if e = v.close(); e != ErrUnknown {
		t.Fatal(e)
	}
	if v.close() != e {
		t.Fatal("first close changed")
	}
	var revision int
	if e = db.QueryRow(`SELECT revision FROM public.auth_ide_publisher_capture_schema WHERE singleton=1`).Scan(&revision); e != nil || revision != 1 {
		t.Fatal("factory closed caller pool", e)
	}
	if v, e := openOriginalFactoryPublisher(context.Background(), db, control, []byte(`{"profileRaw":"PUBLIC","policy":{"signatureContract":{"purpose":"ide-project-control-authority-v1"}}}`)); e == nil || v != nil {
		t.Fatal("control Source substituted for dedicated project Source")
	}
}
