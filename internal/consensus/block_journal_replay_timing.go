package consensus

import "time"

// Sequential children of prefix suffixReplay, not additional decode time.
// MemoryCommit replays application state only; it is never disk durability.
type BlockJournalFrameReplayPhases struct {
	FinalizeDetails    *BlockJournalFinalizePhases `json:"finalizeDetails,omitempty"`
	ReadFrame          BlockJournalPrefixPhase     `json:"readFrame"`
	DecodeRecord       BlockJournalPrefixPhase     `json:"decodeRecord"`
	CheckpointValidate BlockJournalPrefixPhase     `json:"checkpointValidate"`
	DecodeRequest      BlockJournalPrefixPhase     `json:"decodeRequest"`
	Finalize           BlockJournalPrefixPhase     `json:"finalize"`
	VerifyResponse     BlockJournalPrefixPhase     `json:"verifyResponse"`
	MemoryCommit       BlockJournalPrefixPhase     `json:"memoryCommit"`
	FinalValidate      BlockJournalPrefixPhase     `json:"finalValidate"`
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
	if other.FinalizeDetails != nil {
		if p.FinalizeDetails == nil {
			p.FinalizeDetails = new(BlockJournalFinalizePhases)
		}
		p.FinalizeDetails.add(*other.FinalizeDetails)
	}
	targets := []*BlockJournalPrefixPhase{&p.ReadFrame, &p.DecodeRecord, &p.CheckpointValidate, &p.DecodeRequest, &p.Finalize, &p.VerifyResponse, &p.MemoryCommit, &p.FinalValidate}
	values := []BlockJournalPrefixPhase{other.ReadFrame, other.DecodeRecord, other.CheckpointValidate, other.DecodeRequest, other.Finalize, other.VerifyResponse, other.MemoryCommit, other.FinalValidate}
	for i, v := range values {
		targets[i].Calls += v.Calls
		targets[i].Errors += v.Errors
		targets[i].DurationNs += v.DurationNs
	}
}

// Clone owns nested diagnostic values as well as the frame counters.
func (p *BlockJournalFrameReplayPhases) Clone() BlockJournalFrameReplayPhases {
	if p == nil {
		return BlockJournalFrameReplayPhases{}
	}
	out := *p
	if p.FinalizeDetails != nil {
		details := *p.FinalizeDetails
		out.FinalizeDetails = &details
	}
	return out
}

type BlockJournalFinalizePhases struct {
	TransactionDetails  BlockJournalTransactionPhases `json:"transactionDetails"`
	CloneExecutionState BlockJournalPrefixPhase       `json:"cloneExecutionState"`
	ExecuteTransactions BlockJournalPrefixPhase       `json:"executeTransactions"`
	SealState           BlockJournalPrefixPhase       `json:"sealState"`
	BuildResponse       BlockJournalPrefixPhase       `json:"buildResponse"`
}

func (p *BlockJournalFinalizePhases) measure(name string, action func() error) error {
	if p == nil {
		return action()
	}
	var phase *BlockJournalPrefixPhase
	switch name {
	case "cloneExecutionState":
		phase = &p.CloneExecutionState
	case "executeTransactions":
		phase = &p.ExecuteTransactions
	case "sealState":
		phase = &p.SealState
	case "buildResponse":
		phase = &p.BuildResponse
	default:
		panic("unregistered replay finalize phase")
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

func (p *BlockJournalFinalizePhases) add(other BlockJournalFinalizePhases) {
	p.TransactionDetails.add(other.TransactionDetails)
	targets := []*BlockJournalPrefixPhase{&p.CloneExecutionState, &p.ExecuteTransactions, &p.SealState, &p.BuildResponse}
	for i, v := range []BlockJournalPrefixPhase{other.CloneExecutionState, other.ExecuteTransactions, other.SealState, other.BuildResponse} {
		targets[i].Calls += v.Calls
		targets[i].Errors += v.Errors
		targets[i].DurationNs += v.DurationNs
	}
}

// Children of executeTransactions. NativeFeeEventAppend is nested inside
// NativeApplyState; none of these counters is additional wall-clock duration.
// DecodeVerified includes cache lookup and full verification on misses.
type BlockJournalTransactionPhases struct {
	EnvelopeType         BlockJournalPrefixPhase `json:"envelopeType"`
	NativeDecodeVerified BlockJournalPrefixPhase `json:"nativeDecodeVerified"`
	NativeApplyState     BlockJournalPrefixPhase `json:"nativeApplyState"`
	NativeFeeEventAppend BlockJournalPrefixPhase `json:"nativeFeeEventAppend"`
}

func (p *BlockJournalTransactionPhases) measure(name string, action func() error) error {
	if p == nil {
		return action()
	}
	var phase *BlockJournalPrefixPhase
	switch name {
	case "envelopeType":
		phase = &p.EnvelopeType
	case "nativeDecodeVerified":
		phase = &p.NativeDecodeVerified
	case "nativeApplyState":
		phase = &p.NativeApplyState
	case "nativeFeeEventAppend":
		phase = &p.NativeFeeEventAppend
	default:
		panic("unregistered replay transaction phase")
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

func (p *BlockJournalTransactionPhases) add(other BlockJournalTransactionPhases) {
	targets := []*BlockJournalPrefixPhase{&p.EnvelopeType, &p.NativeDecodeVerified, &p.NativeApplyState, &p.NativeFeeEventAppend}
	for i, v := range []BlockJournalPrefixPhase{other.EnvelopeType, other.NativeDecodeVerified, other.NativeApplyState, other.NativeFeeEventAppend} {
		targets[i].Calls += v.Calls
		targets[i].Errors += v.Errors
		targets[i].DurationNs += v.DurationNs
	}
}
