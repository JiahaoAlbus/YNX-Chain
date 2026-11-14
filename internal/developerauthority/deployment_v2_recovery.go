package developerauthority

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"time"
)

const DeploymentV2RecoverySourcePurpose = "cloud-deployment-recovery-authority-v2"

func (a *DeploymentV2Authority) recoverySource(ctx context.Context, p Principal, op DeploymentV2OriginalOperation) (string, error) {
	key, _ := originalIDEJSON(map[string]any{"principalSHA256": objectHash(p), "requestId": op.RequestID, "project": op.Project, "resourceId": op.ResourceID, "resourceApprovalRef": op.ResourceApprovalRef, "payloadBinding": op.ManifestBinding, "contentBinding": op.ContentBinding})
	o := a.source
	o.mu.Lock()
	defer o.mu.Unlock()
	r, e := o.record(ctx, "deployment-v2-read", p.Account, hash(key))
	if e != nil {
		return "", e
	}
	if e = o.current(ctx, r); e != nil {
		return "", e
	}
	var selection struct {
		Scope json.RawMessage `json:"cloudDeploymentRecoveryV2"`
	}
	if json.Unmarshal(r.projection.Selection, &selection) != nil {
		return "", ErrDenied
	}
	var s struct {
		Version             string                    `json:"version"`
		Purpose             string                    `json:"purpose"`
		RequestID           string                    `json:"requestId"`
		Principal           string                    `json:"principalSHA256"`
		Payload             string                    `json:"payloadOriginal"`
		Binding             DeploymentV2ObjectBinding `json:"payloadBinding"`
		CatalogProjectID    string                    `json:"catalogProjectId"`
		ProjectCurrentRef   string                    `json:"projectCurrentRef"`
		ResourceID          string                    `json:"resourceId"`
		ResourceApprovalRef string                    `json:"resourceApprovalRef"`
		Account             string                    `json:"account"`
		Issued              int64                     `json:"issuedAtMs"`
		Expires             int64                     `json:"expiresAtMs"`
	}
	if !deploymentV2Canonical(selection.Scope, &s) || s.Version != "ynx-cloud-deployment-recovery-source/v2" || s.Purpose != DeploymentV2RecoverySourcePurpose || s.RequestID != op.RequestID || s.Principal != objectHash(p) || s.Account != p.Account || s.CatalogProjectID != op.CatalogProjectID || s.ResourceID != op.ResourceID || s.ResourceApprovalRef != op.ResourceApprovalRef || s.Binding != op.ManifestBinding {
		return "", ErrDenied
	}
	payload, e := base64.RawURLEncoding.DecodeString(s.Payload)
	if e != nil || base64.RawURLEncoding.EncodeToString(payload) != s.Payload {
		return "", ErrDenied
	}
	m, e := ynxbatch.DecodeDeploymentManifestV2DATA(payload, &op.ManifestBinding)
	if e != nil || m.Project != op.Project || m.Artifact.Content != op.ContentBinding || s.ProjectCurrentRef == "" || time.Now().UnixMilli() < s.Issued || time.Now().UnixMilli() >= min(s.Expires, r.projection.Expires, p.ExpiresMS) {
		return "", ErrDenied
	}
	return s.ProjectCurrentRef, nil
}
