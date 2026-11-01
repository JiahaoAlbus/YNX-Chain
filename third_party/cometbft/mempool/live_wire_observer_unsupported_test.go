//go:build !linux && !darwin

package mempool

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLiveWireObservationUnsupportedClockIsUnknown(t *testing.T) {
	r := newLosslessTransportReactor(t, &WireObserver{})
	require.NoError(t, r.Start())
	got := r.LiveWireObservation()
	require.Equal(t, "UNKNOWN", got.Status)
	require.False(t, got.Complete)
	require.Equal(t, "UNKNOWN", got.ClockStatus)
	require.Equal(t, "clock_unavailable", got.ClockError)
	require.Nil(t, got.StartMonotonicNs)
	require.Nil(t, got.EndMonotonicNs)
	require.NotNil(t, got.Wire)
	require.False(t, got.WireStatus.Complete)
}
