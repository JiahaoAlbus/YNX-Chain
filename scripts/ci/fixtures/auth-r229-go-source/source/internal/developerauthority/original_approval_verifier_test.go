package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

func approvalFixtureInput() []byte {
	scope := `{"PUBLIC":true}`
	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	return []byte(`{"expectedScopeOriginal":` + strconv.Quote(scope) + `,"nonce":` + strconv.Quote(nonce) + `,"operation":"ide-publication-approval-current-native-node/v1","previous":{},"source":{}}`)
}

const approvalProcessFixture = `let input='';for await(const b of process.stdin)input+=b;const q=JSON.parse(input),crypto=await import('node:crypto'),h=v=>crypto.createHash('sha256').update(v).digest('hex'),now=Date.now(),c=JSON.stringify({nonce:q.nonce}),approval=JSON.stringify({version:'YNX-IDE-APPROVAL-CURRENT/v1',binding:{},scopeOriginal:q.expectedScopeOriginal,currentOriginal:c,memberOriginal:'PUBLIC_NOT_A_REAL_MEMBER'}),source={projection:{selection:{PUBLIC:true},principalId:'PUBLIC_ACCOUNT',subjectOwner:'0x'+'1'.repeat(40),subjectKeyVersion:'1',generation:1,sequence:1,floor:0,head:'1'.repeat(64),status:'active',timeFloor:now,expiresAtMs:now+30000,profileDigest:'2'.repeat(64),sourceId:'PUBLIC_SOURCE',instanceId:'PUBLIC_INSTANCE',executionHeight:'20',dataOnly:true,nativeAdmission:false},currentRaw:'PUBLIC_NOT_A_ROOT'},projection={kind:'artifact',scopeSHA256:h(q.expectedScopeOriginal),statementSHA256:h(c),resultOriginalSHA256:'3'.repeat(64),sequence:'1',floor:'0',decision:'approved',requestState:'signed-unhanded',statementExecutionHeight:'19',observedExecutionHeight:'20',timeFloor:now,expiresAtMs:now+30000,readyForSourceVerification:true,dataOnly:true,signatureVerified:true,authorized:false,nativeAdmission:false,publicationAuthorized:false,resourceAuthorized:false};process.stdout.write(JSON.stringify({version:'YNX-IDE-APPROVAL-VERIFICATION-DATA/v1',completed:true,sourceBefore:source,sourceAfter:source,approvalOriginal:approval,projection,failureCode:'',dataOnly:true,authorized:false,nativeAdmission:false})+'\n');`

func TestApprovalVerifierActualReadonlyChildAndOriginalBinding(t *testing.T) {
	o, _, _ := openFixtureProcess(t, approvalProcessFixture)
	raw, e := o.InvokeOriginalApprovalCurrentDATA(context.Background(), approvalFixtureInput())
	if e != nil || len(raw) == 0 {
		t.Fatalf("invoke=%v phase=%s", e, o.FailurePhase())
	}
	if _, ok := any(o).(OriginalSource); ok {
		t.Fatal("DATA process became source")
	}
	bad := strings.Replace(approvalProcessFixture, "scopeSHA256:h(q.expectedScopeOriginal)", "scopeSHA256:'f'.repeat(64)", 1)
	g, _, _ := openFixtureProcess(t, bad)
	partial, e := g.InvokeOriginalApprovalCurrentDATA(context.Background(), approvalFixtureInput())
	if e != ErrOriginalVerifierUnknown || len(partial) != 0 || len(g.processStdout) == 0 || g.FailurePhase() != "APPROVAL_PROJECTION" {
		t.Fatal("scope substitution/partial", e, g.FailurePhase())
	}
}
func TestApprovalVerifierKnownFailureRetainsChildRawAndNeverResubmits(t *testing.T) {
	body := `let i='';for await(const b of process.stdin)i+=b;process.stdout.write('{"PUBLIC_SIGNED_PARTIAL":"retained"}\n');process.exitCode=1;`
	o, _, _ := openFixtureProcess(t, body)
	raw, e := o.InvokeOriginalApprovalCurrentDATA(context.Background(), approvalFixtureInput())
	if e != ErrOriginalVerifierUnknown || len(raw) != 0 || !bytes.Contains(o.processStdout, []byte("PUBLIC_SIGNED_PARTIAL")) {
		t.Fatal("partial lost", e)
	}
	pid := o.processPID
	if _, e = o.InvokeOriginalApprovalCurrentDATA(context.Background(), approvalFixtureInput()); e != ErrOriginalVerifierClosed || o.processPID != pid {
		t.Fatal("unknown replayed", e)
	}
}
func TestApprovalVerifierTransportStringPreservesActualOriginal(t *testing.T) {
	for _, s := range []string{"<>&", "line\u2028separator\u2029", `literal\u2028-not-a-newline`, "\"quoted\\path\n", "中文🦋"} {
		encoded, ok := originalApprovalTransportString(s)
		if !ok {
			t.Fatal("invalid valid string")
		}
		var got string
		if json.Unmarshal([]byte(encoded), &got) != nil || got != s {
			t.Fatal("original changed", encoded)
		}
		if strings.Contains(encoded, `\u003c`) {
			t.Fatal("noncanonical outer HTML escaping")
		}
	}
	if _, ok := originalApprovalTransportString(string([]byte{255})); ok {
		t.Fatal("invalid UTF8 accepted")
	}
}
func TestApprovalStateHeadExactOriginalGoAcrossInt64Counters(t *testing.T) {
	type vector struct {
		Scope    string          `json:"scope"`
		Current  json.RawMessage `json:"current"`
		Expected string          `json:"expected"`
	}
	var v []vector
	for _, seq := range []int64{1, 9007199254740993, 9223372036854775807} {
		scope := "PUBLIC-only-head-data"
		w := originalApprovalRow{scope: originalApprovalScopeDATA{digest: hash([]byte(scope))}, sequence: seq, decision: "approved", requestState: "signed-unhanded", resultSHA256: strings.Repeat("7", 64)}
		raw, e := json.Marshal(map[string]string{"sequence": strconv.FormatInt(seq, 10), "floor": "0", "decision": w.decision, "requestState": w.requestState, "resultOriginalSHA256": w.resultSHA256})
		if e != nil {
			t.Fatal(e)
		}
		v = append(v, vector{scope, raw, w.digest()})
	}
	input, _ := json.Marshal(v)
	script := `import{originalApprovalStateHeadDATA as h}from'file:///Volumes/西部数据/YNX-large-work/auth-owned-r189/source/packages/wallet-auth/native/original-ide-approval-state-head-data.mjs';let i='';for await(const b of process.stdin)i+=b;const v=JSON.parse(i);process.stdout.write(JSON.stringify(v.map(x=>h(x.scope,JSON.stringify(x.current,Object.keys(x.current).sort())))));`
	cmd := exec.Command(fixtureNode, "--input-type=module", "-e", script)
	cmd.Stdin = bytes.NewReader(input)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, e := cmd.Output()
	if e != nil {
		t.Fatal(e, stderr.String())
	}
	var got []string
	if json.Unmarshal(out, &got) != nil || len(got) != len(v) {
		t.Fatal("bad vector output")
	}
	for i := range v {
		if got[i] != v[i].Expected {
			t.Fatal(fmt.Sprintf("Go/Node counter rounding at %d", i))
		}
	}
}
