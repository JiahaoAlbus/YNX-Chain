package taskactionv6

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

var build BuildInputs
var actual *Bridge
var sample struct {
	PublicOnly      bool
	NetworkID       string
	ProofHeader     string
	BodyOriginal    string
	MessageOriginal string
	Expected        Projection
}

func TestMain(m *testing.M) {
	var cfg struct {
		Build      BuildInputs
		GoldenPath string
	}
	raw, e := os.ReadFile(os.Getenv("YNX_V6_GO_TEST_CONFIG"))
	if e != nil {
		fmt.Fprintln(os.Stderr, "run the normal SDK ai-task-v6-go-data-bridge CI driver to supply PUBLIC build fixture")
		os.Exit(2)
	}
	if json.Unmarshal(raw, &cfg) != nil {
		os.Exit(2)
	}
	raw, e = os.ReadFile(cfg.GoldenPath)
	if e != nil || json.Unmarshal(raw, &sample) != nil || !sample.PublicOnly {
		os.Exit(2)
	}
	build = cfg.Build
	actual, e = OpenInstalledCLI(build)
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(2)
	}
	os.Exit(m.Run())
}
func originalBody(t *testing.T) []byte {
	t.Helper()
	b, e := base64.RawURLEncoding.DecodeString(sample.BodyOriginal)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func request(t *testing.T) Request {
	return Request{NetworkID: sample.NetworkID, ProofHeader: sample.ProofHeader, BodyOriginal: originalBody(t)}
}
func code(t *testing.T, e error, want string) {
	t.Helper()
	var b *Error
	if !errors.As(e, &b) || b.Code != want {
		t.Fatalf("want code %s, got %v", want, e)
	}
}
func TestActualInstalledNodeProjectionCrossLanguage(t *testing.T) {
	p, e := actual.Project(context.Background(), request(t))
	if e != nil {
		t.Fatal(e)
	}
	if p != sample.Expected {
		t.Fatalf("digest DATA mismatch: %#v", p)
	}
	message, e := base64.RawURLEncoding.DecodeString(sample.MessageOriginal)
	if e != nil {
		t.Fatal(e)
	}
	s := sha256.Sum256(message)
	if hex.EncodeToString(s[:]) != p.RequestDigest {
		t.Fatal("not original E5 SHA256")
	}
	if !bytes.Contains(originalBody(t), []byte("9007199254740993")) || !bytes.Contains(originalBody(t), []byte("1.25")) {
		t.Fatal("raw numeric PUBLIC fixture missing")
	}
	if p.SignatureVerified || p.SourceAdmission || p.NativeAdmission {
		t.Fatal("DATA escalation")
	}
}
func TestWrongOriginalBodyRejectedAndNoBodyLeak(t *testing.T) {
	r := request(t)
	r.BodyOriginal = []byte("PUBLIC-do-not-echo-this-body")
	_, e := actual.Project(context.Background(), r)
	code(t, e, "TASK_V6_NODE_CLI_REJECTED")
	var c *Error
	_ = errors.As(e, &c)
	if c.CLI_Code != "PRODUCT_SESSION_TASK_V6_BODY_BINDING" || strings.Contains(e.Error(), "do-not-echo") {
		t.Fatal("unexpected error projection")
	}
}
func TestInputCapsAndCancellation(t *testing.T) {
	for _, r := range []Request{{NetworkID: sample.NetworkID, ProofHeader: sample.ProofHeader, BodyOriginal: make([]byte, maxBody+1)}, {NetworkID: strings.ToUpper(sample.NetworkID), ProofHeader: sample.ProofHeader}, {NetworkID: sample.NetworkID, ProofHeader: "="}, {NetworkID: sample.NetworkID, ProofHeader: strings.Repeat("a", maxHeader+1)}} {
		_, e := actual.Project(context.Background(), r)
		code(t, e, "TASK_V6_REQUEST_INVALID")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, e := actual.Project(ctx, request(t))
	if !errors.Is(e, context.Canceled) {
		t.Fatal("cancellation lost")
	}
	ctx, cancel = context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, e = actual.Project(ctx, request(t))
	if !errors.Is(e, context.DeadlineExceeded) {
		t.Fatalf("deadline lost: %v", e)
	}
}
func TestBuildInputsArePinnedFixedAndCopied(t *testing.T) {
	b := build
	b.RuntimeFiles = append([]FilePin(nil), build.RuntimeFiles...)
	b.CLI_SHA256 = strings.Repeat("0", 64)
	_, e := OpenInstalledCLI(b)
	code(t, e, "TASK_V6_BUILD_CLI_PIN_MISMATCH")
	b = build
	b.NodePath = "node"
	_, e = OpenInstalledCLI(b)
	code(t, e, "TASK_V6_BUILD_PATH_INVALID")
	b = build
	b.RuntimeFiles = append([]FilePin(nil), build.RuntimeFiles...)
	b.RuntimeFiles[0].Path = "../foreign"
	_, e = OpenInstalledCLI(b)
	code(t, e, "TASK_V6_BUILD_MANIFEST_INVALID")
	if actual.files[0].Path != build.RuntimeFiles[0].Path {
		t.Fatal("mutated borrowed manifest")
	}
}
func canonical(p Projection) []byte {
	b, _ := json.Marshal(map[string]any{"version": p.Version, "requestDigest": p.RequestDigest, "bodyDigest": p.BodyDigest, "bodyBytes": p.BodyBytes, "dataOnly": p.DataOnly, "signatureVerified": p.SignatureVerified, "SourceAdmission": p.SourceAdmission, "NativeAdmission": p.NativeAdmission})
	return append(b, '\n')
}
func TestFakeCLIOutputsCannotAddQualificationOrAliasCanonicalShape(t *testing.T) {
	good := canonical(sample.Expected)
	p, e := decodeProjection(good)
	if e != nil || p != sample.Expected {
		t.Fatal(e)
	}
	for _, raw := range [][]byte{bytes.Replace(good, []byte(`"bodyBytes":"`+sample.Expected.BodyBytes+`"`), []byte(`"bodyBytes":"1048577"`), 1), bytes.Replace(good, []byte(`"signatureVerified":false`), []byte(`"signatureVerified":true`), 1), bytes.Replace(good, []byte(`"NativeAdmission":false`), []byte(`"NativeAdmission":true`), 1), bytes.Replace(good, []byte(`"version":"6"`), []byte(`"version":6`), 1), append([]byte(`{"RootAdmission":false,`), good[1:]...), append([]byte(`{"version":"6",`), good[1:]...), append(append([]byte(nil), good...), []byte("{}\n")...), append([]byte(" "), good...), bytes.Replace(good, []byte(`"version"`), []byte(`"vers\u0069on"`), 1), append([]byte(nil), good[:len(good)-1]...)} {
		if _, e := decodeProjection(raw); e == nil {
			t.Fatal("forged/noncanonical output accepted")
		}
	}
}
func TestOutputBudgetsCancelWithoutRetainingOverflow(t *testing.T) {
	called := false
	w := cappedWriter{max: 4, cancel: func() { called = true }}
	if n, e := w.Write([]byte("abcd")); n != 4 || e != nil {
		t.Fatal(e)
	}
	if n, e := w.Write([]byte("x")); n != 0 || e == nil || !called || !w.overflow || w.b.String() != "abcd" {
		t.Fatal("output limit not enforced")
	}
}
