//go:build darwin || linux

package grantruntime

import (
	"context"
	policy "ynx.local/authgrantpolicy"
)

// The original protected issuer retains the exact approved request on this
// key. A lookup is read-only: no new prompt, approval, signing or model send.
// No plaintext body is forwarded. The body size and both digests come from
// the normal P08 caller's exact current bytes.
type originalModelDisclosureKey struct {
	Source                                               policy.SourceVersion
	Realm, Tenant, GrantID, GrantRevision, Account       string
	Task                                                 policy.Ref
	Generation                                           string
	Holder                                               policy.Ref
	HolderEpoch, SessionID, SessionEpoch, ChannelBinding string
	URL, Model                                           string
	Actual                                               policy.Bind
}
type originalModelDisclosurePermit interface {
	ReadOriginal(context.Context, originalModelDisclosureKey) (string, error)
	Current(context.Context) error
	Close() error
}
type originalModelDisclosureRecord struct {
	Key    originalModelDisclosureKey
	Permit modelDisclosure
}
type originalModelDisclosureReader interface {
	ReadOriginalPermit(context.Context, originalModelDisclosureKey) (originalModelDisclosurePermit, error)
	Close() error
}
type originalModelDisclosureRelease struct {
	Slot, Authority, Realm, Tenant string
	open                           func() (originalModelDisclosureReader, error)
}

// Only reviewed protected release composition may add a real original
// issuer reader. No App/HTTP/ENV setter or fixture in the normal table.
var admittedOriginalModelDisclosureReaders = [...]originalModelDisclosureRelease{}

func openOriginalModelDisclosureReader(s releaseSelection) (originalModelDisclosureReader, error) {
	var selected func() (originalModelDisclosureReader, error)
	for _, row := range admittedOriginalModelDisclosureReaders {
		if row.Slot != s.ModelDisclosureCustody || row.Authority != s.Authority || row.Realm != s.Realm || row.Tenant != s.Tenant {
			continue
		}
		if selected != nil || row.open == nil {
			return nil, ErrProof
		}
		selected = row.open
	}
	if selected == nil {
		return nil, ErrUnavailable
	}
	reader, e := selected()
	if reader == nil && e == nil {
		return nil, ErrUnavailable
	}
	return reader, e
}
