//go:build cloud_auth_v2

package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// This composition requires the original Auth V2 implementation and matching
// Core. The default build cannot replace it with callbacks or legacy permits.
type AuthIDEDeploymentV2Authority struct {
	original *developerauthority.DeploymentV2Authority
	catalog  *developerauthority.Catalog
	source   *developerauthority.OriginalIDEPublicationSourceOwner
}

func (a *AuthIDEDeploymentV2Authority) Close() error {
	if a == nil || a.original == nil {
		return nil
	}
	return a.original.Close()
}

func isIDEDeploymentV2RequestUnavailable(err error) bool {
	return errors.Is(err, developerauthority.ErrDeploymentV2OriginalRequestUnavailable)
}

func OpenAuthIDEDeploymentV2Authority(ctx context.Context, catalog *developerauthority.Catalog, source developerauthority.OriginalSource) (IDEDeploymentV2Authority, error) {
	original, err := developerauthority.OpenOriginalDeploymentV2Authority(ctx, catalog)
	if original == nil {
		return nil, err
	}
	// Keep even the nonnil errored opening partial under the existing server
	// lifecycle. Opening does not create an execution permit or new Source.
	concrete, _ := source.(*developerauthority.OriginalIDEPublicationSourceOwner)
	return &AuthIDEDeploymentV2Authority{original: original, catalog: catalog, source: concrete}, err
}

func (a *AuthIDEDeploymentV2Authority) BorrowOriginalBodyV5(ctx context.Context, r *http.Request) (io.ReadCloser, error) {
	return borrowAuthIDEDeploymentV2Body(ctx, a, r)
}

type authIDEDeploymentV2Permit struct {
	permit   *developerauthority.DeploymentV2ExecutionPermit
	approval *developerauthority.DeploymentV2ExecuteApprovalHandoff
	once     sync.Once
	closeErr error
}

func (a *AuthIDEDeploymentV2Authority) AuthorizeV2(ctx context.Context, r *http.Request, principal string, in IDEDeploymentV2Request) (IDEDeploymentV2Permit, error) {
	if a == nil || a.original == nil || in.Artifact == nil {
		return nil, ErrDenied
	}
	body, err := io.ReadAll(io.LimitReader(in.Artifact.OpenContent(), MaxMultipartBytes+1))
	if err != nil || int64(len(body)) > MaxMultipartBytes {
		return nil, ErrDenied
	}
	request := developerauthority.DeploymentV2ExecutionRequest{RequestID: in.RequestID, ExpectedSlotRevision: in.ExpectedSlotRevision, RollbackTarget: in.RollbackTarget, PayloadOriginal: in.Artifact.ManifestBytes(), MemberOriginal: in.MemberOriginal, ActualArtifact: body}
	approval, err := a.original.AcquireOriginalDeploymentV2ExecuteApproval(ctx, r, request)
	var owner *authIDEDeploymentV2Permit
	if approval != nil {
		owner = &authIDEDeploymentV2Permit{approval: approval}
	}
	if err != nil || approval == nil {
		return owner, errors.Join(err, ErrDenied)
	}
	request.ExecuteApprovalOriginal = approval.Original()
	if len(request.ExecuteApprovalOriginal) == 0 {
		return owner, ErrDenied
	}
	permit, err := a.original.AuthorizeExecutionV2(ctx, r, request)
	owner.permit = permit // Retain the actual opaque partial BEFORE status.
	if err != nil || permit == nil {
		return owner, errors.Join(err, ErrDenied)
	}
	if permit.Selection().Principal != principal {
		return owner, ErrDenied
	}
	return owner, nil
}

