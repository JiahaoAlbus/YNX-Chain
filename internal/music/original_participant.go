//go:build ynx_canonical_media && ynx_media_combined_authority

package music

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"reflect"
)

// PrepareOriginalMusicParticipant consumes the already verified original
// grant and the fixed producer's mapped participant. It creates no mapper,
// reservation, reader, Session, operation ID, grant or terminal receipt.
// Returned metadata must be installed on that SAME original scoped grant.
// Use this transaction ONLY for FIRST local admission; subsequent original
// phases need fresh coordinator captures under the same authority topology.
func PrepareOriginalMusicParticipant(g MusicBusinessGrant, p *productsessionv2.OriginalEffectParticipant) (MusicLocalTransaction, MusicOriginalOperationMetadata, error) {
	if p == nil || g.Current == nil || g.Revalidate == nil {
		return nil, MusicOriginalOperationMetadata{}, ErrMusicAuthorityUnavailable
	}
	op, err := p.OriginalOperation()
	if err != nil {
		return nil, MusicOriginalOperationMetadata{}, err
	}
	scope := false
	for _, s := range op.Session.Scopes {
		if s == g.Scope {
			scope = true
		}
	}
	if op.Session.ProductID != "music" || !scope || g.Actor != op.Session.Account || g.ProductID != op.Session.ProductID || g.SessionBinding != op.Session.SessionBinding || g.Nonce != op.Action.Nonce || g.BodyDigest != op.Action.BodyDigest || g.BodyDigest != op.ActionBodyDigest || g.BodyDigest != op.WireDigest || !g.ExpiresAt.Equal(op.Action.ExpiresAt) {
		return nil, MusicOriginalOperationMetadata{}, ErrUnauthorized
	}
	metadata := MusicOriginalOperationMetadata{OperationID: op.NodeOperationID, OwnedOperationID: op.ID, SessionBinding: op.Session.SessionBinding, NodeRequestDigest: op.NodeRequestDigest, ActionBodyDigest: op.ActionBodyDigest, Method: op.Method, Path: op.Path}
	if !validMusicOperation(metadata) || metadata.OwnedOperationID == "" || g.Operation != nil && *g.Operation != metadata {
		return nil, MusicOriginalOperationMetadata{}, ErrUnauthorized
	}
	return &originalMusicParticipantTransaction{participant: p, original: op}, metadata, nil
}

type originalMusicParticipantTransaction struct {
	participant *productsessionv2.OriginalEffectParticipant
	original    productsessionv2.OriginalEffectOperation
}

func (t *originalMusicParticipantTransaction) Execute(ctx context.Context, commit func(context.Context) error) error {
	if t == nil || t.participant == nil || commit == nil || ctx == nil || ctx.Err() != nil {
		return ErrMusicAuthorityUnavailable
	}
	entered := false
	var originalErr error
	_, err := t.participant.Execute(ctx, func(local context.Context, op productsessionv2.OriginalEffectOperation) error {
		if entered || !reflect.DeepEqual(op, t.original) {
			return ErrUnauthorized
		}
		entered = true
		originalErr = commit(local)
		return originalErr
	})
	// Existing Node UNKNOWN returns readback-only with no commit. It must not
	// become a successful product write or release a fake terminal result here.
	if !entered && err == nil {
		return ErrMusicAuthorityUnavailable
	}
	return errors.Join(err, originalErr)
}
