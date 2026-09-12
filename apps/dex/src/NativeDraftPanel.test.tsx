import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeDraftPanel, draftAccount } from './NativeDraftPanel';
import { nativeDraftCopy } from './native-draft-i18n';
import { nativeSubmitCopy, nativeLaunchCopy } from './native-submit-i18n';
import type { Locale } from './types';
const mocks=vi.hoisted(()=>({open:vi.fn(),read:vi.fn(),accept:vi.fn(),discard:vi.fn(),close:vi.fn(),status:vi.fn(),submit:vi.fn(),check:vi.fn(),subscribe:vi.fn(),unsubscribe:vi.fn(),launcher:vi.fn(),prepare:vi.fn(),launch:vi.fn(),invalidate:vi.fn(),dispose:vi.fn()}));
vi.mock('./native-action-journal',()=>({openNativeActionStore:mocks.open,subscribeNativeActionCommits:mocks.subscribe,createNativeActionJournal:(store:unknown)=>({read:mocks.read,acceptReturn:(account:string,url:string)=>mocks.accept(account,url,store),discardUnsigned:mocks.discard})}));
vi.mock('./vendor/application-actions-browser.mjs',()=>({createApplicationActionLauncher:mocks.launcher}));
vi.mock('./native-submission',()=>({getNativeSubmissionStatus:mocks.status,submitNativeAction:mocks.submit,refreshNativeSubmission:mocks.check}));
const A='0x2222222222222222222222222222222222222222',B='0x3333333333333333333333333333333333333333',hash='0x'+'a'.repeat(64),digest='d'.repeat(64),s=nativeSubmitCopy.en;
const pending={version:1,status:'pending',digest,snapshotId:'sha256:'+'e'.repeat(64),signed:null,transactionHash:null,request:{account:draftAccount(A),chainId:'ynx_6423-1',action:'dex_swap_exact_input',nonce:4,expiresAt:'2099-01-01T00:00:00.000Z',payload:{poolId:'dex_ynxt_usd',amountIn:10,minAmountOut:1,deadlineUnix:4102444800}}};
// Synthetic local UI doubles only, never a signature, installed Wallet or node claim.
const approved={...pending,status:'approved',signed:'{"localFixture":"signed-wire"}',transactionHash:hash};
const attempt={version:1,account:draftAccount(A),digest,hash,attemptedAt:'2026-09-12T00:00:00.000Z',status:'unknown',observation:null};
const launchTarget={status:'ready',installation:'unknown',automatic:false,requestDigest:digest,walletURL:'https://wallet.invalid/local-fixture',callback:'https://dex.ynxweb4.com/wallet-action/callback',downloadURL:'https://www.ynxweb4.com/dapp/download',expiresAt:pending.request.expiresAt};
const store=()=>({close:mocks.close,update:async(_key:string,change:(v:string|null)=>string|null)=>change(null)});
beforeEach(()=>{
  vi.resetAllMocks();vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No real network allowed');}));
  history.replaceState({},'', '/wallet-action/callback?applicationActionResult=LOCAL_FIXTURE');
  mocks.open.mockImplementation(async()=>store());mocks.read.mockResolvedValue(pending);mocks.accept.mockResolvedValue(approved);mocks.status.mockResolvedValue(null);mocks.discard.mockResolvedValue(undefined);mocks.submit.mockResolvedValue(attempt);mocks.check.mockResolvedValue({...attempt,status:'not_found'});
  mocks.subscribe.mockReturnValue(mocks.unsubscribe);mocks.prepare.mockResolvedValue(launchTarget);mocks.launch.mockReturnValue({status:'launch-attempted',installation:'unknown',automatic:false,requestDigest:digest});mocks.launcher.mockReturnValue({prepare:mocks.prepare,open:mocks.launch,invalidate:mocks.invalidate,dispose:mocks.dispose});
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();cleanup();history.replaceState({},'','/');vi.unstubAllGlobals();});
async function signedView(revision=0){mocks.read.mockResolvedValue(approved);const view=render(<NativeDraftPanel account={A} locale="en" revision={revision}/>);await screen.findByTestId('native-signed-json');await waitFor(()=>expect(screen.getByRole('checkbox')).not.toBeDisabled());return view;}

