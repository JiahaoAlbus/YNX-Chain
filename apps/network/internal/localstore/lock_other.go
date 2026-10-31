//go:build !unix

package localstore

import "errors"

type Lock struct{}

func Acquire(string) (*Lock, error) {
	return nil, errors.New("Network local journal kernel lock unsupported")
}
func (*Lock) Check() error { return errors.New("unsupported kernel lock") }
func (*Lock) Close() error { return nil }
