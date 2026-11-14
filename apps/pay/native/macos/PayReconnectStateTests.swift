@main struct PayReconnectStateTests {
    static func main() {
        var state = PayReconnectState()
        precondition(state.activate(busy: false))
        let original = state.generation
        state.invalidate()
        precondition(state.generation != original)
        precondition(!state.activate(busy: true))
        precondition(state.completed()) // late read completion schedules one new status read
        precondition(!state.completed())
        state.invalidate()
        precondition(!state.completed()) // no reconnect while inactive
        precondition(state.activate(busy: false))
        precondition(!state.completed())
    }
}
