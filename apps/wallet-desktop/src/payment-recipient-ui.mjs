/** An asynchronous input lease owns only a Send draft, never a signing operation. */
export function createPaymentRecipientUI({ getContext, parse, decode, apply, report, onStart = () => {}, target = 'ynx' }) {
  let revision = 0;
  const invalidate = () => { revision++; };
  function capture() {
    const current = ++revision, before = getContext();
    return () => {
      const after = getContext();
      return current === revision && before.open && after.open && !before.locked && !after.locked &&
        Boolean(before.account) && after.account === before.account && after.keyRevision === before.keyRevision &&
        (!['evm','bitcoin','tron'].includes(target)||after.networkId===before.networkId&&after.configRevision===before.configRevision&&after.draftRevision===before.draftRevision);
    };
  }
  async function consume(load, image) {
    const live = capture();
    if (!live()) return;
    onStart();
    report("Reading recipient locally…");
    try {
      const input = await load();
      if (!live()) return;
      const result = await (image ? decode(input) : parse(input));
      if (!live()) return;
      if(target==='bitcoin'||target==='tron'){
        const value=result?.value,c=getContext(),valid=target==='bitcoin'?/^(bc1|tb1)[a-z0-9]+$/.test(value?.account??''):/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value?.account??'');
        if(result?.ok!==true||value?.family!==target||value.network!==c.networkId||value.networkVerified!==false||!valid)throw Error('invalid');
        apply(value.account);report('{family} recipient filled. Verify the selected network, enter an amount, then review.');return;
      }
      if(target==='evm'){
        const c=getContext(),value=result?.value;if(result?.ok!==true||value?.family!=='evm'||!/^0x[0-9a-f]{40}$/.test(value.account??'')||/^0x0{40}$/.test(value.account)||value.networkId!==c.networkId||value.configRevision!==c.configRevision||value.networkVerified!==false)throw Error('invalid');
        apply(value.account);report('EVM recipient filled. Verify the selected network, enter an amount, then review.');return;
      }
      if (!result?.ok || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]+$/u.test(result.value?.ynxAccount ?? "") ||
          result.value.chainId !== "ynx_6423-1" || result.value.asset !== "YNXT") throw new Error("invalid");
      apply(result.value.ynxAccount);
      report("Recipient filled. Enter the amount, then review the address and fee.");
    } catch {
      if (live()) report(['bitcoin','tron'].includes(target)?'{family} recipient unavailable. Check the QR address, selected network and unresolved operations.':target==='evm'?'EVM recipient unavailable. Use a QR image containing only a nonzero EVM address.':"Recipient unavailable. Use a YNX Testnet address, receiving link or its QR image.");
    }
  }
  function text(value) { return consume(typeof value === "function" ? value : async () => value, false); }
  function image(file) {
    return consume(async () => {
      if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("invalid image");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength !== file.size) throw new Error("changed image");
      return { bytes, mimeType: file.type };
    }, true);
  }
  return { invalidate, text, image };
}
