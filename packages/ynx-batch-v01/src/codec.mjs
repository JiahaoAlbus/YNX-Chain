// Node compatibility facade: ordinary Buffers in, detached Buffers out.
import {createCodec} from './codec-core.mjs';
export {VERSION, SUITE, LIMIT, ProtocolError, requireThat} from './codec-core.mjs';
const codec = createCodec(Object.freeze({
  name: 'ordinary Buffer',
  isBytes: value => Buffer.isBuffer(value) && !(value.buffer instanceof SharedArrayBuffer),
  copy: value => Buffer.from(value), allocate: size => Buffer.allocUnsafe(size),
}));
export const {bytes, exact, u32, batchCount, encodeFields, encodeContext, decodeContext, encodeDescriptor, decodeDescriptor, encodeCertificate, decodeCertificate, validateMessages, encodeProof, decodeProof, encodeWhole, decodeWhole, encodeMember, decodeMember} = codec;
