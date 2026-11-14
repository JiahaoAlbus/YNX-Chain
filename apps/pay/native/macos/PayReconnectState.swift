// UI lifecycle bookkeeping only. It supplies no Wallet or Source authority.
struct PayReconnectState {
    private(set) var generation = 0
    private var active = false
    private var reconnectPending = false
    mutating func invalidate() { generation += 1; active = false; reconnectPending = false }
    mutating func activate(busy: Bool) -> Bool {
        active = true
        if busy { reconnectPending = true; return false }
        reconnectPending = false
        return true
    }
    mutating func completed() -> Bool {
        let reconnect = active && reconnectPending
        reconnectPending = false
        return reconnect
    }
}
