//go:build unix && !linux

package consensus

import "errors"

func publishProofHostLiveControl(string, []byte) error {
	return errors.New("live DATA request publication requires Linux renameat2 RENAME_NOREPLACE")
}
