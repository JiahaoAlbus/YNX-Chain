package consensus

import (
	"bytes"
	"errors"

	cmttypes "github.com/cometbft/cometbft/types"
)

var _ cmttypes.ConsensusSigningAuthoritySource = (*PQEngineFileSource)(nil)

// ConsensusAuthorityForSigning reopens and validates the actual file even if
// the engine has previously authenticated this height in its historical cache.
// It never confirms pending application writes, rewrites history or treats an
// older cached registry as current permission to sign another object.
func (s *PQEngineFileSource) ConsensusAuthorityForSigning(chainID string, height int64, appHash []byte) (cmttypes.ConsensusAuthority, error) {
	if s == nil || s.bootstrap == nil || chainID != s.bootstrap.record.ChainID || len(appHash) != 32 {
		return nil, errors.New("remote signing requires the pinned chain and exact full checkpoint hash")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, err := LoadPQEngineSnapshot(s.migration, s.path, s.bootstrap, s.authorization, height, appHash)
	if err != nil {
		return nil, err
	}
	if s.signingSeen && (height < s.signingHeight || (height == s.signingHeight && !bytes.Equal(appHash, s.signingHash[:]))) {
		return nil, errors.New("remote signing checkpoint regressed or changed at its permanent observed height")
	}
	for _, checkpoint := range s.checkpoints {
		if checkpoint.snapshot != nil && (checkpoint.height > height || (checkpoint.height == height && !bytes.Equal(checkpoint.hash[:], appHash))) {
			return nil, errors.New("remote signing checkpoint regressed or changed at a known height")
		}
	}
	var hash [32]byte
	copy(hash[:], appHash)
	s.signingSeen, s.signingHeight, s.signingHash = true, height, hash
	if s.checkpoints[0].snapshot == nil || s.checkpoints[0].height != height || s.checkpoints[0].hash != hash {
		s.checkpoints[1] = s.checkpoints[0]
		s.checkpoints[0] = pqEngineCheckpoint{height: height, hash: hash, snapshot: snapshot}
	} else {
		s.checkpoints[0].snapshot = snapshot
	}
	return snapshot, nil
}
