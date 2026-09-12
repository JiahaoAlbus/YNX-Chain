import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortfolioPanel } from './PortfolioPanel';
import { nativeFixture } from './fixtures/native-fixture';

const A=`0x${'a'.repeat(40)}`,B=`0x${'b'.repeat(40)}`;
function responder(){
  return vi.fn(async(path:RequestInfo|URL)=>{
    const p=String(path),address=p.endsWith(B)?B:A;
    const value=nativeFixture(address);value.account.balance=address===A?'123':'456';value.balances[0].amount=value.account.balance;
    return new Response(JSON.stringify(value),{status:200});
  });
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('wallet account to native portfolio UI',()=>{
  it('guest browsing does not read an account or request Wallet permission',()=>{
    const fetch=responder();vi.stubGlobal('fetch',fetch);const connect=vi.fn();
    render(<PortfolioPanel account="" locale="en" onConnect={connect}/>);
    expect(fetch).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Connect Wallet'));expect(connect).toHaveBeenCalledOnce();
  });
  it('renders real native balance and changes owner without showing prior owner data',async()=>{
    vi.stubGlobal('fetch',responder());const view=render(<PortfolioPanel account={A} locale="en" onConnect={()=>{}}/>);
    expect(await screen.findByText('123')).toBeInTheDocument();
    view.rerender(<PortfolioPanel account={B} locale="en" onConnect={()=>{}}/>);
    expect(screen.queryByText('123')).not.toBeInTheDocument();expect(await screen.findByText('456')).toBeInTheDocument();
    view.rerender(<PortfolioPanel account="" locale="en" onConnect={()=>{}}/>);
    expect(screen.queryByText('456')).not.toBeInTheDocument();
  });
  it('ignores delayed requests after disconnect and account change',async()=>{
    const gates:Array<()=>void>=[],respond=responder();
    vi.stubGlobal('fetch',vi.fn((path:RequestInfo|URL)=>new Promise<Response>(resolve=>{
      gates.push(()=>{void respond(path).then(resolve);});
    })));
    const view=render(<PortfolioPanel account={A} locale="en" onConnect={()=>{}}/>);
    view.rerender(<PortfolioPanel account="" locale="en" onConnect={()=>{}}/>);
    await act(async()=>{gates.forEach(release=>release());});
    expect(screen.queryByText('123')).not.toBeInTheDocument();expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });
  it('exposes translated failure, then recovers using read-only retry and online event',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:503}));vi.stubGlobal('fetch',fetch);
    render(<PortfolioPanel account={A} locale="zh-CN" onConnect={()=>{}}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('余额未知');
    fetch.mockImplementation(responder());fireEvent.click(screen.getByText('刷新账本'));
    expect(await screen.findByText('123')).toBeInTheDocument();const before=fetch.mock.calls.length;
    fireEvent(window,new Event('online'));await waitFor(()=>expect(fetch.mock.calls.length).toBe(before+1));
  });
  it('ends a hung ledger request with a bounded unavailable state without disconnecting anything',async()=>{
    vi.useFakeTimers();
    vi.stubGlobal('fetch',vi.fn((_path:unknown,options:RequestInit)=>new Promise((_resolve,reject)=>{
      options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
    })));
    render(<PortfolioPanel account={A} locale="en" onConnect={()=>{}}/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(8001);});
    expect(screen.getByRole('alert')).toHaveTextContent('Balances are unknown');
    expect(screen.queryByText('Reading current ledger…')).not.toBeInTheDocument();
  });
});
