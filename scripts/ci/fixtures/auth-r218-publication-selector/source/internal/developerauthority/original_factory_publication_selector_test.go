package developerauthority

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Real fixed pinner/process, original HTTP/TLS and SQL APIs below. Child math
// and Source metadata are PUBLIC fixtures; real original N1+Node24 CLI tests
// are test-signed-manifest-selector.mjs, never Root/registration proof.
func r218SelectorFixture(t *testing.T, wrongPublisher bool) (*OriginalDeveloperSourceFactory, *r216ReaderDB, Principal, Publisher, []byte) {
	t.Helper()
	at := time.Now().UnixMilli()
	p := Principal{"PUBLIC_ACCOUNT", "PUBLIC_DEVICE", "PUBLIC_SESSION", "PUBLIC_CURRENT", 9007199254740993, 18446744073709551615, at + 28000}
	public := []byte("PUBLIC_INDEPENDENT_SOURCE_SELECTED_KEY")
	k := Publisher{Account: p.Account, ProjectID: "PUBLIC_PROJECT", PublisherID: "PUBLIC_PUBLISHER", KeyRole: "ide-artifact-publisher", PublicSHA256: hash(public), PublicOriginal: public, RegistrationRef: "PUBLIC_REG", Revision: 9007199254740993, ExpiresMS: at + 26000}
	s := r216ProjectProjection(p, k)
	snapshot, _ := json.Marshal(map[string]any{"projection": s, "currentRaw": "PUBLIC_NOT_SIGNED_SOURCE"})
	manifest, _ := json.Marshal(ArtifactBinding{ProjectID: k.ProjectID, Version: "PUBLIC_VERSION", ContentDigest: strings.Repeat("a", 64), PublishPurpose: "PUBLIC", TargetEnvironment: "PUBLIC_NO_DEPLOY", ByteSize: 1})
	id := k.PublisherID
	if wrongPublisher {
		id = "PUBLIC_FOREIGN_PUBLISHER"
	}
	math, _ := json.Marshal(map[string]any{"networkId": strings.Repeat("ab", 32), "subjectOwner": s.Owner, "account": p.Account, "projectId": k.ProjectID, "publisherId": id, "publisherKeyVersion": "9007199254740993", "purpose": "ARTIFACT-RELEASE", "keyRole": "ide-artifact-publisher", "signatureVerified": true, "memberCount": 1, "memberIndex": 0, "dataOnly": true, "trusted": false, "authorized": false, "nativeAdmission": false, "registered": false, "current": false, "publicationAuthorized": false, "manifestOriginal": base64.RawURLEncoding.EncodeToString(manifest)})
	expected, _ := json.Marshal(base64.RawURLEncoding.EncodeToString(public))
	script := fixtureRead + "const inputObject=JSON.parse(input);let out;if(inputObject.operation==='ide-artifact-signed-manifest-data/v1'){if(inputObject.expectedPublicOriginal!==" + string(expected) + ")throw Error('PUBLIC_UNBOUND_EXPECTED_KEY');out=" + string(math) + ";}else{out=" + string(snapshot) + ";out.projection.timeFloor=Date.now();}process.stdout.write(JSON.stringify(out)+'\\n');"
	verifier, _, _ := openFixtureProcess(t, script)
	var in map[string]any
	_ = json.Unmarshal(fixtureCurrentInput(), &in)
	in["profileRaw"] = "PUBLIC_PROJECT_PROFILE"
	in["policy"] = map[string]any{"signatureContract": map[string]any{"purpose": "ide-project-authority-v1"}}
	source, _ := json.Marshal(in)
	state := &r216ReaderDB{key: k, active: true}
	db := sql.OpenDB(r216ReaderConnector{state})
	t.Cleanup(func() { db.Close() })
	f := &OriginalDeveloperSourceFactory{principal: r216Principal(t, p), control: &OriginalProjectControlRuntime{db: db, verifier: verifier, now: time.Now}, publisher: &originalFactoryPublisher{store: &originalPublisherCaptureStore{db: db, ready: true}, projectSource: source, projectProfile: s.Profile, pending: map[string]*originalFactoryPublisherPending{}}}
	t.Cleanup(func() { f.Close() })
	return f, state, p, k, []byte("PUBLIC_MEMBER_FIXTURE_NOT_REAL_CRYPTO")
}

