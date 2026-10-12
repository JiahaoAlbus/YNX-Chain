// macOS system Bash 3.2/readline can lose large fast PTY writes (node-pty #833).
// Bound only this shell's input rate. All bytes and FIFO order are retained.
const installed = new WeakSet();
function paceBashInput(terminal, { schedule = setTimeout, cancel = clearTimeout, limit = 4 * 1024 * 1024, onError = () => {} } = {}) {
  const write = terminal.write, kill = terminal.kill;
  let queue = [], offset = 0, bytes = 0, timer, closed = false;
  const dispose = () => { closed = true; if (timer !== undefined) cancel(timer); timer = undefined; queue = []; bytes = offset = 0; };
  const drain = () => {
    timer = undefined;
    if (closed || !queue.length) return;
    const chunk = queue[0], end = Math.min(offset + 128, chunk.length);
    const output = chunk.subarray(offset, end);
    bytes -= output.length; offset = end;
    if (offset === chunk.length) { queue.shift(); offset = 0; }
    try { write.call(terminal, output); } catch (error) { dispose(); throw error; }
    // Retain the interval even at the tail: a following keystroke cannot race
    // the last submitted chunk or overtake the final newline.
    timer = schedule(() => { try { drain(); } catch (error) { onError(error); } }, 5);
  };
  terminal.write = function (data) {
    if (closed) return;
    let input = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, 'utf8');
    const interrupt = input.lastIndexOf(3);
    if (interrupt !== -1) {
      // Ctrl-C cancels pending paste/command bytes, rather than waiting behind
      // them and allowing a cancelled command to execute on a later newline.
      if (timer !== undefined) cancel(timer);
      timer = undefined; queue = []; bytes = offset = 0;
      input = input.subarray(interrupt);
    }
    if (input.length > limit - bytes || queue.length >= 4096) throw new RangeError('Terminal input queue capacity exceeded; input was not accepted.');
    if (!input.length) return;
    queue.push(input); bytes += input.length;
    if (timer === undefined) drain();
  };
  terminal.kill = function (...args) { dispose(); return kill.apply(this, args); };
  terminal.onExit(dispose);
  return { dispose };
}
function install(prototype, platform = process.platform) {
  if (platform !== 'darwin' || installed.has(prototype)) return;
  installed.add(prototype);
  const original = prototype.createPseudoTerminal;
  prototype.createPseudoTerminal = function (command, ...args) {
    const result = original.call(this, command, ...args);
    if (command === '/bin/bash' && result.terminal) paceBashInput(result.terminal, { onError: error => this.emitOnErrorAsync(error) });
    return result;
  };
}
module.exports = { paceBashInput, install };
