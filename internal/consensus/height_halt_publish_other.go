//go:build !linux

package consensus

import "errors"

func publishHeightHaltRequestPlatform(_ []byte, _ HeightHaltPublicationOptions, _ HeightHaltPublicationResult, _ *heightHaltPublicationHooks) (HeightHaltPublicationResult, error) {
	return HeightHaltPublicationResult{}, errors.New("height halt request publication requires Linux renameat2 RENAME_NOREPLACE; this platform is unsupported")
}
