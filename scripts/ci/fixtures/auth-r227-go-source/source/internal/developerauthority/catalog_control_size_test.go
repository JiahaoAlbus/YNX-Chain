package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type controlSizeBoundarySource struct {
	p                    Principal
	calls                int
	original             []byte
	verifier             *OriginalSourceVerifierOwner
	input                []byte
	nonce, caller        string
	actualCalleeReturned error
}

func (s *controlSizeBoundarySource) CurrentExistingPrincipal(context.Context, *http.Request) (Principal, error) {
	return s.p, nil
}
func (s *controlSizeBoundarySource) AuthorizeProjectControl(ctx context.Context, p Principal, c Command, proof []byte) (Approval, error) {
	s.calls++
	s.original = append([]byte(nil), proof...)
	_, s.actualCalleeReturned = s.verifier.invokeOriginalControlCurrent(ctx, s.input, p, c, proof, s.nonce, s.caller)
	return Approval{}, s.actualCalleeReturned
}
func (*controlSizeBoundarySource) AssertSourceCurrent(context.Context) error { return ErrDenied }
func (*controlSizeBoundarySource) AssertPrincipalCurrent(context.Context, Principal) error {
	return ErrDenied
}
func (*controlSizeBoundarySource) AssertCatalogAuthorityCurrent(context.Context, Principal) error {
	return ErrDenied
}
func (*controlSizeBoundarySource) AssertControlCurrent(context.Context, Principal, Approval) error {
	return ErrDenied
}
func (*controlSizeBoundarySource) VerifyProtectedPublisherOriginal(context.Context, Principal, Command, []byte) (ProtectedPublisher, error) {
	return ProtectedPublisher{}, ErrDenied
}
func (*controlSizeBoundarySource) AssertPublisherCurrent(context.Context, Principal, Publisher) error {
	return ErrDenied
}

func TestApplyControlActualCABIEnvelopeSizeAndCurrentExpiry(t *testing.T) {
	raw, e := os.ReadFile(filepath.Join("..", "..", "packages", "wallet-auth", "test", "fixtures", "native-control-154a7b211-public-interop.json"))
	if e != nil {
		t.Fatal(e)
	}
	if len(raw) != 86706 || hash(raw) != "9e6639840b56f51cc5faa95de69a30b2c6c4fed68b9318e08d16fe4b038f57ec" {
		t.Fatal("actual supplier identity")
	}
	var f struct {
		Principal string            `json:"principalOriginalBase64"`
		Command   string            `json:"commandOriginalBase64"`
		Decision  string            `json:"decisionOriginalBase64"`
		Member    string            `json:"memberOriginalBase64Url"`
		Binding   map[string]string `json:"binding"`
		Observed  int64             `json:"observedAtMs,string"`
		Actual    bool              `json:"actualCABI"`
		AND       bool              `json:"dualANDVerified"`
	}
	if json.Unmarshal(raw, &f) != nil || !f.Actual || !f.AND || len(f.Member) != 78682 {
		t.Fatal("not actual CABI member")
	}
	decode := func(s string) []byte {
		b, e := base64.StdEncoding.Strict().DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	var p Principal
	var c Command
	if json.Unmarshal(decode(f.Principal), &p) != nil || json.Unmarshal(decode(f.Command), &c) != nil {
		t.Fatal("actual originals")
	}
	binding := map[string]string{}
	for _, k := range []string{"networkId", "owner", "keyVersion", "executionHeight", "callerIdentity", "sourceCurrentRef"} {
		binding[k] = f.Binding[k]
	}
	proof, _ := json.Marshal(map[string]any{"version": "YNX-IDE-PROJECT-CONTROL-APPROVAL/v1", "binding": binding, "principalOriginal": string(decode(f.Principal)), "commandOriginal": string(decode(f.Command)), "decisionOriginal": string(decode(f.Decision)), "memberOriginal": f.Member})
	if len(proof) <= 65536 || len(proof) > 393216 {
		t.Fatal("real envelope size", len(proof))
	}
	var decision struct {
		Nonce string `json:"nonce"`
	}
	_ = json.Unmarshal(decode(f.Decision), &decision)
	input, _ := json.Marshal(map[string]any{"operation": "ide-project-control-current-native-node/v1", "source": map[string]any{"profileRaw": "PUBLIC_UNCOMMISSIONED"}, "approvalOriginal": string(proof), "principal": originalControlPrincipalDTO(p), "command": originalControlCommandDTO(c), "expected": map[string]any{"nonce": decision.Nonce, "callerIdentity": binding["callerIdentity"], "sourceCurrentRef": p.CurrentRef}})
	source := &controlSizeBoundarySource{p: p, verifier: &OriginalSourceVerifierOwner{}, input: input, nonce: decision.Nonce, caller: binding["callerIdentity"]}
	// Historical clock ONLY on Catalog's existing private test seam. The actual
	// current callee retains real time and MUST reject this historical fixture.
	catalog := &Catalog{source: source, now: func() time.Time { return time.UnixMilli(f.Observed) }}
	_, e = catalog.ApplyControl(context.Background(), &http.Request{}, c, proof, nil)
	if source.calls != 1 || !bytes.Equal(source.original, proof) {
		t.Fatal("actual complete CABI approval rejected before Source/current callee", len(proof), source.calls)
	}
	if e == nil || source.actualCalleeReturned != ErrDenied {
		t.Fatal("historical fixture became current authority")
	}
	source.calls = 0
	if _, e = catalog.ApplyControl(context.Background(), &http.Request{}, c, bytes.Repeat([]byte{'x'}, 393217), nil); e == nil || source.calls != 0 {
		t.Fatal("CONTROL overlimit reached Source")
	}
	t.Logf("actualCABI member=%d envelope=%d sha=%s; forwarded unchanged; real current expired denied", len(f.Member), len(proof), hash(proof))
}
