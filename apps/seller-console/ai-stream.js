// Keep a provider stream inside the same account/store/view as its job.
export async function streamJob(requests, url, options, onStatus, fetcher = globalThis.fetch) {
  const assertCurrent = requests.capture();
  return requests.fetchJSON(url, options, fetcher, async response => {
    if (!response.ok) return response.json();
    if (!response.body) throw new Error('The provider stream is unavailable.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffered = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        assertCurrent();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        if (buffered.length > 65536) throw new Error('The provider stream event is too large.');
        const events = buffered.split(/\r?\n\r?\n/);
        buffered = events.pop();
        for (const event of events) {
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          let status;
          try { status = JSON.parse(data); } catch { continue; }
          assertCurrent();
          onStatus(status);
        }
      }
      return {};
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  });
}
