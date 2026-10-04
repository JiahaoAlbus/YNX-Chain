// A guest banner must not echo error text containing account, endpoint,
// callback or permission details. The explicit sign-in flow remains separate.
export function guestRecoveryNotice(error:string|null):string|null{
  return error===null?null:'Your saved session could not be restored. Your local data is retained. Review sign-in or local recovery in Settings.';
}
