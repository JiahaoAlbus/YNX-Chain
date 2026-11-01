//go:build (!darwin && !linux) || (darwin && !cgo)

package localipc

func observeProcessImage(int32) (processImage, error) { return processImage{}, ErrUnsupported }
