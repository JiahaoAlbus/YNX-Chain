package developerauthority

// Actual Go HTTP -> durable SQL fixture -> OS child -> terminal DB -> HTTP
// path. The child explicitly returns PUBLIC metadata, not Root cryptography.
import (
	"bytes"
	"context"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

const approvalIssuerPublicChild = `let raw='';for await(const b of process.stdin)raw+=b;const q=JSON.parse(raw),result=JSON.stringify({version:'YNX-IDE-APPROVAL-CURRENT/v1',binding:{PUBLIC:true},scopeOriginal:q.scopeOriginal,currentOriginal:q.currentOriginal,memberOriginal:'PUBLIC-not-Root-proof'});process.stdout.write(JSON.stringify({version:'YNX-AUTH-PUBLICATION-ISSUER-RESULT/v1',status:'current',resultOriginal:result,errorCode:'',dataOnly:true,authorized:false})+'\n');`

func issuerFixture(t *testing.T, child string) (*originalApprovalIssuerOwner, *approvalFixture, *originalApprovalRow) {
	t.Helper()
	db, state, c := newApprovalFixture(t)
	store := openApprovalFixture(t, db, c)
	scope := publicApprovalScope()
	scope.original = []byte(`{"kind":"artifact","PUBLIC":"not-an-admitted-scope"}`)
	scope.digest = hash(scope.original)
	w, e := store.prepare(context.Background(), scope)
	if e != nil {
		t.Fatal(e)
	}
	w, e = store.transition(context.Background(), w.scope.ref, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", w.stateSHA256, "approved", "signed-unhanded", 0, []byte("PUBLIC-native-result"))
	if e != nil {
		t.Fatal(e)
	}
	cfg, _ := fixtureSourceProcess(t, "// PUBLIC unused read-only entry")
	p := filepath.Join(cfg.SDKRoot, originalApprovalIssuerEntry)
	if e = os.Mkdir(filepath.Dir(p), 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(p, []byte(child), 0600); e != nil {
		t.Fatal(e)
	}
	pin := fixturePin(t, p)
	pin.Path = originalApprovalIssuerEntry
	cfg.SDKFiles = append(cfg.SDKFiles, pin)
	o, e := openOriginalApprovalIssuer(context.Background(), c, store, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { o.Close(); store.Close() })
	return o, state, w
}

func queryRequest(o *originalApprovalIssuerOwner, w *originalApprovalRow, n string) string {
	v := url.Values{"profile": {o.store.config.profileSHA256}, "approvalRef": {w.scope.ref}, "scope": {w.scope.digest}, "nonce": {n}}
	return originalApprovalQueryPath + "?" + v.Encode()
}

func TestApprovalIssuerActualHTTPDurableChildCompletionAndReplay(t *testing.T) {
	o, state, w := issuerFixture(t, approvalIssuerPublicChild)
	req := queryRequest(o, w, nonce(25))
	response := httptest.NewRecorder()
	o.ServeHTTP(response, httptest.NewRequest("GET", req, nil))
	if response.Code != 200 || o.lastQuery == nil || o.lastQuery.phase != "terminal" || response.Body.String() != string(o.lastQuery.envelopeOriginal) {
		t.Fatal(response.Code, o.phase, o.store.phase)
	}
	writes := state.writes
	again := httptest.NewRecorder()
	o.ServeHTTP(again, httptest.NewRequest("GET", req, nil))
	if again.Code == 200 || state.writes != writes {
		t.Fatal("replayed original nonce")
	}
	if _, ok := any(o).(OriginalSource); ok {
		t.Fatal("private issuer became Source13")
	}
}

func TestApprovalIssuerActualChildPartialPreservedBeforeExit(t *testing.T) {
	o, _, w := issuerFixture(t, approvalIssuerPublicChild+"process.exitCode=1;")
	r := httptest.NewRecorder()
	o.ServeHTTP(r, httptest.NewRequest("GET", queryRequest(o, w, nonce(26)), nil))
	if r.Code == 200 || o.lastQuery == nil || len(o.lastQuery.envelopeOriginal) == 0 || len(o.stdout) == 0 || o.store.firstCause == nil {
		t.Fatal("partial or UNKNOWN lost")
	}
	if o.Close() != ErrUnknown || o.Close() != ErrUnknown {
		t.Fatal("first close result lost")
	}
}

func TestApprovalIssuerPostDurableRevocationNeverWritesOriginal(t *testing.T) {
	o, state, w := issuerFixture(t, approvalIssuerPublicChild)
	// During terminal DB completion, not during reserve: revoke original state.
	state.afterWrite = func() {
		for _, q := range state.queries {
			if q.phase == "terminal" {
				k := o.store.config.source + "/" + o.store.config.instance + "/" + w.scope.ref
				r := state.records[k]
				r.w.sequence++
				r.w.decision = "revoked"
				r.w.stateSHA256 = r.w.digest()
				state.records[k] = r
			}
		}
	}
	r := httptest.NewRecorder()
	o.ServeHTTP(r, httptest.NewRequest("GET", queryRequest(o, w, nonce(27)), nil))
	if r.Code == 200 || o.store.phase != "QUERY_DELIVERY_POST_CURRENT" || len(o.lastQuery.envelopeOriginal) == 0 {
		t.Fatal(r.Code, o.phase, o.store.phase)
	}
}

func TestApprovalIssuerMalformedHTTPCannotStartChildOrReserve(t *testing.T) {
	o, state, w := issuerFixture(t, approvalIssuerPublicChild)
	before := state.writes
	for _, suffix := range []string{"&nonce=" + nonce(28), "&keyPath=/PUBLIC", "&bad=%zz"} {
		r := httptest.NewRecorder()
		o.ServeHTTP(r, httptest.NewRequest("GET", queryRequest(o, w, nonce(28))+suffix, nil))
		if r.Code == 200 {
			t.Fatal("bad input accepted")
		}
	}
	if state.writes != before || len(o.stdout) != 0 || o.firstCause != nil {
		t.Fatal("public malformed poisoned/reserved")
	}
}

func TestApprovalIssuerCanonicalCurrentPreservesOpaqueReferences(t *testing.T) {
	o, _, w := issuerFixture(t, approvalIssuerPublicChild)
	q := &originalApprovalQueryDATA{row: *w, nonce: nonce(29), observedMS: 1000}
	q.row.scope.confirmation = "PUBLIC<>&\u2028🦋"
	raw, e := approvalQueryCurrentOriginal(q, 1000)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(raw, []byte("PUBLIC<>&\u2028🦋")) || bytes.Contains(raw, []byte(`\u003c`)) || bytes.Contains(raw, []byte(`\u2028`)) {
		t.Fatal("original references changed")
	}
	if o.store.config.profileSHA256 == "" {
		t.Fatal("missing normal config")
	}
}
