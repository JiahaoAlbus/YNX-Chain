package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"

	sdk "github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/taskactionv6"
)

type p08SDKSelectedPagesFixture struct {
	PublicEphemeralOnly bool `json:"publicEphemeralOnly"`
	SourceAdmission     bool
	NativeAdmission     bool
	Raw                 string
	Header              string
	Message             string
	Unsigned            struct{ TaskRevision, Generation, RunID, BodyDigest string }
	Expected            struct{ NetworkID string }
}

func p08SDKSelectedFixture(t *testing.T) (p08SDKSelectedPagesFixture, []byte) {
	t.Helper()
	data, err := os.ReadFile("testdata/sdk-selected-pages/public.json")
	if err != nil {
		t.Fatal(err)
	}
	var f p08SDKSelectedPagesFixture
	if json.Unmarshal(data, &f) != nil || !f.PublicEphemeralOnly || f.SourceAdmission || f.NativeAdmission {
		t.Fatal("explicit original PUBLIC SDK vector required")
	}
	raw, err := base64.RawURLEncoding.DecodeString(f.Raw)
	if err != nil {
		t.Fatal(err)
	}
	return f, raw
}
func TestP08SelectedPagesSDKOriginalVectorActualProductDecode(t *testing.T) {
	f, raw := p08SDKSelectedFixture(t)
	var input taskRunRequest
	if rejectDuplicateShopJSON(raw) != nil || strictToolJSON(bytes.NewReader(raw), &input) != nil || validateTaskPageReferences(input.SelectedPages) != nil {
		t.Fatal("actual product schema rejected original new SDK body")
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != f.Unsigned.BodyDigest || input.RunID != f.Unsigned.RunID || strconv.FormatUint(input.TaskRevision, 10) != f.Unsigned.TaskRevision || strconv.FormatUint(input.Generation, 10) != f.Unsigned.Generation || len(input.SelectedPages) != 1 {
		t.Fatal("original body digest/task/run/revision/reference binding lost")
	}
	// References remain distinct from user prompt; no Source/approval is created.
	if strings.Contains(input.Prompt, input.SelectedPages[0].SelectionID) {
		t.Fatal("SDK fixture hid refs inside prompt")
	}
	for _, id := range []string{strings.Repeat("界", 42) + "ab", strings.Repeat("é", 64)} {
		if validateTaskPageReferences([]TaskPageReference{{SelectionID: id, Version: strings.Repeat("a", 128)}}) != nil {
			t.Fatal("valid original 128-byte UTF8 reference rejected")
		}
	}
	for _, id := range []string{strings.Repeat("界", 43), string([]byte{0xff}), ""} {
		if validateTaskPageReferences([]TaskPageReference{{SelectionID: id, Version: strings.Repeat("a", 128)}}) == nil {
			t.Fatal("invalid byte-bound/UTF8 reference accepted")
		}
	}
}

// Optional complete normal SDK build fixture, never a product/Source setter.
// The original runtime CI always runs the product-decode vector above; the
// bounded matching-prefix intake supplies this immutable build configuration.
func TestP08SelectedPagesSDKNormalGoBridgeProjection(t *testing.T) {
	path := os.Getenv("P08_SELECTED_PAGES_SDK_BUILD_CONFIG")
	if path == "" {
		t.Skip("complete original SDK CLI build selection not supplied")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var build sdk.BuildInputs
	if json.Unmarshal(raw, &build) != nil {
		t.Fatal("invalid normal SDK build DATA")
	}
	bridge, err := sdk.OpenInstalledCLI(build)
	if err != nil {
		t.Fatal(err)
	}
	f, body := p08SDKSelectedFixture(t)
	projected, err := bridge.Project(context.Background(), sdk.Request{NetworkID: f.Expected.NetworkID, ProofHeader: f.Header, BodyOriginal: body})
	if err != nil || projected.SignatureVerified || !projected.DataOnly || projected.SourceAdmission || projected.NativeAdmission || projected.BodyDigest != f.Unsigned.BodyDigest {
		t.Fatalf("normal original Go/Node projection rejected or promoted DATA: %+v %v", projected, err)
	}
	message, err := base64.RawURLEncoding.DecodeString(f.Message)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(message)
	if projected.RequestDigest != hex.EncodeToString(digest[:]) {
		t.Fatal("original E5 bytes changed")
	}
	// Old public proof cannot approve a changed selected version/body.
	changed := bytes.Replace(body, []byte(strings.Repeat("a", 128)), []byte(strings.Repeat("b", 128)), 1)
	if bytes.Equal(changed, body) {
		t.Fatal("test did not change original selected version")
	}
	if _, err = bridge.Project(context.Background(), sdk.Request{NetworkID: f.Expected.NetworkID, ProofHeader: f.Header, BodyOriginal: changed}); err == nil {
		t.Fatal("original normal CLI accepted altered refs under unchanged E5 proof")
	}
}
