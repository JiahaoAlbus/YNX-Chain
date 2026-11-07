//go:build darwin && !cgo

package consensus

func observePQSourceProcessImage(int32) (pqSourceProcessImage, error) {
	return pqSourceProcessImage{}, errPQSourceIdentity
}
