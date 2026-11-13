//go:build !linux && !darwin

package consensus

import "errors"

func measureInitializationStorage(string) (initializationStorage, error) {
	return initializationStorage{}, errors.New("application initialization requires a supported filesystem capacity query")
}
