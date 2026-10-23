package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
	"golang.org/x/sys/unix"
)

var errIDEConfigSource = errors.New("protected IDE configuration requires the original publication Source")
var errIDEConfig = errors.New("protected IDE configuration unavailable, invalid or changed")

const ideConfigLimit = 64 << 10

// This fixed configuration carries no principal, publisher key, grant or
// approval. It is read only after original Source admission. Constructors still
// enforce original TLS/schema/runtime policy; this loader never opens a pool,
// connects an executor, creates storage, migrates data or activates a service.
type ideProtectedConfig struct {
	Catalog developerauthority.PostgresCatalogConfig
	Runtime cloud.IDEExistingOCIConfig
}

func (ideProtectedConfig) String() string     { return "IDE protected configuration (redacted)" }
func (c ideProtectedConfig) GoString() string { return c.String() }
func (ideProtectedConfig) MarshalJSON() ([]byte, error) {
	return []byte(`{"protected":"redacted"}`), nil
}

func decodeIDEConfigObject(d *json.Decoder, fields map[string]func() error) error {
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return errIDEConfig
	}
	seen := make(map[string]bool, len(fields))
	for d.More() {
		token, err = d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] || fields[key] == nil {
			return errIDEConfig
		}
		seen[key] = true
		if fields[key]() != nil {
			return errIDEConfig
		}
	}
	token, err = d.Token()
	if err != nil || token != json.Delim('}') || len(seen) != len(fields) {
		return errIDEConfig
	}
	return nil
}

