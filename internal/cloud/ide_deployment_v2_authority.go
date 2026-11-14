package cloud

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
	"io"
	"net/http"
	"time"
)

// Product port only. The original Auth adapter must independently verify the
// E11 Member and current Source before returning its opaque permit. No request
// JSON, signer result flag or legacy PublicationPermit implements this port.
type IDEDeploymentV2Authority interface {
	AuthorizeV2(context.Context, *http.Request, string, IDEDeploymentV2Request) (IDEDeploymentV2Permit, error)
	AuthorizeV2Read(context.Context, *http.Request, IDEDeploymentOperation) error
}

// Body custody comes from the SAME authenticated request and concrete Source.
// It is separate from execution approval; a byte slice/JSON cannot mint it.
type IDEDeploymentV2BodyAuthority interface {
	BorrowOriginalBodyV5(context.Context, *http.Request) (io.ReadCloser, error)
}

type IDEDeploymentV2Request struct {
	Artifact                                        *IDEDeploymentV2Artifact
	MemberOriginal                                  []byte
	RequestID, ExpectedSlotRevision, RollbackTarget string
}

// Selection is an observation of an Auth-owned permit, not the permit itself.
// Cloud compares all values to the immutable actual-byte capture. The adapter
// retains its original Source/permit and enforces it again at every effect.
type IDEDeploymentV2Grant struct {
	CatalogProjectID                                                   string
	RequestID, Principal, PublisherID, ResourceID, ResourceApprovalRef string
	ExpectedSlotRevision, RollbackTarget                               string
	Manifest                                                           IDEDeploymentV2Manifest
	ManifestBinding, ContentBinding                                    ObjectBinding
	RuntimeSeconds                                                     int
	ExpiresAt                                                          time.Time
	RequiresAdditionalCharge                                           bool
}
type IDEDeploymentV2Permit interface {
	Selection() IDEDeploymentV2Grant
	Recheck(context.Context) error
	BorrowArtifactOriginal(context.Context) (io.Reader, error)
	Close() error
}

// Invoked by the original startup with its same concrete Catalog. A nonnil
// opening partial is owned before its status is interpreted. An unavailable
// V2 Source leaves that effect gated and does not replace the original runtime.
func (s *Server) AttachAuthIDEDeploymentV2(ctx context.Context, catalog *developerauthority.Catalog, source developerauthority.OriginalSource) error {
	if s.ideDeployments == nil || s.ideDeployments.v2Authority != nil || s.ideDeployments.v2OpeningPartial != nil {
		return ErrInvalid
	}
	original, err := OpenAuthIDEDeploymentV2Authority(ctx, catalog, source)
	s.ideDeployments.v2OpeningPartial = original
	if err != nil || original == nil {
		return ErrDenied
	}
	return s.EnableIDEDeploymentV2Authority(original)
}

// The original runtime owner closes the V2-owned pinner/children before its
// borrowed Catalog/Source parent. Preserve the original first close result;
// failure does not silently drop the retained opening partial or retry IO.
func (s *Server) CloseIDEDeploymentV2Authority() error {
	if s == nil || s.ideDeployments == nil {
		return nil
	}
	d := s.ideDeployments
	d.v2CloseOnce.Do(func() {
		owned := d.v2OpeningPartial
		if owned == nil {
			owned = d.v2Authority
		}
		if closer, ok := owned.(io.Closer); ok {
			d.v2CloseErr = closer.Close()
		}
	})
	return d.v2CloseErr
}

func (s *Server) EnableIDEDeploymentV2Authority(authority IDEDeploymentV2Authority) error {
	if s.ideDeployments == nil || s.ideDeployments.v2Authority != nil || authority == nil {
		return ErrInvalid
	}
	if _, ok := s.ideDeployments.executor.(IDEDeploymentV2Executor); !ok {
		return ErrIDEExistingRuntimeUnavailable
	}
	if runtime, ok := s.ideDeployments.executor.(IDEProjectRuntimeExecutor); ok && runtime.ProjectRuntimeOrigin() != "" {
		registered, ok := authority.(IDEProjectRuntimeAuthority)
		if !ok {
			return ErrDenied
		}
		if err := registered.AssertProjectRuntimeOrigin(context.Background(), runtime.ProjectRuntimeOrigin()); err != nil {
			return err
		}
	}
	s.ideDeployments.v2Authority = authority
	return nil
}

func (d *ideDeploymentService) authorizeOperationRead(ctx context.Context, r *http.Request, op IDEDeploymentOperation) error {
	if op.ManifestVersion == "2" {
		if d.v2Authority == nil {
			return ErrDenied
		}
		return d.v2Authority.AuthorizeV2Read(ctx, r, op)
	}
	return d.authority.AuthorizeRead(ctx, r, op)
}
