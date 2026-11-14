package developerauthority

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"io"
	"net/http"
	"sync"
	"time"
)

const DeploymentV2ExecutionSourcePurpose = "cloud-deployment-execution-authority-v2"
const DeploymentV2ExecutionAction = "deployment.execute-existing"

var ErrDeploymentV2OriginalRequestUnavailable = errors.New("original binary deployment HTTP authority not supplied")

func (*DeploymentV2Authority) String() string {
	return "DeploymentV2Authority{original custody redacted}"
}
func (a *DeploymentV2Authority) GoString() string { return a.String() }
func (*DeploymentV2ExecutionPermit) String() string {
	return "DeploymentV2ExecutionPermit{opaque original custody}"
}
func (p *DeploymentV2ExecutionPermit) GoString() string { return p.String() }
func (*DeploymentV2ExecuteApprovalHandoff) String() string {
	return "DeploymentV2ExecuteApprovalHandoff{originals redacted}"
}
func (h *DeploymentV2ExecuteApprovalHandoff) GoString() string { return h.String() }

type DeploymentV2Ref = ynxbatch.DeploymentV2Ref
type DeploymentV2ObjectBinding = ynxbatch.DeploymentV2Bind
type DeploymentV2Manifest = ynxbatch.DeploymentManifestV2

// Public byte inputs only. The owning call snapshots EVERY slice before any
// authentication/Source callback. No producer, Root, key or verifier injection.
type DeploymentV2ExecutionRequest struct {
	RequestID, ExpectedSlotRevision, RollbackTarget                          string
	PayloadOriginal, MemberOriginal, ActualArtifact, ExecuteApprovalOriginal []byte
}
type DeploymentV2ExecutionSelection struct {
	RequestID, Principal, DeviceID, PublisherID, ResourceID, ResourceApprovalRef string
	ExpectedSlotRevision, RollbackTarget, CatalogProjectID                       string
	Manifest                                                                     DeploymentV2Manifest
	ManifestBinding, ContentBinding                                              DeploymentV2ObjectBinding
	RuntimeSeconds                                                               int
	ExpiresAt                                                                    time.Time
	RequiresAdditionalCharge                                                     bool
}

// Only DATA for P04's original durable operation journal, never an execute
// credential. Read authorization reauthenticates the original HTTP caller/ACL.
type DeploymentV2OriginalOperation struct {
	RequestID, Principal, CatalogProjectID, ResourceID, ResourceApprovalRef string
	Project                                                                 DeploymentV2Ref
	ManifestBinding, ContentBinding                                         DeploymentV2ObjectBinding
}
type DeploymentV2PermitPartial struct {
	Phase, FailureCode, SourceOriginalSHA256, CurrentOriginalSHA256 string
	PayloadSHA256, MemberSHA256, ExecuteApprovalSHA256              string
	Ready, Closed                                                   bool
}
type DeploymentV2Authority struct {
	mu               sync.Mutex
	catalog          *Catalog
	source           *OriginalIDEPublicationSourceOwner
	approvalVerifier *OriginalSourceVerifierOwner // owned V2 child; borrowed old service remains untouched
	permits          map[*DeploymentV2ExecutionPermit]bool
	approvals        map[*DeploymentV2ExecuteApprovalHandoff]bool
	closed           bool
	first            error
}

// Opaque and owner-branded; copying a value or JSON cannot mint a permit.
// P04 must retain a NONNIL permit BEFORE interpreting an accompanying error.
type DeploymentV2ExecutionPermit struct {
	owner            *DeploymentV2Authority
	request          *http.Request
	input            DeploymentV2ExecutionRequest
	selection        DeploymentV2ExecutionSelection
	principal        Principal
	access           Access
	record           *originalIDESourceRecord
	sourceProjection originalIDEProjection
	scope            originalDeploymentV2ExecutionScope
	approval         *DeploymentV2ExecuteApprovalHandoff
	partial          DeploymentV2PermitPartial
	ready, closed    bool
	first            error
	started          time.Time
	expires          int64
}

func (p *DeploymentV2ExecutionPermit) Selection() DeploymentV2ExecutionSelection {
	if p == nil || p.owner == nil {
		return DeploymentV2ExecutionSelection{}
	}
	p.owner.mu.Lock()
	defer p.owner.mu.Unlock()
	if !p.owner.permits[p] || !p.ready || p.closed {
		return DeploymentV2ExecutionSelection{}
	}
	return p.selection
}
func (p *DeploymentV2ExecutionPermit) Recheck(ctx context.Context) error {
	if p == nil || p.owner == nil {
		return ErrDenied
	}
	return p.owner.RecheckExecutionV2(ctx, p.request, p)
}

// Reader borrows this SAME immutable actual-byte capture. It never opens a
// file, repeats an upload, changes a slot or grants permission by itself.
func (p *DeploymentV2ExecutionPermit) BorrowArtifactOriginal(ctx context.Context) (io.Reader, error) {
	if p == nil || p.owner == nil {
		return nil, ErrDenied
	}
	return p.owner.borrowArtifact(ctx, p)
}
func (p *DeploymentV2ExecutionPermit) Status() DeploymentV2PermitPartial {
	if p == nil || p.owner == nil {
		return DeploymentV2PermitPartial{FailureCode: "DENIED"}
	}
	p.owner.mu.Lock()
	defer p.owner.mu.Unlock()
	if !p.owner.permits[p] {
		return DeploymentV2PermitPartial{FailureCode: "DENIED"}
	}
	return p.partial
}
func (p *DeploymentV2ExecutionPermit) Close() error {
	if p == nil || p.owner == nil {
		return ErrDenied
	}
	p.owner.mu.Lock()
	defer p.owner.mu.Unlock()
	if !p.owner.permits[p] {
		return ErrDenied
	}
	if !p.closed {
		p.closed = true
		p.ready = false
		p.partial.Closed = true
		p.partial.Ready = false
	}
	return p.first
}
