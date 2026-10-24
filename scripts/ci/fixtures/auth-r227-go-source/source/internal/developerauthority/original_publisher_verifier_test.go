package developerauthority

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestOriginalProtectedPublisherNormalProcessBinding(t *testing.T) {
	now := time.Now().UnixMilli()
	public, proof := []byte("PUBLIC-R13-METADATA-FIXTURE"), []byte("PUBLIC-REGISTRATION-METADATA-FIXTURE")
	p := Principal{Account: "PUBLIC", DeviceID: "PUBLIC", SessionRef: "PUBLIC", CurrentRef: "PUBLIC", AccountGeneration: 1, SessionGeneration: 1, ExpiresMS: now + 30000}
	c := Command{RequestID: "PUBLIC-request", Action: "project.publisher", ProjectID: "PUBLIC-project", SubjectAccount: "PUBLIC", PublisherID: "PUBLIC-publisher", GrantExpiresMS: now + 30000, ExpiresMS: now + 30000, PublicOriginalSHA256: hash(public)}
	output := map[string]any{"account": c.SubjectAccount, "projectId": c.ProjectID, "publisherId": c.PublisherID, "keyRole": "ide-artifact-publisher", "publicSHA256": hash(public), "registrationRef": "PUBLIC-registry", "principalSHA256": objectHash(p), "commandSHA256": objectHash(c), "proofSHA256": hash(proof), "expiresAtMs": now + 20000, "signatureVerified": true, "independentCustodianPairVerified": true, "dataOnly": true, "authorized": false, "registered": false, "protectedCustodyAdmitted": false, "nativeAdmission": false}
	raw, _ := json.Marshal(output)
	script := "for await(const b of process.stdin){};process.stdout.write(" + string(mustJSONString(string(raw)+"\n")) + ");"
	owner, _, _ := openFixtureProcess(t, script)
	got, e := owner.invokeOriginalProtectedPublisherDATA(context.Background(), []byte(`{"PUBLIC":true}`), p, c, public, proof, "PUBLIC-registry")
	if e != nil || len(got) == 0 {
		t.Fatal(e, owner.FailurePhase())
	}
	if _, ok := any(owner).(OriginalSource); ok {
		t.Fatal("DATA became Source")
	}
	for _, pair := range [][2]string{{objectHash(c), strings.Repeat("f", 64)}, {`\"registered\":false`, `\"registered\":true`}} {
		changed := strings.Replace(script, pair[0], pair[1], 1)
		if changed == script {
			t.Fatal("negative not applied")
		}
		bad, _, _ := openFixtureProcess(t, changed)
		got, e = bad.invokeOriginalProtectedPublisherDATA(context.Background(), []byte(`{"PUBLIC":true}`), p, c, public, proof, "PUBLIC-registry")
		if e != ErrOriginalVerifierUnknown || len(got) != 0 || len(bad.processStdout) == 0 {
			t.Fatal("binding/promotion/partial", e, bad.FailurePhase())
		}
	}
}
