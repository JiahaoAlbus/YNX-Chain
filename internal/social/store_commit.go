package social

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type stateCommitError struct{ err error }

func (e *stateCommitError) Error() string {
	return "social state replacement committed; directory durability unconfirmed: " + e.err.Error()
}
func (e *stateCommitError) Unwrap() error { return e.err }
func stateWriteCommitted(err error) bool {
	var committed *stateCommitError
	return errors.As(err, &committed)
}

func syncStateDirectory(path string) error {
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (s *Service) saveOrRollbackWithLocked(before persistentState, write func(string, *persistentState, []byte) error) error {
	if s.stateWriteError != nil {
		s.state = before
		return fmt.Errorf("state writes suspended; recover with compatible reader: %w", s.stateWriteError)
	}
	err := write(s.cfg.StatePath, &s.state, s.cfg.TokenKey)
	if err == nil {
		return nil
	}
	if stateWriteCommitted(err) {
		s.stateWriteError = err
	} else {
		s.state = before
	}
	return err
}
