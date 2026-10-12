import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
const helper = await readFile(new URL('../../../native/ynx-brand/workbench-activity.js', import.meta.url), 'utf8');
function fixture() {
  const listeners = new Map(), requests = [], attachment = new WeakMap();
  let clock = 0;
  class Target {
    handlers = new Map();
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    fire(type, event) { this.handlers.get(type)?.({ type, ...event }); }
  }
  class Element extends Target {
    isConnected = true; editor = true;
    closest() { return this.editor ? this : null; }
  }
  class HTMLElement extends Element {}
  Object.defineProperty(HTMLElement.prototype, 'editContext', { configurable: true,
    get() { return attachment.get(this); }, set(value) { attachment.set(this, value); } });
  const window = { fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { status: 200 }; },
    addEventListener(type, fn) { listeners.set(type, fn); } }; window.top = window;
  const document = { currentScript: { remove() {} }, addEventListener(type, fn) { listeners.set(type, fn); } };
  runInNewContext(helper.replace('__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__', 'a'.repeat(43)), {
    window, document, Element, HTMLElement, EventTarget: Target, WeakMap,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    Date: { now: () => clock }, JSON, AbortController, setTimeout, clearTimeout
  });
  return { element: new HTMLElement(), context: new Target(), requests, listeners,
    advance() { clock += 30001; }, tick: () => new Promise(resolve => setImmediate(resolve)) };
}
test('trusted IME beforeinput counts editing without transmitting composition text and is rate limited', async () => {
  const f = fixture();
  f.listeners.get('beforeinput')({ type: 'beforeinput', isTrusted: true, isComposing: true, target: f.element, data: '中文' });
  await f.tick();
  f.listeners.get('beforeinput')({ type: 'beforeinput', isTrusted: true, isComposing: true, target: f.element });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(Object.keys(f.requests[0]).sort(), ['action', 'capability', 'eventId']);
  assert.equal(f.requests[0].action, 'edit');
});
test('native EditContext counts only trusted currently attached connected editor textupdate', async () => {
  const f = fixture(); f.element.editContext = f.context;
  f.context.fire('textupdate', { isTrusted: false }); assert.equal(f.requests.length, 0);
  f.element.editor = false; f.context.fire('textupdate', { isTrusted: true }); assert.equal(f.requests.length, 0);
  f.element.editor = true; f.element.isConnected = false;
  f.context.fire('textupdate', { isTrusted: true }); assert.equal(f.requests.length, 0);
  f.element.isConnected = true; f.element.editContext = null;
  f.context.fire('textupdate', { isTrusted: true }); assert.equal(f.requests.length, 0);
  f.element.editContext = f.context; f.context.fire('textupdate', { isTrusted: true, text: 'secret' });
  await f.tick(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].action, 'edit');
  assert.equal(JSON.stringify(f.requests).includes('secret'), false);
  f.context.fire('textupdate', { isTrusted: true }); assert.equal(f.requests.length, 1);
  f.advance(); f.listeners.get('pagehide')(); f.context.fire('textupdate', { isTrusted: true });
  assert.equal(f.requests.length, 1);
});
