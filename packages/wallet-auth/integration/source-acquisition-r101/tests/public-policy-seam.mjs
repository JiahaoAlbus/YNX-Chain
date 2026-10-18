import assert from 'node:assert/strict';
export function parsePQAccountAuthorization(dto,network){assert.equal(dto.owner,network.owner);assert.equal(network.chainId,'12'.repeat(32));assert.equal(network.nativeChainId,'6423');return Object.freeze({executionHeight:dto.height,owner:dto.owner,revision:dto.revision});}
export function assertPQAuthorizationCurrent(before,after){assert.equal(before.owner,after.owner);if(before.revision!==after.revision)throw Object.assign(Error('PUBLIC revision changed'),{code:'PUBLIC_REVISION_CHANGED'});}
