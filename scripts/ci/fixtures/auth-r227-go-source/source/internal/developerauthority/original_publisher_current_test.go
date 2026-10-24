package developerauthority

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Actual pinned process/FD/inventory boundary, PUBLIC child metadata only.
// This fixture does not prove Root/Source authority or dual-PQ mathematics;
// real dual-PQ member tests are R211 and are not rerun by this group.
func publisherCurrentProcessFixture(t *testing.T, mutation string) (*OriginalSourceVerifierOwner, []byte, Principal, Command, []byte, []byte, string) {
	t.Helper()
	at := time.Now().UnixMilli()
	p := Principal{"PUBLIC_ACCOUNT", "PUBLIC_DEVICE", "PUBLIC_SESSION", "PUBLIC_CURRENT", 9007199254740993, 18446744073709551615, at + 28000}
	public := []byte("PUBLIC_ORIGINAL_PUBLISHER")
	c := Command{RequestID: "PUBLIC_REQUEST", Action: "project.publisher", ProjectID: "PUBLIC_PROJECT", SubjectAccount: p.Account, PublisherID: "PUBLIC_PUBLISHER", ExpectedRevision: 1, GrantExpiresMS: at + 26000, ExpiresMS: at + 27000, PublicOriginalSHA256: hash(public)}
	nonce := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("n", 32)))
	caller := "PUBLIC_CODE"
	ref := "PUBLIC_REGISTRATION"
	profile := "PUBLIC_PROFILE"
	praw, _ := json.Marshal(p)
	craw, _ := json.Marshal(c)
	capture := map[string]any{"version": "YNX-IDE-PROJECT-CONTROL-CAPTURE/v1", "review": map[string]any{"publisher": map[string]any{"Account": c.SubjectAccount, "ProjectID": c.ProjectID, "PublisherID": c.PublisherID, "KeyRole": "ide-artifact-publisher", "PublicSHA256": hash(public), "RegistrationRef": ref, "ExpiresMS": fmt.Sprint(c.GrantExpiresMS)}}, "requestOriginal": base64.RawURLEncoding.EncodeToString([]byte("PUBLIC_REQUEST_ORIGINAL")), "principalOriginal": base64.RawURLEncoding.EncodeToString(praw), "commandOriginal": base64.RawURLEncoding.EncodeToString(craw), "expiresAtMs": fmt.Sprint(at + 24000)}
	captureRaw, _ := json.Marshal(capture)
	selection := map[string]any{"projectControlCapture": capture, "identityPeerBinding": map[string]any{"walletCodeIdentity": caller}, "projectPublisherRegistrationCapture": map[string]any{"version": "YNX-IDE-PUBLISHER-REGISTRATION-CAPTURE/v1", "requestId": c.RequestID, "registrationRef": ref, "nonce": nonce, "principalSHA256": objectHash(p), "commandSHA256": objectHash(c), "publicSHA256": hash(public)}}
	body, _ := json.Marshal(map[string]any{"nonce": nonce, "registrationRef": ref})
	proof, _ := json.Marshal(map[string]any{"registrationOriginal": string(body)})
	snapshot := map[string]any{"projection": map[string]any{"selection": selection, "principalId": p.Account, "subjectOwner": "0x" + strings.Repeat("1", 40), "subjectKeyVersion": "1", "generation": 1, "sequence": 2, "floor": 1, "head": hash(captureRaw), "status": "active", "timeFloor": at, "expiresAtMs": at + 25000, "profileDigest": hash([]byte(profile)), "sourceId": "PUBLIC_SOURCE", "instanceId": "PUBLIC_INSTANCE", "executionHeight": "18446744073709551614", "dataOnly": true, "nativeAdmission": false}, "currentRaw": "PUBLIC_NOT_SIGNED"}
	projection := originalPublisherProjection{Account: c.SubjectAccount, ProjectID: c.ProjectID, PublisherID: c.PublisherID, KeyRole: "ide-artifact-publisher", PublicSHA256: hash(public), RegistrationRef: ref, PrincipalSHA256: objectHash(p), CommandSHA256: objectHash(c), ProofSHA256: hash(proof), ExpiresMS: at + 20000, SignatureVerified: true, IndependentCustodian: true, DataOnly: true}
	out := map[string]any{"version": "YNX-IDE-PUBLISHER-CURRENT-VERIFICATION-DATA/v1", "completed": true, "sourceBefore": snapshot, "sourceAfter": snapshot, "registrationOriginal": string(proof), "projection": projection, "failureCode": "", "dataOnly": true, "authorized": false, "registered": false, "protectedCustodyAdmitted": false, "nativeAdmission": false}
	payload, _ := json.Marshal(out)
	script := fixtureRead + "const out=" + string(payload) + ";out.sourceBefore.projection.timeFloor=Date.now();out.sourceAfter=structuredClone(out.sourceBefore);" + mutation + "process.stdout.write(JSON.stringify(out)+'\\n');"
	owner, _, _ := openFixtureProcess(t, script)
	source := map[string]any{"profileRaw": profile, "policy": map[string]any{"signatureContract": map[string]any{"purpose": "ide-project-control-authority-v1"}}}
	input, _ := json.Marshal(map[string]any{"operation": "ide-protected-publisher-current-native-node/v1", "source": source, "registrationOriginal": string(proof), "principal": originalControlPrincipalDTO(p), "command": originalControlCommandDTO(c)})
	return owner, input, p, c, public, proof, caller
}

