package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
	"golang.org/x/sys/unix"
)

// PUBLIC Source-current fixture only, not a principal or a production verifier.
type publicIDEConfigSource struct {
	publicStartupSource
	calls, denyAt int
}

func (s *publicIDEConfigSource) AssertSourceCurrent(context.Context) error {
	s.calls++
	if s.denyAt > 0 && s.calls >= s.denyAt {
		return errors.New("PUBLIC Source revoked")
	}
	return nil
}

func publicIDEConfigRaw() []byte {
	return []byte(`{"catalog":{"connectionUrl":"postgres://public:PUBLIC_SECRET@public.invalid:5432/public?sslmode=verify-full","maxOpen":4,"maxIdle":2,"connectTimeoutSeconds":5,"maxIdleSeconds":60,"maxLifetimeSeconds":1800},"runtime":{"binary":"/PUBLIC/docker","socket":"/PUBLIC/socket","storageRoot":"/PUBLIC/storage","resourceId":"PUBLIC_RESOURCE","targetEnvironment":"PUBLIC_ENV","imageDigest":"sha256:` + strings.Repeat("a", 64) + `","serverOrigin":"https://cloud.public.invalid","runtimeOrigin":"https://runtime.other.invalid","httpPort":3000,"maxSeconds":30}}`)
}
func publicIDEConfigFile(t *testing.T, raw []byte) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "private")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "config.json")
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestIDERuntimeProtectedConfigAssemblesWithoutCreatingAuthorityOrResources(t *testing.T) {
	source := &publicIDEConfigSource{}
	file := publicIDEConfigFile(t, publicIDEConfigRaw())
	original := &ideDeploymentStartupInputs{Source: source}
	got, err := resolveIDEDeploymentStartup(context.Background(), file, original)
	if err != nil || got == nil || got.Source != source || source.calls != 2 || got.Runtime.ResourceID != "PUBLIC_RESOURCE" || got.Catalog.ConnectTimeout != 5*time.Second || got.Catalog.MaxLifetime != 30*time.Minute {
		t.Fatal("protected assembly failed", err)
	}
	if original.Catalog != (developerauthority.PostgresCatalogConfig{}) || original.Runtime != (cloud.IDEExistingOCIConfig{}) {
		t.Fatal("original input mutated")
	}
	c, err := parseIDEProtectedConfig(publicIDEConfigRaw())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{fmt.Sprint(c), fmt.Sprintf("%#v", c), string(encoded)} {
		if strings.Contains(text, "PUBLIC_SECRET") || strings.Contains(text, "postgres://") {
			t.Fatal("private config diagnostics leaked")
		}
	}
}

func TestIDERuntimeProtectedConfigRequiresCurrentOriginalSourceBeforeFileRead(t *testing.T) {
	for _, original := range []*ideDeploymentStartupInputs{nil, {Source: (*publicIDEConfigSource)(nil)}, {Source: &publicIDEConfigSource{denyAt: 1}}} {
		got, err := resolveIDEDeploymentStartup(context.Background(), "/PUBLIC_NONEXISTENT_CONFIG", original)
		if got != nil || !errors.Is(err, errIDEConfigSource) {
			t.Fatal("missing Source touched configuration or admitted", err)
		}
	}
	source := &publicIDEConfigSource{denyAt: 2}
	got, err := resolveIDEDeploymentStartup(context.Background(), publicIDEConfigFile(t, publicIDEConfigRaw()), &ideDeploymentStartupInputs{Source: source})
	if got != nil || !errors.Is(err, errIDEConfigSource) {
		t.Fatal("late revocation admitted", err)
	}
	unchanged := &ideDeploymentStartupInputs{}
	got, err = resolveIDEDeploymentStartup(context.Background(), "", unchanged)
	if got != unchanged || err != nil {
		t.Fatal("unconfigured original behavior changed")
	}
}

func TestIDERuntimeProtectedConfigStrictSchemaPermissionsAndNoGrantFallback(t *testing.T) {
	valid := string(publicIDEConfigRaw())
	for _, raw := range []string{strings.Replace(valid, `"maxOpen":4`, `"maxOpen":4,"maxOpen":4`, 1), strings.Replace(valid, `"maxOpen":4`, `"MaxOpen":4`, 1), strings.Replace(valid, `"maxOpen":4`, `"maxOpen":true`, 1), strings.Replace(valid, `"maxSeconds":30`, `"maxSeconds":30,"source":{"approved":true}`, 1), valid + ` {}`, strings.Repeat("X", ideConfigLimit+1)} {
		if _, err := parseIDEProtectedConfig([]byte(raw)); !errors.Is(err, errIDEConfig) {
			t.Fatal("ambiguous/oversize/config-grant input admitted")
		}
	}
	for _, kind := range []string{"public-file", "public-parent", "symlink", "hardlink"} {
		t.Run(kind, func(t *testing.T) {
			file := publicIDEConfigFile(t, publicIDEConfigRaw())
			switch kind {
			case "public-file":
				if err := os.Chmod(file, 0644); err != nil {
					t.Fatal(err)
				}
			case "public-parent":
				if err := os.Chmod(filepath.Dir(file), 0755); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				target := file + ".link"
				if err := os.Symlink(file, target); err != nil {
					t.Fatal(err)
				}
				file = target
			case "hardlink":
				if err := os.Link(file, file+".second"); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := readIDEProtectedConfig(file); !errors.Is(err, errIDEConfig) {
				t.Fatal("unprotected configuration admitted")
			}
		})
	}
}

func TestIDERuntimeProtectedConfigSpecialFileNeverBlocks(t *testing.T) {
	if file := os.Getenv("YNX_PUBLIC_IDE_CONFIG_FIFO"); file != "" {
		if _, err := readIDEProtectedConfig(file); !errors.Is(err, errIDEConfig) {
			t.Fatal("FIFO admitted")
		}
		return
	}
	dir := filepath.Join(t.TempDir(), "private")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "config.json")
	if err := unix.Mkfifo(file, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestIDERuntimeProtectedConfigSpecialFileNeverBlocks$", "-test.count=1")
	cmd.Env = append(os.Environ(), "YNX_PUBLIC_IDE_CONFIG_FIFO="+file)
	out, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatal("protected config blocked before type validation")
	}
	if err != nil {
		t.Fatalf("FIFO subprocess: %v %s", err, out)
	}
}
