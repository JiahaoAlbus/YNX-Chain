package consensus

import (
	"testing"
	"time"
)

func TestFeeEventJournalEmptyEventsAreNil(t *testing.T) {
	for _, tc := range []struct {
		name    string
		journal feeEventJournal
	}{
		{name: "zero value"},
		{name: "empty base", journal: feeEventJournal{base: []BFTFeeEvent{}}},
		{name: "empty base with capacity", journal: feeEventJournal{base: make([]BFTFeeEvent, 0, 4)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.journal.events(); got != nil {
				t.Fatalf("empty journal materialized as a non-nil slice: %#v", got)
			}
		})
	}
}

func TestFeeEventJournalBranchesPreserveBaseAndSharedPrefix(t *testing.T) {
	backing := []BFTFeeEvent{
		feeJournalTestEvent("base-1"),
		feeJournalTestEvent("base-2"),
		feeJournalTestEvent("capacity-guard-1"),
		feeJournalTestEvent("capacity-guard-2"),
	}
	before := append([]BFTFeeEvent(nil), backing...)
	base := feeEventJournal{base: backing[:2]}
	common := feeJournalTestEvent("common")
	leftEvent := feeJournalTestEvent("left")
	rightEvent := feeJournalTestEvent("right")
	shared := base.append(common)
	left := shared.append(leftEvent)
	leftBeforeRight := left.events()
	right := shared.append(rightEvent)

	assertFeeJournalEvents(t, backing, before)
	assertFeeJournalEvents(t, base.events(), before[:2])
	assertFeeJournalEvents(t, shared.events(), []BFTFeeEvent{before[0], before[1], common})
	assertFeeJournalEvents(t, left.events(), []BFTFeeEvent{before[0], before[1], common, leftEvent})
	assertFeeJournalEvents(t, leftBeforeRight, left.events())
	assertFeeJournalEvents(t, right.events(), []BFTFeeEvent{before[0], before[1], common, rightEvent})
}

func TestFeeEventJournalPreservesAppendOrder(t *testing.T) {
	want := []BFTFeeEvent{
		feeJournalTestEvent("base-1"),
		feeJournalTestEvent("base-2"),
		feeJournalTestEvent("pending-1"),
		feeJournalTestEvent("pending-2"),
		feeJournalTestEvent("pending-3"),
		feeJournalTestEvent("pending-4"),
	}
	journal := feeEventJournal{base: want[:2:2]}
	for i := 2; i < len(want); i++ {
		prior := journal
		journal = journal.append(want[i])
		assertFeeJournalEvents(t, prior.events(), want[:i])
		assertFeeJournalEvents(t, journal.events(), want[:i+1])
	}
}

func TestFeeEventJournalMaterializationIsIndependent(t *testing.T) {
	for _, tc := range []struct {
		name      string
		baseCount int
		pending   int
	}{
		{name: "base only", baseCount: 2},
		{name: "pending only", pending: 2},
		{name: "base and pending", baseCount: 2, pending: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			backing := []BFTFeeEvent{
				feeJournalTestEvent("base-1"),
				feeJournalTestEvent("base-2"),
				feeJournalTestEvent("capacity-guard"),
			}
			before := append([]BFTFeeEvent(nil), backing...)
			journal := feeEventJournal{base: backing[:tc.baseCount]}
			want := append([]BFTFeeEvent(nil), before[:tc.baseCount]...)
			pending := []BFTFeeEvent{feeJournalTestEvent("pending-1"), feeJournalTestEvent("pending-2")}
			for _, event := range pending[:tc.pending] {
				journal = journal.append(event)
				want = append(want, event)
			}

			first := journal.events()
			second := journal.events()
			assertFeeJournalEvents(t, first, want)
			assertFeeJournalEvents(t, second, want)
			for i := range first {
				first[i] = feeJournalTestEvent("caller-overwrite")
			}
			first = append(first, feeJournalTestEvent("caller-append"))

			assertFeeJournalEvents(t, backing, before)
			assertFeeJournalEvents(t, second, want)
			assertFeeJournalEvents(t, journal.events(), want)
		})
	}
}

func TestFeeEventJournalSurvivesExecutionStateCloneBranches(t *testing.T) {
	backing := []BFTFeeEvent{
		feeJournalTestEvent("base"),
		feeJournalTestEvent("capacity-guard-1"),
		feeJournalTestEvent("capacity-guard-2"),
	}
	before := append([]BFTFeeEvent(nil), backing...)
	common := feeJournalTestEvent("common")
	original := executionState{feeEvents: feeEventJournal{base: backing[:1]}.append(common)}
	left := cloneExecutionStateValue(original)
	right := cloneExecutionStateValue(original)
	assertFeeJournalEvents(t, left.feeEvents.events(), []BFTFeeEvent{before[0], common})
	assertFeeJournalEvents(t, right.feeEvents.events(), []BFTFeeEvent{before[0], common})

	leftEvent := feeJournalTestEvent("left")
	rightEvent := feeJournalTestEvent("right")
	left.feeEvents = left.feeEvents.append(leftEvent)
	leftBeforeRight := left.feeEvents.events()
	right.feeEvents = right.feeEvents.append(rightEvent)
	assertFeeJournalEvents(t, backing, before)
	assertFeeJournalEvents(t, original.feeEvents.events(), []BFTFeeEvent{before[0], common})
	assertFeeJournalEvents(t, left.feeEvents.events(), []BFTFeeEvent{before[0], common, leftEvent})
	assertFeeJournalEvents(t, leftBeforeRight, left.feeEvents.events())
	assertFeeJournalEvents(t, right.feeEvents.events(), []BFTFeeEvent{before[0], common, rightEvent})

	// A caller may edit a materialized clone without changing either branch.
	leftBeforeRight[0] = feeJournalTestEvent("caller-overwrite")
	leftBeforeRight[len(leftBeforeRight)-1] = feeJournalTestEvent("caller-overwrite-tail")
	assertFeeJournalEvents(t, original.feeEvents.events(), []BFTFeeEvent{before[0], common})
	assertFeeJournalEvents(t, left.feeEvents.events(), []BFTFeeEvent{before[0], common, leftEvent})
	assertFeeJournalEvents(t, right.feeEvents.events(), []BFTFeeEvent{before[0], common, rightEvent})
}

func feeJournalTestEvent(id string) BFTFeeEvent {
	return newCurrentFeeEvent("0x"+id, SignedTransactionType, "payer", "recipient", 1, 10, time.Unix(100, 0).UTC())
}

func assertFeeJournalEvents(t *testing.T, got, want []BFTFeeEvent) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("fee event count = %d, want %d: got=%+v want=%+v", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("fee event %d changed: got=%+v want=%+v", i, got[i], want[i])
		}
	}
}
