//go:build darwin && !cgo

package grantruntime

func observeReceiverProcess(int) (receiverProcessObservation, error) {
	return receiverProcessObservation{}, ErrUnavailable
}
