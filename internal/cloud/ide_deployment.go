package cloud

import (
	"bytes"
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"time"
)

// Original Auth adapters implement this interface, not request JSON. Approval
// and manifest bytes remain opaque here: no signing domain or publisher public
// key is reconstructed from artifact-supplied fields. All methods must use the
// original authenticated account and current project/deploy ACL.
type IDEDeploymentAuthority interface {
	AssertCurrent(context.Context) error
	Principal(context.Context, *http.Request) (string, error)
	Authorize(context.Context, *http.Request, string, []byte, []byte) (IDEDeploymentPermit, error)
	Recheck(context.Context, *http.Request, IDEDeploymentPermit) error
	AuthorizeRead(context.Context, *http.Request, IDEDeploymentOperation) error
}

type IDEDeploymentPermit struct {
	originalAuthPermit                            *developerauthority.PublicationPermit
	RuntimeSeconds                                int
	ResourceApprovalRef                           string
	ApprovalSHA256                                string
	RequestID, Principal, PublisherID, ResourceID string
	ManifestSHA256                                string
	Binding                                       IDEArtifactBinding
	ExpiresAt                                     time.Time
	RequiresAdditionalCharge                      bool
}

// This is the existing-resource deployment boundary, not a lease/provision or
// payment API. ApplyExisting must invoke current at its final effect fence and
// use the supplied snapshot stream, never reopen a caller-controlled file.
// ObserveOriginal and Logs are read-only: they must never resubmit a deployment.
type IDEDeploymentExecutor interface {
	ApplyExisting(context.Context, IDEDeploymentPermit, io.Reader, func() error) (IDEDeploymentResult, error)
	ObserveOriginal(context.Context, IDEDeploymentOperation) (IDEDeploymentResult, error)
	Logs(context.Context, IDEDeploymentOperation, int64) ([]byte, error)
}

type IDEDeploymentResult struct {
	RuntimeKind                                            string
	ExitCode                                               *int
	RequestID, ResourceID, State, DeploymentID, RuntimeURL string
	Binding                                                IDEArtifactBinding
}

type ideDeploymentService struct {
	authority IDEDeploymentAuthority
	executor  IDEDeploymentExecutor
	journal   *ideDeploymentJournal
	now       func() time.Time
}

// Called by the original server constructor only after genuine dependencies
// exist. No environment flag, local fixture or self-reported key enables it.
func (s *Server) EnableIDEDeployments(authority IDEDeploymentAuthority, executor IDEDeploymentExecutor) error {
	if authority == nil || executor == nil || s.ideDeployments != nil {
		return ErrInvalid
	}
	if err := authority.AssertCurrent(context.Background()); err != nil {
		return err
	}
	if runtime, ok := executor.(IDEProjectRuntimeExecutor); ok && runtime.ProjectRuntimeOrigin() != "" {
		registered, ok := authority.(IDEProjectRuntimeAuthority)
		if !ok {
			return ErrInvalid
		}
		if err := registered.AssertProjectRuntimeOrigin(context.Background(), runtime.ProjectRuntimeOrigin()); err != nil {
			return err
		}
	}
	j, err := newIDEDeploymentJournal(filepath.Clean(s.service.cfg.StatePath) + ".ide-deployments")
	if err != nil {
		return err
	}
	s.ideDeployments = &ideDeploymentService{authority: authority, executor: executor, journal: j, now: s.service.cfg.Now}
	return nil
}

func (s *Server) mountIDEDeployments(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/ide/deployments", s.ideDeploymentSubmit)
	mux.HandleFunc("GET /api/v1/ide/deployments/{request}", s.ideDeploymentRead)
	mux.HandleFunc("GET /api/v1/ide/deployments/{request}/logs", s.ideDeploymentRead)
	mux.HandleFunc("GET /api/v1/ide/deployments/{request}/runtime", s.ideDeploymentRead)
}

