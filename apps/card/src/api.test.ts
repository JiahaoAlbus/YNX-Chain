import test from "node:test";
import assert from "node:assert/strict";
import {parseState}from"./api";

const safe={eligibility:{reference:"kyc_ref",status:"eligible_sandbox",provider:"sandbox",updatedAt:"2026-07-18T06:00:00Z"},applications:[],cards:[{id:"card_1",account:"ynx1account",applicationId:"cap_1",providerCardId:"pcard_1",provider:"YNX Card Testnet Sandbox",network:"YNX Testnet Sandbox",last4:"1234",expiryMonth:12,expiryYear:2029,status:"active",controls:{spendLimitMinor:10000,currency:"USD",online:true,international:false,atm:false,allowedMcc:[],blockedMcc:[],allowedCountries:[]},createdAt:"2026-07-18T06:00:00Z",updatedAt:"2026-07-18T06:00:00Z"}],events:[],disputes:[],notifications:[],aiRuns:[],audit:[]};
test("Card API accepts only safe provider references",()=>{const parsed=parseState(safe);assert.equal(parsed.cards[0]?.last4,"1234");assert.equal((parsed.cards[0] as any).pan,undefined)});
test("Card API rejects PAN, CVV, PIN and identity material at any depth",()=>{for(const field of ["pan","cvv","pin","trackData","identityDocument","passportImage"]){assert.throws(()=>parseState({...safe,cards:[{...safe.cards[0],[field]:"secret"}]}),/Sensitive issuer data rejected/)}});
test("Card API refuses unlabelled or non-sandbox cards",()=>{assert.throws(()=>parseState({...safe,cards:[{...safe.cards[0],network:"Visa"}]}),/Invalid safe Card reference/);assert.throws(()=>parseState({...safe,cards:[{...safe.cards[0],last4:"abcd"}]}),/Invalid safe Card reference/)});