it('cold restore reads selected local request but neither accepts callback nor submits',async()=>{
  render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  expect(await screen.findByText(draftAccount(A))).toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledWith(draftAccount(A));expect(mocks.accept).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();expect(mocks.check).not.toHaveBeenCalled();
  expect(screen.getByRole('link')).toHaveAttribute('href','https://www.ynxweb4.com/dapp/download');
  expect(screen.queryByRole('button',{name:s.submit})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:nativeDraftCopy.en[4]}));await waitFor(()=>expect(mocks.discard).toHaveBeenCalledWith(draftAccount(A),digest));
});
it('explicit return verification saves decision before removing query and never sends',async()=>{
  let complete!:(value:unknown)=>void;mocks.accept.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const original=location.href;render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  fireEvent.click(await screen.findByRole('button',{name:s.verifyReturn}));
  await waitFor(()=>expect(mocks.accept).toHaveBeenCalledWith(draftAccount(A),original,expect.anything()));expect(location.href).toBe(original);
  await act(async()=>complete(approved));
  expect(await screen.findByText(s.verified)).toBeInTheDocument();expect(location.search).toBe('');
  expect(location.pathname).toBe('/');expect(screen.queryByRole('button',{name:s.verifyReturn})).not.toBeInTheDocument();
  expect(screen.getByTestId('native-signed-json').textContent).toBe(approved.signed);
  expect(mocks.submit).not.toHaveBeenCalled();expect(mocks.check).not.toHaveBeenCalled();expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('signed review shows exact bytes/hash/network/fee/limits/deadline and requires separate checkbox',async()=>{
  await signedView();
  expect(screen.getByTestId('native-signed-json').textContent).toBe(approved.signed);expect(screen.getByText(hash)).toBeInTheDocument();
  expect(screen.getByText('ynx_6423-1')).toBeInTheDocument();expect(screen.getByText(nativeDraftCopy.en[9])).toBeInTheDocument();
  expect(screen.getByText('{"minAmountOut":1}')).toBeInTheDocument();expect(screen.getByText(s.deadline)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:s.submit})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:s.submit}));expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:nativeDraftCopy.en[4]})).not.toBeInTheDocument();
});
it('only checked explicit submit calls once; repeated click never creates another attempt',async()=>{
  let complete!:(v:unknown)=>void;mocks.submit.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));await signedView();
  fireEvent.click(screen.getByRole('checkbox'));const submit=screen.getByRole('button',{name:s.submit});fireEvent.click(submit);fireEvent.click(submit);
  await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));const input=mocks.submit.mock.calls[0][0];
  expect(input).toMatchObject({account:draftAccount(A),digest,hash,confirmed:true});expect(input.isCurrent()).toBe(true);
  await act(async()=>complete(attempt));expect(await screen.findByText(s.attempted,{exact:false})).toBeInTheDocument();expect(screen.queryByRole('button',{name:s.submit})).not.toBeInTheDocument();
});
it.each(['unknown','not_found','memory_only','uncertain','pending_durable','durable'])('saved %s attempt restores without POST and permits only explicit same-hash GET',async status=>{
  mocks.read.mockResolvedValue(approved);mocks.status.mockResolvedValue({...attempt,status});render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  await screen.findByTestId('native-signed-json');expect(screen.queryByRole('button',{name:s.submit})).not.toBeInTheDocument();expect(mocks.submit).not.toHaveBeenCalled();expect(mocks.check).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:s.check}));await waitFor(()=>expect(mocks.check).toHaveBeenCalledWith(expect.objectContaining({account:draftAccount(A),digest,hash,isCurrent:expect.any(Function)})));
  expect(await screen.findByText(s.notFound)).toBeInTheDocument();expect(screen.getByText(s.observationBoundary)).toBeInTheDocument();expect(mocks.submit).not.toHaveBeenCalled();
});
it('expired signed payload disables first submit without manufacturing an attempt',async()=>{
  mocks.read.mockResolvedValue({...approved,request:{...approved.request,payload:{...approved.request.payload,deadlineUnix:1}}});render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  expect(await screen.findByText(s.expired)).toBeInTheDocument();expect(screen.getByRole('checkbox')).toBeDisabled();expect(screen.getByRole('button',{name:s.submit})).toBeDisabled();expect(screen.queryByRole('button',{name:s.check})).not.toBeInTheDocument();
});
it('account and same-account revision changes reset confirmation and hide previous results immediately',async()=>{
  const view=await signedView();fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('checkbox')).toBeChecked();
  view.rerender(<NativeDraftPanel account={A} locale="en" revision={1}/>);
  await waitFor(()=>expect(screen.getByRole('checkbox')).not.toBeDisabled());expect(screen.getByRole('checkbox')).not.toBeChecked();
  mocks.read.mockResolvedValue({...approved,request:{...approved.request,account:draftAccount(B)},digest:'b'.repeat(64)});
  view.rerender(<NativeDraftPanel account={B} locale="en" revision={1}/>);expect(screen.queryByText(draftAccount(A))).not.toBeInTheDocument();
  await screen.findByText(draftAccount(B));expect(screen.getByRole('checkbox')).not.toBeChecked();expect(mocks.submit).not.toHaveBeenCalled();
  view.rerender(<NativeDraftPanel account="" locale="en" revision={2}/>);expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
it('late opening cannot verify an old callback after selected account changes',async()=>{
  const view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(draftAccount(A));
  let opened!:(v:unknown)=>void;mocks.open.mockImplementationOnce(()=>new Promise(resolve=>{opened=resolve;}));fireEvent.click(screen.getByRole('button',{name:s.verifyReturn}));
  await waitFor(()=>expect(opened).toBeTypeOf('function'));mocks.read.mockResolvedValue(null);view.rerender(<NativeDraftPanel account={B} locale="en" revision={1}/>);
  await act(async()=>opened(store()));expect(mocks.accept).not.toHaveBeenCalled();expect(screen.queryByText(s.verified)).not.toBeInTheDocument();expect(location.search).not.toBe('');
});
it('late journal transaction change is fenced after a revision change',async()=>{
  let mutate!:()=>Promise<void>;mocks.accept.mockImplementation((_a,_u,guarded)=>new Promise((resolve,reject)=>{mutate=async()=>{try{await guarded.update('fixture',()=>JSON.stringify(approved));resolve(approved);}catch(error){reject(error);}};}));
  const view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);fireEvent.click(await screen.findByRole('button',{name:s.verifyReturn}));await waitFor(()=>expect(mutate).toBeTypeOf('function'));
  view.rerender(<NativeDraftPanel account={A} locale="en" revision={1}/>);await act(mutate);expect(screen.queryByText(s.verified)).not.toBeInTheDocument();expect(location.search).not.toBe('');expect(mocks.submit).not.toHaveBeenCalled();
});
it('late submission response is fenced on account change and isCurrent becomes false',async()=>{
  let complete!:(v:unknown)=>void;mocks.submit.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));const view=await signedView();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:s.submit}));await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));
  const input=mocks.submit.mock.calls[0][0];mocks.read.mockResolvedValue(null);view.rerender(<NativeDraftPanel account={B} locale="en" revision={1}/>);expect(input.isCurrent()).toBe(false);
  await act(async()=>complete({...attempt,status:'durable'}));expect(screen.queryByText('durable')).not.toBeInTheDocument();expect(screen.queryByText(hash)).not.toBeInTheDocument();
});
it('lost submit response reloads existing attempt and offers no resend',async()=>{
  await signedView();mocks.submit.mockRejectedValue(Error('DO_NOT_RENDER_INTERNAL_DETAIL'));mocks.status.mockResolvedValue(attempt);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:s.submit}));
  expect(await screen.findByRole('alert')).toHaveTextContent(s.submitError);expect(screen.queryByRole('button',{name:s.submit})).not.toBeInTheDocument();expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it('rejected Wallet decision is saved without first submission controls',async()=>{
  mocks.accept.mockResolvedValue({...pending,status:'rejected'});render(<NativeDraftPanel account={A} locale="en" revision={0}/>);fireEvent.click(await screen.findByRole('button',{name:s.verifyReturn}));
  await screen.findByText('rejected');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(mocks.submit).not.toHaveBeenCalled();
});
it('a normal product page offers no return-verification action without a callback payload',async()=>{
  history.replaceState({},'','/');render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(draftAccount(A));
  expect(screen.queryByRole('button',{name:s.verifyReturn})).not.toBeInTheDocument();expect(mocks.accept).not.toHaveBeenCalled();
});
it('an existing expired attempt permits only explicit same-hash lookup',async()=>{
  mocks.read.mockResolvedValue({...approved,request:{...approved.request,payload:{...approved.request.payload,deadlineUnix:1}}});mocks.status.mockResolvedValue(attempt);
  render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(s.expired);expect(screen.queryByRole('button',{name:s.submit})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:s.check}));await waitFor(()=>expect(mocks.check).toHaveBeenCalledTimes(1));expect(mocks.submit).not.toHaveBeenCalled();
});
it('shared launcher prepare and the current native click are separate; no automatic launch or submission',async()=>{
  const l=nativeLaunchCopy.en;render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(draftAccount(A));
  expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.launch).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:l[1]})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:l[0]}));await waitFor(()=>expect(screen.getByRole('button',{name:l[1]})).not.toBeDisabled());expect(mocks.launch).not.toHaveBeenCalled();
  const button=screen.getByRole('button',{name:l[1]});const nativeEvent=new MouseEvent('click',{bubbles:true});
  mocks.launch.mockImplementation((event,reviewed)=>{expect(event).toBe(nativeEvent);expect(event.currentTarget).not.toBeNull();expect(reviewed).toBe(digest);return {status:'launch-attempted',installation:'unknown'};});
  fireEvent(button,nativeEvent);expect(mocks.launch).toHaveBeenCalledTimes(1);expect(screen.getByText(l[3])).toBeInTheDocument();expect(button).toBeDisabled();expect(mocks.submit).not.toHaveBeenCalled();expect(mocks.accept).not.toHaveBeenCalled();
});
it('launcher reads only the existing pending request and never makes a new action',async()=>{
  render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(draftAccount(A));
  const options=mocks.launcher.mock.calls[0][1];expect(options.productId).toBe('dex');expect(options.getActiveAccount()).toBe(draftAccount(A));
  expect(await options.loadPendingRequest()).toBe(pending.request);expect(mocks.accept).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
});
it.each(['commit','hidden','pagehide','revision','disconnect'] as const)('%s invalidates a prepared launch without an automatic open',async kind=>{
  const l=nativeLaunchCopy.en,view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(draftAccount(A));
  fireEvent.click(screen.getByRole('button',{name:l[0]}));await waitFor(()=>expect(screen.getByRole('button',{name:l[1]})).not.toBeDisabled());
  if(kind==='commit')act(()=>mocks.subscribe.mock.calls[0][0]());
  if(kind==='pagehide')fireEvent(window,new Event('pagehide'));
  if(kind==='hidden'){const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');fireEvent(document,new Event('visibilitychange'));visibility.mockRestore();}
  if(kind==='revision')view.rerender(<NativeDraftPanel account={A} locale="en" revision={1}/>);
  if(kind==='disconnect')view.rerender(<NativeDraftPanel account="" locale="en" revision={1}/>);
  const button=screen.queryByRole('button',{name:l[1]});if(button)expect(button).toBeDisabled();expect(mocks.launch).not.toHaveBeenCalled();
  if(kind==='revision'||kind==='disconnect'){expect(mocks.dispose).toHaveBeenCalled();expect(mocks.unsubscribe).toHaveBeenCalled();}else expect(mocks.invalidate).toHaveBeenCalled();
});
it('late prepare cannot repopulate launch UI after provider revision changes',async()=>{
  let complete!:(value:unknown)=>void;mocks.prepare.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));const l=nativeLaunchCopy.en;
  const view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(draftAccount(A));fireEvent.click(screen.getByRole('button',{name:l[0]}));
  view.rerender(<NativeDraftPanel account={A} locale="en" revision={1}/>);await act(async()=>complete(launchTarget));expect(screen.getByRole('button',{name:l[1]})).toBeDisabled();expect(mocks.launch).not.toHaveBeenCalled();
});
it('a submission claim commit notice does not cancel its own identity fence',async()=>{
  let complete!:(value:unknown)=>void;mocks.submit.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));await signedView();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:s.submit}));
  await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));const input=mocks.submit.mock.calls[0][0];act(()=>mocks.subscribe.mock.calls[0][0]());expect(input.isCurrent()).toBe(true);
  await act(async()=>complete(attempt));expect(screen.queryByRole('button',{name:s.submit})).not.toBeInTheDocument();expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it.each(Object.keys(nativeSubmitCopy) as Locale[])('launcher failure updates to locale %s without exposing SDK internals',async locale=>{
  mocks.prepare.mockRejectedValue(Error('DO_NOT_RENDER_LAUNCH_INTERNALS'));const view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByText(draftAccount(A));
  fireEvent.click(screen.getByRole('button',{name:nativeLaunchCopy.en[0]}));await screen.findByRole('alert');view.rerender(<NativeDraftPanel account={A} locale={locale} revision={0}/>);
  expect(screen.getByRole('alert')).toHaveTextContent(nativeLaunchCopy[locale][4]);expect(screen.queryByText('DO_NOT_RENDER_LAUNCH_INTERNALS')).not.toBeInTheDocument();
  expect(nativeLaunchCopy[locale]).toHaveLength(6);for(const text of nativeLaunchCopy[locale])expect(text.trim().length).toBeGreaterThan(0);expect(mocks.launch).not.toHaveBeenCalled();
});
it.each(Object.keys(nativeSubmitCopy) as Locale[])('all action errors and review warnings change with locale %s',async locale=>{
  mocks.read.mockRejectedValue(Error('DO_NOT_RENDER_INTERNAL_DETAIL'));const view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);await screen.findByRole('alert');
  view.rerender(<NativeDraftPanel account={A} locale={locale} revision={0}/>);expect(screen.getByRole('alert')).toHaveTextContent(nativeSubmitCopy[locale].readError);expect(screen.getByText(nativeSubmitCopy[locale].boundary)).toBeInTheDocument();
  expect(Object.keys(nativeSubmitCopy[locale])).toEqual(Object.keys(s));for(const message of Object.values(nativeSubmitCopy[locale]))expect(message.trim().length).toBeGreaterThan(0);
  for(const key of ['readError','returnError','submitError','checkError','confirm','notFound','observationBoundary'] as const){if(locale!=='en')expect(nativeSubmitCopy[locale][key]).not.toBe(s[key]);}
  expect(screen.queryByText('DO_NOT_RENDER_INTERNAL_DETAIL')).not.toBeInTheDocument();
});
