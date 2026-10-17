package consensus

import (
	"errors"
	"sort"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// nativeDelta is an immutable AVL update index, not committed storage. Each put
// owns its changed path; older transaction branches retain their original nodes.
type nativeDelta[V any] struct {
	key         string
	value       V
	left, right *nativeDelta[V]
	height      int
}

func deltaHeight[V any](n *nativeDelta[V]) int {
	if n == nil {
		return 0
	}
	return n.height
}
func deltaNode[V any](key string, value V, left, right *nativeDelta[V]) *nativeDelta[V] {
	h := deltaHeight(left)
	if r := deltaHeight(right); r > h {
		h = r
	}
	return &nativeDelta[V]{key: key, value: value, left: left, right: right, height: h + 1}
}
func deltaRotateRight[V any](n *nativeDelta[V]) *nativeDelta[V] {
	p := n.left
	return deltaNode(p.key, p.value, p.left, deltaNode(n.key, n.value, p.right, n.right))
}
func deltaRotateLeft[V any](n *nativeDelta[V]) *nativeDelta[V] {
	p := n.right
	return deltaNode(p.key, p.value, deltaNode(n.key, n.value, n.left, p.left), p.right)
}
func deltaPut[V any](n *nativeDelta[V], key string, value V) *nativeDelta[V] {
	if n == nil {
		return deltaNode(key, value, nil, nil)
	}
	left, right := n.left, n.right
	if key < n.key {
		left = deltaPut(left, key, value)
	} else if key > n.key {
		right = deltaPut(right, key, value)
	} else {
		return deltaNode(key, value, left, right)
	}
	n = deltaNode(n.key, n.value, left, right)
	if deltaHeight(left)-deltaHeight(right) > 1 {
		if deltaHeight(left.left) < deltaHeight(left.right) {
			n = deltaNode(n.key, n.value, deltaRotateLeft(left), right)
		}
		return deltaRotateRight(n)
	}
	if deltaHeight(right)-deltaHeight(left) > 1 {
		if deltaHeight(right.right) < deltaHeight(right.left) {
			n = deltaNode(n.key, n.value, left, deltaRotateRight(right))
		}
		return deltaRotateLeft(n)
	}
	return n
}
func deltaGet[V any](n *nativeDelta[V], key string) (V, bool) {
	for n != nil {
		if key < n.key {
			n = n.left
		} else if key > n.key {
			n = n.right
		} else {
			return n.value, true
		}
	}
	var zero V
	return zero, false
}
func deltaWalk[V any](n *nativeDelta[V], visit func(string, V)) {
	if n != nil {
		deltaWalk(n.left, visit)
		visit(n.key, n.value)
		deltaWalk(n.right, visit)
	}
}
func deltaCount[V any](n *nativeDelta[V]) int {
	if n == nil {
		return 0
	}
	return 1 + deltaCount(n.left) + deltaCount(n.right)
}

type nativeAccountValue struct {
	account chain.ConsensusAccount // Lots is an immutable base map.
	lots    *nativeDelta[int64]    // Includes zero balances, as the original map does.
}

func nativeAccountAt(state executionState, address string) (nativeAccountValue, bool) {
	if value, ok := deltaGet(state.nativeAccounts, address); ok {
		return value, true
	}
	if i, ok := accountIndex(state.accounts, address); ok {
		return nativeAccountValue{account: state.accounts[i]}, true
	}
	return nativeAccountValue{account: chain.ConsensusAccount{Address: address}}, false
}
func (a nativeAccountValue) lot(id string) int64 {
	if value, ok := deltaGet(a.lots, id); ok {
		return value
	}
	return a.account.Lots[id]
}
func (a *nativeAccountValue) setLot(id string, value int64) { a.lots = deltaPut(a.lots, id, value) }
func (a nativeAccountValue) lotKeys() []string {
	keys := make([]string, 0, len(a.account.Lots)+deltaCount(a.lots))
	for key := range a.account.Lots {
		keys = append(keys, key)
	}
	deltaWalk(a.lots, func(key string, _ int64) {
		if _, exists := a.account.Lots[key]; !exists {
			keys = append(keys, key)
		}
	})
	sort.Strings(keys)
	return keys
}
func moveNativeLots(sender, receiver *nativeAccountValue, amount int64) error {
	remaining := amount
	for _, id := range sender.lotKeys() {
		if remaining == 0 {
			break
		}
		available := sender.lot(id)
		if available <= 0 {
			continue
		}
		moved := available
		if moved > remaining {
			moved = remaining
		}
		sender.setLot(id, available-moved)
		receiver.setLot(id, receiver.lot(id)+moved)
		remaining -= moved
	}
	if remaining != 0 {
		return errors.New("insufficient traceable YNXT lot balance")
	}
	return nil
}

func ownedNativeAccount(value nativeAccountValue) chain.ConsensusAccount {
	account := value.account
	account.Lots = make(map[string]int64, len(account.Lots)+deltaCount(value.lots))
	for id, amount := range value.account.Lots {
		account.Lots[id] = amount
	}
	deltaWalk(value.lots, func(id string, amount int64) { account.Lots[id] = amount })
	return account
}

// Materialization restores the exact canonical account/lot representation at
// full-clone and block-seal boundaries. The delta and its base remain immutable.
func cloneExecutionAccounts(state executionState) []chain.ConsensusAccount {
	if state.nativeAccounts == nil {
		return cloneAccounts(state.accounts)
	}
	updates := make([]nativeAccountValue, 0, deltaCount(state.nativeAccounts))
	deltaWalk(state.nativeAccounts, func(_ string, value nativeAccountValue) { updates = append(updates, value) })
	out := make([]chain.ConsensusAccount, 0, len(state.accounts)+len(updates))
	i, j := 0, 0
	for i < len(state.accounts) || j < len(updates) {
		if j == len(updates) || (i < len(state.accounts) && state.accounts[i].Address < updates[j].account.Address) {
			out = append(out, ownedNativeAccount(nativeAccountValue{account: state.accounts[i]}))
			i++
		} else {
			if i < len(state.accounts) && state.accounts[i].Address == updates[j].account.Address {
				i++
			}
			out = append(out, ownedNativeAccount(updates[j]))
			j++
		}
	}
	return out
}
