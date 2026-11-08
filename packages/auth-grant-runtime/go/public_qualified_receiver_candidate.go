//go:build link_receiver_purpose_candidate && (darwin || linux)

package grantruntime

// TEST ONLY: exact original supplier PUBLIC fixture construction adapted to
// the SAME concrete grant runtime from P08. No production release[] change.
import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// PUBLIC tool input only; never a normal receiver provider or Root row.
func candidateNode(t *testing.T) string {
	t.Helper()
	p := os.Getenv("PUBLIC_RECEIVER_NODE")
	if !filepath.IsAbs(p) || filepath.Clean(p) != p || strings.ContainsRune(p, '\x00') {
		t.Fatal("explicit absolute PUBLIC_RECEIVER_NODE required")
	}
	real, e := filepath.EvalSymlinks(p)
	if e != nil || real != p {
		t.Fatal("canonical PUBLIC_RECEIVER_NODE required", e)
	}
	info, e := os.Stat(p)
	if e != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
		t.Fatal("executable regular PUBLIC_RECEIVER_NODE required", e)
	}
	return p
}
func candidateSocketRoot(t *testing.T) string {
	t.Helper()
	p := os.Getenv("LINK_RECEIVER_CANDIDATE_SOCKET_ROOT")
	real, e := filepath.EvalSymlinks(p)
	if !filepath.IsAbs(p) || filepath.Clean(p) != p || e != nil || real != p {
		t.Fatal("explicit canonical safe fixture root required", e)
	}
	info, e := os.Stat(p)
	if e != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		t.Fatal("fixture root must be existing 0700 directory", e)
	}
	return p
}
func candidateShellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }

