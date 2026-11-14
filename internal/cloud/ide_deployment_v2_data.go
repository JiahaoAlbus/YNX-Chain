package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var ErrIDEDeploymentV2DATAUnavailable = errors.New("original deployment V2 SDK DATA dependency unavailable")

// Consumer JSON DTOs of the sole SDK-decoded result, not an E11 implementation
// or Source/issuer/publisher authority. Explicit epochs never derive from rev.
type IDEDeploymentV2Ref struct {
	Realm  string `json:"realm"`
	Tenant string `json:"tenant"`
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Rev    string `json:"rev"`
}
type IDEDeploymentV2File struct {
	Ref       IDEDeploymentV2Ref `json:"ref"`
	Content   ObjectBinding      `json:"content"`
	Size      string             `json:"size"`
	MIME      string             `json:"mime"`
	ObjectKey string             `json:"objectKey"`
}
type IDEDeploymentV2Manifest struct {
	Realm          string              `json:"realm"`
	Tenant         string              `json:"tenant"`
	Project        IDEDeploymentV2Ref  `json:"project"`
	Version        string              `json:"version"`
	Artifact       IDEDeploymentV2File `json:"artifact"`
	Environment    string              `json:"env"`
	Publisher      IDEDeploymentV2Ref  `json:"publisher"`
	PublisherEpoch string              `json:"publisherEpoch"`
	Issuer         IDEDeploymentV2Ref  `json:"issuer"`
	IssuerEpoch    string              `json:"issuerEpoch"`
}

type IDEDeploymentV2Codec struct {
	node, bridge string
	active       chan struct{}
}

func NewIDEDeploymentV2Codec(node, bridge string) (*IDEDeploymentV2Codec, error) {
	for _, path := range []string{node, bridge} {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return nil, ErrIDEDeploymentV2DATAUnavailable
		}
	}
	n, err := os.Stat(node)
	if err != nil || !n.Mode().IsRegular() || n.Mode().Perm()&0111 == 0 {
		return nil, ErrIDEDeploymentV2DATAUnavailable
	}
	b, err := os.Lstat(bridge)
	if err != nil || !b.Mode().IsRegular() || b.Mode()&os.ModeSymlink != 0 {
		return nil, ErrIDEDeploymentV2DATAUnavailable
	}
	return &IDEDeploymentV2Codec{node: node, bridge: bridge, active: make(chan struct{}, 1)}, nil
}

type IDEDeploymentV2Artifact struct {
	manifest                IDEDeploymentV2Manifest
	payload, content        []byte
	binding, contentBinding ObjectBinding
}

func (a *IDEDeploymentV2Artifact) Manifest() IDEDeploymentV2Manifest { return a.manifest }
func (a *IDEDeploymentV2Artifact) ManifestBytes() []byte             { return bytes.Clone(a.payload) }
func (a *IDEDeploymentV2Artifact) Binding() ObjectBinding            { return a.binding }
func (a *IDEDeploymentV2Artifact) ContentBinding() ObjectBinding     { return a.contentBinding }
func (a *IDEDeploymentV2Artifact) OpenContent() io.Reader            { return bytes.NewReader(a.content) }

// Calls the installed sole SDK against held original bytes. Approval/signature,
// current Source, fullRef admission and original resource CAS remain separate.
func ReadIDEDeploymentArtifactV2(ctx context.Context, codec *IDEDeploymentV2Codec, manifest, content io.Reader, expected *ObjectBinding, maxBytes int64) (*IDEDeploymentV2Artifact, error) {
	if ctx == nil || codec == nil || codec.node == "" || codec.bridge == "" || codec.active == nil || manifest == nil || content == nil || maxBytes < 1 || maxBytes > MaxMultipartBytes {
		return nil, ErrIDEDeploymentV2DATAUnavailable
	}
	select {
	case codec.active <- struct{}{}:
		defer func() { <-codec.active }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	payload, err := readIDEArtifactBounded(ctx, manifest, 16<<10)
	if err != nil {
		return nil, err
	}
	body, err := readIDEArtifactBounded(ctx, content, maxBytes)
	if err != nil {
		return nil, err
	}
	full, actual := bindObjectBytes(payload), bindObjectBytes(body)
	if expected != nil && *expected != full {
		return nil, ErrIDEArtifactInput
	}
	input := struct {
		Payload  []byte         `json:"payloadOriginal"`
		Artifact []byte         `json:"artifact"`
		Expected *ObjectBinding `json:"expectedBinding,omitempty"`
	}{payload, body, expected}
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, ErrIDEArtifactInput
	}
	bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	command := exec.CommandContext(bounded, codec.node, codec.bridge)
	command.Env = []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8"}
	command.Stdin = bytes.NewReader(raw)
	stdout := &ideBoundedCommandOutput{limit: 64 << 10}
	stderr := &ideBoundedCommandOutput{limit: 8 << 10}
	command.Stdout, command.Stderr = stdout, stderr
	if err = command.Run(); err != nil || stdout.overflow || stderr.overflow {
		if bounded.Err() != nil {
			return nil, bounded.Err()
		}
		if strings.TrimSpace(stderr.buf.String()) == "V2 deployment DATA rejected" {
			return nil, ErrIDEArtifactInput
		}
		return nil, ErrIDEDeploymentV2DATAUnavailable
	}
	var result struct {
		Manifest IDEDeploymentV2Manifest `json:"manifest"`
		Binding  ObjectBinding           `json:"manifestBinding"`
		Content  ObjectBinding           `json:"contentBinding"`
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout.buf.Bytes()))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil || decoder.Decode(&struct{}{}) != io.EOF || result.Binding != full || result.Content != actual || result.Manifest.Artifact.Content != actual {
		return nil, ErrIDEArtifactInput
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	return &IDEDeploymentV2Artifact{manifest: result.Manifest, payload: payload, content: body, binding: full, contentBinding: actual}, nil
}
