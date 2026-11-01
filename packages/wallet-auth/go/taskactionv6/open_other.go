//go:build !linux && !darwin

package taskactionv6

import (
	"errors"
	"os"
)

// Other server platforms require their original protected no-follow file owner.
// Never fall back to a blocking or following open and pretend pins are enforced.
func openPinned(string) (*os.File, error) { return nil, errors.New("TASK_V6_BUILD_OPEN_UNAVAILABLE") }
