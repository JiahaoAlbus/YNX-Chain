package cloud

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/unix"
)

// IDEUsageBillReader borrows the original server's journal. Its concrete
// identity has no path/DTO constructor. It proves only a sealed Cloud bill,
// never a Pay caller, merchant membership, terms approval or Core Member.
type IDEUsageBillReader struct {
	self    *IDEUsageBillReader
	journal *ideDeploymentJournal
	retired atomic.Bool
}

// OpenOriginalIDEUsageBillReader is an in-process composition callee, not an
// HTTP route. owner in Capture is an exact original journal locator; Auth must
// independently bind it to its qualified tenant/project/Pay selection.
func (s *Server) OpenOriginalIDEUsageBillReader() (*IDEUsageBillReader, error) {
	if s == nil || s.service == nil {
		return nil, ErrIDEUsageUnpriced
	}
	s.billReaderMu.Lock()
	defer s.billReaderMu.Unlock()
	if s.billReaderRetired {
		return nil, ErrDenied
	}
	journal, err := s.originalIDEJournalLocked()
	if err != nil {
		return nil, err
	}
	if s.billReader == nil {
		s.billReader = &IDEUsageBillReader{journal: journal}
		s.billReader.self = s.billReader
	}
	if s.billReader.retired.Load() {
		return nil, ErrDenied
	}
	return s.billReader, nil
}

// The descriptor belongs to the one real Server, whether first needed by
// read-only billing or admitted IDE execution. Binding it creates no directory,
// lock, journal or execution service. It is not a second bill database.
func (s *Server) originalIDEJournalLocked() (*ideDeploymentJournal, error) {
	if s.originalIDEJournal != nil {
		return s.originalIDEJournal, nil
	}
	if s.service == nil || s.service.cfg.StatePath == "" {
		return nil, ErrInvalid
	}
	state, err := filepath.Abs(filepath.Clean(s.service.cfg.StatePath))
	if err != nil {
		return nil, err
	}
	s.originalIDEJournal = &ideDeploymentJournal{original: &productWriteJournal{root: state + ".ide-deployments"}}
	return s.originalIDEJournal, nil
}
func (s *Server) openOriginalIDEJournalForExecution() (*ideDeploymentJournal, error) {
	s.billReaderMu.Lock()
	defer s.billReaderMu.Unlock()
	if s.billReaderRetired {
		return nil, ErrDenied
	}
	j, err := s.originalIDEJournalLocked()
	if err != nil {
		return nil, err
	}
	// Reuse the original execution constructor's private-directory checks only
	// after the genuine execution authority has been checked. Never replace j.
	if _, err = newProductWriteJournal(j.original.root); err != nil {
		return nil, err
	}
	return j, nil
}

// Retire stops capture and all child Current checks without touching borrowed
// parents or doing any IO. Normal runtime calls this before parent shutdown.
func (r *IDEUsageBillReader) Retire() {
	if r != nil && r.self == r {
		r.retired.Store(true)
	}
}
func (r *IDEUsageBillReader) Close() error {
	if r == nil || r.self != r {
		return ErrDenied
	}
	r.Retire()
	return nil // No owned FDs; journal and server remain borrowed.
}
func (s *Server) RetireOriginalIDEUsageBillReader() {
	if s == nil {
		return
	}
	s.billReaderMu.Lock()
	defer s.billReaderMu.Unlock()
	s.billReaderRetired = true
	if s.billReader != nil {
		s.billReader.Retire()
	}
}

// All fields are copied observations. Merchant comes from the frozen original
// tariff; Cloud has no StoreID/member/terms record and does not invent one.
// SHA256 binds canonical Cloud provenance DATA, NOT a Core signing digest.
type IDEUsageBillProvenanceDATA struct {
	Owner           string             `json:"owner"`
	ManifestVersion string             `json:"manifestVersion"`
	ProjectID       string             `json:"projectId"`
	ProjectRef      IDEDeploymentV2Ref `json:"projectRef"`
	ResourceID      string             `json:"resourceId"`
	ManifestSHA256  string             `json:"manifestSHA256"`
	ArtifactSHA256  string             `json:"artifactSHA256"`
	Bill            IDEUsageBill       `json:"bill"`
}
type IDEUsageBillProvenance struct {
	self      *IDEUsageBillProvenance
	parent    *IDEUsageBillReader
	ctx       context.Context
	until     time.Time
	data      IDEUsageBillProvenanceDATA
	digest    string
	closed    atomic.Bool
	mu        sync.Mutex
	first     error
	closeDone bool
	closeErr  error
}

