package cloud

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

var ErrIDEDeploymentConflict = errors.New("IDE deployment request identity conflict")

type IDEDeploymentLog struct {
	At      time.Time `json:"at"`
	Source  string    `json:"source"`
	Message string    `json:"message"`
}

// These are operation observations, never a permission or charging receipt.
// UNKNOWN is intentionally durable before an executor may receive the artifact.
type IDEDeploymentOperation struct {
	RuntimeHandle       string             `json:"runtimeHandle,omitempty"`
	RuntimeSeconds      int                `json:"runtimeSeconds,omitempty"`
	ResourceApprovalRef string             `json:"resourceApprovalRef,omitempty"`
	RuntimeKind         string             `json:"runtimeKind,omitempty"`
	ExitCode            *int               `json:"exitCode,omitempty"`
	RequestID           string             `json:"requestId"`
	Binding             IDEArtifactBinding `json:"binding"`
	ManifestSHA256      string             `json:"manifestSHA256"`
	ApprovalSHA256      string             `json:"approvalSHA256"`
	PublisherID         string             `json:"publisherId"`
	ResourceID          string             `json:"resourceId"`
	State               string             `json:"state"`
	DeploymentID        string             `json:"deploymentId,omitempty"`
	RuntimeURL          string             `json:"runtimeUrl,omitempty"`
	CreatedAt           time.Time          `json:"createdAt"`
	UpdatedAt           time.Time          `json:"updatedAt"`
	Logs                []IDEDeploymentLog `json:"logs"`
}

type ideDeploymentRecord struct {
	Version   int                    `json:"version"`
	OwnerHash string                 `json:"ownerHash"`
	Operation IDEDeploymentOperation `json:"operation"`
}

// Reuse the inherited private journal directory and atomic publication helpers.
// No account data, bearer/proof, approval body, signing key or artifact is saved.
type ideDeploymentJournal struct {
	original   *productWriteJournal
	terminalMu sync.Mutex // Inherited single-writer service; serialize terminal publication.
}

func newIDEDeploymentJournal(root string) (*ideDeploymentJournal, error) {
	j, err := newProductWriteJournal(root)
	if err != nil {
		return nil, err
	}
	return &ideDeploymentJournal{original: j}, nil
}

func (j *ideDeploymentJournal) file(owner, requestID string) string {
	return filepath.Join(j.original.root, productHash([]byte(owner+"\x00"+requestID))+".json")
}

