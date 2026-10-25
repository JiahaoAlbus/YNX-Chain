package developerauthority

// Real OS process/FD/Node permission tests. Child programs are explicitly PUBLIC
// fixtures, NOT a signed Source/registry/Root or production supplier acceptance.
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixturePin(t *testing.T, path string) OriginalVerifierFile {
	t.Helper()
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	return OriginalVerifierFile{path, int64(len(b)), hash(b)}
}
func fixtureSourceProcess(t *testing.T, body string) (OriginalSourceVerifierConfig, string) {
	t.Helper()
	node := os.Getenv("YNX_IDE_TEST_NODE")
	if node == "" || !filepath.IsAbs(node) || filepath.Clean(node) != node {
		t.Fatal("YNX_IDE_TEST_NODE must name the explicitly selected absolute test Node; no system/host fallback")
	}
	home, e := os.UserHomeDir()
	if e != nil {
		t.Fatal(e)
	}
	root, e := os.MkdirTemp(home, ".ynx-auth-source-process-PUBLIC-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	if e = os.Chmod(root, 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.Mkdir(filepath.Join(root, "native"), 0700); e != nil {
		t.Fatal(e)
	}
	entry := filepath.Join(root, originalVerifierEntry)
	if e = os.WriteFile(entry, []byte(body), 0600); e != nil {
		t.Fatal(e)
	}
	pin := fixturePin(t, entry)
	pin.Path = originalVerifierEntry
	return OriginalSourceVerifierConfig{Node: fixturePin(t, node), SDKRoot: root, SDKFiles: []OriginalVerifierFile{pin}}, entry
}
func fixtureCurrentInput() []byte {
	// This input is intentionally not commissioned. PUBLIC fake child only.
	return []byte(`{"operation":"auth-source-v2-native-node/v1","node":{},"rootRaw":"PUBLIC","enrollmentRaw":"PUBLIC","profileRaw":"PUBLIC","headRaw":"PUBLIC","policy":{},"previous":{}}`)
}

const fixtureRead = `let input='';for await(const b of process.stdin)input+=b;`
const fixtureGood = `const now=Date.now();process.stdout.write(JSON.stringify({projection:{selection:{PUBLIC:true},principalId:'PUBLIC_ACCOUNT',subjectOwner:'0x'+'1'.repeat(40),subjectKeyVersion:'1',generation:1,sequence:1,floor:1,head:'1'.repeat(64),status:'active',timeFloor:now,expiresAtMs:now+30000,profileDigest:'2'.repeat(64),sourceId:'PUBLIC_SOURCE',instanceId:'PUBLIC_INSTANCE',executionHeight:'0',dataOnly:true,nativeAdmission:false},currentRaw:'PUBLIC_NOT_A_PROOF'})+'\n');`

