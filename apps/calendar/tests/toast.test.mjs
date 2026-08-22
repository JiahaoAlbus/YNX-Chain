import assert from "node:assert/strict";
import test from "node:test";
import {createCalendarToastController} from "../web/toast.js";

function fixture() {
  const classes = new Set();
  const attributes = new Map();
  return {
    element: {
      textContent: "",
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
        contains(value) { return classes.has(value); },
      },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
    },
    classes,
    attributes,
  };
}

test("toast clears DOM and live-region visibility after hiding", () => {
  const timers = [];
  const {element} = fixture();
  const toast = createCalendarToastController(element, {setTimer(callback) { timers.push(callback); return timers.length; }, clearTimer() {}});
  toast.show("MetaMask account changed");
  assert.equal(element.textContent, "MetaMask account changed");
  assert.equal(element.getAttribute("aria-hidden"), "false");
  timers[0]();
  timers[1]();
  assert.equal(element.textContent, "");
  assert.equal(element.getAttribute("aria-hidden"), "true");
  assert.equal(element.classList.contains("show"), false);
});

test("an older toast timer cannot clear a newer toast", () => {
  const timers = [];
  const {element} = fixture();
  const toast = createCalendarToastController(element, {setTimer(callback) { timers.push(callback); return timers.length; }, clearTimer() {}});
  toast.show("first");
  toast.show("second");
  timers[0]();
  assert.equal(element.textContent, "second");
  assert.equal(element.classList.contains("show"), true);
  timers[1]();
  timers[2]();
  assert.equal(element.textContent, "");
});
