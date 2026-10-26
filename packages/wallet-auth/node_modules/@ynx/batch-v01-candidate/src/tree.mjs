import {createHash} from 'node:crypto';
import * as wire from './codec.mjs';
import {createPortableHash} from './portable.mjs';
import {createTreeOperations} from './tree-core.mjs';
const tree = createTreeOperations(wire, {copy: value => Buffer.from(value), concat: parts => Buffer.concat(parts)});
export function createHasher(C, N, optimized = true, provider = 'native') {
  wire.requireThat(provider === 'native' || provider === 'portable', 'unknown hash provider');
  return tree.createHasher(C, N, optimized, provider === 'native' ? createHash : createPortableHash);
}
export const {buildTree, extractPath, pathRoot} = tree;
