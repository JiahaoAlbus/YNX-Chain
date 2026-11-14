package cloud

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// An acknowledgment of an already attempted create, never a grant or a
// permission to start/retry. Keep it independent of reservation publication.
type ideCreatedInstanceRecord struct {
	Version   int                    `json:"version"`
	Operation IDEDeploymentOperation `json:"operation"`
}

func sameIDECreatedSelection(a, b IDEDeploymentOperation) bool {
	return a.RequestID == b.RequestID && a.Binding == b.Binding && a.ResourceID == b.ResourceID && a.PublisherID == b.PublisherID && a.ManifestSHA256 == b.ManifestSHA256 && a.ApprovalSHA256 == b.ApprovalSHA256 && a.RuntimeHandle == b.RuntimeHandle && a.RuntimeSeconds == b.RuntimeSeconds && a.ResourceApprovalRef == b.ResourceApprovalRef
}

func (e *OCIIDEDeploymentExecutor) createdInstanceFile(op IDEDeploymentOperation) string {
	return filepath.Join(e.cfg.StorageRoot, e.name(op.RequestID, op.ApprovalSHA256), "created-instance.json")
}

func readIDECreatedRecord(file string) (ideCreatedInstanceRecord, error) {
	var empty ideCreatedInstanceRecord
	dir, err := os.Lstat(filepath.Dir(file))
	if err != nil {
		return empty, err
	}
	if !dir.IsDir() || dir.Mode()&os.ModeSymlink != 0 || dir.Mode().Perm()&0077 != 0 {
		return empty, ErrIDEDeploymentConflict
	}
	fd, err := unix.Open(file, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return empty, err
	}
	f := os.NewFile(uintptr(fd), "ide-created-instance-record")
	defer f.Close()
	info, err := f.Stat()
	named, namedErr := os.Lstat(file)
	var stat unix.Stat_t
	if err != nil || namedErr != nil || unix.Fstat(fd, &stat) != nil || stat.Nlink != 1 || !info.Mode().IsRegular() || named.Mode()&os.ModeSymlink != 0 || !os.SameFile(info, named) || info.Mode().Perm()&0077 != 0 || info.Size() > 16<<10 {
		return empty, ErrIDEDeploymentConflict
	}
	raw, err := io.ReadAll(io.LimitReader(f, (16<<10)+1))
	if err != nil || len(raw) > 16<<10 {
		return empty, ErrIDEDeploymentConflict
	}
	after, afterErr := f.Stat()
	last, lastErr := os.Lstat(file)
	lastDir, dirErr := os.Lstat(filepath.Dir(file))
	if afterErr != nil || lastErr != nil || dirErr != nil || !os.SameFile(info, last) || !os.SameFile(dir, lastDir) || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return empty, ErrIDEDeploymentConflict
	}
	var record ideCreatedInstanceRecord
	if json.Unmarshal(raw, &record) != nil || record.Version != 1 {
		return empty, ErrIDEDeploymentConflict
	}
	canonical, err := json.Marshal(record)
	if err != nil || !bytes.Equal(canonical, raw) {
		return empty, ErrIDEDeploymentConflict
	}
	return record, nil
}

func (e *OCIIDEDeploymentExecutor) rememberCreatedInstance(op IDEDeploymentOperation) error {
	if !ideOCIDigest.MatchString("sha256:" + op.DeploymentID) {
		return ErrIDEExistingRuntimeUnavailable
	}
	op.State = "unknown"
	op.CreatedAt = e.now()
	raw, err := json.Marshal(ideCreatedInstanceRecord{Version: 1, Operation: op})
	if err != nil || len(raw) > 16<<10 {
		return ErrInvalid
	}
	file := e.createdInstanceFile(op)
	fd, err := unix.Open(file, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "ide-created-instance-acknowledgment")
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	var syncErr error
	if writeErr == nil {
		syncErr = f.Sync()
	}
	closeErr := f.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		// Do not erase or retry a partial acknowledgment as though no effect
		// occurred. Its first IO cause and the original UNKNOWN remain intact.
		return err
	}
	if err := socialSync(filepath.Dir(file)); err != nil {
		return err
	}
	return socialSync(e.cfg.StorageRoot)
}

func (e *OCIIDEDeploymentExecutor) createdContainerID(op IDEDeploymentOperation) (string, error) {
	record, err := readIDECreatedRecord(e.createdInstanceFile(op))
	if errors.Is(err, os.ErrNotExist) && op.DeploymentID != "" && ideOCIDigest.MatchString("sha256:"+op.DeploymentID) {
		// Already confirmed legacy journals retain their exact immutable ID.
		// An UNKNOWN without an acknowledgment never falls back to a name.
		return op.DeploymentID, nil
	}
	if err != nil {
		return "", err
	}
	id := record.Operation.DeploymentID
	if record.Operation.State != "unknown" || !sameIDECreatedSelection(record.Operation, op) || !ideOCIDigest.MatchString("sha256:"+id) || (op.DeploymentID != "" && op.DeploymentID != id) {
		return "", ErrIDEDeploymentConflict
	}
	return id, nil
}