func (s *Server) ideDeploymentCaller(w http.ResponseWriter, r *http.Request) (*ideDeploymentService, string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	d := s.ideDeployments
	if d == nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_AUTHORITY_UNAVAILABLE")
		return nil, "", false
	}
	if r.Context().Err() != nil || d.authority.AssertCurrent(r.Context()) != nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_CURRENT_UNAVAILABLE")
		return nil, "", false
	}
	principal, err := d.authority.Principal(r.Context(), r)
	if err != nil || principal == "" {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_CALLER_DENIED")
		return nil, "", false
	}
	return d, principal, true
}

func (s *Server) ideDeploymentSubmit(w http.ResponseWriter, r *http.Request) {
	d, principal, ok := s.ideDeploymentCaller(w, r)
	if !ok {
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	if len(keys) != 1 || !productWriteKey.MatchString(keys[0]) {
		productReadFailure(w, 400, "IDEMPOTENCY_KEY_REQUIRED")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxMultipartBytes+developerauthority.PublicationEnvelopeLimit+(128<<10))
	multipart, err := r.MultipartReader()
	if err != nil {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_MULTIPART_REQUIRED")
		return
	}
	// Exact order avoids buffered temporary uploads and ambiguous duplicate fields.
	readPart := func(name string, limit int64) ([]byte, error) {
		part, err := multipart.NextPart()
		if err != nil {
			return nil, err
		}
		if part.FormName() != name {
			return nil, ErrInvalid
		}
		body, err := readIDEArtifactBounded(r.Context(), part, limit)
		if err != nil {
			return nil, err
		}
		if err = part.Close(); err != nil {
			return nil, err
		}
		return body, nil
	}
	manifest, err := readPart("manifest", 16<<10)
	if err != nil {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_MANIFEST_REJECTED")
		return
	}
	approval, err := readPart("approval", developerauthority.PublicationEnvelopeLimit)
	if err != nil || len(approval) == 0 {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_APPROVAL_REQUIRED")
		return
	}
	permit, err := d.authority.Authorize(r.Context(), r, principal, manifest, approval)
	if err != nil || permit.Principal != principal || permit.RequestID != keys[0] || permit.PublisherID == "" || permit.ResourceID == "" || permit.ManifestSHA256 != productHash(manifest) || !permit.ExpiresAt.After(d.now()) {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_APPROVAL_DENIED")
		return
	}
	if permit.RequiresAdditionalCharge {
		productReadFailure(w, 403, "IDE_RESOURCE_CHARGE_APPROVAL_REQUIRED")
		return
	}
	if permit.RuntimeSeconds < 6 || permit.RuntimeSeconds > 300 || permit.ResourceApprovalRef == "" {
		productReadFailure(w, 403, "IDE_RESOURCE_APPROVAL_REQUIRED")
		return
	}
	permit.ApprovalSHA256 = productHash(approval)
	part, err := multipart.NextPart()
	if err != nil || part.FormName() != "artifact" {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_ARTIFACT_REQUIRED")
		return
	}
	artifact, err := ReadIDEDeploymentArtifact(r.Context(), bytes.NewReader(manifest), part, permit.Binding, MaxMultipartBytes)
	if err != nil {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_ARTIFACT_REJECTED")
		return
	}
	if err = part.Close(); err != nil {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_ARTIFACT_REJECTED")
		return
	}
	if _, err = multipart.NextPart(); err != io.EOF {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_EXTRA_PART")
		return
	}
	current := func() error {
		if err := r.Context().Err(); err != nil {
			return err
		}
		if !permit.ExpiresAt.After(d.now()) {
			return ErrDenied
		}
		if err := d.authority.AssertCurrent(r.Context()); err != nil {
			return err
		}
		return d.authority.Recheck(r.Context(), r, permit)
	}
	if current() != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_PERMISSION_CHANGED")
		return
	}
	op, claim, err := d.journal.begin(principal, IDEDeploymentOperation{RequestID: permit.RequestID, Binding: artifact.Binding(), ManifestSHA256: productHash(manifest), ApprovalSHA256: productHash(approval), PublisherID: permit.PublisherID, ResourceID: permit.ResourceID, RuntimeSeconds: permit.RuntimeSeconds, ResourceApprovalRef: permit.ResourceApprovalRef, CreatedAt: d.now()})
	if errors.Is(err, ErrIDEDeploymentConflict) {
		productReadFailure(w, 409, "IDEMPOTENCY_KEY_CONFLICT")
		return
	}
	if err != nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_JOURNAL_UNAVAILABLE")
		return
	}
	if claim && current() == nil {
		result, executeErr := d.executor.ApplyExisting(r.Context(), permit, artifact.OpenContent(), current)
		if executeErr == nil && r.Context().Err() == nil {
			op = d.acceptResult(principal, op, result, current)
		}
	}
	status := http.StatusAccepted
	if op.State == "running" {
		status = http.StatusCreated
	}
	if op.State == "completed" {
		status = http.StatusOK
	}
	if op.State == "failed" {
		status = http.StatusConflict
	}
	writeJSON(w, status, op)
}

