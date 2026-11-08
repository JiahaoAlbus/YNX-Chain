package productreadsource

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strconv"
)

// Original SDK stdin requires canonical JSON, not merely correctly named keys.
// A Go struct is not suitable for previous: Marshal emits declaration order,
// unlike the sole SDK's lexicographic key order. This is DATA assembly only;
// all Root/signature/current verification remains in the original SDK callee.
func encodeOriginalSDKInput(r release, root, enrollment, profile, head []byte, before previous) ([]byte, error) {
	const maxSafe = 9007199254740991
	if before.Sequence > maxSafe || before.Floor > before.Sequence || before.TimeFloor < 0 || before.TimeFloor > maxSafe || (before.Head != "" && !network.MatchString(before.Head)) || !regexp.MustCompile(`^(0|[1-9][0-9]*)$`).MatchString(before.ExecutionHeight) {
		return nil, ErrDenied
	}
	if _, e := strconv.ParseUint(before.ExecutionHeight, 10, 64); e != nil {
		return nil, ErrDenied
	}
	prior := map[string]any{"sequence": before.Sequence, "floor": before.Floor, "head": before.Head, "timeFloor": before.TimeFloor, "executionHeight": before.ExecutionHeight}
	input := map[string]any{"operation": "auth-source-v2-native-node/v1", "rootRaw": string(root), "enrollmentRaw": string(enrollment), "profileRaw": string(profile), "headRaw": string(head), "policy": map[string]any{"rootDigest": r.root.SHA256, "enrollmentDigest": r.enrollment.SHA256, "endpoint": r.endpoint, "spki": r.spki, "platform": r.platform, "applicationId": r.applicationID, "productId": r.productID, "signatureContract": map[string]string{"purpose": Purpose, "enrollmentFrame": r.enrollmentFrame, "profileFrame": r.profileFrame, "currentFrame": r.currentFrame}}, "previous": prior, "node": map[string]string{"origin": r.nodeOrigin, "spki": r.nodeSPKI, "nativeChainId": r.nativeChainID}}
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if e := encoder.Encode(input); e != nil {
		return nil, e
	}
	encoded := bytes.TrimSuffix(out.Bytes(), []byte{'\n'})
	if len(encoded) > 2<<20 {
		return nil, ErrDenied
	}
	return bytes.Clone(encoded), nil
}
