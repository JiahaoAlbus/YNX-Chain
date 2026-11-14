package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

var ErrIDEResourceBusy = errors.New("original IDE resource remains occupied or uncertain")

// Resource admission is separate from operation idempotency. An authenticated
// new request cannot multiply a single existing resource's approved CPU/memory
// allocation while a prior operation is running or its result is UNKNOWN.
// This is an owned single-resource fence, not a scheduler, lease or authority.
func (e *OCIIDEDeploymentExecutor) acquireResource(ctx context.Context, p IDEDeploymentPermit, current func() error) (func(), error) {
	if current == nil {
		return nil, ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := current(); err != nil {
		return nil, err
	}
	prefix := filepath.Join(e.cfg.StorageRoot, "resource-"+productHash([]byte(e.cfg.ResourceID)))
	fd, err := unix.Open(prefix+".lock", unix.O_CREAT|unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	lock := os.NewFile(uintptr(fd), "ide-resource-admission")
	info, err := lock.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		lock.Close()
		return nil, ErrInvalid
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		return nil, ErrIDEResourceBusy
	}
	release := func() { _ = unix.Flock(fd, unix.LOCK_UN); _ = lock.Close() }
	file := prefix + ".json"
	if err := e.reconcileResourceRecord(ctx, file, p); err != nil {
		release()
		return nil, err
	}
	op := IDEDeploymentOperation{RequestID: p.RequestID, Binding: p.Binding, ManifestSHA256: p.ManifestSHA256, ApprovalSHA256: p.ApprovalSHA256, PublisherID: p.PublisherID, ResourceID: p.ResourceID, RuntimeHandle: productHash([]byte(p.Principal + "\x00" + p.RequestID)), RuntimeSeconds: p.RuntimeSeconds, ResourceApprovalRef: p.ResourceApprovalRef, State: "unknown", CreatedAt: e.now()}
	raw, err := json.Marshal(struct {
		Version   int                    `json:"version"`
		Operation IDEDeploymentOperation `json:"operation"`
	}{1, op})
	if err != nil || len(raw) > 64<<10 {
		release()
		return nil, ErrInvalid
	}
	// Persist before staging/create/start. Failed acknowledgment never deletes
	// or releases the original UNKNOWN reservation as if no effect had happened.
	if err := socialAtomicGuarded(file, raw, current); err != nil {
		release()
		return nil, err
	}
	return release, nil
}

func (e *OCIIDEDeploymentExecutor) reconcileResourceRecord(ctx context.Context, file string, next IDEDeploymentPermit) error {
	prior, err := readIDECreatedRecord(file)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return ErrIDEResourceBusy
	}
	if prior.Operation.ResourceID != e.cfg.ResourceID {
		return ErrIDEResourceBusy
	}
	if prior.Operation.RequestID == next.RequestID {
		return ErrIDEResourceBusy
	}
	// Only an actual original exit observation permits another approved ID.
	// Missing containers, observer errors and running/pending results are NOT
	// evidence of non-execution and must never release the previous claim.
	observed, err := e.ObserveOriginal(ctx, prior.Operation)
	if err != nil || (observed.State != "completed" && observed.State != "failed") {
		return ErrIDEResourceBusy
	}
	return nil
}

// Called while acquireResource's original exclusive lock is still held.
// Publishing an acknowledged ID is metadata recovery, not a new grant/start.
func (e *OCIIDEDeploymentExecutor) pinCreatedResource(op IDEDeploymentOperation) error {
	file := filepath.Join(e.cfg.StorageRoot, "resource-"+productHash([]byte(e.cfg.ResourceID))+".json")
	prior, err := readIDECreatedRecord(file)
	if err != nil {
		return err
	}
	if prior.Operation.State != "unknown" || !sameIDECreatedSelection(prior.Operation, op) || (prior.Operation.DeploymentID != "" && prior.Operation.DeploymentID != op.DeploymentID) {
		return ErrIDEDeploymentConflict
	}
	prior.Operation.DeploymentID = op.DeploymentID
	raw, err := json.Marshal(prior)
	if err != nil {
		return err
	}
	return socialAtomicGuarded(file, raw, nil)
}
