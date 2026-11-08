//go:build !linux && !darwin

package securelink

func NewDesktopTaskGrantIPCIngress(AuthorityIPCIngressConfig) (*AuthorityIPCIngress, error) {
	return nil, ErrUnavailable
}