func TestR218FactorySelectorActualIndependentSourceProcessSQLAndTypedCallee(t *testing.T) {
	f, state, p, k, signature := r218SelectorFixture(t, false)
	id, e := f.OriginalPublicationPublisherID(context.Background(), p, signature)
	if e != nil || id != k.PublisherID {
		t.Fatal("actual owned selector", e)
	}
	r := f.publisher.publicationSelections[objectHash(p)+":"+hash(signature)]
	if r == nil || r.result != nil || r.mathematics == nil || len(r.mathematics.manifest) == 0 || r.mathematics.publisher != id || len(f.publisher.projectOriginals) != 3 || state.reads != 2 {
		t.Fatal("actual pending/original/current/binding custody")
	}
	signature[0] ^= 1
	if string(r.signature) == string(signature) {
		t.Fatal("caller signature aliased")
	}
}
func TestR218FactorySelectorForeignPublisherIsStickyAndRetainsActualPartial(t *testing.T) {
	f, state, p, _, signature := r218SelectorFixture(t, true)
	if id, e := f.OriginalPublicationPublisherID(context.Background(), p, signature); e == nil || id != "" {
		t.Fatal("foreign publisher selected")
	}
	r := f.publisher.publicationSelections[objectHash(p)+":"+hash(signature)]
	if r == nil || r.mathematics == nil || r.result == nil || state.reads != 0 {
		t.Fatal("actual partial lost or key promoted")
	}
	first := r.result
	if id, e := f.OriginalPublicationPublisherID(context.Background(), p, signature); e != first || id != "" || len(f.publisher.projectOriginals) != 1 {
		t.Fatal("failed selector reentered/replaced")
	}
}
func TestR218FactorySelectorMathematicsCannotReplaceAbsentRegistry(t *testing.T) {
	f, state, p, _, signature := r218SelectorFixture(t, false)
	state.active = false
	if id, e := f.OriginalPublicationPublisherID(context.Background(), p, signature); e == nil || id != "" {
		t.Fatal("mathematics became registration")
	}
	r := f.publisher.publicationSelections[objectHash(p)+":"+hash(signature)]
	if r == nil || r.mathematics == nil || r.result == nil || state.reads != 1 {
		t.Fatal("registry guard not actually reached")
	}
}
func TestR218FactorySelectorFinalSQLExpiryRetainsUnknown(t *testing.T) {
	f, state, p, k, signature := r218SelectorFixture(t, false)
	state.afterSecond = func() { f.control.now = func() time.Time { return time.UnixMilli(k.ExpiresMS) } }
	if id, e := f.OriginalPublicationPublisherID(context.Background(), p, signature); e == nil || id != "" {
		t.Fatal("final SQL expiry promoted selector")
	}
	r := f.publisher.publicationSelections[objectHash(p)+":"+hash(signature)]
	if r == nil || r.mathematics == nil || r.result != ErrUnknown {
		t.Fatal("actual failed completion custody lost")
	}
}
func TestR218SignedManifestDecoderRejectsGrantAndDuplicateProjection(t *testing.T) {
	var nilOwner *OriginalSourceVerifierOwner
	if r, e := nilOwner.inspectOriginalSignedManifest(context.Background(), nil, nil); e == nil || r != nil {
		t.Fatal("empty input")
	}
	for _, raw := range []string{`{"authorized":true}` + "\n", `{"manifestOriginal":"QQ","manifestOriginal":"Qg"}` + "\n", `{}`} {
		if r, e := decodeOriginalSignedManifest([]byte(raw)); e == nil || r != nil {
			t.Fatal("unverified projection accepted")
		}
	}
}
