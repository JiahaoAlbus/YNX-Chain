// Shared dual-tree grammar and position binding for both byte runtimes.
export function createTreeOperations(wire, runtime) {
  const {VERSION, u32, encodeFields, requireThat} = wire;
  // Both implementations absorb exactly the same complete E encoding.
  function createHasher(C, N, optimized, createDigest) {
    requireThat(typeof optimized === 'boolean', 'invalid optimization flag');
    const states = {};
    const suffix = (...parts) => encodeFields(parts).subarray(4);
    for (const b of ['A', 'B']) {
      const algorithm = b === 'A' ? 'sha3-512' : 'sha512';
      const leafTag = VERSION + '/LEAF/' + b, nodeTag = VERSION + '/NODE/' + b;
      const leafPrefix = runtime.concat([u32(5), suffix(leafTag, C, u32(N))]);
      const nodePrefix = runtime.concat([u32(7), suffix(nodeTag, C, u32(N))]);
      const leafState = createDigest(algorithm).update(leafPrefix), nodeState = createDigest(algorithm).update(nodePrefix);
      states[b] = {
        leaf: (i, m) => optimized ? leafState.copy().update(suffix(u32(i), m)).digest()
          : createDigest(algorithm).update(encodeFields([leafTag, C, u32(N), u32(i), m])).digest(),
        node: (l, j, left, right) => optimized ? nodeState.copy().update(suffix(u32(l), u32(j), left, right)).digest()
          : createDigest(algorithm).update(encodeFields([nodeTag, C, u32(N), u32(l), u32(j), left, right])).digest(),
      };
    }
    return states;
  }
  function buildTree(hash, messages) {
    const levels = [messages.map((m, i) => hash.leaf(i, m))];
    for (let level = 1; levels[level - 1].length > 1; level++) {
      const children = levels[level - 1], parents = [];
      for (let j = 0; j < children.length / 2; j++) parents.push(hash.node(level, j, children[2 * j], children[2 * j + 1]));
      levels.push(parents);
    }
    return levels;
  }
  function extractPath(levels, index) {
    const result = [];
    for (let l = 0; l < levels.length - 1; l++) { result.push(runtime.copy(levels[l][index ^ 1])); index = Math.floor(index / 2); }
    return result;
  }
  function pathRoot(hash, index, message, path) {
    let value = hash.leaf(index, message);
    for (let l = 1; l <= path.length; l++) {
      const up = Math.floor(index / 2);
      value = index % 2 === 0 ? hash.node(l, up, value, path[l - 1]) : hash.node(l, up, path[l - 1], value);
      index = up;
    }
    return value;
  }

  return Object.freeze({createHasher, buildTree, extractPath, pathRoot});
}