func authIDEV2Binding(b developerauthority.DeploymentV2ObjectBinding) (ObjectBinding, error) {
	n, err := strconv.ParseInt(b.Bytes, 10, 64)
	if err != nil || n < 0 || strconv.FormatInt(n, 10) != b.Bytes {
		return ObjectBinding{}, ErrInvalid
	}
	return ObjectBinding{Bytes: n, SHA3512: b.SHA3_512, SHA512: b.SHA512}, nil
}
func (p *authIDEDeploymentV2Permit) Selection() IDEDeploymentV2Grant {
	if p == nil || p.permit == nil {
		return IDEDeploymentV2Grant{}
	}
	s := p.permit.Selection()
	binding, err := authIDEV2Binding(s.ManifestBinding)
	if err != nil {
		return IDEDeploymentV2Grant{}
	}
	content, err := authIDEV2Binding(s.ContentBinding)
	if err != nil {
		return IDEDeploymentV2Grant{}
	}
	// DTO translation only. Sole Core/Auth have already decoded/verified E11;
	// preserve every fullRef and independent epoch, including env's JSON name.
	raw, err := json.Marshal(s.Manifest)
	if err != nil {
		return IDEDeploymentV2Grant{}
	}
	var manifest IDEDeploymentV2Manifest
	if json.Unmarshal(raw, &manifest) != nil {
		return IDEDeploymentV2Grant{}
	}
	return IDEDeploymentV2Grant{RequestID: s.RequestID, Principal: s.Principal, PublisherID: s.PublisherID, ResourceID: s.ResourceID, ResourceApprovalRef: s.ResourceApprovalRef, CatalogProjectID: s.CatalogProjectID, ExpectedSlotRevision: s.ExpectedSlotRevision, RollbackTarget: s.RollbackTarget, Manifest: manifest, ManifestBinding: binding, ContentBinding: content, RuntimeSeconds: s.RuntimeSeconds, ExpiresAt: s.ExpiresAt, RequiresAdditionalCharge: s.RequiresAdditionalCharge}
}
func (p *authIDEDeploymentV2Permit) Recheck(ctx context.Context) error {
	if p == nil || p.permit == nil {
		return ErrDenied
	}
	return p.permit.Recheck(ctx)
}
func (p *authIDEDeploymentV2Permit) BorrowArtifactOriginal(ctx context.Context) (io.Reader, error) {
	if p == nil || p.permit == nil {
		return nil, ErrDenied
	}
	return p.permit.BorrowArtifactOriginal(ctx)
}
func (p *authIDEDeploymentV2Permit) Close() error {
	if p == nil {
		return ErrDenied
	}
	p.once.Do(func() {
		if p.permit != nil {
			p.closeErr = p.permit.Close()
		}
		if p.approval != nil {
			p.closeErr = errors.Join(p.closeErr, p.approval.Close())
		}
	})
	return p.closeErr
}

func (a *AuthIDEDeploymentV2Authority) AuthorizeV2Read(ctx context.Context, r *http.Request, op IDEDeploymentOperation) error {
	if a == nil || a.catalog == nil || a.original == nil || !validIDEOperationVersion(op) || op.ManifestVersion != "2" {
		return ErrDenied
	}
	principal, err := a.catalog.Principal(ctx, r)
	if err != nil {
		return err
	}
	ref := op.ManifestV2.Project
	return a.original.AuthorizeDeploymentV2Read(ctx, r, developerauthority.DeploymentV2OriginalOperation{RequestID: op.RequestID, Principal: principal.Account, CatalogProjectID: op.CatalogProjectID, ResourceID: op.ResourceID, ResourceApprovalRef: op.ResourceApprovalRef, Project: developerauthority.DeploymentV2Ref{Realm: ref.Realm, Tenant: ref.Tenant, Kind: ref.Kind, ID: ref.ID, Rev: ref.Rev}, ManifestBinding: developerauthority.DeploymentV2ObjectBinding{Bytes: strconv.FormatInt(op.ManifestBinding.Bytes, 10), SHA3_512: op.ManifestBinding.SHA3512, SHA512: op.ManifestBinding.SHA512}, ContentBinding: developerauthority.DeploymentV2ObjectBinding{Bytes: strconv.FormatInt(op.ContentBinding.Bytes, 10), SHA3_512: op.ContentBinding.SHA3512, SHA512: op.ContentBinding.SHA512}})
}
func (a *AuthIDEDeploymentV2Authority) AssertProjectRuntimeOrigin(ctx context.Context, origin string) error {
	if a == nil || a.catalog == nil {
		return ErrDenied
	}
	return a.catalog.AssertProjectRuntimeOrigin(ctx, origin)
}
func (a *AuthIDEDeploymentV2Authority) AuthorizeProjectRuntime(ctx context.Context, r *http.Request, op IDEDeploymentOperation, origin string) error {
	if op.State != "running" || op.RuntimeKind != "node-http-project" || a.AuthorizeV2Read(ctx, r, op) != nil {
		return ErrDenied
	}
	access, err := a.catalog.AuthorizeProjectRuntime(ctx, r, op.CatalogProjectID, origin)
	if err != nil {
		return err
	}
	if !access.Runtime || access.RuntimeOrigin != origin {
		return ErrDenied
	}
	if err = a.catalog.RecheckProject(ctx, r, access); err != nil {
		return err
	}
	return a.AuthorizeV2Read(ctx, r, op)
}
