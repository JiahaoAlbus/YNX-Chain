package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"golang.org/x/sys/unix"
)

var ErrIDEResourceBusy = errors.New("original IDE resource remains occupied or uncertain")

// Resource admission is separate from operation idempotency. An authenticated
// new request cannot multiply a single existing resource's approved CPU/memory
// allocation while a prior operation is running or its result is UNKNOWN.
// This is an owned single-resource fence, not a scheduler, lease or authority.
func (e *OCIIDEDeploymentExecutor) acquireResource(ctx context.Context, p IDEDeploymentPermit, current func() error) (func(), error) {
	return e.acquireExecutionResource(ctx, legacyIDEExecution(p), current)
}

func (e *OCIIDEDeploymentExecutor) acquireExecutionResource(ctx context.Context, p ideExecutionSnapshot, current func() error) (func(), error) {
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
		return nil, ideBeforeDispatchError{ErrIDEResourceBusy}
	}
	release := func() { _ = unix.Flock(fd, unix.LOCK_UN); _ = lock.Close() }
	file := prefix + ".json"
	if err := e.reconcileExecutionResourceRecord(ctx, file, p); err != nil {
		release()
		return nil, ideBeforeDispatchError{err}
	}
	previousRevision := uint64(0)
	if prior, err := readIDECreatedRecord(file); err == nil {
		previousRevision = 1 // Existing legacy reservation is the first known revision.
		if prior.Operation.SlotRevision != "" {
			previousRevision, err = ideSlotNumber(prior.Operation.SlotRevision)
			if err != nil || previousRevision == 0 {
				release()
				return nil, ErrIDEDeploymentConflict
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		release()
		return nil, err
	}
	if p.ExpectedSlotRevision != "" && p.ExpectedSlotRevision != strconv.FormatUint(previousRevision, 10) {
		release()
		return nil, ideBeforeDispatchError{ErrIDEDeploymentConflict}
	}
	if previousRevision == ^uint64(0) {
		release()
		return nil, ErrIDEDeploymentConflict
	}
	op := p.IDEDeploymentOperation
	op.RuntimeHandle = productHash([]byte(p.Principal + "\x00" + p.RequestID))
	op.State = "unknown"
	op.CreatedAt = e.now()
	op.SlotRevision = strconv.FormatUint(previousRevision+1, 10)
	op.ExpectedSlotRevision = p.ExpectedSlotRevision
	op.RollbackTarget = p.RollbackTarget
	op.ContentBinding = p.ContentBinding
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
	return e.reconcileExecutionResourceRecord(ctx, file, legacyIDEExecution(next))
}

func (e *OCIIDEDeploymentExecutor) reconcileExecutionResourceRecord(ctx context.Context, file string, next ideExecutionSnapshot) error {
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
