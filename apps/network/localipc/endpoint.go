package localipc

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

const EndpointRecordName = "network-helper.endpoint.json"
const endpointVersion = "YNX-NETWORK-LOCAL-ENDPOINT/v1"

type fileStamp struct {
	Device  string `json:"device"`
	Inode   string `json:"inode"`
	UID     uint32 `json:"uid"`
	Mode    uint32 `json:"mode"`
	Changed string `json:"changed"`
}
type endpointRecord struct {
	Version    string    `json:"version"`
	EndpointID string    `json:"endpointId"`
	UID        uint32    `json:"uid"`
	Directory  fileStamp `json:"directory"`
	Lock       fileStamp `json:"lock"`
	Socket     fileStamp `json:"socket"`
}

func endpointID() string {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return hex.EncodeToString(raw)
}
func readEndpointRecord(path string, uid uint32) (endpointRecord, os.FileInfo, error) {
	var record endpointRecord
	info, err := os.Lstat(path)
	if err != nil {
		return record, nil, err
	}
	owner, err := fileOwner(info)
	if err != nil || owner != uid || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || info.Size() < 1 || info.Size() > 4096 {
		return record, nil, ErrEndpointChanged
	}
	file, err := os.Open(path)
	if err != nil {
		return record, nil, err
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return record, nil, ErrEndpointChanged
	}
	raw, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil || len(raw) > 4096 || strictJSON(raw, &record) != nil {
		return record, nil, ErrEndpointChanged
	}
	canonical, err := json.Marshal(record)
	if err != nil || !equivalentJSON(raw, canonical) || record.Version != endpointVersion || record.UID != uid || len(record.EndpointID) != 48 {
		return record, nil, ErrEndpointChanged
	}
	id, err := hex.DecodeString(record.EndpointID)
	if err != nil || len(id) != 24 || hex.EncodeToString(id) != record.EndpointID {
		return record, nil, ErrEndpointChanged
	}
	return record, info, nil
}
func (s *Server) recoverKnownEndpoint() error {
	if s.lease.Check() != nil || s.directoryUnchanged() != nil {
		return ErrEndpointChanged
	}
	lockInfo, err := os.Lstat(s.lockPath)
	if err != nil {
		return err
	}
	s.lockInfo = lockInfo
	record, recordInfo, err := readEndpointRecord(s.recordPath, s.uid)
	if errors.Is(err, os.ErrNotExist) {
		if _, socketErr := os.Lstat(s.path); !errors.Is(socketErr, os.ErrNotExist) {
			return errors.New("unknown socket without owned endpoint record preserved")
		}
		return nil
	}
	if err != nil {
		return err
	}
	directoryStamp, err := directoryIdentity(s.dirInfo)
	if err != nil {
		return err
	}
	lockStamp, err := stamp(lockInfo)
	if err != nil {
		return err
	}
	if record.Directory != directoryStamp || record.Lock != lockStamp {
		return ErrEndpointChanged
	}
	s.recordInfo = recordInfo
	socketInfo, err := os.Lstat(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	socketStamp, err := stamp(socketInfo)
	if err != nil || socketInfo.Mode()&os.ModeSocket == 0 || socketInfo.Mode().Perm() != 0o600 || socketStamp != record.Socket {
		return ErrEndpointChanged
	}
	// We hold the exact persisted lock's kernel lease. No live old owner can
	// still hold that lease. Only this previously published socket identity may
	// be removed; no PID guess or stale-file age participates in recovery.
	if s.lease.Check() != nil || s.directoryUnchanged() != nil || !samePath(s.recordPath, recordInfo) || !samePath(s.path, socketInfo) {
		return ErrEndpointChanged
	}
	return os.Remove(s.path)
}
func (s *Server) publishEndpoint() error {
	if s.lease.Check() != nil || s.directoryUnchanged() != nil {
		return ErrEndpointChanged
	}
	directoryStamp, err := directoryIdentity(s.dirInfo)
	if err != nil {
		return err
	}
	lockStamp, err := stamp(s.lockInfo)
	if err != nil {
		return err
	}
	socketStamp, err := stamp(s.socketInfo)
	if err != nil {
		return err
	}
	record := endpointRecord{Version: endpointVersion, EndpointID: endpointID(), UID: s.uid, Directory: directoryStamp, Lock: lockStamp, Socket: socketStamp}
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if s.recordInfo != nil {
		if !samePath(s.recordPath, s.recordInfo) {
			return ErrEndpointChanged
		}
	} else if _, err = os.Lstat(s.recordPath); !errors.Is(err, os.ErrNotExist) {
		return ErrEndpointChanged
	}
	temp := filepath.Join(s.directory, "endpoint-"+endpointID()+".tmp")
	file, err := os.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	tempInfo, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return err
	}
	defer func() {
		_ = file.Close()
		if samePath(temp, tempInfo) {
			_ = os.Remove(temp)
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
	if s.recordInfo != nil {
		if !samePath(s.recordPath, s.recordInfo) {
			return ErrEndpointChanged
		}
	} else if _, err = os.Lstat(s.recordPath); !errors.Is(err, os.ErrNotExist) {
		return ErrEndpointChanged
	}
	if err = os.Rename(temp, s.recordPath); err != nil {
		return err
	}
	directory, err := os.Open(s.directory)
	if err != nil {
		return err
	}
	err = directory.Sync()
	_ = directory.Close()
	if err != nil {
		return err
	}
	s.recordInfo, err = os.Lstat(s.recordPath)
	return err
}

func directoryIdentity(info os.FileInfo) (fileStamp, error) {
	value, err := stamp(info)
	value.Changed = ""
	return value, err
}
