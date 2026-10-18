//go:build !unix

package consensus

import "errors"

type ApplicationStateWriterLease struct{}

func AcquireApplicationStateWriterLease(string) (*ApplicationStateWriterLease, error) {
	return nil, errors.New("production application writer lease requires supported Unix file locking")
}

func (*ApplicationStateWriterLease) Close() error { return nil }
