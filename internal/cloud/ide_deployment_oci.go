package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var ErrIDEExistingRuntimeUnavailable = errors.New("existing IDE isolated runtime unavailable")
var ideOCIDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// An operator must supply an ALREADY authorized local OCI socket and an
// ALREADY present immutable image containing Node and GNU timeout. Nothing is
// installed/pulled, no network/lease is created, and no payment API is called.
// This supports one bounded Node script job, NOT a web-hosting deployment.
type IDEExistingOCIConfig struct {
	RuntimeOrigin                                                                         string // Existing isolated wildcard ingress; empty means job only.
	HTTPPort                                                                              int
	Binary, Socket, StorageRoot, ResourceID, TargetEnvironment, ImageDigest, ServerOrigin string
	MaxSeconds                                                                            int
}

type OCIIDEDeploymentExecutor struct {
	input func(context.Context, []byte, ...string) ([]byte, error)
	cfg   IDEExistingOCIConfig
	run   func(context.Context, ...string) ([]byte, error)
	now   func() time.Time
}

func NewOCIIDEDeploymentExecutor(cfg IDEExistingOCIConfig) (*OCIIDEDeploymentExecutor, error) {
	if cfg.RuntimeOrigin != "" && (validateIDEProjectOrigin(cfg.RuntimeOrigin, cfg.ServerOrigin) != nil || cfg.HTTPPort < 1024 || cfg.HTTPPort > 65535) {
		return nil, ErrInvalid
	}
	if cfg.RuntimeOrigin == "" && cfg.HTTPPort != 0 {
		return nil, ErrInvalid
	}
	u, err := url.Parse(cfg.ServerOrigin)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, ErrInvalid
	}
	for _, value := range []string{cfg.Binary, cfg.Socket, cfg.StorageRoot} {
		if !filepath.IsAbs(value) || filepath.Clean(value) != value || strings.Contains(value, ",") {
			return nil, ErrInvalid
		}
	}
	if cfg.ResourceID == "" || cfg.TargetEnvironment == "" || !ideOCIDigest.MatchString(cfg.ImageDigest) || cfg.MaxSeconds < 1 || cfg.MaxSeconds > 300 {
		return nil, ErrInvalid
	}
	info, err := os.Stat(cfg.Binary)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
		return nil, ErrIDEExistingRuntimeUnavailable
	}
	if err := os.MkdirAll(cfg.StorageRoot, 0700); err != nil {
		return nil, err
	}
	info, err = os.Lstat(cfg.StorageRoot)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return nil, ErrInvalid
	}
	configDir := filepath.Join(cfg.StorageRoot, "cli-config")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return nil, err
	}
	configInfo, err := os.Lstat(configDir)
	if err != nil || !configInfo.IsDir() || configInfo.Mode()&os.ModeSymlink != 0 || configInfo.Mode().Perm()&0077 != 0 {
		return nil, ErrInvalid
	}
	e := &OCIIDEDeploymentExecutor{cfg: cfg, now: time.Now}
	e.run = func(ctx context.Context, args ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		base := []string{"--config", configDir, "--host", "unix://" + cfg.Socket}
		cmd := exec.CommandContext(ctx, cfg.Binary, append(base, args...)...)
		cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "DOCKER_CONFIG=" + configDir}
		out := &ideBoundedCommandOutput{limit: 1 << 20}
		stderr := &ideBoundedCommandOutput{limit: 16 << 10}
		cmd.Stdout, cmd.Stderr = out, stderr
		if len(args) > 0 && args[0] == "logs" {
			cmd.Stderr = out
		}
		runErr := cmd.Run()
		if out.overflow || stderr.overflow {
			return nil, ErrIDEExistingRuntimeUnavailable
		}
		if runErr != nil {
			// A create may have returned its immutable ID before the CLI lost
			// its final acknowledgment. Preserve that bounded partial output.
			return out.buf.Bytes(), ErrIDEExistingRuntimeUnavailable
		}
		return out.buf.Bytes(), nil
	}
	e.input = func(ctx context.Context, input []byte, args ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		base := []string{"--config", configDir, "--host", "unix://" + cfg.Socket}
		cmd := exec.CommandContext(ctx, cfg.Binary, append(base, args...)...)
		cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "DOCKER_CONFIG=" + configDir}
		cmd.Stdin = bytes.NewReader(input)
		out := &ideBoundedCommandOutput{limit: MaxUploadBytes}
		stderr := &ideBoundedCommandOutput{limit: 16 << 10}
		cmd.Stdout, cmd.Stderr = out, stderr
		if err := cmd.Run(); err != nil || out.overflow || stderr.overflow {
			return nil, ErrIDEExistingRuntimeUnavailable
		}
		return out.buf.Bytes(), nil
	}
	return e, nil
}

