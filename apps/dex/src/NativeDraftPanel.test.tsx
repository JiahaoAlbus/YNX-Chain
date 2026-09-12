import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeDraftPanel } from './NativeDraftPanel';
import { nativeDraftCopy } from './native-draft-i18n';
import type { Locale } from './types';
const mocks=vi.hoisted(()=>({read:vi.fn(),discard:vi.fn(),close:vi.fn()}));
vi.mock('./native-action-journal',()=>({openNativeActionStore:async()=>({close:mocks.close}),createNativeActionJournal:()=>({read:mocks.read,discardUnsigned:mocks.discard})}));
const A='0x2222222222222222222222222222222222222222',B='0x3333333333333333333333333333333333333333';
const draft={version:1,status:'pending',digest:'d'.repeat(64),snapshotId:'sha256:'+'s'.repeat(64),signed:null,transactionHash:null,request:{account:'selected-native-account',action:'dex_swap_exact_input',nonce:4,expiresAt:'2099-01-01T00:00:00.000Z',payload:{poolId:'dex_ynxt_usd',amountIn:10,minAmountOut:1,deadlineUnix:4102444800}}};
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No request allowed');}));mocks.read.mockResolvedValue(draft);mocks.discard.mockResolvedValue(undefined);});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('restores exact persisted review without any launch, provider or submit controls',async()=>{
  render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  expect(await screen.findByText('selected-native-account')).toBeInTheDocument();
  expect(screen.getByText(nativeDraftCopy.en[9])).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href','https://www.ynxweb4.com/dapp/download');
  expect(screen.getAllByRole('button').map(button=>button.textContent)).toEqual([nativeDraftCopy.en[3],nativeDraftCopy.en[4]]);
  fireEvent.click(screen.getByRole('button',{name:nativeDraftCopy.en[4]}));
  await waitFor(()=>expect(mocks.discard).toHaveBeenCalledWith(expect.stringMatching(/^ynx1/),'d'.repeat(64)));
});
it('hides old account immediately and fences late restore after account switch',async()=>{
  let resolveOld!:(v:unknown)=>void;mocks.read.mockImplementationOnce(()=>new Promise(done=>{resolveOld=done;})).mockResolvedValueOnce(null);
  const view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  await waitFor(()=>expect(resolveOld).toBeTypeOf('function'));
  view.rerender(<NativeDraftPanel account={B} locale="en" revision={0}/>);
  resolveOld(draft);
  await waitFor(()=>expect(mocks.close).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('selected-native-account')).not.toBeInTheDocument();
  view.rerender(<NativeDraftPanel account="" locale="en" revision={0}/>);expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
it('signed intent retains hash but has no discard or submit button',async()=>{
  mocks.read.mockResolvedValue({...draft,status:'approved',signed:'synthetic-signed-wire',transactionHash:'0x'+'a'.repeat(64)});
  render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  expect(await screen.findByText('0x'+'a'.repeat(64))).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:nativeDraftCopy.en[4]})).not.toBeInTheDocument();
  expect(screen.queryByText('synthetic-signed-wire')).not.toBeInTheDocument();
});
it.each(Object.keys(nativeDraftCopy) as Locale[])('errors and boundaries follow selected language %s',async locale=>{
  mocks.read.mockRejectedValue(Error('DO_NOT_RENDER_INTERNAL_DETAIL'));
  const view=render(<NativeDraftPanel account={A} locale="en" revision={0}/>);
  await screen.findByRole('alert');view.rerender(<NativeDraftPanel account={A} locale={locale} revision={0}/>);
  expect(screen.getByRole('alert')).toHaveTextContent(nativeDraftCopy[locale][7]);
  expect(screen.getByText(nativeDraftCopy[locale][5])).toBeInTheDocument();
  expect(screen.queryByText('DO_NOT_RENDER_INTERNAL_DETAIL')).not.toBeInTheDocument();
  expect(nativeDraftCopy[locale]).toHaveLength(10);
});