func (d *ideDeploymentService) acceptResult(principal string, op IDEDeploymentOperation, result IDEDeploymentResult, current func() error) IDEDeploymentOperation {
	if result.RequestID != op.RequestID || result.ResourceID != op.ResourceID || result.Binding != op.Binding || (result.State != "running" && result.State != "completed" && result.State != "failed") {
		return op
	}
	if result.State == "completed" && (result.ExitCode == nil || *result.ExitCode != 0) {
		return op
	}
	if result.State == "running" || result.State == "completed" {
		u, err := url.Parse(result.RuntimeURL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || result.DeploymentID == "" {
			return op
		}
	}
	observed := op
	observed.State = result.State
	observed.RuntimeKind = result.RuntimeKind
	observed.ExitCode = result.ExitCode
	observed.DeploymentID = result.DeploymentID
	observed.RuntimeURL = result.RuntimeURL
	observed.UpdatedAt = d.now()
	if d.journal.recordTerminal(principal, observed, current) != nil {
		return op
	}
	stored, err := d.journal.lookup(principal, op.RequestID)
	if err != nil {
		return op
	}
	return stored
}

func (s *Server) ideDeploymentRead(w http.ResponseWriter, r *http.Request) {
	d, principal, ok := s.ideDeploymentCaller(w, r)
	if !ok {
		return
	}
	id := r.PathValue("request")
	if !productWriteKey.MatchString(id) {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_REQUEST_INVALID")
		return
	}
	op, err := d.journal.lookup(principal, id)
	if errors.Is(err, ErrNotFound) {
		productReadFailure(w, 404, "IDE_DEPLOYMENT_NOT_FOUND")
		return
	}
	if err != nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_JOURNAL_UNAVAILABLE")
		return
	}
	current := func() error {
		if err := r.Context().Err(); err != nil {
			return err
		}
		if err := d.authority.AssertCurrent(r.Context()); err != nil {
			return err
		}
		return d.authority.AuthorizeRead(r.Context(), r, op)
	}
	if current() != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_READ_DENIED")
		return
	}
	if r.Pattern == "GET /api/v1/ide/deployments/{request}/logs" {
		logs, err := d.executor.Logs(r.Context(), op, 64<<10)
		if err != nil || len(logs) > 64<<10 {
			productReadFailure(w, 503, "IDE_DEPLOYMENT_LOGS_UNAVAILABLE")
			return
		}
		if current() != nil {
			productReadFailure(w, 403, "IDE_DEPLOYMENT_READ_DENIED")
			return
		}
		writeJSON(w, 200, map[string]any{"requestId": id, "operationLogs": op.Logs, "runtimeLogs": string(logs), "runtimeLogSource": "original-resource"})
		return
	}
	if op.State == "unknown" || op.State == "running" {
		result, err := d.executor.ObserveOriginal(r.Context(), op)
		if err == nil {
			op = d.acceptResult(principal, op, result, current)
		}
	}
	if current() != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_READ_DENIED")
		return
	}
	writeJSON(w, 200, op)
}