type ideBoundedCommandOutput struct {
	buf      bytes.Buffer
	limit    int
	overflow bool
}

func (w *ideBoundedCommandOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := w.limit - w.buf.Len()
	if len(p) > remaining {
		w.overflow = true
		p = p[:remaining]
	}
	_, _ = w.buf.Write(p)
	return n, nil
}

func (e *OCIIDEDeploymentExecutor) name(request, approval string) string {
	return "ynx-ide-" + productHash([]byte(e.cfg.ResourceID + "\x00" + request + "\x00" + approval))[:32]
}
func (e *OCIIDEDeploymentExecutor) labels(op IDEDeploymentOperation) map[string]string {
	b, _ := json.Marshal(op.Binding)
	return map[string]string{"ynx.ide.request": op.RequestID, "ynx.ide.resource": op.ResourceID, "ynx.ide.manifest": op.ManifestSHA256, "ynx.ide.approval": op.ApprovalSHA256, "ynx.ide.binding": productHash(b), "ynx.ide.runtime": "bounded-node-job"}
}

func (e *OCIIDEDeploymentExecutor) ApplyExisting(ctx context.Context, p IDEDeploymentPermit, reader io.Reader, current func() error) (IDEDeploymentResult, error) {
	var empty IDEDeploymentResult
	if current == nil || p.RequiresAdditionalCharge || p.ResourceID != e.cfg.ResourceID || p.Binding.TargetEnvironment != e.cfg.TargetEnvironment || p.PublisherID == "" || !productWriteKey.MatchString(p.RequestID) || len(p.ApprovalSHA256) != 64 || len(p.ManifestSHA256) != 64 || p.ResourceApprovalRef == "" || p.RuntimeSeconds < 6 || p.RuntimeSeconds > e.cfg.MaxSeconds {
		return empty, ErrDenied
	}
	seconds := min(e.cfg.MaxSeconds, p.RuntimeSeconds, int(p.ExpiresAt.Sub(e.now())/time.Second)) - 5 // Include forced-stop grace inside the approved cap.
	if seconds < 1 {
		return empty, ErrDenied
	}
	if err := current(); err != nil {
		return empty, err
	}
	image, err := e.run(ctx, "image", "inspect", e.cfg.ImageDigest)
	if err != nil {
		return empty, err
	}
	var images []struct {
		ID string `json:"Id"`
	}
	if json.Unmarshal(image, &images) != nil || len(images) != 1 || images[0].ID != e.cfg.ImageDigest {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	if p.Binding.ByteSize < 1 || p.Binding.ByteSize > MaxMultipartBytes {
		return empty, ErrInvalid
	}
	body, err := readIDEArtifactBounded(ctx, reader, p.Binding.ByteSize)
	if err != nil || int64(len(body)) != p.Binding.ByteSize || productHash(body) != p.Binding.ContentDigest {
		return empty, ErrIDEArtifactInput
	}
	release, err := e.acquireResource(ctx, p, current)
	if err != nil {
		return empty, err
	}
	defer release()
	name := e.name(p.RequestID, p.ApprovalSHA256)
	dir := filepath.Join(e.cfg.StorageRoot, name)
	// Never reuse or erase a prior staged artifact/unknown attempt.
	if err := os.Mkdir(dir, 0700); err != nil {
		return empty, err
	}
	file := filepath.Join(dir, "artifact.mjs")
	f, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0444)
	if err != nil {
		return empty, err
	}
	_, err = f.Write(body)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return empty, err
	}
	if closeErr != nil {
		return empty, closeErr
	}
	if err := socialSync(dir); err != nil {
		return empty, err
	}
	op := IDEDeploymentOperation{RequestID: p.RequestID, ResourceID: p.ResourceID, PublisherID: p.PublisherID, Binding: p.Binding, ManifestSHA256: p.ManifestSHA256, ApprovalSHA256: p.ApprovalSHA256}
	op.RuntimeHandle = productHash([]byte(p.Principal + "\x00" + p.RequestID))
	op.RuntimeSeconds = p.RuntimeSeconds
	op.ResourceApprovalRef = p.ResourceApprovalRef
	args := []string{"create", "--pull=never", "--name", name, "--restart=no", "--read-only", "--user=10001:10001", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--network=none", "--pids-limit=64", "--cpus=0.5", "--memory=128m", "--memory-swap=128m", "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m", "--log-driver=json-file", "--log-opt=max-size=1m", "--log-opt=max-file=1"}
	for _, key := range []string{"ynx.ide.request", "ynx.ide.resource", "ynx.ide.manifest", "ynx.ide.approval", "ynx.ide.binding", "ynx.ide.runtime"} {
		args = append(args, "--label", key+"="+e.labels(op)[key])
	}
	if e.cfg.RuntimeOrigin != "" {
		args = append(args, "--env=PORT="+strconv.Itoa(e.cfg.HTTPPort))
	}
	args = append(args, "--mount", "type=bind,src="+file+",dst=/app/artifact.mjs,readonly", "--entrypoint=/usr/bin/timeout", e.cfg.ImageDigest, "--signal=TERM", "--kill-after=5s", strconv.Itoa(seconds)+"s", "/usr/local/bin/node", "/app/artifact.mjs")
	if err := current(); err != nil {
		return empty, err
	}
	created, createErr := e.run(ctx, args...)
	op.DeploymentID = strings.TrimSpace(string(created))
	if !ideOCIDigest.MatchString("sha256:" + op.DeploymentID) {
		if createErr != nil {
			return empty, createErr
		}
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	// Record the actual acknowledgment before any subsequent current/inspect
	// call. This local receipt grants nothing and survives cancellation.
	if err := e.rememberCreatedInstance(op); err != nil {
		return empty, errors.Join(createErr, err)
	}
	if err := e.pinCreatedResource(op); err != nil {
		return empty, errors.Join(createErr, err)
	}
	if createErr != nil {
		return empty, createErr
	}
	// Check the same original container identity, then fence the actual start.
	inspection, err := e.inspect(ctx, op)
	if err != nil {
		return empty, err
	}
	// Container names can be rebound between inspect and start. The verified
	// instance, not its mutable name, is the only permitted effect target.
	op.DeploymentID = inspection.ID
	if err := current(); err != nil {
		return empty, err
	}
	if !p.ExpiresAt.After(e.now()) {
		return empty, ErrDenied
	}
	if _, err := e.run(ctx, "start", op.DeploymentID); err != nil {
		return empty, err
	}
	return e.ObserveOriginal(ctx, op)
}

type ideOCIInspection struct {
	ID     string `json:"Id"`
	Config struct {
		Image, User     string
		Labels          map[string]string
		Entrypoint, Cmd []string
		Tty             bool
	}
	HostConfig struct {
		NetworkMode, PidMode, IpcMode string
		ReadonlyRootfs, Privileged    bool
		Memory, MemorySwap, NanoCpus  int64
		PidsLimit                     int
		CapDrop, CapAdd, SecurityOpt  []string
		Tmpfs                         map[string]string
	}
	State struct {
		Status    string
		Running   bool
		ExitCode  int
		OOMKilled bool
	}
	Mounts []struct {
		Type, Source, Destination string
		RW                        bool
	}
}

func (e *OCIIDEDeploymentExecutor) inspect(ctx context.Context, op IDEDeploymentOperation) (ideOCIInspection, error) {
	var empty ideOCIInspection
	if op.ResourceID != e.cfg.ResourceID || op.Binding.TargetEnvironment != e.cfg.TargetEnvironment || !productWriteKey.MatchString(op.RequestID) || len(op.ApprovalSHA256) != 64 {
		return empty, ErrDenied
	}
	target, err := e.createdContainerID(op)
	if err != nil {
		return empty, err
	}
	raw, err := e.run(ctx, "inspect", "--type=container", target)
	if err != nil {
		return empty, err
	}
	var rows []ideOCIInspection
	if json.Unmarshal(raw, &rows) != nil || len(rows) != 1 {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	v := rows[0]
	if v.ID != target {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	if len(v.ID) != 64 || !ideOCIDigest.MatchString("sha256:"+v.ID) || v.Config.Image != e.cfg.ImageDigest || v.Config.User != "10001:10001" || v.HostConfig.NetworkMode != "none" || !v.HostConfig.ReadonlyRootfs || v.HostConfig.Memory != 128<<20 || v.HostConfig.MemorySwap != 128<<20 || v.HostConfig.NanoCpus != 500000000 || v.HostConfig.PidsLimit != 64 {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	if v.HostConfig.Privileged || v.HostConfig.PidMode != "" || (v.HostConfig.IpcMode != "" && v.HostConfig.IpcMode != "private") || len(v.HostConfig.CapAdd) != 0 || v.Config.Tty {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	if len(v.Config.Entrypoint) != 1 || v.Config.Entrypoint[0] != "/usr/bin/timeout" || len(v.Config.Cmd) != 5 || v.Config.Cmd[0] != "--signal=TERM" || v.Config.Cmd[1] != "--kill-after=5s" || v.Config.Cmd[3] != "/usr/local/bin/node" || v.Config.Cmd[4] != "/app/artifact.mjs" {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	seconds, parseErr := strconv.Atoi(strings.TrimSuffix(v.Config.Cmd[2], "s"))
	if parseErr != nil || v.Config.Cmd[2] != strconv.Itoa(seconds)+"s" || seconds < 1 || seconds+5 > e.cfg.MaxSeconds || op.RuntimeSeconds < 6 || seconds+5 > op.RuntimeSeconds || op.ResourceApprovalRef == "" {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	if !containsIDEOption(v.HostConfig.CapDrop, "ALL") || (!containsIDEOption(v.HostConfig.SecurityOpt, "no-new-privileges") && !containsIDEOption(v.HostConfig.SecurityOpt, "no-new-privileges:true")) {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	for key, value := range e.labels(op) {
		if v.Config.Labels[key] != value {
			return empty, ErrIDEExistingRuntimeUnavailable
		}
	}
	file := filepath.Join(e.cfg.StorageRoot, e.name(op.RequestID, op.ApprovalSHA256), "artifact.mjs")
	binds := 0
	for _, mount := range v.Mounts {
		if mount.Type == "tmpfs" && mount.Destination == "/tmp" {
			continue
		}
		if mount.Type != "bind" || mount.Source != file || mount.Destination != "/app/artifact.mjs" || mount.RW {
			return empty, ErrIDEExistingRuntimeUnavailable
		}
		binds++
	}
	if binds != 1 || len(v.HostConfig.Tmpfs) != 1 {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	options := strings.Split(v.HostConfig.Tmpfs["/tmp"], ",")
	for _, flag := range []string{"noexec", "nosuid", "nodev"} {
		if !containsIDEOption(options, flag) {
			return empty, ErrIDEExistingRuntimeUnavailable
		}
	}
	if !containsIDEOption(options, "size=16m") && !containsIDEOption(options, "size=16777216") {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	return v, nil
}
func containsIDEOption(options []string, value string) bool {
	for _, option := range options {
		if option == value {
			return true
		}
	}
	return false
}

func (e *OCIIDEDeploymentExecutor) ObserveOriginal(ctx context.Context, op IDEDeploymentOperation) (IDEDeploymentResult, error) {
	v, err := e.inspect(ctx, op)
	if err != nil {
		return IDEDeploymentResult{}, err
	}
	r := IDEDeploymentResult{RequestID: op.RequestID, ResourceID: op.ResourceID, Binding: op.Binding, DeploymentID: v.ID, RuntimeKind: "bounded-node-job", RuntimeURL: strings.TrimRight(e.cfg.ServerOrigin, "/") + "/api/v1/ide/deployments/" + op.RequestID + "/runtime"}
	if e.cfg.RuntimeOrigin != "" {
		runtimeURL, err := e.projectURL(op.RuntimeHandle)
		if err != nil {
			return IDEDeploymentResult{}, err
		}
		r.RuntimeKind = "node-http-project"
		r.RuntimeURL = runtimeURL
	}
	if v.State.Running {
		if e.cfg.RuntimeOrigin != "" {
			if !ideRuntimeHandle.MatchString(op.RuntimeHandle) {
				return IDEDeploymentResult{}, ErrInvalid
			}
			op.DeploymentID = v.ID
			response, err := e.projectProbe(ctx, op)
			if err != nil {
				return IDEDeploymentResult{}, err
			}
			response.Body.Close()
			base, _ := url.Parse(e.cfg.RuntimeOrigin)
			base.Host = "h" + op.RuntimeHandle + "." + base.Host
			r.RuntimeURL = strings.TrimRight(base.String(), "/") + "/"
			r.RuntimeKind = "node-http-project"
		}
		r.State = "running"
		return r, nil
	}
	if v.State.Status == "exited" {
		code := v.State.ExitCode
		r.ExitCode = &code
		if code == 0 && !v.State.OOMKilled {
			r.State = "completed"
		} else {
			r.State = "failed"
		}
		return r, nil
	}
	return IDEDeploymentResult{}, ErrIDEExistingRuntimeUnavailable
}

func (e *OCIIDEDeploymentExecutor) Logs(ctx context.Context, op IDEDeploymentOperation, maximum int64) ([]byte, error) {
	if maximum < 1 || maximum > 64<<10 {
		return nil, ErrInvalid
	}
	inspection, err := e.inspect(ctx, op)
	if err != nil {
		return nil, err
	}
	body, err := e.run(ctx, "logs", "--tail=1000", "--timestamps", inspection.ID)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maximum {
		return nil, fmt.Errorf("%w: runtime log bound", ErrIDEExistingRuntimeUnavailable)
	}
	return body, nil
}
