package state

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestYNXHeightHaltWaitsForCompleteCommittedCheckpoint(t *testing.T) {
	initial := State{ChainID: "halt-test", InitialHeight: 1, LastBlockHeight: 2}
	halt, err := NewHeightHalt(initial)
	require.NoError(t, err)
	require.NoError(t, halt.Arm(4))
	require.True(t, halt.Enter(3))
	third := initial
	third.LastBlockHeight = 3
	require.False(t, halt.Committed(third))
	require.True(t, halt.Enter(4))
	select {
	case <-halt.Done():
		t.Fatal("halt completed before the complete application/database commit")
	default:
	}
	fourth := third
	fourth.LastBlockHeight = 4
	fourth.AppHash = []byte{1, 2, 3}
	require.True(t, halt.Committed(fourth))
	require.True(t, halt.Blocked())
	require.False(t, halt.Enter(5))
	result, target, err := halt.Result()
	require.NoError(t, err)
	require.EqualValues(t, 4, target)
	require.Equal(t, fourth, result)
	result.AppHash[0] = 9
	detached, _, err := halt.Result()
	require.NoError(t, err)
	require.Equal(t, byte(1), detached.AppHash[0])
}

func TestYNXHeightHaltRejectsLateAndDuplicateRequests(t *testing.T) {
	for _, target := range []int64{0, 2, 3} {
		halt, err := NewHeightHalt(State{ChainID: "halt-test", InitialHeight: 1, LastBlockHeight: 2})
		require.NoError(t, err)
		require.True(t, halt.Enter(4))
		require.Error(t, halt.Arm(target))
		require.True(t, halt.Blocked())
		_, _, err = halt.Result()
		require.Error(t, err, "late target must not be a successful halt")
	}
	halt, err := NewHeightHalt(State{ChainID: "halt-test", InitialHeight: 1})
	require.NoError(t, err)
	require.NoError(t, halt.Arm(3))
	require.Error(t, halt.Arm(3))
	require.False(t, halt.Enter(2))
}

func TestYNXHeightHaltFailureNeverTruncatesInFlightCommitOrBecomesSuccess(t *testing.T) {
	halt, err := NewHeightHalt(State{ChainID: "halt-test", InitialHeight: 1, LastBlockHeight: 2})
	require.NoError(t, err)
	require.True(t, halt.Enter(3))
	first := errors.New("original control read failure")
	halt.Fail(first)
	require.True(t, halt.Committed(State{ChainID: "halt-test", InitialHeight: 1, LastBlockHeight: 3}))
	halt.Fail(errors.New("later close failure"))
	_, _, err = halt.Result()
	require.ErrorIs(t, err, first)
	require.False(t, halt.Enter(4))
}
