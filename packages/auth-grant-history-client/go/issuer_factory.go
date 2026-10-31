package originalclient

import (
	"bytes"
	"context"
	core "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Original protected custodian supplies an already-open ORIGINAL Core handle;
// no key format, key generation, key import or private bytes are invented here.
type originalResponseCustody interface {
	Current(context.Context) error
	BorrowOriginalCoreSigner(context.Context, string) (*core.PrivateKey, core.PublicKey, error)
	OriginalResponseGate(context.Context, string) (originalWholeResponseGate, error)
	Close() error
}
type responseIssuerRelease struct {
	Issuer      protectedRef
	CustodySlot string
}

var admittedResponseIssuerReleases = [...]responseIssuerRelease{}
var admittedOriginalResponseCustody = [...]func() (originalResponseCustody, error){}

func OpenOriginalWholeResponseIssuer() (out *OriginalWholeResponseIssuer, err error) {
	if len(admittedResponseIssuerReleases) != 1 || len(admittedOriginalResponseCustody) != 1 {
		return nil, ErrWholeResponseUnavailable
	}
	var r responseIssuerRelease
	for _, value := range admittedResponseIssuerReleases {
		r = value
	}
	out = &OriginalWholeResponseIssuer{}
	out.issuer, err = openResponseIssuer(r.Issuer)
	if err != nil {
		return out, err
	}
	var acquire func() (originalResponseCustody, error)
	for _, value := range admittedOriginalResponseCustody {
		acquire = value
	}
	custody, e := acquire()
	out.custody = custody
	if e != nil {
		return out, e
	}
	if custody == nil || r.CustodySlot == "" {
		return out, ErrWholeResponseUnavailable
	}
	if e = custody.Current(context.Background()); e != nil {
		return out, e
	}
	var public core.PublicKey
	out.key, public, e = custody.BorrowOriginalCoreSigner(context.Background(), r.CustodySlot)
	if e != nil {
		return out, e
	}
	if out.key == nil || !bytes.Equal(public.PKA, out.issuer.registration.PKA) || !bytes.Equal(public.PKB, out.issuer.registration.PKB) {
		return out, ErrWholeResponse
	}
	out.gate, e = custody.OriginalResponseGate(context.Background(), r.CustodySlot)
	if e != nil {
		return out, e
	}
	if out.gate == nil {
		return out, ErrWholeResponseUnavailable
	}
	if e = custody.Current(context.Background()); e != nil {
		return out, e
	}
	return out, nil
}
