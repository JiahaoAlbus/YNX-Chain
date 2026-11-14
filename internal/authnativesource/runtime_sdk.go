//go:build pay_pq

package paynativesource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"path/filepath"
	"time"
)

type boundedResult struct {
	bytes.Buffer
	limit int
}

func (b *boundedResult) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, ErrDenied
	}
	return b.Buffer.Write(p)
}
func decodeObject(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		return e
	}
	if d.Decode(new(any)) != io.EOF {
		return ErrDenied
	}
	return nil
}
func (c *originalPayCommissioning) runOriginalSDK(r originalPayRelease, root, enrollment, profile, head []byte) (map[string]json.RawMessage, error) {
	if e := requireOriginalPayFamily(r); e != nil {
		return nil, e
	}
	if e := requireOriginalPayPlatform(r.platform); e != nil {
		return nil, e
	}
	if r.sourceID == "" || r.productID == "" || r.applicationID == "" || r.endpoint == "" || r.spki == "" {
		return nil, ErrNotSupplied
	}
	if _, e := c.hold(r.nodeImage, r.nodeSHA, 134217728); e != nil {
		return nil, e
	}
	if _, e := c.hold(r.verifierImage, r.verifierSHA, 131072); e != nil {
		return nil, e
	}
	manifest, e := c.hold(r.runtimeManifest, r.manifestSHA, 1048576)
	if e != nil {
		return nil, e
	}
	var m struct {
		Version string `json:"version"`
		Files   []struct {
			Path  string `json:"path"`
			Bytes int64  `json:"bytes"`
			SHA   string `json:"sha256"`
		} `json:"files"`
	}
	if decodeObject(manifest, &m) != nil || m.Version != "YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1" || len(m.Files) == 0 || len(m.Files) > 4096 {
		return nil, ErrDenied
	}
	base := filepath.Dir(filepath.Dir(r.verifierImage))
	seen := map[string]bool{}
	previous := ""
	var total int64
	for _, f := range m.Files {
		if f.Path == "" || filepath.IsAbs(f.Path) || filepath.Clean(f.Path) != f.Path || f.Path <= previous || seen[f.Path] || f.Bytes < 1 || f.Bytes > 16777216 {
			return nil, ErrDenied
		}
		p := filepath.Join(base, f.Path)
		if p == base || len(p) <= len(base) || p[:len(base)+1] != base+string(filepath.Separator) {
			return nil, ErrDenied
		}
		total += f.Bytes
		if total > 268435456 {
			return nil, ErrDenied
		}
		b, e := c.hold(p, f.SHA, f.Bytes)
		if e != nil || int64(len(b)) != f.Bytes {
			return nil, ErrDenied
		}
		seen[f.Path] = true
		previous = f.Path
	}
	for _, required := range []string{"package.json", "native/original-auth-identity-source-verifier.mjs", "native/original-auth-identity-source-v2-verifier.mjs", "native/original-auth-source-v2-dispatch.mjs"} {
		if !seen[required] {
			return nil, errors.New("PAY_ORIGINAL_COMPLETE_SDK_CLOSURE_NOT_SUPPLIED")
		}
	}
	input, e := originalPaySDKInputDATA(r, root, enrollment, profile, head)
	if e != nil {
		return nil, e
	}
	raw, e := json.Marshal(input)
	if e != nil || len(raw) > 2097152 {
		return nil, ErrDenied
	}
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, r.nodeImage, r.verifierImage)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "NODE_NO_WARNINGS=1"}
	cmd.Stdin = bytes.NewReader(raw)
	out := &boundedResult{limit: 2097152}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if e = cmd.Run(); e != nil {
		return nil, errors.New("PAY_ORIGINAL_SDK_VERIFIER_REJECTED_OR_NOT_SUPPLIED")
	}
	var result struct {
		Projection map[string]json.RawMessage `json:"projection"`
		CurrentRaw string                     `json:"currentRaw"`
	}
	if decodeObject(out.Bytes(), &result) != nil || len(result.CurrentRaw) == 0 {
		return nil, ErrDenied
	}
	var status, id, subject string
	var dataOnly, nativeAdmission bool
	var expires int64
	p := result.Projection
	if json.Unmarshal(p["status"], &status) != nil || json.Unmarshal(p["sourceId"], &id) != nil || json.Unmarshal(p["subjectOwner"], &subject) != nil || json.Unmarshal(p["dataOnly"], &dataOnly) != nil || json.Unmarshal(p["nativeAdmission"], &nativeAdmission) != nil || json.Unmarshal(p["expiresAtMs"], &expires) != nil || status != "active" || id != r.sourceID || subject == "" || !dataOnly || nativeAdmission || expires <= time.Now().UnixMilli() || expires > time.Now().Add(time.Minute).UnixMilli() {
		return nil, ErrDenied
	}
	c.until = time.UnixMilli(expires)
	c.monotonicAnchor = time.Now()
	c.wallAnchor = c.monotonicAnchor.UnixMilli()
	c.wallFloor = c.wallAnchor
	return p, c.current()
}

// Private DATA assembly only. This neither verifies a credential nor grants
// Source/Pay authority. Sole SDK performs the real signed cross-binding of
// policy/enrollment/association/expectedRequest; no alternate Go codec exists.
func originalPaySDKInputDATA(r originalPayRelease, root, enrollment, profile, head []byte) (map[string]any, error) {
	if e := requireOriginalPayFamily(r); e != nil {
		return nil, e
	}
	if e := requireOriginalPayPlatform(r.platform); e != nil {
		return nil, e
	}
	return map[string]any{"operation": "auth-source-v2-native-node/v1", "rootRaw": string(root), "enrollmentRaw": string(enrollment), "profileRaw": string(profile), "headRaw": string(head), "policy": map[string]any{"rootDigest": r.rootSHA, "enrollmentDigest": r.enrollmentSHA, "endpoint": r.endpoint, "spki": r.spki, "platform": r.platform, "applicationId": r.applicationID, "productId": r.productID, "signatureContract": map[string]string{"purpose": r.purpose, "enrollmentFrame": r.enrollmentFrame, "profileFrame": r.profileFrame, "currentFrame": r.currentFrame}}, "previous": map[string]any{"sequence": 0, "floor": 0, "head": "", "timeFloor": 0, "executionHeight": "0"}, "node": map[string]string{"origin": r.nodeOrigin, "spki": r.nodeSPKI, "nativeChainId": r.nativeChainID}}, nil
}
