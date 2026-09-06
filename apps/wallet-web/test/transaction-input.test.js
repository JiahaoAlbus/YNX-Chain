import assert from "node:assert/strict";
import test from "node:test";
import {decimalYNXTToWei, weiHexToYNXT, prepareTransaction, reviewMatchesSession} from "../src/transaction-input.js";

test("decimal YNXT conversion preserves every wei beyond Number precision", () => {
  assert.equal(decimalYNXTToWei("0"), "0x0");
  assert.equal(decimalYNXTToWei("0.000000000000000001"), "0x1");
  assert.equal(decimalYNXTToWei("1.000000000000000001"), "0xde0b6b3a7640001");
  assert.equal(weiHexToYNXT(decimalYNXTToWei("9007199254740993.123456789012345678")), "9007199254740993.123456789012345678");
  assert.equal(weiHexToYNXT(decimalYNXTToWei(" 0001.2300 ")), "1.23");
});

test("decimal input rejects ambiguity, exponents, excessive decimals and uint256 overflow", () => {
  for (const value of ["", " ", "1e3", "-1", "+1", "1,2", "1,000", ".1", "1.", "NaN", "Infinity", "0x1", "1.0000000000000000001", "١", 1]) {
    assert.throws(() => decimalYNXTToWei(value), {code:"INVALID_AMOUNT"}, String(value));
  }
  const max = `0x${"f".repeat(64)}`;
  assert.equal(decimalYNXTToWei(weiHexToYNXT(max)), max);
  const overflow = (((1n << 256n) - 1n) / (10n ** 18n) + 1n).toString();
  assert.throws(() => decimalYNXTToWei(overflow), {code:"AMOUNT_TOO_LARGE"});
});

test("raw value/data preserve advanced capability but reject malformed quantities", () => {
  const from = `0x${"1".repeat(40)}`, to = `0x${"2".repeat(40)}`;
  assert.deepEqual(prepareTransaction({from,to,amount:"1.5"}), {from,to,value:"0x14d1120d7b160000",data:"0x",displayAmount:"1.5"});
  assert.equal(prepareTransaction({from,to,value:"0x0",data:"0x1234",useHex:true}).data, "0x1234");
  for (const value of ["0x", "0x00", "0x01", "-0x1", `0x1${"0".repeat(64)}`]) assert.throws(() => weiHexToYNXT(value), {code:"INVALID_HEX_VALUE"});
  assert.throws(() => prepareTransaction({from,to:"0x12",amount:"1"}), {code:"INVALID_RECIPIENT"});
  assert.throws(() => prepareTransaction({from,to,amount:"1",data:"0x1"}), {code:"INVALID_CALLDATA"});
});

test("a prepared review cannot survive a changed provider, account, network or request epoch", () => {
  const session = {provider:{},wallet:"ynx",account:`0x${"1".repeat(40)}`,chainId:"0x1917",epoch:4};
  const review = Object.freeze({...session});
  assert.equal(reviewMatchesSession(review, session), true);
  for (const patch of [{provider:{}},{wallet:"metamask"},{account:`0x${"2".repeat(40)}`},{account:null},{chainId:"0x1"},{epoch:5}]) {
    assert.equal(reviewMatchesSession(review, {...session,...patch}), false);
  }
});
