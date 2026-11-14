package developerauthority

import (
	"bytes"
	"context"
	"net/http"
)

type DeploymentV2HandoffObservation struct {
	Phase, ScopeSHA256, MemberSHA256, EnvelopeSHA256 string
	OriginalPublicPartial                            []byte
	DataOnly                                         bool
	Authorized                                       bool
}

// Original reconciliation only: no random nonce, approval selection, issuer,
// key loan, execution permit, operation journal or resource reservation. An
// entered row remains UNKNOWN; observing it NEVER clears or re-arms it.
func (a *DeploymentV2Authority) ObserveOriginalDeploymentV2Handoff(ctx context.Context, r *http.Request, op DeploymentV2OriginalOperation) (DeploymentV2HandoffObservation, error) {
	var out DeploymentV2HandoffObservation
	if e := a.AuthorizeDeploymentV2Read(ctx, r, op); e != nil {
		return out, e
	}
	a.mu.Lock()
	if a.closed || a.first != nil {
		a.mu.Unlock()
		return out, ErrDenied
	}
	t := a.source.config.Templates["deployment-v2"]
	e := a.source.db.QueryRowContext(ctx, `SELECT phase,scope_sha256,member_sha256,COALESCE(original,''::bytea),COALESCE(original_sha256,'') FROM public.auth_ide_deployment_v2_handoffs WHERE source_id=$1 AND instance_id=$2 AND request_id=$3`, t.SourceID, t.InstanceID, op.RequestID).Scan(&out.Phase, &out.ScopeSHA256, &out.MemberSHA256, &out.OriginalPublicPartial, &out.EnvelopeSHA256)
	a.mu.Unlock()
	if e != nil {
		return DeploymentV2HandoffObservation{}, e
	}
	if out.Phase != "entered" && out.Phase != "terminal" || len(out.OriginalPublicPartial) > 393216 || len(out.OriginalPublicPartial) > 0 && hash(out.OriginalPublicPartial) != out.EnvelopeSHA256 {
		return DeploymentV2HandoffObservation{}, ErrUnknown
	}
	if e = a.AuthorizeDeploymentV2Read(ctx, r, op); e != nil {
		return DeploymentV2HandoffObservation{}, e
	}
	out.OriginalPublicPartial = bytes.Clone(out.OriginalPublicPartial)
	out.DataOnly = true
	out.Authorized = false
	return out, nil
}
