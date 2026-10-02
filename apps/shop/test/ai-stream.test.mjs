import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestContext,contextChanged} from '../request-context.js';
import {streamJob} from '../ai-stream.js';

test('late stream chunks cannot cross logout or a closed and reopened AI view',async()=>{
  for(const logout of[false,true]){
    let subject='buyerA',controller,cancelled=false;const context=createRequestContext(()=>subject),states=[];
    const stream=new Response(new ReadableStream({start(c){controller=c},cancel(){cancelled=true}}));
    const pending=streamJob(context,'/stream',{},value=>states.push(value),async()=>stream);
    await Promise.resolve();await Promise.resolve();if(logout)subject='';context.invalidate();
    controller.enqueue(new TextEncoder().encode('data: {"Status":"old account result"}\n\n'));
    await assert.rejects(pending,contextChanged);assert.deepEqual(states,[]);assert.equal(cancelled,true);
  }
});

test('stream parser handles split CRLF events and preserves authoritative 401 status',async()=>{
  const context=createRequestContext(()=> 'buyerA'),states=[],encoder=new TextEncoder();
  const response=new Response(new ReadableStream({start(c){for(const text of['data: {"Status":','"running"}\r\n\r','\ndata: {"Status":"review_required"}\n\n'])c.enqueue(encoder.encode(text));c.close()}}));
  await streamJob(context,'/stream',{},state=>states.push(state.Status),async()=>response);assert.deepEqual(states,['running','review_required']);
  await assert.rejects(streamJob(context,'/stream',{},()=>{},async()=>new Response('{"error":"session expired"}',{status:401})),error=>error.status===401);
});

test('provider stream deadline aborts an open read instead of leaving generation pending',async()=>{
  const context=createRequestContext(()=> 'buyerA',{timeoutMs:15});let aborted=false;
  const fetcher=async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>{aborted=true;controller.error(new DOMException('Stream timed out','AbortError'))})}}));
  await assert.rejects(streamJob(context,'/stream',{},()=>{},fetcher),error=>error.name==='AbortError');assert.equal(aborted,true);
});
