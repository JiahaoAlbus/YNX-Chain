package main_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// Keep native export's real launcher functions and filesystem contract in the
// original ./cmd/... CI discovery. The harness never creates NSApplication,
// WKWebView or NSSavePanel and does not launch a helper or any GUI process.
// t.TempDir and clang inherit the caller's TMPDIR/GOTMPDIR; HOME is unchanged.
func TestP09QANativeExportBridgeContract(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native Cocoa/WebKit export requires macOS; no GUI or replacement bridge is simulated")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	binary := filepath.Join(directory, "native-export-contract")
	qa := filepath.Join(root, "apps", "network", "qa")
	compileContext, cancelCompile := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancelCompile()
	compile := exec.CommandContext(compileContext, "xcrun", "--sdk", "macosx", "clang", "-mmacosx-version-min=12.0", "-fobjc-arc", "-Wno-deprecated-declarations", "-Wno-incompatible-pointer-types", "-framework", "Cocoa", "-framework", "WebKit", filepath.Join(qa, "export_bridge_test.m"), filepath.Join(qa, "proof_profile.m"), "-o", binary)
	compile.Dir = root
	compile.Env = os.Environ()
	if output, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("native export actual-launcher contract compile: %v\n%s", err, output)
	}
	filesystem := filepath.Join(directory, "isolated-files")
	if err = os.Mkdir(filesystem, 0700); err != nil {
		t.Fatal(err)
	}
	runContext, cancelRun := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelRun()
	run := exec.CommandContext(runContext, binary, filesystem)
	run.Env = os.Environ()
	output, err := run.CombinedOutput()
	if err != nil {
		t.Fatalf("native export actual-launcher contract: %v\n%s", err, output)
	}
	match := regexp.MustCompile(`(?m)^SUMMARY ([0-9]+) passed;`).FindStringSubmatch(string(output))
	count := 0
	if len(match) == 2 {
		count, _ = strconv.Atoi(match[1])
	}
	if count < 60 {
		t.Fatalf("native export contract did not execute all cases:\n%s", output)
	}
	t.Logf("%s", output)
	// Execute the actual native-generated fixed bootstrap against fresh storage,
	// then a second helper port. It may touch only the two benign enum keys.
	bootstrap := `
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const directory=process.argv[1];
const first=fs.readFileSync(directory+'/preferences-bootstrap.js','utf8');
const second=fs.readFileSync(directory+'/preferences-bootstrap-next.js','utf8');
function restore(script, origin) {
 const values=new Map([['ynxNetworkLocale','fr'],['ynxNetworkTheme','dark'],['ynxNetworkTicket','preserve-ticket'],['independentTrustPin','preserve-pin']]);
 let writes=0;
 vm.runInNewContext(script,{window:{location:{origin}},localStorage:{setItem(key,value){assert.ok(['ynxNetworkLocale','ynxNetworkTheme'].includes(key));values.set(key,value);writes++;}}},{timeout:1000});
 assert.equal(values.get('ynxNetworkTicket'),'preserve-ticket'); assert.equal(values.get('independentTrustPin'),'preserve-pin');
 return {values,writes};
}
for (const [script,origin] of [[first,'http://127.0.0.1:15432'],[second,'http://127.0.0.1:25433']]) {
 const result=restore(script,origin); assert.equal(result.writes,2);assert.equal(result.values.get('ynxNetworkLocale'),'ja');assert.equal(result.values.get('ynxNetworkTheme'),'system');
}
for (const [script,origin] of [[first,'http://127.0.0.1:25433'],[second,'http://127.0.0.1:15432'],[first,'https://evil.example'],[first,'null']]) {
 const result=restore(script,origin);assert.equal(result.writes,0);assert.equal(result.values.get('ynxNetworkLocale'),'fr');assert.equal(result.values.get('ynxNetworkTheme'),'dark');
}
console.log('PASS native fixed preference bootstrap restores across fresh helper ports only at exact origin; pairing/trust keys preserved');`
	js := exec.CommandContext(runContext, "node", "--input-type=module", "-e", bootstrap, filesystem)
	js.Env = os.Environ()
	if output, err := js.CombinedOutput(); err != nil {
		t.Fatalf("actual native preference bootstrap: %v\n%s", err, output)
	} else {
		t.Logf("%s", output)
	}
}
