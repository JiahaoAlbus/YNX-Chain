export async function switchAccountFailClosed<T>(
  account:string,
  relock:(account:string)=>void,
  persistSelection:(account:string)=>Promise<T>,
):Promise<T>{
  relock(account);
  return persistSelection(account);
}
