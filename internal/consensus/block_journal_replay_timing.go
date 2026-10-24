package consensus

import "time"

// Sequential children of prefix suffixReplay, not additional decode time.
// MemoryCommit replays application state only; it is never disk durability.
type BlockJournalFrameReplayPhases struct {
	ReadFrame          BlockJournalPrefixPhase `json:"readFrame"`
	DecodeRecord       BlockJournalPrefixPhase `json:"decodeRecord"`
	CheckpointValidate BlockJournalPrefixPhase `json:"checkpointValidate"`
	DecodeRequest      BlockJournalPrefixPhase `json:"decodeRequest"`
	Finalize           BlockJournalPrefixPhase `json:"finalize"`
	VerifyResponse     BlockJournalPrefixPhase `json:"verifyResponse"`
	MemoryCommit       BlockJournalPrefixPhase `json:"memoryCommit"`
	FinalValidate      BlockJournalPrefixPhase `json:"finalValidate"`
}

func (p *BlockJournalFrameReplayPhases) measure(name string, action func() error) error {
	if p == nil {
		return action()
	}
	var phase *BlockJournalPrefixPhase
	switch name {
	case "readFrame":
		phase = &p.ReadFrame
	case "decodeRecord":
		phase = &p.DecodeRecord
	case "checkpointValidate":
		phase = &p.CheckpointValidate
	case "decodeRequest":
		phase = &p.DecodeRequest
	case "finalize":
		phase = &p.Finalize
	case "verifyResponse":
		phase = &p.VerifyResponse
	case "memoryCommit":
		phase = &p.MemoryCommit
	case "finalValidate":
		phase = &p.FinalValidate
	default:
		panic("unregistered frame replay phase")
	}
	started := time.Now()
	phase.Calls++
	err := action()
	phase.DurationNs += time.Since(started).Nanoseconds()
	if err != nil {
		phase.Errors++
	}
	return err
}

func (p *BlockJournalFrameReplayPhases) add(other BlockJournalFrameReplayPhases) {
	targets := []*BlockJournalPrefixPhase{&p.ReadFrame, &p.DecodeRecord, &p.CheckpointValidate, &p.DecodeRequest, &p.Finalize, &p.VerifyResponse, &p.MemoryCommit, &p.FinalValidate}
	values := []BlockJournalPrefixPhase{other.ReadFrame, other.DecodeRecord, other.CheckpointValidate, other.DecodeRequest, other.Finalize, other.VerifyResponse, other.MemoryCommit, other.FinalValidate}
	for i, v := range values {
		targets[i].Calls += v.Calls
		targets[i].Errors += v.Errors
		targets[i].DurationNs += v.DurationNs
	}
}
