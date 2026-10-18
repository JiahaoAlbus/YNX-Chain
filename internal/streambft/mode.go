package streambft

import "errors"

type CandidateMode string

const (
	ModeDisabled CandidateMode = "disabled"
	ModeShadow   CandidateMode = "shadow"
	ModeCanary   CandidateMode = "canary"
)

type PromotionEvidence struct {
	FormalSafetyVerified      bool         `json:"formalSafetyVerified"`
	DifferentialReplayMatched bool         `json:"differentialReplayMatched"`
	StateRootsMatched         bool         `json:"stateRootsMatched"`
	ValidatorCounts           map[int]bool `json:"validatorCounts"`
	WANRegions                int          `json:"wanRegions"`
	ByzantineFaultsPassed     bool         `json:"byzantineFaultsPassed"`
	PartitionAndLossPassed    bool         `json:"partitionAndLossPassed"`
	StateSyncAndRestorePassed bool         `json:"stateSyncAndRestorePassed"`
	LongSoakPassed            bool         `json:"longSoakPassed"`
	RollbackPassed            bool         `json:"rollbackPassed"`
	CometBFTCompositeWin      bool         `json:"cometBftCompositeWin"`
}

func (e PromotionEvidence) ValidateForCanary() error {
	if !e.FormalSafetyVerified || !e.DifferentialReplayMatched || !e.StateRootsMatched ||
		!e.ByzantineFaultsPassed || !e.PartitionAndLossPassed || !e.StateSyncAndRestorePassed ||
		!e.LongSoakPassed || !e.RollbackPassed || !e.CometBFTCompositeWin {
		return errors.New("StreamBFT promotion evidence is incomplete")
	}
	for _, count := range []int{4, 7, 13, 21} {
		if !e.ValidatorCounts[count] {
			return errors.New("StreamBFT validator-count evidence is incomplete")
		}
	}
	if e.WANRegions < 3 {
		return errors.New("StreamBFT multi-region WAN evidence is incomplete")
	}
	return nil
}

func ResolveMode(requested CandidateMode, evidence PromotionEvidence) (CandidateMode, error) {
	switch requested {
	case ModeDisabled, ModeShadow:
		return requested, nil
	case ModeCanary:
		if err := evidence.ValidateForCanary(); err != nil {
			return ModeShadow, err
		}
		return ModeCanary, nil
	default:
		return ModeDisabled, errors.New("unsupported StreamBFT candidate mode")
	}
}
