//go:build darwin && !cgo

package consensus

func sourceProcessParent(int32) (int32, error)    { return 0, errSourceParent }
func sourceKernelPeer(int) (uint32, int32, error) { return 0, 0, errSourceParent }
