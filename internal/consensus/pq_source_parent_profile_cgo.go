//go:build cgo && (linux || darwin)

package consensus

import sourceparentprofile "github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/sourceparentprofile"

// This concrete private adapter preserves Auth's original locked actor. It
// accepts no provider, image pins, profile JSON, Root flag or caller callback.
type pqSourceCodeProfile struct{ owner *sourceparentprofile.Owner }

type pqSourceCodeDrain struct {
	failure      error
	physicalDone bool
}

func acquirePQOriginalSourceCodeProfile() (*pqSourceCodeProfile, error) {
	owner, err := sourceparentprofile.AcquireOriginalCoreProfile()
	if owner == nil {
		return nil, err
	}
	return &pqSourceCodeProfile{owner: owner}, err // partial adopted before error
}

func (p *pqSourceCodeProfile) Current() error {
	if p == nil || p.owner == nil {
		return ErrPQOriginalSourceProfileNotSupplied
	}
	return p.owner.Current()
}

func (p *pqSourceCodeProfile) ReadOriginalImagesDATA() ([3][32]byte, error) {
	if p == nil || p.owner == nil {
		return [3][32]byte{}, ErrPQOriginalSourceProfileNotSupplied
	}
	images, err := p.owner.ReadOriginalImagesDATA()
	return [3][32]byte(images), err
}

func (p *pqSourceCodeProfile) Retire() {
	if p != nil && p.owner != nil {
		p.owner.Retire()
	}
}

func (p *pqSourceCodeProfile) Close() pqSourceCodeDrain {
	if p == nil || p.owner == nil {
		return pqSourceCodeDrain{physicalDone: true}
	}
	d := p.owner.Close()
	var err error
	if d.Failure.Present {
		err = d.Failure
	}
	return pqSourceCodeDrain{failure: err, physicalDone: d.PhysicalDone}
}
