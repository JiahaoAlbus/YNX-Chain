//go:build !unix

package consensus

import "errors"

// An unsupported host cannot establish the enrolled history barrier.
func syncPQLabEnrollmentConfirmed(string) error {
	return errors.New("synthetic enrollment confirmation barrier requires unix")
}
