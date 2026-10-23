package cloud

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode"
)

var ErrIDEArtifactInput = errors.New("IDE deployment artifact input rejected")

// IDEArtifactBinding is a DATA selection, not project ACL, an issuer claim,
// a publisher identity, or deployment approval. The original Auth verifier must
// separately authorize the exact manifest bytes and this selection before use.
type IDEArtifactBinding struct {
	ProjectID         string `json:"projectId"`
	Version           string `json:"version"`
	ContentDigest     string `json:"contentDigest"`
	PublishPurpose    string `json:"publishPurpose"`
	TargetEnvironment string `json:"targetEnvironment"`
	ByteSize          int64  `json:"byteSize"`
}

// IDEDeploymentArtifact holds the same bounded bytes that were hashed. No path
// is returned to reopen after verification, and accessors expose no mutable
// backing array. This object conveys no permission and performs no deployment.
type IDEDeploymentArtifact struct {
	binding  IDEArtifactBinding
	manifest []byte
	content  []byte
}

func (a *IDEDeploymentArtifact) Binding() IDEArtifactBinding { return a.binding }
func (a *IDEDeploymentArtifact) ManifestBytes() []byte {
	return append([]byte(nil), a.manifest...)
}
func (a *IDEDeploymentArtifact) OpenContent() io.Reader {
	return bytes.NewReader(a.content)
}

// ReadIDEDeploymentArtifact snapshots a caller-owned stream once, bounded by
// the requested size and the inherited Cloud multipart ceiling. Signature,
// current deployment permission, target admission, approval expiry and resource
// charges deliberately remain outside this DATA-only function.
func ReadIDEDeploymentArtifact(ctx context.Context, manifest, content io.Reader, selected IDEArtifactBinding, maxBytes int64) (*IDEDeploymentArtifact, error) {
	if ctx == nil || manifest == nil || content == nil || maxBytes < 1 || maxBytes > MaxMultipartBytes || selected.ByteSize < 1 || selected.ByteSize > maxBytes {
		return nil, ErrIDEArtifactInput
	}
	for _, value := range []string{selected.ProjectID, selected.Version, selected.PublishPurpose, selected.TargetEnvironment} {
		if value == "" || len(value) > 256 || strings.TrimSpace(value) != value || strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return nil, ErrIDEArtifactInput
		}
	}
	digest, err := hex.DecodeString(selected.ContentDigest)
	if err != nil || len(digest) != sha256.Size || selected.ContentDigest != strings.ToLower(selected.ContentDigest) {
		return nil, ErrIDEArtifactInput
	}
	raw, err := readIDEArtifactBounded(ctx, manifest, 16<<10)
	if err != nil {
		return nil, err
	}
	decoded, err := decodeIDEArtifactBinding(raw)
	if err != nil || decoded != selected {
		return nil, ErrIDEArtifactInput
	}
	body, err := readIDEArtifactBounded(ctx, content, selected.ByteSize)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) != selected.ByteSize || hashBytes(body) != selected.ContentDigest {
		return nil, ErrIDEArtifactInput
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &IDEDeploymentArtifact{binding: selected, manifest: raw, content: body}, nil
}

type ideArtifactContextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r ideArtifactContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

func readIDEArtifactBounded(ctx context.Context, r io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(ideArtifactContextReader{ctx, r}, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, ErrIDEArtifactInput
	}
	return body, nil
}

// Reject duplicate/unknown fields instead of letting a second interpretation
// choose another project, target, digest or artifact-supplied publisher key.
// Retain the original bytes for Auth; never reconstruct signing bytes here.
func decodeIDEArtifactBinding(raw []byte) (IDEArtifactBinding, error) {
	var value IDEArtifactBinding
	d := json.NewDecoder(bytes.NewReader(raw))
	start, err := d.Token()
	if err != nil || start != json.Delim('{') {
		return value, ErrIDEArtifactInput
	}
	seen := make(map[string]bool)
	for d.More() {
		token, err := d.Token()
		if err != nil {
			return value, ErrIDEArtifactInput
		}
		key, ok := token.(string)
		if !ok || seen[key] {
			return value, ErrIDEArtifactInput
		}
		seen[key] = true
		var into any
		switch key {
		case "projectId":
			into = &value.ProjectID
		case "version":
			into = &value.Version
		case "contentDigest":
			into = &value.ContentDigest
		case "publishPurpose":
			into = &value.PublishPurpose
		case "targetEnvironment":
			into = &value.TargetEnvironment
		case "byteSize":
			into = &value.ByteSize
		default:
			return value, ErrIDEArtifactInput
		}
		if err := d.Decode(into); err != nil {
			return value, ErrIDEArtifactInput
		}
	}
	end, err := d.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 6 {
		return value, ErrIDEArtifactInput
	}
	if _, err := d.Token(); err != io.EOF {
		return value, ErrIDEArtifactInput
	}
	return value, nil
}
