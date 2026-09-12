import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDexData } from './useDexData';
import { nativeFixture } from './fixtures/native-fixture';
import type { Locale } from './types';
function Probe({locale='en'}:{locale?:Locale}){
  const {data,retry}=useDexData(locale);
  return <><button onClick={retry}>Retry</button><output>{data.state==='ready'?data.data.provenance.snapshotId:data.state==='error'?data.message:data.state}</output></>;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('atomic market read lifecycle',()=>{
  it('keeps a newer retry generation when the older response arrives late, and ignores after unmount',async()=>{
    const pending:Array<(response:Response)=>void>=[];
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>pending.push(resolve))));
    const view=render(<Probe/>);fireEvent.click(screen.getByText('Retry'));
    const first=nativeFixture(null),second=nativeFixture(null);second.snapshotId='sha256:'+'f'.repeat(64);
    await act(async()=>{pending[1](new Response(JSON.stringify(second)));});
    expect(screen.getByRole('status')).toHaveTextContent(second.snapshotId);
    await act(async()=>{pending[0](new Response(JSON.stringify(first)));});
    expect(screen.getByRole('status')).toHaveTextContent(second.snapshotId);
    fireEvent.click(screen.getByText('Retry'));view.unmount();
    await act(async()=>{pending[2](new Response(JSON.stringify(first)));});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('times out a hung read even if fetch ignores abort, and translates existing errors without a new request',async()=>{
    vi.useFakeTimers();const fetch=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetch);
    const view=render(<Probe/>);await act(async()=>{await vi.advanceTimersByTimeAsync(8001);});
    expect(screen.getByRole('status')).toHaveTextContent('Ledger unavailable');
    view.rerender(<Probe locale="zh-CN"/>);expect(screen.getByRole('status')).toHaveTextContent('余额未知');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
