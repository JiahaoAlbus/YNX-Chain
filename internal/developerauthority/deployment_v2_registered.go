package developerauthority

import (
	"bytes"
	"context"
	"encoding/json"
)

// Original registered-current records are independently read, never obtained
// from Member fields/local IDs or admitted by a JSON boolean. Root-selected
// signed Source binds exact original bytes/fullRef/current-reference together.
// Normal Root ledger custodian supplies these rows; this module writes none.
const deploymentV2RegisteredCurrentRead = `SELECT original,sha256 FROM public.auth_ide_deployment_v2_registered_currents WHERE source_id=$1 AND instance_id=$2 AND kind=$3 AND full_ref_sha256=$4 AND current_reference=$5`

func (o *OriginalIDEPublicationSourceOwner) deploymentRegisteredCurrents(ctx context.Context, s originalDeploymentV2ExecutionScope) error {
	for _, item := range []struct{ kind, raw string }{{"publisher", s.PublisherOriginal}, {"issuer", s.IssuerOriginal}, {"project", s.ProjectOriginal}, {"resource", s.ResourceOriginal}} {
		var record struct {
			Ref     DeploymentV2Ref `json:"ref"`
			Current string          `json:"ledgerCurrentRef"`
		}
		if json.Unmarshal([]byte(item.raw), &record) != nil || record.Current == "" {
			return ErrDenied
		}
		ref, e := originalIDEJSON(record.Ref)
		if e != nil {
			return e
		}
		var raw []byte
		var digest string
		if e = o.db.QueryRowContext(ctx, deploymentV2RegisteredCurrentRead, o.config.SourceID, o.config.InstanceID, item.kind, hash(ref), record.Current).Scan(&raw, &digest); e != nil || hash(raw) != digest || !bytes.Equal(raw, []byte(item.raw)) {
			return ErrDenied
		}
	}
	return nil
}