func TestOriginalPublisherCurrentNormalPinnedProcessAndRetainedOriginals(t *testing.T) {
	o, input, p, c, public, proof, caller := publisherCurrentProcessFixture(t, "")
	r, e := o.invokeOriginalProtectedPublisherCurrent(context.Background(), input, p, c, public, proof, caller)
	if e != nil || r == nil {
		t.Fatal(e, o.FailurePhase())
	}
	if len(r.before) == 0 || len(r.after) == 0 || len(r.original) == 0 || r.reviewExpiresMS != c.GrantExpiresMS || !r.projection.IndependentCustodian || r.projection.Registered {
		t.Fatal("actual original lost/promoted")
	}
	if _, ok := any(o).(OriginalSource); ok {
		t.Fatal("process owner became Source")
	}
}

func TestOriginalPublisherCurrentNormalPinnedProcessRejectsSubstitutionAndPromotion(t *testing.T) {
	for name, mutation := range map[string]string{
		"post_source_changed":        "out.sourceAfter.projection.generation++;",
		"publisher_ref_substitution": "out.projection.registrationRef='OTHER';",
		"wrong_proof":                "out.registrationOriginal+='X';",
		"independent_pair_missing":   "out.projection.independentCustodianPairVerified=false;",
		"registered_promotion":       "out.registered=true;",
		"capture_nonce_substitution": "out.sourceBefore.projection.selection.projectPublisherRegistrationCapture.nonce='QQ';out.sourceAfter=structuredClone(out.sourceBefore);",
		"capture_head_unbound":       "out.sourceBefore.projection.head='f'.repeat(64);out.sourceAfter=structuredClone(out.sourceBefore);",
		"post_expired":               "out.sourceAfter.projection.expiresAtMs=Date.now()-1;",
	} {
		t.Run(name, func(t *testing.T) {
			o, input, p, c, public, proof, caller := publisherCurrentProcessFixture(t, mutation)
			_, e := o.invokeOriginalProtectedPublisherCurrent(context.Background(), input, p, c, public, proof, caller)
			if e == nil || len(o.processStdout) == 0 {
				t.Fatal("substitution accepted or raw lost", e, o.FailurePhase())
			}
		})
	}
}

func TestOriginalPublisherCurrentRejectsInvalidInputBeforeProcess(t *testing.T) {
	o, input, p, c, public, proof, caller := publisherCurrentProcessFixture(t, "")
	c.Revoke = true
	c.GrantExpiresMS = 0
	if r, e := o.invokeOriginalProtectedPublisherCurrent(context.Background(), input, p, c, public, proof, caller); e != ErrDenied || r != nil || len(o.processStdout) != 0 {
		t.Fatal("revocation dispatched as registration")
	}
}

func TestOriginalPublisherCurrentPostIOCompletionIsStickyAndRetainsOriginal(t *testing.T) {
	o, input, p, c, public, proof, caller := publisherCurrentProcessFixture(t, "")
	r, e := o.invokeOriginalProtectedPublisherCurrent(context.Background(), input, p, c, public, proof, caller)
	if e != nil || r == nil {
		t.Fatal(e, o.FailurePhase())
	}
	if e = r.recheckOriginalCompletion(context.Background(), p, c, public, proof, caller); e != nil {
		t.Fatal("valid same original completion refused", e)
	}
	original := append([]byte(nil), r.original...)
	// Explicit PUBLIC clock-boundary control on the retained observation, not
	// rewriting a real signed record or advancing a production authority clock.
	r.projection.ExpiresMS = time.Now().UnixMilli()
	if e = r.recheckOriginalCompletion(context.Background(), p, c, public, proof, caller); e != ErrUnknown {
		t.Fatal("expired completion accepted", e)
	}
	cause := r.firstCause
	r.projection.ExpiresMS = time.Now().Add(time.Minute).UnixMilli()
	if e = r.recheckOriginalCompletion(context.Background(), p, c, public, proof, caller); e != ErrUnknown || r.firstCause != cause || string(r.original) != string(original) {
		t.Fatal("UNKNOWN renewed or original/firstcause lost")
	}
}
