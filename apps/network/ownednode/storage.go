package ownednode

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"strings"
)

const stateVersion = "YNX-NETWORK-OWNED-NODE/v1"
const DirectoryName = "owned-node"
const NodeID = "ordinary-node"
const stateName = "manager.json"
const lockName = "manager.lock"
const artifactName = "node"
const stateRecordLimit = 128 << 10
const managerLockLimit = 4096

type persistentState struct {
	Version          string                 `json:"version"`
	ManagerID        string                 `json:"managerId"`
	Mode             string                 `json:"mode"`
	NodeID           string                 `json:"nodeId"`
	Stage            string                 `json:"stage"`
	Generation       uint64                 `json:"generation,string"`
	ArtifactSHA256   string                 `json:"artifactSHA256"`
	RunID            string                 `json:"runId"`
	LastPID          int                    `json:"lastPid"`
	LastExit         string                 `json:"lastExit"`
	FirstCause       string                 `json:"firstCause"`
	RootIdentity     *FileIdentity          `json:"rootIdentity,omitempty"`
	BinIdentity      *FileIdentity          `json:"binIdentity,omitempty"`
	DataIdentity     *FileIdentity          `json:"dataIdentity,omitempty"`
	ArtifactIdentity *FileIdentity          `json:"artifactIdentity,omitempty"`
	LogsIdentity     *FileIdentity          `json:"logsIdentity,omitempty"`
	Logs             []runLogRecord         `json:"logs,omitempty"`
	Runtime          *runtimeInstallRecord  `json:"runtime,omitempty"`
	Observer         *observerRuntimeRecord `json:"observer,omitempty"`
}

// FileIdentity is local filesystem provenance, not publisher authentication.
// Directory bytes are omitted because normal data writes change their size.
type FileIdentity struct {
	Device   string `json:"device"`
	Inode    string `json:"inode"`
	OwnerUID string `json:"ownerUid"`
	Mode     string `json:"mode"`
	Bytes    string `json:"bytes,omitempty"`
}
type lockRecord struct {
	Version   string `json:"version"`
	ManagerID string `json:"managerId"`
}