func parseIDEProtectedConfig(raw []byte) (ideProtectedConfig, error) {
	var c ideProtectedConfig
	if len(raw) == 0 || len(raw) > ideConfigLimit || !utf8.Valid(raw) {
		return c, errIDEConfig
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	read := func(dst any) func() error { return func() error { return d.Decode(dst) } }
	var connect, idle, lifetime int
	err := decodeIDEConfigObject(d, map[string]func() error{
		"catalog": func() error {
			return decodeIDEConfigObject(d, map[string]func() error{
				"connectionUrl": read(&c.Catalog.ConnectionURL), "maxOpen": read(&c.Catalog.MaxOpen), "maxIdle": read(&c.Catalog.MaxIdle),
				"connectTimeoutSeconds": read(&connect), "maxIdleSeconds": read(&idle), "maxLifetimeSeconds": read(&lifetime),
			})
		},
		"runtime": func() error {
			return decodeIDEConfigObject(d, map[string]func() error{
				"binary": read(&c.Runtime.Binary), "socket": read(&c.Runtime.Socket), "storageRoot": read(&c.Runtime.StorageRoot),
				"resourceId": read(&c.Runtime.ResourceID), "targetEnvironment": read(&c.Runtime.TargetEnvironment),
				"imageDigest": read(&c.Runtime.ImageDigest), "serverOrigin": read(&c.Runtime.ServerOrigin),
				"runtimeOrigin": read(&c.Runtime.RuntimeOrigin), "httpPort": read(&c.Runtime.HTTPPort), "maxSeconds": read(&c.Runtime.MaxSeconds),
			})
		},
	})
	if err != nil {
		return ideProtectedConfig{}, errIDEConfig
	}
	if _, err = d.Token(); err != io.EOF {
		return ideProtectedConfig{}, errIDEConfig
	}
	if c.Catalog.ConnectionURL == "" || len(c.Catalog.ConnectionURL) > 8192 || c.Catalog.MaxOpen < 1 || c.Catalog.MaxOpen > 64 || c.Catalog.MaxIdle < 0 || c.Catalog.MaxIdle > c.Catalog.MaxOpen || connect < 1 || connect > 30 || idle < 1 || idle > 3600 || lifetime < idle || lifetime > 86400 {
		return ideProtectedConfig{}, errIDEConfig
	}
	if c.Runtime.RuntimeOrigin == "" || c.Runtime.ServerOrigin == "" || c.Runtime.ResourceID == "" || c.Runtime.TargetEnvironment == "" || c.Runtime.ImageDigest == "" || c.Runtime.HTTPPort < 1024 || c.Runtime.HTTPPort > 65535 || c.Runtime.MaxSeconds < 6 || c.Runtime.MaxSeconds > 300 {
		return ideProtectedConfig{}, errIDEConfig
	}
	for _, p := range []string{c.Runtime.Binary, c.Runtime.Socket, c.Runtime.StorageRoot} {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || len(p) > 4096 {
			return ideProtectedConfig{}, errIDEConfig
		}
	}
	c.Catalog.ConnectTimeout = time.Duration(connect) * time.Second
	c.Catalog.MaxIdleTime = time.Duration(idle) * time.Second
	c.Catalog.MaxLifetime = time.Duration(lifetime) * time.Second
	return c, nil
}

func readIDEProtectedConfig(file string) (ideProtectedConfig, error) {
	var empty ideProtectedConfig
	if !filepath.IsAbs(file) || filepath.Clean(file) != file {
		return empty, errIDEConfig
	}
	directory := filepath.Dir(file)
	dir, err := os.Lstat(directory)
	resolved, resolveErr := filepath.EvalSymlinks(directory)
	if err != nil || resolveErr != nil || resolved != directory || !dir.IsDir() || dir.Mode().Perm() != 0700 {
		return empty, errIDEConfig
	}
	var ds unix.Stat_t
	if unix.Lstat(directory, &ds) != nil || ds.Uid != uint32(os.Geteuid()) {
		return empty, errIDEConfig
	}
	fd, err := unix.Open(file, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return empty, errIDEConfig
	}
	f := os.NewFile(uintptr(fd), "protected-ide-configuration")
	defer f.Close()
	var stat unix.Stat_t
	before, err := f.Stat()
	if err != nil || unix.Fstat(fd, &stat) != nil || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 1 || before.Size() < 1 || before.Size() > ideConfigLimit {
		return empty, errIDEConfig
	}
	raw, err := io.ReadAll(io.LimitReader(f, ideConfigLimit+1))
	if err != nil {
		return empty, errIDEConfig
	}
	after, err := f.Stat()
	named, namedErr := os.Lstat(file)
	parent, parentErr := os.Lstat(directory)
	if err != nil || namedErr != nil || parentErr != nil || !os.SameFile(before, after) || !os.SameFile(after, named) || !os.SameFile(dir, parent) || named.Mode()&os.ModeSymlink != 0 || parent.Mode().Perm() != 0700 || named.Mode().Perm() != 0600 || before.Size() != after.Size() || after.Size() != named.Size() || !before.ModTime().Equal(after.ModTime()) || !after.ModTime().Equal(named.ModTime()) || int64(len(raw)) != before.Size() {
		return empty, errIDEConfig
	}
	return parseIDEProtectedConfig(raw)
}

func resolveIDEDeploymentStartup(ctx context.Context, file string, original *ideDeploymentStartupInputs) (*ideDeploymentStartupInputs, error) {
	if file == "" {
		return original, nil
	}
	if ctx == nil || ctx.Err() != nil || original == nil || missingIDEValue(original.Source) {
		return nil, errIDEConfigSource
	}
	if _, ok := original.Source.(developerauthority.OriginalPublicationSource); !ok {
		return nil, errIDEConfigSource
	}
	if _, ok := original.Source.(developerauthority.OriginalPublicationSelector); !ok {
		return nil, errIDEConfigSource
	}
	if original.Catalog != (developerauthority.PostgresCatalogConfig{}) || original.Runtime != (cloud.IDEExistingOCIConfig{}) {
		return nil, errIDEConfig
	}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if original.Source.AssertSourceCurrent(bounded) != nil || bounded.Err() != nil {
		return nil, errIDEConfigSource
	}
	c, err := readIDEProtectedConfig(file)
	if err != nil {
		return nil, errIDEConfig
	}
	if original.Source.AssertSourceCurrent(bounded) != nil || bounded.Err() != nil {
		return nil, errIDEConfigSource
	}
	return &ideDeploymentStartupInputs{Source: original.Source, Catalog: c.Catalog, Runtime: c.Runtime}, nil
}
