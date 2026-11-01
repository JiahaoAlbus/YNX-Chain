package ownednode

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

type ManagedArtifact struct {
	NodeID              string       `json:"nodeId"`
	Mode                string       `json:"mode"`
	Path                string       `json:"path"`
	SHA256              string       `json:"sha256"`
	Bytes               string       `json:"bytes"`
	Identity            FileIdentity `json:"identity"`
	BinIdentity         FileIdentity `json:"binIdentity"`
	DataIdentity        FileIdentity `json:"dataIdentity"`
	ProductionSupported bool         `json:"productionSupported"`
	Authority           bool         `json:"authority"`
}

// ManagedArtifactReadback reads actual managed bytes and filesystem identity.
// It is neither the missing original A signature nor an ordinary-node grant.
func (m *Manager) ManagedArtifactReadback(peer localipc.Peer) (ManagedArtifact, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.peerAllowed(peer); err != nil {
		return ManagedArtifact{}, err
	}
	if m.closed {
		return ManagedArtifact{}, ErrClosed
	}
	raw, info, err := m.artifact()
	if err != nil {
		return ManagedArtifact{}, err
	}
	return ManagedArtifact{NodeID: NodeID, Mode: m.state.Mode, Path: filepath.Join(m.directory, "bin", artifactName), SHA256: m.state.ArtifactSHA256, Bytes: strconv.Itoa(len(raw)), Identity: identity(info), BinIdentity: *m.state.BinIdentity, DataIdentity: *m.state.DataIdentity}, nil
}
func (m *Manager) artifact() ([]byte, os.FileInfo, error) {
	if err := m.rootUnchanged(); err != nil {
		return nil, nil, err
	}
	if m.state.ArtifactIdentity == nil || m.state.ArtifactSHA256 == "" {
		return nil, nil, ErrReconcile
	}
	raw, info, err := readOwnedFile(filepath.Join(m.directory, "bin", artifactName), m.uid, int64(m.maxArtifact))
	if err != nil {
		return nil, nil, err
	}
	if len(raw) == 0 || info.Mode().Perm() != 0700 || info.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || identity(info) != *m.state.ArtifactIdentity {
		return nil, nil, ErrUnsafePath
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != m.state.ArtifactSHA256 {
		return nil, nil, ErrUnsafePath
	}
	return raw, info, nil
}
func (m *Manager) reconcile(cause error) error {
	m.state.Stage = "reconcile_required"
	m.firstCause(cause)
	_ = m.save()
	return errors.Join(ErrReconcile, cause)
}
func (m *Manager) openBin() (*os.File, error) {
	if err := m.rootUnchanged(); err != nil {
		return nil, err
	}
	f, err := os.Open(filepath.Join(m.directory, "bin"))
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || m.state.BinIdentity == nil || identity(info) != *m.state.BinIdentity {
		_ = f.Close()
		return nil, ErrUnsafePath
	}
	return f, nil
}

func (m *Manager) publishFixtureArtifact(ctx context.Context, intent Intent, artifact []byte) error {
	// Durable claim precedes any artifact write. Any interrupted/failed claim
	// remains UNKNOWN/reconcile_required; a later start never retries install.
	m.state.Stage = "installing"
	m.state.ArtifactSHA256 = intent.ArtifactSHA256
	m.state.Generation++
	if err := m.save(); err != nil {
		return m.reconcile(err)
	}
	dir, err := m.openBin()
	if err != nil {
		return m.reconcile(err)
	}
	defer dir.Close()
	temporary := "install-" + randomID() + ".tmp"
	path := filepath.Join(m.directory, "bin", temporary)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		return m.reconcile(err)
	}
	_, writeErr := file.Write(artifact)
	syncErr := file.Sync()
	closeErr := file.Close()
	if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
		return m.reconcile(err)
	}
	staged, info, err := readOwnedFile(path, m.uid, int64(m.maxArtifact))
	if err != nil {
		return m.reconcile(err)
	}
	sum := sha256.Sum256(staged)
	if hex.EncodeToString(sum[:]) != intent.ArtifactSHA256 {
		return m.reconcile(ErrUnsafePath)
	}
	if err = ctx.Err(); err != nil {
		return m.reconcile(err)
	}
	if err = m.rootUnchanged(); err != nil {
		return m.reconcile(err)
	}
	if err = ctx.Err(); err != nil {
		return m.reconcile(err)
	}
	// linkat atomically publishes only if the fixed destination does not exist.
	// It cannot overwrite another inode, partial old install or unknown file.
	if err = publishArtifact(dir, temporary, artifactName); err != nil {
		return m.reconcile(err)
	}
	if err = dir.Sync(); err != nil {
		return m.reconcile(err)
	}
	actual, err := os.Lstat(filepath.Join(m.directory, "bin", artifactName))
	if err != nil || !os.SameFile(info, actual) {
		return m.reconcile(ErrUnsafePath)
	}
	if err = m.rootUnchanged(); err != nil {
		return m.reconcile(err)
	}
	stagedInfo, err := os.Lstat(path)
	if err != nil || !os.SameFile(stagedInfo, info) {
		return m.reconcile(ErrUnsafePath)
	}
	if err = unlinkManagedFile(dir, temporary); err != nil {
		return m.reconcile(err)
	}
	if err = dir.Sync(); err != nil {
		return m.reconcile(err)
	}
	bound := identity(actual)
	m.state.ArtifactIdentity = &bound
	m.state.Stage = "installed"
	if err = m.save(); err != nil {
		return m.reconcile(err)
	}
	if _, _, err = m.artifact(); err != nil {
		return m.reconcile(err)
	}
	return nil
}

