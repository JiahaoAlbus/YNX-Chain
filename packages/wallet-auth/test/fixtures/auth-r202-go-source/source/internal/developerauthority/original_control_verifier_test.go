package developerauthority

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestOriginalControlActualGoCommandUnicodeInterop(t *testing.T) {
	node := "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
	root, e := os.Getwd()
	if e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"PUBLIC<>&", "PUBLIC\u2028project\u2029id", "PUBLIC\u0085inside", "PUBLIC\ufeffinside"} {
		now := time.Now().UnixMilli()
		c := Command{RequestID: "PUBLIC-request", Action: "project.create", ProjectID: name, ExpiresMS: now + 30000}
		if !c.valid(now) {
			t.Fatal("Go precondition", name)
		}
		original, e := json.Marshal(c)
		if e != nil {
			t.Fatal(e)
		}
		display := map[string]any{"RequestID": c.RequestID, "Action": c.Action, "ProjectID": c.ProjectID, "TeamID": "", "SubjectAccount": "", "PublisherID": "", "RuntimeOrigin": "", "ExpectedRevision": "0", "GrantExpiresMS": "0", "Read": false, "Publish": false, "Runtime": false, "Revoke": false, "ExpiresMS": strconv.FormatInt(c.ExpiresMS, 10), "PublicOriginalSHA256": ""}
		raw, _ := json.Marshal(display)
		script := `import{encodeOriginalDeveloperCommandDATA as f}from'./native/original-ide-project-control-contract.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(f(JSON.parse(s),` + strconv.FormatInt(now, 10) + `).commandOriginal);`
		cmd := exec.Command(node, "--input-type=module", "-e", script)
		cmd.Dir = filepath.Join(root, "..", "..", "packages/wallet-auth")
		cmd.Stdin = strings.NewReader(string(raw))
		got, e := cmd.CombinedOutput()
		if e != nil || string(got) != string(original) {
			t.Fatalf("Go/Node mismatch: %v %s", e, got)
		}
	}
}

func TestOriginalControlNormalChildBindingAndNegativeDecision(t *testing.T) {
	now := time.Now().UnixMilli()
	p := Principal{Account: "PUBLIC", DeviceID: "PUBLIC", SessionRef: "PUBLIC", CurrentRef: "PUBLIC", AccountGeneration: 1, SessionGeneration: 1, ExpiresMS: now + 30000}
	c := Command{RequestID: "PUBLIC-request", Action: "project.create", ProjectID: "PUBLIC-project", ExpiresMS: now + 30000}
	proof := []byte("PUBLIC-proof")
	nonce := strings.Repeat("a", 43)
	for _, decision := range []string{"approve", "reject"} {
		r := originalControlProjection{PrincipalSHA256: objectHash(p), BindingSHA256: objectHash(c), ProofSHA256: hash(proof), ConfirmationRef: "PUBLIC-confirm", RevocationRef: "PUBLIC-revoke", RequestID: c.RequestID, Nonce: nonce, Decision: decision, ExpiresMS: now + 20000, Ready: decision == "approve", SignatureVerified: true, DataOnly: true}
		raw, _ := json.Marshal(r)
		script := "for await(const b of process.stdin){};process.stdout.write(" + string(mustJSONString(string(raw)+"\n")) + ");"
		o, _, _ := openFixtureProcess(t, script)
		got, e := o.invokeOriginalControlDATA(context.Background(), []byte(`{"PUBLIC":true}`), p, c, proof, nonce)
		if e != nil || len(got) == 0 {
			t.Fatalf("normal child: %v %s", e, o.FailurePhase())
		}
		bad, _, _ := openFixtureProcess(t, strings.Replace(script, objectHash(c), strings.Repeat("f", 64), 1))
		got, e = bad.invokeOriginalControlDATA(context.Background(), []byte(`{"PUBLIC":true}`), p, c, proof, nonce)
		if e != ErrOriginalVerifierUnknown || len(got) != 0 || len(bad.processStdout) == 0 {
			t.Fatal("binding/partial lost", e)
		}
		if _, ok := any(o).(OriginalSource); ok {
			t.Fatal("DATA became Source")
		}
	}
}
func mustJSONString(s string) []byte {
	b, e := json.Marshal(s)
	if e != nil {
		panic(e)
	}
	return b
}