func openFixtureProcess(t *testing.T, body string) (*OriginalSourceVerifierOwner, OriginalSourceVerifierConfig, string) {
	t.Helper()
	cfg, path := fixtureSourceProcess(t, body)
	o, e := OpenOriginalSourceVerifier(cfg)
	if e != nil {
		if o != nil {
			t.Fatalf("open phase=%s private type=%T", o.FailurePhase(), o.firstCause)
		}
		t.Fatal(e)
	}
	t.Cleanup(func() { o.Close() })
	return o, cfg, path
}
func TestOriginalSourceProcessActualChild(t *testing.T) {
	t.Run("empty_env_permission_and_DATA_only", func(t *testing.T) {
		t.Setenv("NODE_OPTIONS", "--require=/missing/PUBLIC")
		t.Setenv("HTTP_PROXY", "http://PUBLIC_DO_NOT_FORWARD")
		// Darwin's C runtime itself may create __CF_USER_TEXT_ENCODING after exec.
		// It is not inherited application ENV or a permission/loader selector.
		body := fixtureRead + `if(Object.keys(process.env).some(k=>k!=='__CF_USER_TEXT_ENCODING'))process.exit(90);let denied=false;try{(await import('node:fs')).readFileSync('/etc/passwd')}catch(e){denied=e.code==='ERR_ACCESS_DENIED'}if(!denied)process.exit(91);` + fixtureGood
		o, _, _ := openFixtureProcess(t, body)
		raw, e := o.InvokeOriginalCurrentDATA(context.Background(), fixtureCurrentInput())
		if e != nil {
			t.Fatalf("invoke=%v phase=%s cause=%T", e, o.FailurePhase(), o.firstCause)
		}
		if !strings.Contains(string(raw), `"nativeAdmission":false`) {
			t.Fatal("no DATA flag")
		}
		var source any = o
		if _, ok := source.(OriginalSource); ok {
			t.Fatal("process incorrectly implements Source")
		}
		if e = o.Close(); e != nil {
			t.Fatal(e)
		}
		if _, e = o.InvokeOriginalCurrentDATA(context.Background(), fixtureCurrentInput()); e != ErrOriginalVerifierClosed {
			t.Fatal(e)
		}
	})
	for _, c := range []struct{ name, body, phase string }{
		{"stderr_on_zero", fixtureRead + `process.stderr.write('PUBLIC_FIRST_CAUSE\n');` + fixtureGood, "PROCESS"},
		{"nonzero", fixtureRead + `process.exit(37);`, "PROCESS"},
		{"output_over_cap", fixtureRead + `process.stdout.write('x'.repeat(1048577));`, "PROCESS"},
		{"empty_zero", fixtureRead, "PROCESS"},
		{"extra_output", fixtureRead + fixtureGood + `process.stdout.write('extra');`, "OUTPUT"},
		{"duplicate_field", fixtureRead + `process.stdout.write('{"projection":{},"projection":{},"currentRaw":"PUBLIC"}\n');`, "OUTPUT"},
		{"expired", fixtureRead + strings.Replace(fixtureGood, "expiresAtMs:now+30000", "expiresAtMs:1", 1), "POST_CURRENT"},
		{"admission_flag", fixtureRead + strings.Replace(fixtureGood, "nativeAdmission:false", "nativeAdmission:true", 1), "POST_CURRENT"},
		{"missing_projection_bindings", fixtureRead + `process.stdout.write(JSON.stringify({projection:{expiresAtMs:Date.now()+10000,timeFloor:Date.now(),dataOnly:true,nativeAdmission:false,status:'active'},currentRaw:'PUBLIC'})+'\n');`, "POST_CURRENT"},
	} {
		t.Run(c.name, func(t *testing.T) {
			o, _, _ := openFixtureProcess(t, c.body)
			_, e := o.InvokeOriginalCurrentDATA(context.Background(), fixtureCurrentInput())
			if e != ErrOriginalVerifierUnknown || o.FailurePhase() != c.phase {
				t.Fatalf("error=%v phase=%s", e, o.FailurePhase())
			}
			cause := o.firstCause
			if !o.processWaited || o.processPID <= 0 {
				t.Fatal("actual process custody/wait lost")
			}
			if c.name == "stderr_on_zero" && string(o.processStderr) != "PUBLIC_FIRST_CAUSE\n" {
				t.Fatal("original stderr first cause discarded")
			}
			_, e = o.InvokeOriginalCurrentDATA(context.Background(), fixtureCurrentInput())
			if e != ErrOriginalVerifierClosed || o.firstCause != cause {
				t.Fatal("UNKNOWN was retried/overwritten")
			}
			if strings.Contains(fmt.Sprintf("%#v", o), "PUBLIC_FIRST_CAUSE") {
				t.Fatal("cause leaked")
			}
		})
	}
}

