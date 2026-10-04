//go:build ynx_canonical_media && ynx_media_combined_authority

package music

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"sync/atomic"
)

// PrepareOriginalMusicBoundedGrant installs a fixed first/follow factory on
// the SAME already verified original grant. No registration, preparation,
// mapper, Node ACK, provider outcome or public permission is synthesized.
// Publication must come from actual original durable preparation; its getter
// and actual Node transport run outside the gate and ORIGINAL Store lock.
func PrepareOriginalMusicBoundedGrant(g MusicBusinessGrant, p *productsessionv2.OriginalEffectParticipant, reservation *productsessionv2.OriginalBoundedPhaseReservation, publication productsessionv2.OriginalPreparedPublicationPort) (MusicBusinessGrant, error) {
	_, metadata, err := PrepareOriginalMusicParticipant(g, p)
	if err != nil {
		return MusicBusinessGrant{}, err
	}
	phases, err := productsessionv2.NewOriginalBoundedPhases(p, reservation, publication)
	if err != nil {
		return MusicBusinessGrant{}, errors.Join(ErrMusicAuthorityUnavailable, err)
	}
	factory := &originalMusicBoundedGrantFactory{phases: phases}
	originalCurrent := g.Current
	g.Current = func(ctx context.Context) error {
		if factory.invalid.Load() {
			return ErrMusicAuthorityUnavailable
		}
		if err := originalCurrent(ctx); err != nil {
			factory.invalid.Store(true)
			return err
		}
		// Final phase source/context/Session+Action fence comes AFTER the original
		// pure actor guard; no Store getter, Node/provider call or reentry occurs.
		if err := phases.AssertLocalCurrent(ctx); err != nil {
			factory.invalid.Store(true)
			return err
		}
		if factory.invalid.Load() {
			return ErrMusicAuthorityUnavailable
		}
		return nil
	}
	g.Operation = cloneMusicOperationMetadata(&metadata)
	g.RequireOperationAssociation = true
	g.CaptureTransaction = factory.capture
	return g, nil
}

type originalMusicBoundedGrantFactory struct {
	phases  *productsessionv2.OriginalBoundedPhases
	next    atomic.Uint64
	invalid atomic.Bool
}

func (f *originalMusicBoundedGrantFactory) capture(ctx context.Context) (MusicLocalTransaction, error) {
	if f == nil || f.phases == nil || f.invalid.Load() || ctx == nil || ctx.Err() != nil {
		return nil, ErrMusicAuthorityUnavailable
	}
	phase := "follow"
	if f.next.Add(1) == 1 {
		phase = "intent"
	}
	return &originalMusicBoundedGrantTransaction{factory: f, phase: phase}, nil
}

type originalMusicBoundedGrantTransaction struct {
	factory *originalMusicBoundedGrantFactory
	phase   string
	used    atomic.Bool
}

func (t *originalMusicBoundedGrantTransaction) Execute(ctx context.Context, commit func(context.Context) error) error {
	if t == nil || t.factory == nil {
		return ErrMusicAuthorityUnavailable
	}
	f := t.factory
	if f.invalid.Load() || commit == nil || ctx == nil || ctx.Err() != nil || !t.used.CompareAndSwap(false, true) {
		f.invalid.Store(true)
		return ErrMusicAuthorityUnavailable
	}
	entered := false
	var originalErr error
	err := f.phases.ExecuteOriginalPreparedPhase(ctx, t.phase, func(local context.Context) error {
		if entered || f.invalid.Load() {
			f.invalid.Store(true)
			return ErrMusicAuthorityUnavailable
		}
		entered = true
		originalErr = commit(local)
		return originalErr
	})
	if err != nil || originalErr != nil || !entered {
		f.invalid.Store(true)
		if err == nil && originalErr == nil {
			return ErrMusicAuthorityUnavailable
		}
		return errors.Join(err, originalErr)
	}
	return nil
}
