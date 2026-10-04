/** Decode the original storage configuration, never a Wallet private key.
 * A successful caller owns the buffer and must clear it after Store copying. */
export function decodeCardStateKey(encoded:string):Buffer{
  const key=Buffer.from(encoded,'base64');
  if(key.length!==32||key.toString('base64')!==encoded){
    key.fill(0);
    throw Error('Set YNX_CARD_STATE_KEY_BASE64 to a securely generated 32-byte base64 key');
  }
  return key;
}
