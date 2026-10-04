package quantlab

import (
	"context"
	"encoding/json"
	"regexp"
)

var researchRequestKeyPattern = regexp.MustCompile(`^quant-research-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Replay is scoped to the existing tenant state, not a Wallet account grant.
// It uses the existing state lock/reload and atomic persistence; no matching,
// simulation arithmetic, scheduler, capital or authority is introduced here.
func (s *Service) RunBacktestFromMarketOnce(strategy StrategySpec, assumptions Assumptions, key string) (Experiment, error) {
	return s.RunBacktestFromMarketOnceContext(context.Background(), strategy, assumptions, key)
}

func (s *Service) RunBacktestFromMarketOnceContext(ctx context.Context, strategy StrategySpec, assumptions Assumptions, key string) (Experiment, error) {
	if err := ctx.Err(); err != nil {
		return Experiment{}, err
	}
	if !researchRequestKeyPattern.MatchString(key) {
		return Experiment{}, ErrInvalid
	}
	strategy, err := normalizeResearchParameters(strategy, assumptions)
	if err != nil {
		return Experiment{}, err
	}
	digest := hash(struct {
		Strategy    StrategySpec
		Assumptions Assumptions
	}{strategy, assumptions})
	s.mu.Lock()
	release, err := s.lockAndReload()
	if err != nil {
		s.mu.Unlock()
		return Experiment{}, err
	}
	if err := ctx.Err(); err != nil {
		release()
		s.mu.Unlock()
		return Experiment{}, err
	}
	previous, found, err := s.researchReplayLocked(key, digest)
	release()
	s.mu.Unlock()
	if found || err != nil {
		return previous, err
	}
	if s.cfg.MarketData == nil {
		return Experiment{}, ErrUnavailable
	}
	bars, source, err := marketHistory(ctx, s.cfg.MarketData, "YNXT-YUSD_TEST", 10000)
	if contextErr := ctx.Err(); contextErr != nil {
		return Experiment{}, contextErr
	}
	if err != nil || len(bars) < 20 {
		return Experiment{}, ErrUnavailable
	}
	strategy.Source = source
	result, err := s.RunBacktestContext(ctx, BacktestRequest{Strategy: strategy, Bars: bars, Assumptions: assumptions, researchRequestKey: key, researchRequestDigest: digest})
	if err != nil {
		return Experiment{}, err
	}
	return copyResearchReceipt(result)
}

func (s *Service) researchReplayLocked(key, digest string) (Experiment, bool, error) {
	var result Experiment
	found := false
	for id, experiment := range s.state.Experiments {
		if experiment.ResearchRequestKey != key {
			continue
		}
		if found || experiment.ID != id || experiment.Status != "completed_oos" || experiment.ResearchRequestDigest != digest {
			return Experiment{}, false, ErrConflict
		}
		result, found = experiment, true
	}
	if !found {
		return Experiment{}, false, nil
	}
	copy, err := copyResearchReceipt(result)
	return copy, true, err
}

func copyResearchReceipt(value Experiment) (Experiment, error) {
	bytes, err := json.Marshal(value)
	if err != nil {
		return Experiment{}, ErrUnavailable
	}
	var copied Experiment
	if json.Unmarshal(bytes, &copied) != nil {
		return Experiment{}, ErrUnavailable
	}
	return copied, nil
}

// Scheduled research uses the existing durable claim and recorded runtime, not
// a second public idempotency protocol. Called only after current claim/enable
// checks under the original state lock. Ambiguous historical results fail closed.
func (s *Service) scheduledResearchReplayLocked(strategy StrategySpec, assumptions Assumptions, runID string) (Experiment, bool, error) {
	var result Experiment
	found := false
	for id, experiment := range s.state.Experiments {
		if experiment.Strategy.ID != strategy.ID || experiment.Strategy.Runtime.RunID != runID {
			continue
		}
		previous := experiment.Strategy
		if found || experiment.ID != id || experiment.Status != "completed_oos" ||
			previous.Name != strategy.Name || previous.StrategyHash != strategy.StrategyHash ||
			previous.DataHash != strategy.DataHash || previous.FeatureHash != strategy.FeatureHash ||
			experiment.Assumptions != assumptions {
			return Experiment{}, false, ErrConflict
		}
		result, found = experiment, true
	}
	if !found {
		return Experiment{}, false, nil
	}
	copy, err := copyResearchReceipt(result)
	return copy, true, err
}