func randomID() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func privateDir(path string, uid uint32, create bool) (os.FileInfo, error) {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.IndexByte(path, 0) >= 0 {
		return nil, ErrUnsafePath
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	current := "/"
	for i, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) && create && i == len(parts)-1 {
			if err = os.Mkdir(current, 0o700); err != nil {
				return nil, err
			}
			info, err = os.Lstat(current)
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, ErrUnsafePath
		}
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	owner, err := ownerUID(info)
	if err != nil || owner != uid || info.Mode().Perm() != 0o700 || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return nil, ErrUnsafePath
	}
	return info, nil
}
func readOwnedFile(path string, uid uint32, limit int64) ([]byte, os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	owner, err := ownerUID(info)
	if err != nil || owner != uid || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 || info.Size() < 0 || info.Size() > limit {
		return nil, nil, ErrUnsafePath
	}
	file, err := openRegularRead(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return nil, nil, ErrUnsafePath
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	after, statErr := file.Stat()
	named, nameErr := os.Lstat(path)
	if err != nil || int64(len(raw)) != info.Size() || statErr != nil || nameErr != nil ||
		!os.SameFile(info, after) || !os.SameFile(info, named) || info.Mode() != after.Mode() || info.Mode() != named.Mode() ||
		info.Size() != after.Size() || info.Size() != named.Size() || !info.ModTime().Equal(after.ModTime()) || !info.ModTime().Equal(named.ModTime()) {
		return nil, nil, ErrUnsafePath
	}
	return raw, info, nil
}
func strictRecord(raw []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	if dec.Decode(new(any)) != io.EOF {
		return errors.New("trailing manager metadata")
	}
	canonical, err := json.Marshal(out)
	if err != nil || !bytes.Equal(bytes.TrimSpace(raw), canonical) {
		return errors.New("manager metadata must retain exact canonical bytes")
	}
	return nil
}

func (m *Manager) acquireRootLock() error {
	root, err := openManagerRoot(m.directory)
	if err != nil {
		return err
	}
	held := false
	defer func() {
		if !held {
			_ = root.Close()
		}
	}()
	info, err := root.Stat()
	if err != nil || !os.SameFile(m.rootInfo, info) || identity(m.rootInfo) != identity(info) {
		return ErrUnsafePath
	}
	// A renamed or replaced marker cannot move ownership to another inode
	// while a manager still holds the original private directory.
	if err := lockFile(root); err != nil {
		return fmt.Errorf("cannot exclusively lock the original managed directory: %w", err)
	}
	named, err := privateDir(m.directory, m.uid, false)
	if err != nil || !os.SameFile(info, named) || identity(info) != identity(named) {
		return ErrUnsafePath
	}
	m.rootLock = root
	held = true
	return nil
}

func (m *Manager) closeLocks() error {
	var markerErr error
	if m.lock != nil {
		markerErr = m.lock.Close()
		m.lock = nil
	}
	if m.rootLock != nil {
		rootErr := m.rootLock.Close()
		m.rootLock = nil
		return errors.Join(markerErr, rootErr)
	}
	return markerErr
}

func (m *Manager) acquireLock(fresh bool) error {
	if err := m.rootUnchanged(); err != nil {
		return err
	}
	path := filepath.Join(m.directory, lockName)
	prior, err := os.Lstat(path)
	create := errors.Is(err, os.ErrNotExist)
	if !create {
		if err != nil {
			return err
		}
		if fresh {
			return errors.New("unknown manager lock preserved")
		}
		if !validManagerLock(prior, m.uid) {
			return ErrUnsafePath
		}
	}
	file, err := openManagerLock(m.rootLock, create)
	if err != nil {
		return err
	}
	if err := m.bindManagerLock(path, file, prior, create); err != nil {
		_ = file.Close()
		return err
	}
	return nil
}

// bindManagerLock binds the already opened file to the inode observed by
// acquireLock. Its caller keeps the original managed directory locked.
func (m *Manager) bindManagerLock(path string, file *os.File, prior os.FileInfo, create bool) error {
	info, err := file.Stat()
	if err != nil || !validManagerLock(info, m.uid) || !create && !os.SameFile(info, prior) {
		return ErrUnsafePath
	}
	if err := lockFile(file); err != nil {
		return errors.New("another owner holds the node manager")
	}
	// Check the locked descriptor is still the named owner before touching it.
	if err := m.rootUnchanged(); err != nil {
		return err
	}
	named, err := os.Lstat(path)
	if err != nil || !validManagerLock(named, m.uid) || !os.SameFile(named, info) {
		return ErrUnsafePath
	}
	if create {
		if err := m.checkStateFile(); err != nil {
			return err
		}
		marker, _ := json.Marshal(lockRecord{Version: stateVersion, ManagerID: m.state.ManagerID})
		if _, err := file.Write(marker); err != nil {
			return err
		}
		if err := file.Sync(); err != nil {
			return err
		}
	}
	raw, err := readManagerLock(file)
	if err != nil {
		return err
	}
	var record lockRecord
	if strictRecord(raw, &record) != nil || record.Version != stateVersion || record.ManagerID != m.state.ManagerID {
		return errors.New("unknown manager lock preserved")
	}
	if err := m.checkLock(path, file, info, raw); err != nil {
		return err
	}
	m.lock, m.lockInfo, m.lockRaw = file, info, raw
	return nil
}

func readManagerLock(file *os.File) ([]byte, error) {
	raw, err := io.ReadAll(io.NewSectionReader(file, 0, managerLockLimit+1))
	if err != nil || len(raw) > managerLockLimit {
		return nil, ErrUnsafePath
	}
	return raw, nil
}

func (m *Manager) checkLock(path string, file *os.File, expected os.FileInfo, marker []byte) error {
	before, err := file.Stat()
	if err != nil || !validManagerLock(before, m.uid) || !os.SameFile(before, expected) {
		return ErrUnsafePath
	}
	raw, err := readManagerLock(file)
	if err != nil || !bytes.Equal(raw, marker) {
		return ErrUnsafePath
	}
	held, holdErr := file.Stat()
	current, pathErr := os.Lstat(path)
	if holdErr != nil || pathErr != nil || !validManagerLock(held, m.uid) || !validManagerLock(current, m.uid) ||
		!sameManagerLockSnapshot(before, held) || !sameManagerLockSnapshot(held, current) || held.Size() != int64(len(raw)) {
		return ErrUnsafePath
	}
	return nil
}

func (m *Manager) checkStateFile() error {
	path := filepath.Join(m.directory, stateName)
	if m.stateInfo != nil {
		prior, actual, err := readOwnedFile(path, m.uid, stateRecordLimit)
		if err != nil || !os.SameFile(actual, m.stateInfo) || !bytes.Equal(prior, m.stateRaw) {
			return ErrUnsafePath
		}
	} else if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return ErrUnsafePath
	}
	return nil
}

