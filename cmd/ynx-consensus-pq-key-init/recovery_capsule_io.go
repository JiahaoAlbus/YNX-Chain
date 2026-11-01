//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"golang.org/x/sys/unix"
)

type capsuleIdentity struct {
	Device, Inode, UID, GID, Links    uint64
	Mode                              uint32
	Bytes, MTimeNS, CTimeSec, CTimeNS int64
}

func capsuleFileIdentity(info os.FileInfo) (capsuleIdentity, error) {
	var id capsuleIdentity
	if info == nil {
		return id, errors.New("missing original file metadata")
	}
	v := reflect.ValueOf(info.Sys())
	if v.Kind() != reflect.Pointer || v.IsNil() {
		return id, errors.New("original file identity unavailable")
	}
	v = v.Elem()
	values := []*uint64{&id.Device, &id.Inode, &id.UID, &id.GID, &id.Links}
	for i, name := range []string{"Dev", "Ino", "Uid", "Gid", "Nlink"} {
		field := v.FieldByName(name)
		if !field.IsValid() {
			return id, errors.New("original file identity unavailable")
		}
		if field.CanUint() {
			*values[i] = field.Uint()
		} else if field.CanInt() && field.Int() >= 0 {
			*values[i] = uint64(field.Int())
		} else {
			return id, errors.New("original file identity unavailable")
		}
	}
	found := false
	for _, name := range []string{"Ctim", "Ctimespec"} {
		stamp := v.FieldByName(name)
		if stamp.IsValid() {
			if found || stamp.Kind() != reflect.Struct || !stamp.FieldByName("Sec").CanInt() || !stamp.FieldByName("Nsec").CanInt() {
				return id, errors.New("original nanosecond identity unavailable")
			}
			id.CTimeSec, id.CTimeNS = stamp.FieldByName("Sec").Int(), stamp.FieldByName("Nsec").Int()
			found = true
		}
	}
	if !found {
		return id, errors.New("original nanosecond identity unavailable")
	}
	id.Mode, id.Bytes, id.MTimeNS = uint32(info.Mode()), info.Size(), info.ModTime().UnixNano()
	return id, nil
}

type capsuleHeldFile struct {
	path string
	file *os.File
	id   capsuleIdentity
	raw  []byte
}

func capsuleCanonical(path string) bool {
	return path != "" && len(path) <= 4096 && !strings.ContainsRune(path, 0) && filepath.IsAbs(path) && filepath.Clean(path) == path
}

func capsuleOpen(path string, maximum int64, empty, private, directory bool) (*capsuleHeldFile, error) {
	if !capsuleCanonical(path) {
		return nil, errors.New("canonical original input path required")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("aliased original input refused")
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, errors.New("original input not supplied")
	}
	id, err := capsuleFileIdentity(before)
	if err != nil || directory && !before.IsDir() || !directory && (!before.Mode().IsRegular() || id.Links != 1 || id.Bytes > maximum || id.Bytes < 0 || !empty && id.Bytes == 0) {
		return nil, errors.New("bounded original regular input required")
	}
	if private && (id.UID != uint64(os.Geteuid()) || directory && before.Mode() != os.ModeDir|0700 || !directory && before.Mode() != 0600) || !private && before.Mode().Perm()&0022 != 0 {
		return nil, errors.New("original input ownership or protection differs")
	}
	flags := unix.O_RDONLY | unix.O_NOFOLLOW | unix.O_CLOEXEC | unix.O_NONBLOCK
	if directory {
		flags |= unix.O_DIRECTORY
	}
	fd, err := unix.Open(path, flags, 0)
	if err != nil {
		return nil, errors.New("original input could not be opened read-only")
	}
	h := &capsuleHeldFile{path: path, file: os.NewFile(uintptr(fd), "recovery-original-input"), id: id}
	fail := func() (*capsuleHeldFile, error) {
		h.file.Close()
		return nil, errors.New("original input changed during protected read")
	}
	if h.check() != nil {
		return fail()
	}
	if !directory {
		h.raw, err = io.ReadAll(io.LimitReader(h.file, maximum+1))
		if err != nil || int64(len(h.raw)) != id.Bytes || h.check() != nil {
			return fail()
		}
	}
	return h, nil
}

func (h *capsuleHeldFile) check() error {
	held, err := h.file.Stat()
	current, pathErr := os.Lstat(h.path)
	resolved, resolveErr := filepath.EvalSymlinks(h.path)
	if err != nil || pathErr != nil || resolveErr != nil || resolved != h.path {
		return errors.New("original input path changed")
	}
	for _, info := range []os.FileInfo{held, current} {
		id, err := capsuleFileIdentity(info)
		if err != nil || id != h.id {
			return errors.New("original input identity changed")
		}
	}
	return nil
}

func (h *capsuleHeldFile) unchanged() error {
	if err := h.check(); err != nil {
		return err
	}
	if h.file == nil || h.id.Mode&uint32(os.ModeDir) != 0 {
		return nil
	}
	if _, err := h.file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(h.file, h.id.Bytes+1))
	if err != nil || !bytes.Equal(raw, h.raw) || h.check() != nil {
		return errors.New("original full input bytes changed")
	}
	return nil
}

func capsuleJSON(raw []byte, target any) error {
	if len(raw) > 0 && raw[len(raw)-1] == '\n' {
		raw = raw[:len(raw)-1]
	}
	return decodeCanonical(raw, target)
}

func capsuleJSONBytes(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	return append(raw, '\n'), err
}

func capsuleCreateCase(path string, forbidden ...string) error {
	if !capsuleCanonical(path) || filepath.Dir(path) == path {
		return errors.New("new canonical private result directory required")
	}
	for _, original := range forbidden {
		if capsuleOverlaps(path, original) {
			return errors.New("result directory must be disjoint from original custody")
		}
	}
	parent := filepath.Dir(path)
	real, err := filepath.EvalSymlinks(parent)
	if err != nil || real != parent {
		return errors.New("existing canonical result parent required")
	}
	info, err := os.Lstat(parent)
	id, identityErr := capsuleFileIdentity(info)
	if err != nil || identityErr != nil || !info.IsDir() || !(id.UID == uint64(os.Geteuid()) && info.Mode().Perm() == 0700 || id.UID == 0 && info.Mode()&os.ModeSticky != 0) {
		return errors.New("protected owner parent or canonical system sticky parent required")
	}
	return os.Mkdir(path, 0700) // Atomic exclusion; existing/UNKNOWN is never opened.
}

func capsuleOverlaps(a, b string) bool {
	return a == b || strings.HasPrefix(a, b+string(filepath.Separator)) || strings.HasPrefix(b, a+string(filepath.Separator))
}

func capsuleFirstCause(directory, stage string) {
	raw, _ := capsuleJSONBytes(struct {
		Version        string `json:"version"`
		Stage          string `json:"stage"`
		Status         string `json:"status"`
		AutomaticRetry bool   `json:"automaticRetry"`
	}{"YNX-PQ-RECOVERY-FIRST-CAUSE/v1", stage, "REFUSED_OR_UNKNOWN_ORIGINAL_ATTEMPT_RETAINED", false})
	_ = writeExclusive(filepath.Join(directory, "FIRST-CAUSE.json"), raw)
}
