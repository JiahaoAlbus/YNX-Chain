package payproduct

import (
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

var ErrNativeMerchantFenceUnavailable = errors.New("original Pay merchant association or invoice role is no longer current")

// Non-zero-size tokens have unique identities while retained by a fence. They
// are local commit generations, not a Root, Source grant or signed protocol.
type merchantAuthorityRevision struct{ marker byte }
type merchantAuthorityRecord struct {
	id, centralID, recipient, status string
	createdAt                        time.Time
	revision                         *merchantAuthorityRevision
}
type memberAuthorityRecord struct {
	member   MerchantMember
	revision *merchantAuthorityRevision
}
type merchantAuthorityState struct {
	merchants map[string]merchantAuthorityRecord
	members   map[string]memberAuthorityRecord
}

// Called only under the original Store's write lock (or during private open).
// A Store.Update is logically committed when this immutable state is published
// after successful persistence, before unlock/afterCommit/return. An overlapping
// Current can linearize before that commit; every later Current sees it. No
// tokens change for unrelated bill/outbox/progress writes or failed persistence.
func (s *Store) publishMerchantAuthority() {
	previous := s.merchantAuthority.Load()
	next := &merchantAuthorityState{merchants: make(map[string]merchantAuthorityRecord, len(s.data.Merchants)), members: make(map[string]memberAuthorityRecord, len(s.data.MerchantMembers))}
	for key, m := range s.data.Merchants {
		record := merchantAuthorityRecord{id: m.ID, centralID: m.CentralMerchantID, recipient: m.PayoutAddress, status: m.Status, createdAt: m.CreatedAt}
		if previous != nil {
			if old, ok := previous.merchants[key]; ok && old.id == record.id && old.centralID == record.centralID && old.recipient == record.recipient && old.status == record.status && old.createdAt.Equal(record.createdAt) {
				record.revision = old.revision
			}
		}
		if record.revision == nil {
			record.revision = &merchantAuthorityRevision{}
		}
		next.merchants[key] = record
	}
	for key, m := range s.data.MerchantMembers {
		record := memberAuthorityRecord{member: m}
		if previous != nil {
			if old, ok := previous.members[key]; ok && sameMerchantMemberAuthority(old.member, m) {
				record.revision = old.revision
			}
		}
		if record.revision == nil {
			record.revision = &merchantAuthorityRevision{}
		}
		next.members[key] = record
	}
	s.merchantAuthority.Store(next)
}
func sameMerchantMemberAuthority(a, b MerchantMember) bool {
	return a.ID == b.ID && a.MerchantID == b.MerchantID && a.Account == b.Account && a.Role == b.Role && a.Status == b.Status && a.CreatedAt.Equal(b.CreatedAt) && a.UpdatedAt.Equal(b.UpdatedAt)
}

// NativeMerchantFence is an opaque read-only fence for existing Pay facts.
// Capture occurs outside Store locks, through the original authorized View.
// Current is safe inside View/Update: one atomic load and immutable lookups,
// no mutex, View, network, JSON, persistence or foreign callback. It does not
// confer Source/Root/native submission authority or a product's read scope.
type NativeMerchantFence struct {
	store                 *Store
	merchantID, memberKey string
	merchant, member      *merchantAuthorityRevision
}

func (s *Store) CaptureNativeMerchantFence(merchantID, principal, recipient string, invoiceMemberRequired bool) (*NativeMerchantFence, error) {
	if s == nil || merchantID == "" {
		return nil, ErrNativeMerchantFenceUnavailable
	}
	expected, err := accountaddress.Normalize(recipient)
	if err != nil {
		return nil, ErrNativeMerchantFenceUnavailable
	}
	var encoded string
	if invoiceMemberRequired {
		encoded, err = accountaddress.Encode(principal)
		if err != nil {
			return nil, ErrNativeMerchantFenceUnavailable
		}
	}
	root := s
	for root.parent != nil {
		root = root.parent
	}
	var fence *NativeMerchantFence
	err = s.View(func(data Snapshot) error {
		m, ok := data.Merchants[merchantID]
		actual, e := accountaddress.Normalize(m.PayoutAddress)
		if !ok || m.ID != merchantID || m.Status != "active" || e != nil || actual != expected {
			return ErrNativeMerchantFenceUnavailable
		}
		state := root.merchantAuthority.Load()
		if state == nil {
			return ErrNativeMerchantFenceUnavailable
		}
		entry, ok := state.merchants[merchantID]
		if !ok || entry.revision == nil {
			return ErrNativeMerchantFenceUnavailable
		}
		fence = &NativeMerchantFence{store: root, merchantID: merchantID, merchant: entry.revision}
		if invoiceMemberRequired {
			key := merchantID + ":" + encoded
			member, ok := data.MerchantMembers[key]
			if !ok || member.MerchantID != merchantID || member.Account != encoded || member.Status != "active" || !validMerchantRole(member.Role) || !roleAllows(member.Role, "invoice") {
				return ErrNativeMerchantFenceUnavailable
			}
			entry, ok := state.members[key]
			if !ok || entry.revision == nil {
				return ErrNativeMerchantFenceUnavailable
			}
			fence.memberKey = key
			fence.member = entry.revision
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err = fence.Current(); err != nil {
		return nil, err
	}
	return fence, nil
}
func (f *NativeMerchantFence) Current() error {
	if f == nil || f.store == nil || f.merchant == nil {
		return ErrNativeMerchantFenceUnavailable
	}
	state := f.store.merchantAuthority.Load()
	if state == nil {
		return ErrNativeMerchantFenceUnavailable
	}
	merchant, ok := state.merchants[f.merchantID]
	if !ok || merchant.revision != f.merchant {
		return ErrNativeMerchantFenceUnavailable
	}
	if f.member != nil {
		member, ok := state.members[f.memberKey]
		if !ok || member.revision != f.member {
			return ErrNativeMerchantFenceUnavailable
		}
	}
	return nil
}
