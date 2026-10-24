package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	coretypes "github.com/cometbft/cometbft/rpc/core/types"
)

type blockTipStatusClient interface {
	Status(context.Context) (*coretypes.ResultStatus, error)
}

// A status response is an untrusted discovery hint, never block authority.
// New blocks still follow the original signed commit/validator/Merkle/results
// path. The default returns the original full latest-block response unchanged.
func (s *blockInclusionScanner) queryTip(ctx context.Context) (int64, *coretypes.ResultBlock, []byte, error) {
	if !s.useStatusTip {
		s.stats.BlockQueries++
		latest, err := observedCall(s.stats, "block_query", s.node, 0, 0, "", func() (*coretypes.ResultBlock, error) { return s.client.Block(ctx, nil) })
		if err != nil {
			return 0, nil, nil, fmt.Errorf("%w: latest block query: %v", errBlockScanNotReady, err)
		}
		if err = observedCheck(s.stats, "block_envelope_verification", s.node, 0, 0, "", func() error { return s.validateEnvelope(latest, 0) }); err != nil {
			return 0, nil, nil, s.fatal(err)
		}
		return latest.Block.Height, latest, nil, nil
	}
	client, ok := s.client.(blockTipStatusClient)
	if !ok {
		return 0, nil, nil, s.fatal(errors.New("selected status tip capability unavailable"))
	}
	s.stats.BlockTipStatusQueries++
	status, err := observedCall(s.stats, "block_tip_status_query", s.node, 0, 0, "", func() (*coretypes.ResultStatus, error) { return client.Status(ctx) })
	if err != nil {
		return 0, nil, nil, fmt.Errorf("%w: status hint query: %v", errBlockScanNotReady, err)
	}
	err = observedCheck(s.stats, "block_tip_status_validation", s.node, 0, 0, "", func() error {
		if status == nil || status.NodeInfo.Network != s.manifest.ChainID || status.SyncInfo.LatestBlockHeight < 0 {
			return errors.New("status hint chain/height identity mismatch")
		}
		if status.SyncInfo.LatestBlockHeight == 0 {
			if len(status.SyncInfo.LatestBlockHash) != 0 {
				return errors.New("zero status height has a block hash")
			}
		} else if len(status.SyncInfo.LatestBlockHash) != 32 {
			return errors.New("status hint block hash length mismatch")
		}
		return nil
	})
	if err != nil {
		return 0, nil, nil, s.fatal(err)
	}
	tip := status.SyncInfo.LatestBlockHeight
	if tip == 0 && s.next == s.start && len(s.blocks) == 0 {
		return 0, nil, nil, errBlockScanNotReady
	}
	hint := append([]byte(nil), status.SyncInfo.LatestBlockHash...)
	if tip >= s.start && tip == s.next-1 {
		if len(s.blocks) == 0 {
			return 0, nil, nil, s.fatal(errors.New("status tip has no retained authenticated frontier"))
		}
		prior := s.blocks[len(s.blocks)-1].commit
		if prior.Header.Height != tip || !bytes.Equal(prior.Header.Hash(), hint) {
			return 0, nil, nil, s.fatal(errors.New("status hint conflicts with authenticated frontier"))
		}
	}
	return tip, nil, hint, nil
}
