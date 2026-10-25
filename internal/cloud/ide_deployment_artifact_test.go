package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
)

func ideArtifactData(t *testing.T) ([]byte, []byte, IDEArtifactBinding) {
	t.Helper()
	body := []byte("actual bounded artifact bytes\x00\x01\x02")
	binding := IDEArtifactBinding{ProjectID: "project-a", Version: "1.0.0", ContentDigest: hashBytes(body), PublishPurpose: "deploy", TargetEnvironment: "testnet-qa", ByteSize: int64(len(body))}
	raw, err := json.Marshal(binding)
	if err != nil {
		t.Fatal(err)
	}
	return body, raw, binding
}

func TestIDEDeploymentArtifactSnapshot(t *testing.T) {
	body, raw, binding := ideArtifactData(t)
	snapshot, err := ReadIDEDeploymentArtifact(context.Background(), bytes.NewReader(raw), bytes.NewReader(body), binding, 1024)
	if err != nil {
		t.Fatal(err)
	}
	body[0] ^= 1
	raw[0] = '['
	first, err := io.ReadAll(snapshot.OpenContent())
	if err != nil || hashBytes(first) != binding.ContentDigest {
		t.Fatalf("snapshot alias: %v", err)
	}
	first[0] ^= 1
	second, _ := io.ReadAll(snapshot.OpenContent())
	if hashBytes(second) != binding.ContentDigest {
		t.Fatal("reader exposed mutable content")
	}
	manifest := snapshot.ManifestBytes()
	manifest[0] = '['
	if snapshot.ManifestBytes()[0] != '{' || snapshot.Binding() != binding {
		t.Fatal("binding/manifest alias")
	}
}

func TestIDEDeploymentArtifactSelectionBinding(t *testing.T) {
	body, raw, binding := ideArtifactData(t)
	for _, name := range []string{"project", "version", "digest", "purpose", "environment", "size"} {
		t.Run(name, func(t *testing.T) {
			changed := binding
			switch name {
			case "project":
				changed.ProjectID = "another-project"
			case "version":
				changed.Version = "2.0.0"
			case "digest":
				changed.ContentDigest = strings.Repeat("a", 64)
			case "purpose":
				changed.PublishPurpose = "lease-purchase"
			case "environment":
				changed.TargetEnvironment = "production"
			case "size":
				changed.ByteSize++
			}
			if got, err := ReadIDEDeploymentArtifact(context.Background(), bytes.NewReader(raw), bytes.NewReader(body), changed, 1024); got != nil || !errors.Is(err, ErrIDEArtifactInput) {
				t.Fatalf("substitution accepted: %v", err)
			}
		})
	}
}

func TestIDEDeploymentArtifactTamperAndSize(t *testing.T) {
	body, raw, binding := ideArtifactData(t)
	for _, name := range []string{"tamper", "truncated", "extra"} {
		t.Run(name, func(t *testing.T) {
			changed := append([]byte(nil), body...)
			switch name {
			case "tamper":
				changed[0] ^= 1
			case "truncated":
				changed = changed[:len(changed)-1]
			case "extra":
				changed = append(changed, 0)
			}
			if got, err := ReadIDEDeploymentArtifact(context.Background(), bytes.NewReader(raw), bytes.NewReader(changed), binding, 1024); got != nil || !errors.Is(err, ErrIDEArtifactInput) {
				t.Fatalf("bad body accepted: %v", err)
			}
		})
	}
}

func TestIDEDeploymentArtifactStrictManifest(t *testing.T) {
	body, raw, binding := ideArtifactData(t)
	base := string(raw[:len(raw)-1])
	for _, extra := range []string{`,"projectId":"project-a"}`, `,"publisherPublicKey":"self-reported"}`, `,"signature":"not-authority"}`, `} {}`, `,"unknown":true}`} {
		if got, err := ReadIDEDeploymentArtifact(context.Background(), strings.NewReader(base+extra), bytes.NewReader(body), binding, 1024); got != nil || !errors.Is(err, ErrIDEArtifactInput) {
			t.Fatalf("ambiguous manifest accepted: %s %v", extra, err)
		}
	}
	if _, err := ReadIDEDeploymentArtifact(context.Background(), strings.NewReader(strings.Repeat(" ", 16385)), bytes.NewReader(body), binding, 1024); !errors.Is(err, ErrIDEArtifactInput) {
		t.Fatalf("oversize manifest: %v", err)
	}
}

type ideCountingReader struct {
	reads int
	body  []byte
}

func (r *ideCountingReader) Read(p []byte) (int, error) {
	r.reads++
	if len(r.body) == 0 {
		return 0, io.EOF
	}
	n := copy(p, r.body)
	r.body = r.body[n:]
	return n, nil
}

func TestIDEDeploymentArtifactCancellationAndBounds(t *testing.T) {
	body, raw, binding := ideArtifactData(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	reader := &ideCountingReader{body: append([]byte(nil), body...)}
	if got, err := ReadIDEDeploymentArtifact(ctx, bytes.NewReader(raw), reader, binding, 1024); got != nil || !errors.Is(err, context.Canceled) || reader.reads != 0 {
		t.Fatalf("cancel read content: %v %d", err, reader.reads)
	}
	for _, limit := range []int64{0, binding.ByteSize - 1, MaxMultipartBytes + 1} {
		if got, err := ReadIDEDeploymentArtifact(context.Background(), bytes.NewReader(raw), bytes.NewReader(body), binding, limit); got != nil || !errors.Is(err, ErrIDEArtifactInput) {
			t.Fatalf("invalid cap accepted: %d %v", limit, err)
		}
	}
}
