// A local LXC client's exit does not prove a remote command stopped. Preserve
// uncertainty even when optional probes or package cleanup catch its error.
export function uncertainRemoteCommand(error) {
  return ["child_exit_timeout", "timeout", "max_buffer", "service_maintenance", "remote_command_recovery_required"].includes(error?.code) || Boolean(error?.signal);
}

export function createRemoteCommandBoundary(run) {
  const unsafe = new Set(); let onUnsafe = () => {};
  function target(args) {
    if (["exec", "delete", "stop"].includes(args[0])) return args[1];
    if (args[0] === "launch") return args[2];
    if (args[0] === "config") return args[1] === "device" ? args[3] : args[2];
    if (args[0] === "file" && args[1] === "push") return args.at(-1)?.split("/")[0];
    if (args[0] === "file" && args[1] === "pull") return args[2]?.split("/")[0];
    return undefined;
  }
  const error = () => Object.assign(new Error("Remote command completion could not be verified. The runtime and its files remain protected for recovery."), { code: "remote_command_recovery_required", status: 409 });
  return {
    setRecoveryHandler(handler) { onUnsafe = handler; },
    recoveryRequired: container => unsafe.has(container),
    async run(command, args, options) {
      const container = command === "lxc" ? target(args) : undefined;
      // Only containment attempts remain permitted after uncertainty. Their
      // success never acknowledges the protected workspace or clears this latch.
      const containment = args[0] === "stop" || args[0] === "config" && args[1] === "device" && args[2] === "remove";
      if (container && unsafe.has(container) && !containment) throw error();
      try { return await run(command, args, options); }
      catch (failure) {
        if (container && uncertainRemoteCommand(failure)) {
          unsafe.add(container); onUnsafe(container);
          failure.status ??= 503;
        }
        throw failure;
      }
    },
  };
}
