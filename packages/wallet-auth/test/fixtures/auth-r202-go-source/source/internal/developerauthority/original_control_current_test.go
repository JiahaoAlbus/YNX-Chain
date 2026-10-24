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

// Executes the real pinned Go subprocess boundary. The child is explicitly
// PUBLIC metadata, not a Root/current authority or a cryptographic proof.
func controlCurrentFixture(t *testing.T, mutation string) (*OriginalSourceVerifierOwner, []byte, Principal, Command, []byte, string, string) {
	t.Helper()
	now := time.Now().UnixMilli()
	p := Principal{"PUBLIC_ACCOUNT", "PUBLIC_DEVICE", "PUBLIC_SESSION", "PUBLIC_CURRENT", 9007199254740993, 18446744073709551615, now + 28000}
	c := Command{RequestID: "PUBLIC_REQUEST", Action: "project.create", ProjectID: "PUBLIC_PROJECT", ExpiresMS: now + 27000}
	nonce := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("n", 32)))
	caller := "PUBLIC_CODE"
	decision, _ := json.Marshal(map[string]any{"nonce": nonce})
	proof, _ := json.Marshal(map[string]any{"decisionOriginal": string(decision)}) // PUBLIC metadata child, not signed
	praw, _ := json.Marshal(p)
	craw, _ := json.Marshal(c)
	selection := map[string]any{"projectControlCapture": map[string]any{"version": "YNX-IDE-PROJECT-CONTROL-CAPTURE/v1", "review": map[string]any{"PUBLIC": true}, "requestOriginal": base64.RawURLEncoding.EncodeToString([]byte("PUBLIC_REQUEST_ORIGINAL")), "principalOriginal": base64.RawURLEncoding.EncodeToString(praw), "commandOriginal": base64.RawURLEncoding.EncodeToString(craw), "expiresAtMs": fmt.Sprint(now + 24000)}, "identityPeerBinding": map[string]any{"walletCodeIdentity": caller}}
	profile := "PUBLIC_PROFILE"
	snapshot := map[string]any{"projection": map[string]any{"selection": selection, "principalId": "PUBLIC_ACCOUNT", "subjectOwner": "0x" + strings.Repeat("1", 40), "subjectKeyVersion": "1", "generation": 1, "sequence": 2, "floor": 1, "head": strings.Repeat("a", 64), "status": "active", "timeFloor": now, "expiresAtMs": now + 25000, "profileDigest": hash([]byte(profile)), "sourceId": "PUBLIC_SOURCE", "instanceId": "PUBLIC_INSTANCE", "executionHeight": "18446744073709551614", "dataOnly": true, "nativeAdmission": false}, "currentRaw": "PUBLIC_NOT_SIGNED"}
	r := originalControlProjection{PrincipalSHA256: objectHash(p), BindingSHA256: objectHash(c), ProofSHA256: hash(proof), ConfirmationRef: "PUBLIC_CONFIRM", RevocationRef: "PUBLIC_REVOKE", RequestID: c.RequestID, Nonce: nonce, Decision: "approve", ExpiresMS: now + 23000, Ready: true, SignatureVerified: true, DataOnly: true}
	out := map[string]any{"version": "YNX-IDE-CONTROL-VERIFICATION-DATA/v1", "completed": true, "sourceBefore": snapshot, "sourceAfter": snapshot, "approvalOriginal": string(proof), "projection": r, "failureCode": "", "dataOnly": true, "authorized": false, "nativeAdmission": false}
	payload, _ := json.Marshal(out)
	body := fixtureRead + "const out=" + string(payload) + ";out.sourceBefore.projection.timeFloor=Date.now();out.sourceAfter=structuredClone(out.sourceBefore);" + mutation + "process.stdout.write(JSON.stringify(JSON.parse(input).operation==='auth-source-v2-native-node/v1'?out.sourceBefore:out)+'\\n');"
	o, _, _ := openFixtureProcess(t, body)
	source := map[string]any{"operation": "auth-source-v2-native-node/v1", "node": map[string]any{}, "rootRaw": "PUBLIC_ROOT", "enrollmentRaw": "PUBLIC_ENROLLMENT", "profileRaw": profile, "headRaw": "PUBLIC_HEAD", "policy": map[string]any{"signatureContract": map[string]any{"purpose": "ide-project-control-authority-v1"}}, "previous": map[string]any{}}
	input, _ := json.Marshal(map[string]any{"operation": "ide-project-control-current-native-node/v1", "source": source, "approvalOriginal": string(proof), "principal": originalControlPrincipalDTO(p), "command": originalControlCommandDTO(c), "expected": map[string]any{"nonce": nonce, "callerIdentity": caller, "sourceCurrentRef": p.CurrentRef}})
	return o, input, p, c, proof, nonce, caller
}

func TestOriginalControlCompleteCurrentNormalProcess(t *testing.T) {
	t.Run("both_original_snapshots_and_exact_u64_principal", func(t *testing.T) {
		o, in, p, c, proof, n, caller := controlCurrentFixture(t, "")
		r, e := o.invokeOriginalControlCurrent(context.Background(), in, p, c, proof, n, caller)
		if e != nil {
			t.Fatalf("callee=%v phase=%s", e, o.FailurePhase())
		}
		if r == nil || r.approval.PrincipalSHA256 != objectHash(p) || r.sequence != 2 || len(r.before) == 0 || len(r.after) == 0 || len(r.original) == 0 || !r.projection.Ready {
			t.Fatal("original custody lost")
		}
	})
	for name, mutation := range map[string]string{
		"post_source_changed":    "out.sourceAfter.projection.generation++;",
		"post_capture_changed":   "out.sourceAfter.projection.selection.projectControlCapture.commandOriginal='QQ';",
		"principal_substitution": "out.projection.principalSHA256='f'.repeat(64);",
		"proof_substitution":     "out.approvalOriginal+='X';",
		"height_rollback":        "out.sourceAfter.projection.executionHeight='2';",
		"post_expired":           "out.sourceAfter.projection.expiresAtMs=Date.now()-1;",
		"authority_promotion":    "out.authorized=true;",
		"capture_expired":        "out.sourceBefore.projection.selection.projectControlCapture.expiresAtMs='1';out.sourceAfter=structuredClone(out.sourceBefore);",
		"capture_wrong_original": "out.sourceBefore.projection.selection.projectControlCapture.principalOriginal='QQ';out.sourceAfter=structuredClone(out.sourceBefore);",
		"unknown_field":          "out.EXTRA=true;",
	} {
		t.Run(name, func(t *testing.T) {
			o, in, p, c, proof, n, caller := controlCurrentFixture(t, mutation)
			if _, e := o.invokeOriginalControlCurrent(context.Background(), in, p, c, proof, n, caller); e == nil {
				t.Fatal("accepted mutation")
			}
		})
	}
	t.Run("reject_is_retained_not_approval", func(t *testing.T) {
		o, in, p, c, proof, n, caller := controlCurrentFixture(t, "out.projection.decision='reject';out.projection.readyForSourceVerification=false;")
		r, e := o.invokeOriginalControlCurrent(context.Background(), in, p, c, proof, n, caller)
		if e != nil || r == nil || r.projection.Ready || r.projection.Decision != "reject" {
			t.Fatal("rejection lost/promoted")
		}
	})
}
