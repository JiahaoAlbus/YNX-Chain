package ownednode

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
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

type persistentState struct {
	Version        string `json:"version"`
	ManagerID      string `json:"managerId"`
	Mode           string `json:"mode"`
	NodeID         string `json:"nodeId"`
	Stage          string `json:"stage"`
	Generation     uint64 `json:"generation,string"`
	ArtifactSHA256 string `json:"artifactSHA256"`
	RunID          string `json:"runId"`
	LastPID        int    `json:"lastPid"`
	LastExit       string `json:"lastExit"`
	FirstCause     string `json:"firstCause"`
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
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return nil, nil, ErrUnsafePath
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
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
func (m *Manager) rootUnchanged() error {
	info, err := privateDir(m.directory, m.uid, false)
	if err != nil || !os.SameFile(info, m.rootInfo) {
		return ErrUnsafePath
	}
	return nil
}
func (m *Manager) save() error {
	if err := m.rootUnchanged(); err != nil {
		return err
	}
	path := filepath.Join(m.directory, stateName)
	if m.stateInfo != nil {
		actual, err := os.Lstat(path)
		if err != nil || !os.SameFile(actual, m.stateInfo) || !actual.Mode().IsRegular() {
			return ErrUnsafePath
		}
	} else if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return ErrUnsafePath
	}
	raw, err := json.Marshal(m.state)
	if err != nil {
		return err
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
	if m.stateInfo != nil {
		actual, statErr := os.Lstat(path)
		if statErr != nil || !os.SameFile(actual, m.stateInfo) {
			return ErrUnsafePath
		}
	} else if _, statErr := os.Lstat(path); !errors.Is(statErr, os.ErrNotExist) {
		return ErrUnsafePath
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
		} else if !info.IsDir() {
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
