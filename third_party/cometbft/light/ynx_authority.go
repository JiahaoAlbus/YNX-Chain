package light

import (
	"bytes"
	"context"
	"errors"

	"github.com/cometbft/cometbft/light/provider"
	"github.com/cometbft/cometbft/light/store"
	"github.com/cometbft/cometbft/types"
)

// WithConsensusAuthority binds every fetched and restored light block to an
// independently authenticated immutable application history. The provider is
// never an authority source. A history that does not cover a requested height
// fails closed; callers must explicitly supply a newer trusted checkpoint.
func WithConsensusAuthority(authority types.ConsensusAuthority) Option {
	return func(c *Client) {
		c.primary = &authorityProvider{Provider: c.primary, authority: authority}
		witnesses := make([]provider.Provider, len(c.witnesses))
		for i, witness := range c.witnesses {
			witnesses[i] = &authorityProvider{Provider: witness, authority: authority}
		}
		c.witnesses = witnesses
		c.trustedStore = &authorityLightStore{Store: c.trustedStore, authority: authority}
	}
}

// BindLightBlock does not verify a commit or replace the normal light-client
// trust algorithm. It attaches authority to the actual decoded full keys and
// checks the committed profile before those normal signature checks run.
func BindLightBlock(authority types.ConsensusAuthority, block *types.LightBlock) (*types.LightBlock, error) {
	if authority == nil || block == nil || block.SignedHeader == nil || block.Header == nil || block.ValidatorSet == nil {
		return nil, errors.New("light block requires independent consensus authority and complete data")
	}
	params, err := authority.ParamsAt(block.Height)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(params.Hash(), block.ConsensusHash) {
		return nil, errors.New("light header consensus hash differs from authenticated profile")
	}
	if history, ok := authority.(interface{ ExpectedValidatorHash(int64) ([]byte, error) }); ok {
		nextHash, err := history.ExpectedValidatorHash(block.Height + 1)
		if err != nil {
			return nil, err
		}
		if !bytes.Equal(nextHash, block.NextValidatorsHash) {
			return nil, errors.New("light header next-validator hash differs from authenticated history")
		}
	}
	set, err := authority.BindValidatorSet(block.Height, block.ValidatorSet)
	if err != nil {
		return nil, err
	}
	bound := *block
	bound.ValidatorSet = set
	return &bound, nil
}

type authorityProvider struct {
	provider.Provider
	authority types.ConsensusAuthority
}

func (p *authorityProvider) LightBlock(ctx context.Context, height int64) (*types.LightBlock, error) {
	block, err := p.Provider.LightBlock(ctx, height)
	if err != nil {
		return nil, err
	}
	return BindLightBlock(p.authority, block)
}

type authorityLightStore struct {
	store.Store
	authority types.ConsensusAuthority
}

func (s *authorityLightStore) LightBlock(height int64) (*types.LightBlock, error) {
	block, err := s.Store.LightBlock(height)
	if err != nil {
		return nil, err
	}
	return BindLightBlock(s.authority, block)
}
func (s *authorityLightStore) LightBlockBefore(height int64) (*types.LightBlock, error) {
	block, err := s.Store.LightBlockBefore(height)
	if err != nil {
		return nil, err
	}
	return BindLightBlock(s.authority, block)
}
func (s *authorityLightStore) SaveLightBlock(block *types.LightBlock) error {
	bound, err := BindLightBlock(s.authority, block)
	if err != nil {
		return err
	}
	return s.Store.SaveLightBlock(bound)
}