// Capture performs its sole journal IO here, before entering any Pay Store
// lock. Existing lock only (no O_CREATE), shared/nonblocking, no reserve,
// confirm, invoice lookup, Source callback, signature or monetary operation.
func (r *IDEUsageBillReader) Capture(ctx context.Context, owner, requestID, period string) (*IDEUsageBillProvenance, error) {
	if r == nil || r.self != r || r.journal == nil || r.journal.original == nil || r.retired.Load() || ctx == nil || ctx.Err() != nil || owner == "" || len(owner) > 512 || !productWriteKey.MatchString(requestID) {
		return nil, ErrDenied
	}
	_, end, err := usagePeriod(period)
	if err != nil {
		return nil, err
	}
	if time.Now().Before(end) {
		return nil, ErrIDEUsagePeriodOpen
	}
	// The window starts before IO. Time spent capturing cannot extend it.
	until := time.Now().Add(5 * time.Second)
	if deadline, ok := ctx.Deadline(); ok && deadline.Before(until) {
		until = deadline
	}
	root := r.journal.original.root
	parent, err := originalIDEUsageReadDirectory(root)
	if err != nil {
		return nil, err
	}
	file := r.journal.file(owner, requestID) + ".usage.lock"
	fd, err := unix.Open(file, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "ide-original-bill-read-lock")
	defer f.Close()
	var stat unix.Stat_t
	if unix.Fstat(fd, &stat) != nil || stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Mode&0777 != 0600 || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
		return nil, ErrInvalid
	}
	if err = unix.Flock(fd, unix.LOCK_SH|unix.LOCK_NB); err != nil {
		return nil, ErrIDEResourceBusy
	}
	defer unix.Flock(fd, unix.LOCK_UN)
	info, err := f.Stat()
	named, nerr := os.Lstat(file)
	if err != nil || nerr != nil || !os.SameFile(info, named) {
		return nil, ErrInvalid
	}
	op, err := r.journal.lookup(owner, requestID)
	if err != nil {
		return nil, err
	}
	if op.DeploymentID == "" || op.State == "unknown" {
		return nil, ErrIDEUsageUnpriced
	}
	bill, _, err := r.journal.readUsageBillLocked(owner, op, period)
	if err != nil {
		return nil, err
	}
	wantID := "cloud_usage_" + productHash([]byte(owner+"\x00"+op.RequestID+"\x00"+op.DeploymentID+"\x00"+period))
	if bill.Request.BillID != wantID || bill.CreatedAt.IsZero() || bill.UpdatedAt.Before(bill.CreatedAt) {
		return nil, ErrIDEDeploymentConflict
	}
	after, err := originalIDEUsageReadDirectory(root)
	if err != nil || !os.SameFile(parent, after) {
		return nil, ErrInvalid
	}
	data := IDEUsageBillProvenanceDATA{Owner: owner, ManifestVersion: op.ManifestVersion, ProjectID: op.Binding.ProjectID, ResourceID: op.ResourceID, ManifestSHA256: op.ManifestSHA256, ArtifactSHA256: ideArtifactSHA256(op), Bill: bill}
	if op.ManifestVersion == "2" {
		data.ProjectID = op.CatalogProjectID
		data.ProjectRef = op.ManifestV2.Project
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	h := &IDEUsageBillProvenance{parent: r, ctx: ctx, until: until, data: data, digest: productHash(raw)}
	h.self = h
	if err = h.Current(); err != nil {
		return h, err
	}
	return h, nil
}

func originalIDEUsageReadDirectory(root string) (os.FileInfo, error) {
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root || !info.IsDir() || info.Mode().Perm() != 0700 {
		return nil, ErrInvalid
	}
	var stat unix.Stat_t
	if unix.Lstat(root, &stat) != nil || stat.Uid != uint32(os.Geteuid()) {
		return nil, ErrInvalid
	}
	return info, nil
}

// Current is synchronous and performs NO IO, Source callback, Cloud journal
// lock or Pay Store entry. It is capture liveness only; AND with Auth's original
// current/expiry and Pay's last-locked merchant/member/Core checks. Frozen
// economic bill identity cannot be changed by confirm or another sample.
func (h *IDEUsageBillProvenance) Current() error {
	if h == nil || h.self != h {
		return ErrDenied
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first != nil {
		return h.first
	}
	if h.parent == nil || h.parent.self != h.parent || h.parent.retired.Load() || h.closed.Load() || h.ctx == nil || !time.Now().Before(h.until) {
		h.first = ErrDenied
		return h.first
	}
	if err := h.ctx.Err(); err != nil {
		h.first = err
		return err
	}
	return nil
}
func (h *IDEUsageBillProvenance) DATA() (IDEUsageBillProvenanceDATA, error) {
	if err := h.Current(); err != nil {
		return IDEUsageBillProvenanceDATA{}, err
	}
	return h.data, nil
}
func (h *IDEUsageBillProvenance) SHA256() (string, error) {
	if err := h.Current(); err != nil {
		return "", err
	}
	return h.digest, nil
}
func (h *IDEUsageBillProvenance) Until() time.Time {
	if h == nil || h.self != h {
		return time.Time{}
	}
	return h.until
}
func (h *IDEUsageBillProvenance) Close() error {
	if h == nil || h.self != h {
		return ErrDenied
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closeDone {
		return h.closeErr
	}
	h.closeDone = true
	h.closeErr = h.first
	h.closed.Store(true)
	return h.closeErr
}
