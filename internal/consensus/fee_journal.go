package consensus

// feeEventJournal shares immutable committed history and an immutable chain of
// new events. Copying execution state preserves independent transaction branches
// without copying all historical fees for every attempted transaction.
type feeEventJournal struct {
	base    []BFTFeeEvent
	tail    *pendingFeeEvent
	pending int
}

type pendingFeeEvent struct {
	event    BFTFeeEvent
	previous *pendingFeeEvent
}

func (j feeEventJournal) append(event BFTFeeEvent) feeEventJournal {
	j.tail = &pendingFeeEvent{event: event, previous: j.tail}
	j.pending++
	return j
}

// events materializes the original ordered state format at block sealing.
// The returned slice owns its backing storage, including when there are no new
// events, so later state processing cannot mutate history shared by a journal.
func (j feeEventJournal) events() []BFTFeeEvent {
	count := len(j.base) + j.pending
	if count == 0 {
		return nil
	}
	events := make([]BFTFeeEvent, count)
	copy(events, j.base)
	index := count - 1
	for node := j.tail; node != nil; node = node.previous {
		events[index] = node.event
		index--
	}
	return events
}
