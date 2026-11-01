import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_V1 as actual} from '../src/product-pair-pending-original-query-e13.js';
test('new sole E13 carrier matches the already published private HTTP budget literal',()=>{const code=readFileSync(new URL('../src/original-pending-query-http-header-budget-private.js',import.meta.url),'utf8'),match=code.match(/const PROOF='([^']+)';/);assert(match);assert.equal(match[1],actual);});