type runtimeCapture struct {
	dir, path string
	directory os.FileInfo
	file      os.FileInfo
	pin       string
}

func (m *Manager) captureRuntime(raw []byte, runID string) (*runtimeCapture, error) {
	if err := m.rootUnchanged(); err != nil {
		return nil, err
	}
	dir := filepath.Join(m.directory, "bin", "runtime-"+runID)
	if err := os.Mkdir(dir, 0700); err != nil {
		return nil, err
	}
	info, err := privateDir(dir, m.uid, false)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, artifactName)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0500)
	if err != nil {
		return nil, err
	}
	_, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
		return nil, err
	}
	_, file, err := readOwnedFile(path, m.uid, int64(m.maxArtifact))
	if err != nil {
		return nil, err
	}
	capture := &runtimeCapture{dir: dir, path: path, directory: info, file: file, pin: m.state.ArtifactSHA256}
	if err = m.runtimeUnchanged(capture); err != nil {
		return nil, err
	}
	return capture, nil
}
func (m *Manager) runtimeUnchanged(c *runtimeCapture) error {
	if c == nil {
		return ErrUnsafePath
	}
	if _, _, err := m.artifact(); err != nil {
		return err
	}
	dir, err := privateDir(c.dir, m.uid, false)
	if err != nil || !os.SameFile(dir, c.directory) {
		return ErrUnsafePath
	}
	raw, file, err := readOwnedFile(c.path, m.uid, int64(m.maxArtifact))
	if err != nil || !os.SameFile(file, c.file) || file.Mode() != c.file.Mode() {
		return ErrUnsafePath
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != c.pin {
		return ErrUnsafePath
	}
	return nil
}
func (m *Manager) cleanupRuntime(c *runtimeCapture) error {
	if err := m.runtimeUnchanged(c); err != nil {
		return err
	}
	entries, err := os.ReadDir(c.dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != artifactName {
		return ErrUnsafePath
	}
	dir, err := os.Open(c.dir)
	if err != nil {
		return err
	}
	defer dir.Close()
	info, err := dir.Stat()
	if err != nil || !os.SameFile(info, c.directory) {
		return ErrUnsafePath
	}
	if err = unlinkManagedFile(dir, artifactName); err != nil {
		return err
	}
	if err = os.Remove(c.dir); err != nil {
		return err
	}
	return nil
}