func (j *ideDeploymentJournal) lookup(owner, requestID string) (IDEDeploymentOperation, error) {
	var empty IDEDeploymentOperation
	if j == nil || j.original == nil || owner == "" || !productWriteKey.MatchString(requestID) {
		return empty, ErrInvalid
	}
	file := j.file(owner, requestID)
	fd, err := unix.Open(file, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if errors.Is(err, os.ErrNotExist) {
		return empty, ErrNotFound
	}
	if err != nil {
		return empty, err
	}
	f := os.NewFile(uintptr(fd), "ide-original-operation")
	defer f.Close()
	info, err := f.Stat()
	named, namedErr := os.Lstat(file)
	if err != nil || namedErr != nil || !info.Mode().IsRegular() || named.Mode()&os.ModeSymlink != 0 || !os.SameFile(info, named) || info.Mode().Perm()&0077 != 0 {
		return empty, ErrInvalid
	}
	raw, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 {
		return empty, ErrInvalid
	}
	var record ideDeploymentRecord
	if json.Unmarshal(raw, &record) != nil || record.Version != 1 || record.OwnerHash != productHash([]byte(owner)) || record.Operation.RequestID != requestID {
		return empty, ErrInvalid
	}
	op := record.Operation
	if op.State != "unknown" && op.State != "running" && op.State != "completed" && op.State != "failed" {
		return empty, ErrInvalid
	}
	return op, nil
}

// begin does not authorize or execute. Only its first durable, exclusive claim
// may be used by the normal caller after independent current authorization.
// All existing records return claim=false, including UNKNOWN after a restart.
func (j *ideDeploymentJournal) begin(owner string, proposed IDEDeploymentOperation) (IDEDeploymentOperation, bool, error) {
	var empty IDEDeploymentOperation
	if j == nil || j.original == nil || owner == "" || !productWriteKey.MatchString(proposed.RequestID) || proposed.ManifestSHA256 == "" || proposed.ApprovalSHA256 == "" || proposed.PublisherID == "" || proposed.CreatedAt.IsZero() {
		return empty, false, ErrInvalid
	}
	proposed.State = "unknown"
	proposed.RuntimeHandle = productHash([]byte(owner + "\x00" + proposed.RequestID))
	proposed.DeploymentID, proposed.RuntimeURL = "", ""
	proposed.UpdatedAt = proposed.CreatedAt
	proposed.Logs = []IDEDeploymentLog{{At: proposed.CreatedAt, Source: "cloud-operation", Message: "Original request durably claimed; execution outcome not confirmed."}}
	record := ideDeploymentRecord{Version: 1, OwnerHash: productHash([]byte(owner)), Operation: proposed}
	raw, err := json.Marshal(record)
	if err != nil || len(raw) > 64<<10 {
		return empty, false, ErrInvalid
	}
	f, err := os.OpenFile(j.file(owner, proposed.RequestID), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		prior, err := j.lookup(owner, proposed.RequestID)
		if err != nil {
			return empty, false, err
		}
		if prior.Binding != proposed.Binding || prior.ManifestSHA256 != proposed.ManifestSHA256 || prior.ApprovalSHA256 != proposed.ApprovalSHA256 || prior.PublisherID != proposed.PublisherID || prior.ResourceID != proposed.ResourceID || prior.RuntimeSeconds != proposed.RuntimeSeconds || prior.ResourceApprovalRef != proposed.ResourceApprovalRef {
			return empty, false, ErrIDEDeploymentConflict
		}
		return prior, false, nil
	}
	if err != nil {
		return empty, false, err
	}
	_, writeErr := f.Write(raw)
	if writeErr == nil {
		writeErr = f.Sync()
	}
	closeErr := f.Close()
	if writeErr != nil {
		return empty, false, writeErr
	}
	if closeErr != nil {
		return empty, false, closeErr
	}
	if err := socialSync(j.original.root); err != nil {
		return empty, false, err
	}
	return proposed, true, nil
}

// The opaque hostname handle locates metadata only; it grants no runtime
// access. Original current Auth must authorize the project on every request.
func (j *ideDeploymentJournal) lookupRuntime(handle string) (IDEDeploymentOperation, error) {
	var empty IDEDeploymentOperation
	if j == nil || j.original == nil || !ideRuntimeHandle.MatchString(handle) {
		return empty, ErrInvalid
	}
	file := filepath.Join(j.original.root, handle+".json")
	fd, err := unix.Open(file, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if errors.Is(err, os.ErrNotExist) {
		return empty, ErrNotFound
	}
	if err != nil {
		return empty, err
	}
	f := os.NewFile(uintptr(fd), "ide-original-runtime-operation")
	defer f.Close()
	info, err := f.Stat()
	named, namedErr := os.Lstat(file)
	if err != nil || namedErr != nil || !info.Mode().IsRegular() || named.Mode()&os.ModeSymlink != 0 || !os.SameFile(info, named) || info.Mode().Perm()&0077 != 0 {
		return empty, ErrInvalid
	}
	raw, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 {
		return empty, ErrInvalid
	}
	var record ideDeploymentRecord
	if json.Unmarshal(raw, &record) != nil || record.Version != 1 || !ideRuntimeHandle.MatchString(record.OwnerHash) || record.Operation.RuntimeHandle != handle {
		return empty, ErrInvalid
	}
	return record.Operation, nil
}

// A provider exception or timeout must NOT call recordTerminal as "failed".
// Only a confirmed original result may be published, after a fresh source gate.
func (j *ideDeploymentJournal) recordTerminal(owner string, observed IDEDeploymentOperation, current func() error) error {
	if j == nil || j.original == nil {
		return ErrInvalid
	}
	j.terminalMu.Lock()
	defer j.terminalMu.Unlock()
	if current == nil || (observed.State != "running" && observed.State != "completed" && observed.State != "failed") || observed.UpdatedAt.IsZero() {
		return ErrInvalid
	}
	if (observed.State == "running" || observed.State == "completed") && (observed.DeploymentID == "" || observed.RuntimeURL == "") {
		return ErrInvalid
	}
	prior, err := j.lookup(owner, observed.RequestID)
	if err != nil {
		return err
	}
	if prior.Binding != observed.Binding || prior.ManifestSHA256 != observed.ManifestSHA256 || prior.ApprovalSHA256 != observed.ApprovalSHA256 || prior.PublisherID != observed.PublisherID || prior.ResourceID != observed.ResourceID || prior.RuntimeSeconds != observed.RuntimeSeconds || prior.ResourceApprovalRef != observed.ResourceApprovalRef || prior.RuntimeHandle != observed.RuntimeHandle {
		return ErrIDEDeploymentConflict
	}
	if prior.DeploymentID != "" && prior.DeploymentID != observed.DeploymentID {
		return ErrIDEDeploymentConflict
	}
	if prior.State != "unknown" && !(prior.State == "running" && (observed.State == "completed" || observed.State == "failed")) {
		return ErrIDEDeploymentConflict
	}
	observed.CreatedAt = prior.CreatedAt
	observed.Logs = append(prior.Logs, IDEDeploymentLog{At: observed.UpdatedAt, Source: "cloud-operation", Message: "Original executor result confirmed: " + observed.State})
	raw, err := json.Marshal(ideDeploymentRecord{Version: 1, OwnerHash: productHash([]byte(owner)), Operation: observed})
	if err != nil || len(raw) > 64<<10 {
		return ErrInvalid
	}
	return socialAtomicGuarded(j.file(owner, observed.RequestID), raw, current)
}
