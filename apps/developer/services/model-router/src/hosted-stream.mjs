// Existing AI Gateway emits metadata -> token(s) -> done after completion.
// A token or EOF alone is never a completed answer or persistence receipt.
export async function readHostedStream(response, signal, expectedSession, { onMetadata, details = false } = {}) {
  const invalid = () => Object.assign(new Error("YNX hosted model returned an invalid or incomplete stream."), { code: "model_stream_invalid", status: 502 });
  const tooLarge = () => Object.assign(new Error("Model output exceeded the response boundary."), { code: "model_output_too_large", status: 502 });
  if (!/^text\/event-stream(?:;|$)/i.test(response.headers.get("content-type") || "") || !response.body) throw invalid();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "", wireBytes = 0, outputBytes = 0, text = "", metadata, done = false;
  function frame(raw) {
    let event, data;
    for (const line of raw.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (done) throw invalid();
      if (line.startsWith("event: ") && event === undefined) event = line.slice(7);
      else if (line.startsWith("data: ") && data === undefined) data = line.slice(6);
      else throw invalid();
    }
    if (event === undefined && data === undefined) return;
    let value;
    try { value = JSON.parse(data); } catch { throw invalid(); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const exact = keys => Object.keys(value).sort().join() === keys.sort().join();
    const id = value => typeof value === "string" && value.length > 0 && value.length <= 256;
    if (event === "metadata" && !metadata && exact(["requestId", "sessionId"]) && id(value.requestId) && id(value.sessionId) && (!expectedSession || value.sessionId === expectedSession)) {
      if (signal?.aborted) throw signal.reason;
      metadata = value;
      onMetadata?.({ ...metadata });
    }
    else if (event === "token" && metadata && exact(["text"]) && typeof value.text === "string") {
      outputBytes += Buffer.byteLength(value.text);
      if (outputBytes > 2 * 1024 * 1024) throw tooLarge();
      text += value.text;
    } else if (event === "done" && metadata && exact(["requestId"]) && value.requestId === metadata.requestId) done = true;
    else throw invalid();
  }
  function consume(value) {
    pending += value;
    // Normalize only complete CRLF pairs; a CR split across chunks is retained.
    pending = pending.replace(/\r\n/g, "\n");
    let end;
    while ((end = pending.indexOf("\n\n")) >= 0) {
      frame(pending.slice(0, end)); pending = pending.slice(end + 2);
    }
  }
  async function read() {
    if (signal?.aborted) throw signal.reason;
    if (!signal) return reader.read();
    let abort;
    try {
      return await Promise.race([reader.read(), new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      })]);
    } finally { if (abort) signal.removeEventListener("abort", abort); }
  }
  let complete = false;
  try {
    for (;;) {
      const part = await read();
      if (part.done) break;
      wireBytes += part.value.byteLength;
      if (wireBytes > 4 * 1024 * 1024) throw tooLarge();
      try { consume(decoder.decode(part.value, { stream: true })); }
      catch (error) { if (error.code) throw error; throw invalid(); }
    }
    try { consume(decoder.decode()); } catch (error) { if (error.code) throw error; throw invalid(); }
    if (!done || pending.trim() || !text.trim()) throw invalid();
    complete = true;
    return details ? { text, ...metadata } : text;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
