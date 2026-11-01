package aitaskclient

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Operation stores only local delivery metadata/hashes, never proof, prompt,
// result content, task Grant, account keys or a fabricated remote completion.
type Operation struct {
	Version        int       `json:"version"`
	ID             string    `json:"id"`
	Origin         string    `json:"origin"`
	Method         string    `json:"method"`
	Path           string    `json:"path"`
	TaskID         string    `json:"taskId,omitempty"`
	StepID         string    `json:"stepId,omitempty"`
	RunID          string    `json:"runId,omitempty"`
	BodySHA256     string    `json:"bodySHA256"`
	State          string    `json:"state"`
	HTTPStatus     int       `json:"httpStatus,omitempty"`
	ResponseSHA256 string    `json:"responseSHA256,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
type Journal struct {
	directory string
	mu        sync.Mutex
}

func OpenJournal(directory string) (*Journal, error) {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return nil, errors.New("journal must be an absolute private directory")
	}
	if err := os.Mkdir(directory, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("journal directory must be private and not a symlink")
	}
	return &Journal{directory: directory}, nil
}
func (j *Journal) Begin(id, origin string, route Route, task, step, run string, body []byte) (*Operation, error) {
	if j == nil || !identifier.MatchString(id) {
		return nil, errors.New("explicit original operation ID required")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	op := &Operation{Version: 1, ID: id, Origin: origin, Method: route.Method, Path: route.Path, TaskID: task, StepID: step, RunID: run, BodySHA256: digest(body), State: "PENDING", UpdatedAt: time.Now().UTC()}
	raw, _ := json.Marshal(op)
	f, err := os.OpenFile(filepath.Join(j.directory, id+".json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		return nil, ErrUnresolved
	}
	if err != nil {
		return nil, err
	}
	_, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return nil, err
	}
	if err := syncDirectory(j.directory); err != nil {
		return nil, err
	}
	return op, nil
}
func (j *Journal) Read(id string) (Operation, error) {
	var op Operation
	if j == nil || !identifier.MatchString(id) {
		return op, errors.New("invalid operation ID")
	}
	raw, err := ReadPrivateFile(filepath.Join(j.directory, id+".json"), 64<<10)
	if err != nil {
		return op, err
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&op) != nil || op.Version != 1 || op.ID != id {
		return Operation{}, errors.New("invalid original operation journal")
	}
	if d.Decode(new(any)) != io.EOF {
		return Operation{}, errors.New("invalid original operation journal")
	}
	return op, nil
}
func (j *Journal) Finish(op *Operation, state string, status int, raw []byte) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	original, err := j.Read(op.ID)
	if err != nil {
		return err
	}
	if original.State != "PENDING" || original.BodySHA256 != op.BodySHA256 || original.Origin != op.Origin || original.Path != op.Path {
		return ErrUnresolved
	}
	next := *op
	next.State, next.HTTPStatus, next.UpdatedAt = state, status, time.Now().UTC()
	if len(raw) > 0 {
		next.ResponseSHA256 = digest(raw)
	}
	encoded, _ := json.Marshal(next)
	f, err := os.CreateTemp(j.directory, ".finish-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	_, writeErr := f.Write(encoded)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return err
	}
	if err := os.Rename(name, filepath.Join(j.directory, op.ID+".json")); err != nil {
		return err
	}
	if err := syncDirectory(j.directory); err != nil {
		return err
	}
	*op = next
	return nil
}
func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func ReadPrivateFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 || info.Size() > limit {
		return nil, errors.New("credential/journal file must be a bounded private regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("private file identity changed")
	}
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errors.New("private file exceeded bound")
	}
	return b, nil
}