func (m *Manager) rootUnchanged() error {
	info, err := privateDir(m.directory, m.uid, false)
	if err != nil || !os.SameFile(info, m.rootInfo) || m.state.RootIdentity != nil && identity(info) != *m.state.RootIdentity {
		return ErrUnsafePath
	}
	if m.rootLock != nil {
		held, err := m.rootLock.Stat()
		if err != nil || !os.SameFile(info, held) || identity(info) != identity(held) {
			return ErrUnsafePath
		}
	}
	for name, expected := range map[string]*FileIdentity{"bin": m.state.BinIdentity, "data": m.state.DataIdentity, "logs": m.state.LogsIdentity} {
		if expected == nil {
			continue
		}
		info, err := privateDir(filepath.Join(m.directory, name), m.uid, false)
		if err != nil || identity(info) != *expected {
			return ErrUnsafePath
		}
	}
	if m.lock != nil {
		return m.checkLock(filepath.Join(m.directory, lockName), m.lock, m.lockInfo, m.lockRaw)
	}
	return nil
}
func (m *Manager) save() error {
	if err := m.rootUnchanged(); err != nil {
		return err
	}
	path := filepath.Join(m.directory, stateName)
	if err := m.checkStateFile(); err != nil {
		return err
	}
	raw, err := json.Marshal(m.state)
	if err != nil {
		return err
	}
	if len(raw) > stateRecordLimit {
		return ErrCapacity
	}
	temp := filepath.Join(m.directory, "state-"+randomID()+".tmp")
	file, err := os.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	tempInfo, statErr := file.Stat()
	if statErr != nil {
		_ = file.Close()
		return statErr
	}
	remove := true
	defer func() {
		_ = file.Close()
		if remove {
			if current, statErr := os.Lstat(temp); statErr == nil && current.Mode().Type() == tempInfo.Mode().Type() && os.SameFile(current, tempInfo) {
				_ = os.Remove(temp)
			}
		}
	}()
	if _, err = file.Write(raw); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = m.rootUnchanged(); err != nil {
		return err
	}
	if err := m.checkStateFile(); err != nil {
		return err
	}
	if err = os.Rename(temp, path); err != nil {
		return err
	}
	remove = false
	dir, err := os.Open(m.directory)
	if err != nil {
		return err
	}
	err = dir.Sync()
	_ = dir.Close()
	if err != nil {
		return err
	}
	m.stateInfo, err = os.Lstat(path)
	if err == nil {
		m.stateRaw = append([]byte(nil), raw...)
	}
	return err
}
func (m *Manager) capacity(extra uint64) (Capacity, error) {
	result := Capacity{LimitBytes: m.quotaBytes, Enforcement: "preflight-and-isolated-fixture-monitor"}
	if err := m.rootUnchanged(); err != nil {
		return result, err
	}
	entries := 0
	err := filepath.WalkDir(m.directory, func(path string, entry fs.DirEntry, walkErr error) error {
		entries++
		if entries > 4096 {
			return ErrCapacity
		}
		if walkErr != nil {
			return walkErr
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		uid, err := ownerUID(info)
		if err != nil || uid != m.uid || info.Mode()&os.ModeSymlink != 0 {
			return ErrUnsafePath
		}
		if info.Mode().IsRegular() {
			size := uint64(info.Size())
			if result.UsedBytes > math.MaxUint64-size {
				return ErrCapacity
			}
			result.UsedBytes += size
		} else if !info.IsDir() && !m.fixtureSynchronizationSocket(path, info) {
			return ErrUnsafePath
		}
		return nil
	})
	if err != nil {
		return result, err
	}
	result.Complete = true
	available, err := freeBytes(m.directory)
	if err != nil {
		return result, err
	}
	result.FreeBytes = available
	if extra > m.quotaBytes || result.UsedBytes > m.quotaBytes-extra || available < m.minFreeBytes || extra > available-m.minFreeBytes {
		return result, ErrCapacity
	}
	return result, nil
}