func TestOriginalSourceProcessArtifactGuard(t *testing.T) {
	const projection = `{"account":"PUBLIC_ACCOUNT","authorized":false,"current":false,"dataOnly":true,"keyRole":"ide-artifact-publisher","memberCount":1,"memberIndex":0,"nativeAdmission":false,"networkId":"1111111111111111111111111111111111111111111111111111111111111111","publicationAuthorized":false,"publisherId":"PUBLIC_PUBLISHER","publisherKeyVersion":"1","purpose":"ARTIFACT-RELEASE","registered":false,"signatureVerified":true,"subjectOwner":"0x1111111111111111111111111111111111111111","projectId":"PUBLIC_PROJECT","trusted":false}`
	for _, tc := range []struct {
		name, projection string
		denied           bool
	}{
		{"data", projection, false},
		{"cannot_promote_trusted", strings.Replace(projection, `"trusted":false`, `"trusted":true`, 1), true},
		{"cannot_promote_publication", strings.Replace(projection, `"publicationAuthorized":false`, `"publicationAuthorized":true`, 1), true},
		{"no_extra_keys", strings.Replace(projection, `"trusted":false`, `"trusted":false,"approved":true`, 1), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := fixtureRead + `const x=JSON.parse(input);if(x.operation!=='ide-artifact-signature-data/v1'||x.signatureOriginal!=='AQID'||x.manifestOriginal!=='BAUG'||x.expectedPublicOriginal!=='BwgJ')process.exit(99);process.stdout.write(` + strconv.Quote(tc.projection+"\n") + `);`
			o, _, _ := openFixtureProcess(t, body)
			raw, e := o.InspectOriginalArtifactDATA(context.Background(), []byte{1, 2, 3}, []byte{4, 5, 6}, []byte{7, 8, 9})
			if tc.denied {
				if e != ErrOriginalVerifierUnknown || o.phase != "ARTIFACT_OUTPUT" {
					t.Fatal("promoted", e, o.phase)
				}
			} else if e != nil || string(raw) != tc.projection+"\n" {
				t.Fatal(e)
			}
		})
	}
}
func TestOriginalSourceProcessFiles(t *testing.T) {
	t.Run("import_closure_extra", func(t *testing.T) {
		o, c, _ := openFixtureProcess(t, fixtureRead+fixtureGood)
		if e := os.WriteFile(filepath.Join(c.SDKRoot, "foreign.mjs"), []byte("PUBLIC"), 0600); e != nil {
			t.Fatal(e)
		}
		if _, e := o.InvokeOriginalCurrentDATA(context.Background(), fixtureCurrentInput()); e != ErrOriginalVerifierUnknown || o.FailurePhase() != "PRE_INVENTORY" {
			t.Fatal(e, o.FailurePhase())
		}
	})
	t.Run("same_length_changed_content", func(t *testing.T) {
		o, _, p := openFixtureProcess(t, fixtureRead+fixtureGood)
		b, e := os.ReadFile(p)
		if e != nil {
			t.Fatal(e)
		}
		b[0] = '!'
		if e = os.WriteFile(p, b, 0600); e != nil {
			t.Fatal(e)
		}
		if _, e = o.InvokeOriginalCurrentDATA(context.Background(), fixtureCurrentInput()); e != ErrOriginalVerifierUnknown || o.FailurePhase() != "PRE_FILES" {
			t.Fatal(e, o.FailurePhase())
		}
	})
	t.Run("replaced_same_bytes", func(t *testing.T) {
		o, _, p := openFixtureProcess(t, fixtureRead+fixtureGood)
		b, e := os.ReadFile(p)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.Rename(p, p+".retained"); e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(p, b, 0600); e != nil {
			t.Fatal(e)
		}
		if _, e = o.InvokeOriginalCurrentDATA(context.Background(), fixtureCurrentInput()); e != ErrOriginalVerifierUnknown {
			t.Fatal(e)
		}
	})
	t.Run("symlink", func(t *testing.T) {
		c, p := fixtureSourceProcess(t, fixtureRead+fixtureGood)
		if e := os.Rename(p, p+".original"); e != nil {
			t.Fatal(e)
		}
		if e := os.Symlink(p+".original", p); e != nil {
			t.Fatal(e)
		}
		o, e := OpenOriginalSourceVerifier(c)
		if e == nil || o == nil || !o.closed {
			t.Fatal("symlink accepted or partial lost")
		}
	})
	t.Run("hardlink_and_partial", func(t *testing.T) {
		c, p := fixtureSourceProcess(t, fixtureRead+fixtureGood)
		if e := os.Link(p, p+".link"); e != nil {
			t.Fatal(e)
		}
		c.SDKFiles = append(c.SDKFiles, OriginalVerifierFile{Path: originalVerifierEntry + ".link", Bytes: c.SDKFiles[0].Bytes, SHA256: c.SDKFiles[0].SHA256})
		o, e := OpenOriginalSourceVerifier(c)
		if e == nil || o == nil || o.firstCause == nil || !o.closed {
			t.Fatal("hardlink or partial")
		}
	})
	t.Run("no_self_selected_entry", func(t *testing.T) {
		c, _ := fixtureSourceProcess(t, fixtureRead+fixtureGood)
		c.SDKFiles[0].Path = "../outside"
		if o, e := OpenOriginalSourceVerifier(c); e == nil || o != nil {
			t.Fatal("traversal accepted")
		}
	})
}
func TestOriginalSourceProcessCancellationAndClose(t *testing.T) {
	o, _, _ := openFixtureProcess(t, fixtureRead+`await new Promise(r=>setTimeout(r,2000));`+fixtureGood)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	start := time.Now()
	var wg sync.WaitGroup
	wg.Add(1)
	var result error
	go func() { defer wg.Done(); _, result = o.InvokeOriginalCurrentDATA(ctx, fixtureCurrentInput()) }()
	select {
	case <-o.processStarted:
	case <-time.After(3 * time.Second):
		cancel()
		wg.Wait()
		t.Fatal("actual child never started")
	}
	cancel()
	closed := o.Close()
	wg.Wait()
	if result != ErrOriginalVerifierUnknown || closed != nil || time.Since(start) > 4*time.Second || o.phase != "PROCESS" {
		t.Fatal("child not joined", result, closed, o.phase, time.Since(start))
	}
	first := o.firstCause
	if !errors.Is(o.processContextCause, context.Canceled) || !o.processWaited || o.processPID <= 0 {
		t.Fatal("actual canceled process/context receipt lost")
	}
	if e := o.Close(); e != closed || o.firstCause != first {
		t.Fatal("repeat close changed original outcome")
	}
	if b, e := json.Marshal(o); e != nil || string(b) != "{}" {
		t.Fatal("owner serialized")
	}
}

func TestOriginalSourceProcessMathematicalRejectionIsRequestScoped(t *testing.T) {
	o, _, _ := openFixtureProcess(t, fixtureRead+`process.stderr.write('IDE_ARTIFACT_SIGNATURE_DATA_INVALID\n');process.exit(1);`)
	for i := 0; i < 2; i++ {
		_, e := o.InspectOriginalArtifactDATA(context.Background(), []byte{1}, []byte{2}, []byte{3})
		if e != ErrDenied || o.firstCause != nil || !o.ready || !o.processWaited || o.processExitCode != 1 {
			t.Fatal("request rejection poisoned Source", e, o.phase)
		}
	}
	if string(o.processStderr) != "IDE_ARTIFACT_SIGNATURE_DATA_INVALID\n" {
		t.Fatal("actual rejection bytes lost")
	}
}