func receiverDir(t *testing.T, path string) receiverDirectory {
	t.Helper()
	i, e := os.Lstat(path)
	if e != nil {
		t.Fatal(e)
	}
	s := i.Sys().(*syscall.Stat_t)
	return receiverDirectory{Path: path, Device: uint64(s.Dev), Inode: s.Ino, UID: s.Uid, GID: s.Gid, Mode: uint32(i.Mode().Perm())}
}
func receiverFixture(t *testing.T, p authorityProjection, source *Runtime) (taskReadReceiverRelease, taskReadReceiverRegistration, string) {
	t.Helper()
	dir, e := os.MkdirTemp(candidateSocketRoot(t), "receiver-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	socketDir := filepath.Join(dir, "ipc")
	if e = os.Mkdir(socketDir, 0700); e != nil {
		t.Fatal(e)
	}
	process, e := observeReceiverProcess(os.Getpid())
	if e != nil {
		t.Skip("actual platform process observer NOT_SUPPLIED: " + e.Error())
	}
	raw, e := os.ReadFile(process.Path)
	if e != nil {
		t.Fatal(e)
	}
	ref := receiverImage{Path: process.Path, Bytes: int64(len(raw)), SHA256: digest(raw)}
	original := receiverProcess{PID: os.Getpid(), UID: process.UID, GID: process.GID, Start: process.Start, Image: ref}
	cfg := taskReadReceiverRegistration{Version: "AUTH-ORIGINAL-TASK-READ-RECEIVER/private-v1", Resource: "PUBLIC-receiver-not-approved", Authority: source.selection.Authority, Realm: source.selection.Realm, Tenant: source.selection.Tenant, Namespace: "PUBLIC-original-same-namespace", SourceVersion: p.Snapshot.Version, Local: original, Peer: original, SocketParent: receiverDir(t, socketDir), SocketLeaf: "read.sock", ReadHeaderTimeoutMS: 500, ReadTimeoutMS: 1000, WriteTimeoutMS: 1000, IdleTimeoutMS: 500, MaxHeaderBytes: 8192, IssuedMS: p.Snapshot.ObservedAt, ExpiresMS: p.Snapshot.Expires}
	for _, path := range taskReadPaths {
		cfg.Routes = append(cfg.Routes, receiverRoute{"POST", path, 1 << 20, 1000})
	}
	s := taskReadReceiverRelease{Source: source.selection, SourceVersion: p.Snapshot.Version, Authority: cfg.Authority, Realm: cfg.Realm, Tenant: cfg.Tenant, Namespace: cfg.Namespace, Resource: cfg.Resource, RegistrationParent: receiverDir(t, dir), RegistrationLeaf: "PUBLIC-registration.json"}
	file := filepath.Join(dir, s.RegistrationLeaf)
	writeReceiverRecord(t, file, cfg)
	return s, cfg, file
}
func writeReceiverRecord(t *testing.T, path string, p taskReadReceiverRegistration) {
	t.Helper()
	raw, e := json.Marshal(p)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(path, raw, 0600); e != nil {
		t.Fatal(e)
	}
}

func receiverRef(t *testing.T, p string) protectedRef {
	b, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	return protectedRef{Path: p, Bytes: int64(len(b)), SHA256: digest(b)}
}
func writeReceiverPUBLIC(t *testing.T, p string, b []byte) {
	t.Helper()
	if e := os.WriteFile(p, b, 0600); e != nil {
		t.Fatal(e)
	}
}
func receiverQualifiedFixture(t *testing.T, source *Runtime) (taskReadReceiverRelease, string) {
	t.Helper()
	p := source.projection
	s, _, recordFile := receiverFixture(t, p, source)
	root := os.Getenv("PUBLIC_RECEIVER_RUNTIME")
	if root == "" {
		t.Fatal("PUBLIC runtime staging not supplied")
	}
	dir, e := os.MkdirTemp(candidateSocketRoot(t), "purpose-")
	if e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"public-fixture.mjs", "public-preload.mjs"} {
		b, e := os.ReadFile(os.Getenv("LINK_RECEIVER_CANDIDATE_ASSETS") + "/" + name)
		if e != nil {
			t.Fatal(e)
		}
		writeReceiverPUBLIC(t, dir+"/"+name, b)
	}
	raw, e := os.ReadFile(s.Source.Projection.Path)
	if e != nil {
		t.Fatal(e)
	}
	registration, e := os.ReadFile(recordFile)
	if e != nil {
		t.Fatal(e)
	}
	receiverNode := candidateNode(t)
	facts, _ := json.Marshal(map[string]any{"PUBLICSDKRoot": root, "at": time.Now().UnixMilli(), "projectionOriginalB64": base64.RawURLEncoding.EncodeToString(raw), "registrationOriginal": string(registration)})
	writeReceiverPUBLIC(t, dir+"/PUBLIC-facts.json", facts)
	command := exec.Command(receiverNode, dir+"/public-fixture.mjs", "generate", dir+"/PUBLIC-facts.json")
	out, e := command.CombinedOutput()
	if e != nil {
		t.Fatalf("PUBLIC sole Source math fixture %v: %s", e, out)
	}
	var v struct {
		RootRaw, EnrollmentRaw, ProfileRaw, HeadRaw string
		Policy                                      json.RawMessage
		RootIdentity                                receiverRootIdentity
		SubjectOwner, SourceID, InstanceID          string
		Node                                        receiverNativeNode
	}
	if e = json.Unmarshal(out, &v); e != nil {
		t.Fatal(e, string(out))
	}
	for n, raw := range map[string]string{"root.original": v.RootRaw, "enrollment.original": v.EnrollmentRaw, "profile.original": v.ProfileRaw, "head.original": v.HeadRaw} {
		writeReceiverPUBLIC(t, dir+"/"+n, []byte(raw))
	}
	wrapper := "#!/bin/sh\n: > " + candidateShellQuote(dir+"/PUBLIC-run-entered") + "\nexec " + candidateShellQuote(receiverNode) + " --import " + candidateShellQuote(dir+"/public-preload.mjs") + " \"$@\"\n"
	writeReceiverPUBLIC(t, dir+"/PUBLIC-node", []byte(wrapper))
	if e = os.Chmod(dir+"/PUBLIC-node", 0700); e != nil {
		t.Fatal(e)
	}
	runtimeRaw, e := os.ReadFile(root + "/PUBLIC-runtime-inventory.json")
	if e != nil {
		t.Fatal(e)
	}
	var refs []protectedRef
	if e = json.Unmarshal(runtimeRaw, &refs); e != nil {
		t.Fatal(e)
	}
	s.Permission = receiverAuthorityRelease{Root: receiverRef(t, dir+"/root.original"), Enrollment: receiverRef(t, dir+"/enrollment.original"), Node: receiverRef(t, dir+"/PUBLIC-node"), Runner: receiverRef(t, root+"/native/original-task-read-receiver-qualification-runner.mjs"), Profile: receiverLocatedOriginal{receiverDir(t, dir), "profile.original"}, Head: receiverLocatedOriginal{receiverDir(t, dir), "head.original"}, Runtime: refs, Policy: v.Policy, RootIdentity: v.RootIdentity, SubjectOwner: v.SubjectOwner, SourceID: v.SourceID, InstanceID: v.InstanceID, ProcessUID: uint32(os.Geteuid()), NativeNode: v.Node}
	return s, dir
}

func PUBLICQualifiedReceiverForP08Test(t *testing.T, source *Runtime) (*TaskReadReceiverRuntime, string, error) {
	t.Helper()
	s, dir := receiverQualifiedFixture(t, source)
	r, e := openTaskReadReceiverRuntime(context.Background(), s, uint32(os.Geteuid()))
	if e != nil && r != nil {
		p := r.source.projection
		e = fmt.Errorf("%w: sourceNil=%v proofNil=%v registrationNil=%v permissionNil=%v issuerStatus=%q holderStatus=%q issuerRefEq=%v issuerEpochEq=%v holderRefEq=%v holderEpochEq=%v sourceCurrent=%v", e, r.source == nil, r.proof == nil, r.registration == nil, r.permission == nil, p.Snapshot.Issuer.Status, p.Snapshot.Holder.Status, p.Snapshot.Issuer.Ref == p.Issuer.Principal, p.Snapshot.Issuer.Epoch == p.Issuer.Epoch, p.Snapshot.Holder.Ref == p.Holder.Principal, p.Snapshot.Holder.Epoch == p.Holder.Epoch, r.source.Current(context.Background()))
	}
	return r, dir, e
}
