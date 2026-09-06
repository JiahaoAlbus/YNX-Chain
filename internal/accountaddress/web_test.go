package accountaddress

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveEndpointRejectsInvalidOrAmbiguousInput(t *testing.T) {
	good, _ := Resolve("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf")
	for _, input := range []string{good.EVM, strings.ToUpper(good.EVM), good.YNX, strings.ToUpper(good.YNX), " " + good.YNX + " "} {
		r := httptest.NewRequest(http.MethodGet, "/api/address?address="+url.QueryEscape(input), nil)
		w := httptest.NewRecorder()
		ResolveHandler(w, r)
		var got Formats
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != 200 || got != good {
			t.Fatalf("resolve %q: %d %s", input, w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("account query may be cached")
		}
	}
	for _, query := range []string{
		"", "address=", "address=" + good.EVM + "&address=" + good.YNX,
		"address=0x1234", "address=ynx_faucet", "address=ynx1qqqqqq",
		"address=" + strings.ToUpper(good.YNX[:5]) + good.YNX[5:],
		"address=" + good.YNX[:len(good.YNX)-1] + "q", "address=" + strings.Repeat("q", 91),
		"address=" + url.QueryEscape("<script>alert(1)</script>"),
	} {
		w := httptest.NewRecorder()
		ResolveHandler(w, httptest.NewRequest(http.MethodGet, "/api/address?"+query, nil))
		if w.Code != 400 || strings.Contains(w.Body.String(), `"ynxAddress"`) {
			t.Fatalf("invalid input resolved: %q %d %s", query, w.Code, w.Body.String())
		}
	}
}

func TestBrowserCodecMatchesGoAndPublishedSDK(t *testing.T) {
	// All cases are public synthetic values; no wallet keys or user data.
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("node is required for browser/Go address parity")
	}
	vectors := make([]Formats, 0, 515)
	for i := 0; i < 512; i++ {
		digest := sha256.Sum256([]byte(fmt.Sprintf("ynx-address-parity-%d", i)))
		evm, _ := FromBytes(digest[:20])
		formats, _ := Resolve(evm)
		vectors = append(vectors, formats)
	}
	shared, err := os.ReadFile("../../testdata/address-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixed []addressVector
	if err := json.Unmarshal(shared, &fixed); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixed {
		vectors = append(vectors, Formats{EVM: v.Hex, YNX: v.Bech32})
	}
	input, _ := json.Marshal(vectors)
	browserPath, _ := filepath.Abs("browser.js")
	sdkPath, _ := filepath.Abs("../../sdk/js/index.js")
	script := `import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict'; import {pathToFileURL} from 'node:url';
const source = fs.readFileSync(process.argv[1], 'utf8');
const context = {}; vm.runInNewContext(source, context);
const {normalizeYNXAddress: resolve} = context.YNXAddress;
const sdk = await import(pathToFileURL(process.argv[2]));
const vectors = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const v of vectors) {
  for (const input of [v.evmAddress, v.ynxAddress, v.evmAddress.toUpperCase(), v.ynxAddress.toUpperCase(), ' ' + v.ynxAddress + ' ']) {
    assert.equal(JSON.stringify(resolve(input)), JSON.stringify(sdk.normalizeYNXAddress(input)));
    assert.equal(resolve(input).evmAddress, v.evmAddress);
    assert.equal(resolve(input).ynxAddress, v.ynxAddress);
  }
  const bad = v.ynxAddress.slice(0,-1) + (v.ynxAddress.endsWith('q') ? 'p' : 'q');
  assert.throws(() => resolve(bad));
}
for (const input of ['',null,12,{},'0x1234','0x'+'0'.repeat(64),'ynx_faucet','eth1qqqqqq','ynx1qqqqqq','YNX1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgrm2qr','<img src=x onerror=alert(1)>']) assert.throws(() => resolve(input));
assert.deepEqual(Object.keys(context.YNXAddress).sort(), ['normalizeYNXAddress','toEVMAddress','toYNXAddress']);
console.log(JSON.stringify({vectors:vectors.length,roundTrips:vectors.length*5}));`
	cmd := exec.Command(node, "--input-type=module", "-e", script, browserPath, sdkPath)
	cmd.Stdin = bytes.NewReader(input)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser/Go/SDK parity: %v\n%s", err, output)
	}
	t.Log(string(output))
}

func TestConverterIsIndependentOfWalletOrRPC(t *testing.T) {
	w := httptest.NewRecorder()
	ConverterHandler(w, httptest.NewRequest(http.MethodGet, "/address?address=anything", nil))
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Security-Policy"), "connect-src 'none'") || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("converter privacy boundary: %d %v", w.Code, w.Header())
	}
	if bytes.Contains(converterJS, []byte("fetch(")) || bytes.Contains(converterJS, []byte("innerHTML")) {
		t.Fatal("converter must not upload addresses or parse input as markup")
	}
}
