import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { NativeReceiptPanel } from './NativeReceiptPanel';
import golden from './fixtures/finance-receipt-fixture.json';
import { receiptCopy } from './receipt-i18n';
import type { Locale } from './types';
const hash=golden.transaction.hash;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const start=()=>{fireEvent.change(screen.getByRole('textbox'),{target:{value:hash}});fireEvent.click(screen.getByRole('button',{name:'Read receipt'}));};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('explicit guest native receipt lookup',()=>{
  it('does not read or connect on opening; one submit displays exact Core receipt and Explorer hash',async()=>{
    const fetch=vi.fn().mockResolvedValue(json(golden));vi.stubGlobal('fetch',fetch);
    render(<NativeReceiptPanel locale="en"/>);expect(fetch).not.toHaveBeenCalled();
    await act(async()=>start());
    expect(screen.getByRole('status')).toHaveTextContent('durable');
    expect(screen.getByRole('link')).toHaveAttribute('href','https://explorer.ynxweb4.com/tx/'+hash);
    expect(screen.getByText('Local durability is not consensus finality',{exact:false})).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('renders changed language errors without retrying HTTP or retaining previous locale text',async()=>{
    const fetch=vi.fn().mockResolvedValue(json({},503));vi.stubGlobal('fetch',fetch);
    const view=render(<NativeReceiptPanel locale="en"/>);await act(async()=>start());
    for(const locale of Object.keys(receiptCopy) as Locale[]){
      view.rerender(<NativeReceiptPanel locale={locale}/>);
      expect(screen.getByRole('alert')).toHaveTextContent(receiptCopy[locale][3]);
      expect(screen.getByRole('textbox')).toHaveAccessibleName(receiptCopy[locale][2]);
    }
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps not_found as an unknown observation and never broadcasts or creates nonce',async()=>{
    const fetch=vi.fn().mockResolvedValue(json({status:'not_found',transactionHash:hash},404));vi.stubGlobal('fetch',fetch);
    render(<NativeReceiptPanel locale="en"/>);await act(async()=>start());
    expect(screen.getByRole('status')).toHaveTextContent('not_found');
    expect(screen.getByText(receiptCopy.en[4])).toBeInTheDocument();
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'GET',credentials:'omit'});
  });
  it('ignores late first generation after newer read and retries only same lookup after network recovery',async()=>{
    let finish!:(value:Response)=>void;
    const fetch=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockResolvedValue(json(golden));vi.stubGlobal('fetch',fetch);
    render(<NativeReceiptPanel locale="en"/>);await act(async()=>start());
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Read receipt'})));
    expect(screen.getByRole('status')).toHaveTextContent('durable');
    await act(async()=>finish(json({status:'not_found',transactionHash:hash},404)));
    expect(screen.getByRole('status')).toHaveTextContent('durable');
    await act(async()=>window.dispatchEvent(new Event('online')));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every(([url])=>url==='/v1/native-transactions/'+hash)).toBe(true);
  });
  it('expires the eight second read and unmount removes the recovery listener',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn().mockImplementation((_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')));}));vi.stubGlobal('fetch',fetch);
    const view=render(<NativeReceiptPanel locale="en"/>);await act(async()=>start());
    await act(async()=>vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByRole('alert')).toHaveTextContent(receiptCopy.en[3]);
    view.unmount();window.dispatchEvent(new Event('online'));expect(fetch).toHaveBeenCalledOnce();
  });
});
