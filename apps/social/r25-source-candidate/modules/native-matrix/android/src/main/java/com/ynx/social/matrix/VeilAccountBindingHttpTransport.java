package com.ynx.social.matrix;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.charset.CharacterCodingException;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLException;
import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;
import okio.BufferedSource;

/** Public HTTP only. Epochs fence local delivery, never account/device authority. */
public final class VeilAccountBindingHttpTransport {
    static final int LIMIT=8192, MAX_PENDING=8;
    static final String ENDPOINT="https://social.ynxweb4.com/v4/account-binding";
    private static final MediaType JSON=MediaType.get("application/json; charset=utf-8");
    public interface Completion { void finish(Result result); }
    public static final class Result {
        public final String epoch, handle, error, body;
        public final int status;
        private Result(String epoch,String handle,String error,int status,String body) {
            this.epoch=epoch;this.handle=handle;this.error=error;this.status=status;this.body=body;
        }
    }
    private static final class Pending {
        final String epoch,handle;
        Call call;
        Completion completion;
        byte[] payload;
        ScheduledFuture<?> timer;
        boolean started,submitted,delivered;
        boolean ioDone=true,deliveryDone=true;
        int status;
        Pending(String epoch,String handle) {this.epoch=epoch;this.handle=handle;}
    }
    private static final class Refusal extends IOException {
        final String code;
        Refusal(String code) {super(code);this.code=code;}
    }
    private final Object gate=new Object();
    // Includes reserved entries AND delivered-but-not-reaped worker tombstones.
    private final Map<String,Pending> pending=new LinkedHashMap<>();
    private final Call.Factory factory;
    private final long deadlineMillis;
    private final ScheduledThreadPoolExecutor clock;
    private final ThreadPoolExecutor workers;
    private final ThreadPoolExecutor deliveries;
    private long epoch=1,next=1;
    private boolean closed;
    static OkHttpClient fixedClient() {
        return new OkHttpClient.Builder().cache(null).cookieJar(CookieJar.NO_COOKIES)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .callTimeout(15,TimeUnit.SECONDS).connectTimeout(15,TimeUnit.SECONDS)
            .readTimeout(15,TimeUnit.SECONDS).writeTimeout(15,TimeUnit.SECONDS).build();
    }
    public VeilAccountBindingHttpTransport() {this(fixedClient(),15000);}
    // Only package-private PUBLIC controls use an injected factory/deadline.
    VeilAccountBindingHttpTransport(Call.Factory factory,long deadlineMillis) {
        this.factory=factory;this.deadlineMillis=deadlineMillis;
        clock=new ScheduledThreadPoolExecutor(1,r -> daemon(r,"YNX-binding-deadline"));
        clock.setRemoveOnCancelPolicy(true);
        clock.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        workers=new ThreadPoolExecutor(MAX_PENDING,MAX_PENDING,30,TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(MAX_PENDING),r -> daemon(r,"YNX-binding-io")) {
            @Override protected void afterExecute(Runnable task,Throwable failure) {
                // This runs AFTER the owned synchronous task and reader/close have exited.
                if (task instanceof IoJob) ioExited(((IoJob)task).p);
                super.afterExecute(task,failure);
            }
        };
        workers.allowCoreThreadTimeOut(true);
        deliveries=new ThreadPoolExecutor(4,4,30,TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(MAX_PENDING),r -> daemon(r,"YNX-binding-delivery")) {
            @Override protected void afterExecute(Runnable task,Throwable failure) {
                if (task instanceof DeliveryJob) {
                    synchronized(gate) {
                        Pending p=((DeliveryJob)task).p;
                        p.deliveryDone=true;reapLocked(p);
                    }
                }
                super.afterExecute(task,failure);
            }
        };
        deliveries.allowCoreThreadTimeOut(true);

    }
    private static Thread daemon(Runnable r,String name) {Thread t=new Thread(r,name);t.setDaemon(true);return t;}
    public String currentEpoch() {synchronized(gate) {requireOpen();return Long.toString(epoch);}}
    public String reserve(String expectedEpoch) {
        synchronized(gate) {
            requireOpen();
            if (!Long.toString(epoch).equals(expectedEpoch)) throw new IllegalStateException("STALE_CONTEXT");
            if (pending.size()>=MAX_PENDING) throw new IllegalStateException("HTTP_INVENTORY_FULL");
            if (next==Long.MAX_VALUE) throw new IllegalStateException("HTTP_HANDLE_EXHAUSTED");
            String handle=Long.toString(next++);pending.put(handle,new Pending(expectedEpoch,handle));return handle;
        }
    }
    public void start(String handle,String expectedEpoch,String token,Completion completion) {
        DeliveryJob delivery=null;
        synchronized(gate) {
            requireOpen();Pending p=pending.get(handle);
            if (p==null || p.started || !p.epoch.equals(expectedEpoch) || !Long.toString(epoch).equals(expectedEpoch))
                throw new IllegalStateException("INVALID_HTTP_HANDLE");
            p.started=true;p.completion=completion;
            try {
                p.timer=clock.schedule(() -> expire(p),deadlineMillis,TimeUnit.MILLISECONDS);
                p.payload=encodeToken(token);final byte[] bytes=p.payload;final int size=payloadLength(bytes);
                RequestBody body=new RequestBody() {
                    @Override public MediaType contentType() {return JSON;}
                    @Override public long contentLength() {return size;}
                    @Override public void writeTo(BufferedSink sink) throws IOException {sink.write(bytes,4,size);}
                };
                p.call=factory.newCall(new Request.Builder().url(ENDPOINT).post(body)
                    .header("Cache-Control","no-store, no-cache").header("Pragma","no-cache")
                    .header("Accept","application/json").header("Accept-Encoding","identity").build());
                workers.execute(new IoJob(p));p.submitted=true;p.ioDone=false;
            } catch (Throwable failure) {
                delivery=settleLocked(p,"INVALID_HTTP_REQUEST",null);
                clearIoLocked(p);reapLocked(p);
            }
        }
        dispatch(delivery);
    }
    private final class IoJob implements Runnable {
        final Pending p;
        IoJob(Pending p) {this.p=p;}
        @Override public void run() {
            Response response=null;byte[] buffer=new byte[LIMIT];String text=null;
            try {
                synchronized(gate) {if (p.delivered) return;}
                response=p.call.execute();
                synchronized(gate) {p.status=response.code();if (p.delivered) return;}
                if (p.status>=300 && p.status<400) throw new Refusal("HTTP_REDIRECT_REFUSED");
                if (!jsonContentType(response.headers("Content-Type"))) throw new Refusal("HTTP_CONTENT_TYPE_REFUSED");
                String encoding=response.header("Content-Encoding");
                if (encoding!=null && !encoding.equalsIgnoreCase("identity")) throw new Refusal("HTTP_UNEXPECTED_ENCODING");
                ResponseBody body=response.body();
                if (body==null) throw new Refusal("HTTP_BODY_MISSING");
                if (body.contentLength()>LIMIT) throw new Refusal("HTTP_BODY_TOO_LARGE");
                BufferedSource source=body.source();int used=0,empty=0;
                while (used<LIMIT) {
                    synchronized(gate) {if (p.delivered) return;}
                    int read=source.read(buffer,used,LIMIT-used);
                    if (read<0) break;
                    if (read==0) {if (++empty>8) throw new Refusal("HTTP_EMPTY_READ_LIMIT");continue;}
                    empty=0;used+=read;
                }
                if (used==LIMIT && !source.exhausted()) throw new Refusal("HTTP_BODY_TOO_LARGE");
                text=java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(buffer,0,used)).toString();
            } catch (Throwable failure) {
                String code=failure instanceof Refusal ? ((Refusal)failure).code
                    : failure instanceof CharacterCodingException ? "HTTP_BODY_MALFORMED"
                    : failure instanceof SSLException ? "HTTP_TLS_FAILED"
                    : failure instanceof InterruptedIOException ? "HTTP_TIMEOUT"
                    : p.status==0 ? "HTTP_NO_RESPONSE" : "HTTP_BODY_READ_FAILED";
                deliver(p,code,null);
            } finally {
                Arrays.fill(buffer,(byte)0);
                if (response!=null) {
                    try {response.close();}
                    catch (Throwable cleanup) {deliver(p,"HTTP_CLEANUP_FAILED",null);}
                }
                // Success is observed only after close returns. A blocked close holds the slot.
                deliver(p,null,text);
            }
        }
    }
    private final class DeliveryJob implements Runnable {
        final Pending p;
        final Completion completion;
        final Result result;
        DeliveryJob(Pending p,Completion completion,Result result) {
            this.p=p;this.completion=completion;this.result=result;
        }
        @Override public void run() {
            try {completion.finish(result);}
            catch (Throwable ignored) { /* never export callback/provider errors */ }
        }
    }
    // Caller owns gate. Only state/immutable DTO capture here, never external callback.
    private DeliveryJob settleLocked(Pending p,String error,String body) {
        if (pending.get(p.handle)!=p || p.delivered) return null;
        if (closed || !Long.toString(epoch).equals(p.epoch)) {error="HTTP_CANCELLED";body=null;}
        p.delivered=true;
        if (p.timer!=null) p.timer.cancel(false);
        Completion completion=p.completion;p.completion=null;
        if (completion==null) return null;
        p.deliveryDone=false;
        return new DeliveryJob(p,completion,new Result(p.epoch,p.handle,error,p.status,error==null?body:null));
    }
    private void dispatch(DeliveryJob job) {
        if (job==null) return;
        try {deliveries.execute(job);}
        catch (Throwable rejected) {
            // Fail closed: retain reservation. Never inline a callback or pretend it exited.
        }
    }
    private void deliver(Pending p,String error,String body) {
        DeliveryJob job;
        synchronized(gate) {job=settleLocked(p,error,body);}
        dispatch(job);
    }
    private void clearIoLocked(Pending p) {
        if (p.payload!=null) {Arrays.fill(p.payload,(byte)0);p.payload=null;}
        p.call=null;
    }
    private void ioExited(Pending p) {
        DeliveryJob job;
        synchronized(gate) {
            job=settleLocked(p,"HTTP_NO_RESPONSE",null);
            p.ioDone=true;clearIoLocked(p);reapLocked(p);
        }
        dispatch(job);
    }
    private void reapLocked(Pending p) {
        if (pending.get(p.handle)!=p || !p.delivered || !p.ioDone || !p.deliveryDone) return;
        pending.remove(p.handle);
        if (closed && pending.isEmpty()) deliveries.shutdown();
    }
    private static void abort(Call call) {if (call!=null) try {call.cancel();} catch (Throwable ignored) { /* primary unchanged */ }}
    private void expire(Pending p) {
        Call call;DeliveryJob job;
        synchronized(gate) {
            if (pending.get(p.handle)!=p || p.delivered) return;
            job=settleLocked(p,"HTTP_TIMEOUT",null);call=p.call;reapLocked(p);
        }
        dispatch(job);abort(call);
    }
    public boolean cancel(String handle) {
        Call call;DeliveryJob job;
        synchronized(gate) {
            Pending p=pending.get(handle);if (p==null || p.delivered) return false;
            job=settleLocked(p,"HTTP_CANCELLED",null);call=p.call;
            if (!p.submitted) clearIoLocked(p);
            reapLocked(p);
        }
        dispatch(job);abort(call);return true;
    }
    public String advanceContext() {
        String current;Pending[] entries;
        DeliveryJob[] jobs;
        synchronized(gate) {
            requireOpen();if (epoch==Long.MAX_VALUE) throw new IllegalStateException("HTTP_EPOCH_EXHAUSTED");
            epoch++;current=Long.toString(epoch);entries=pending.values().toArray(new Pending[0]);
            jobs=cancelAllLocked(entries);
        }
        dispatchCancelled(entries,jobs);return current;
    }
    public void close() {
        Pending[] entries;DeliveryJob[] jobs;
        synchronized(gate) {
            if (closed) return;closed=true;entries=pending.values().toArray(new Pending[0]);
            jobs=cancelAllLocked(entries);
            workers.shutdown();clock.shutdown();
            if (pending.isEmpty()) deliveries.shutdown();
        }
        dispatchCancelled(entries,jobs);
    }
    private DeliveryJob[] cancelAllLocked(Pending[] entries) {
        DeliveryJob[] jobs=new DeliveryJob[entries.length];
        for (int i=0;i<entries.length;i++) {
            Pending p=entries[i];jobs[i]=settleLocked(p,"HTTP_CANCELLED",null);
            if (!p.submitted) clearIoLocked(p);
            reapLocked(p);
        }
        return jobs;
    }
    private void dispatchCancelled(Pending[] entries,DeliveryJob[] jobs) {
        for (int i=0;i<entries.length;i++) {dispatch(jobs[i]);abort(entries[i].call);}
    }
    private void requireOpen() {if (closed) throw new IllegalStateException("HTTP_TRANSPORT_CLOSED");}
    // Parsed HTTP field values only: ASCII grammar, never Unicode trim or duplicate coalescing.
    private static boolean jsonContentType(List<String> values) {
        if (values.size()!=1) return false;
        String value=values.get(0);
        for (int i=0;i<value.length();i++) {
            char c=value.charAt(i);
            if (c!='\t' && (c<32 || c>126)) return false;
        }
        int n=value.length(),i=ows(value,0);
        if (!value.regionMatches(true,i,"application/json",0,16)) return false;
        i=ows(value,i+16);
        if (i==n) return true;
        if (value.charAt(i++)!=';') return false;
        i=ows(value,i);
        if (!value.regionMatches(true,i,"charset",0,7)) return false;
        i=ows(value,i+7);
        if (i>=n || value.charAt(i++)!='=') return false;
        i=ows(value,i);
        boolean quoted=i<n && value.charAt(i)=='"';
        if (quoted) i++;
        if (!value.regionMatches(true,i,"utf-8",0,5)) return false;
        i+=5;
        if (quoted && (i>=n || value.charAt(i++)!='"')) return false;
        return ows(value,i)==n;
    }
    private static int ows(String value,int i) {
        while (i<value.length() && (value.charAt(i)==' ' || value.charAt(i)=='\t')) i++;
        return i;
    }
    private static int payloadLength(byte[] b) {return ((b[0]&255)<<24)|((b[1]&255)<<16)|((b[2]&255)<<8)|(b[3]&255);}
    // Four-byte length prefix plus fixed 8192-byte JSON allocation, not persistent storage.
    private static byte[] encodeToken(String token) {
        if (token==null || token.isEmpty() || token.length()>LIMIT) throw new IllegalArgumentException();
        byte[] out=new byte[LIMIT+4];int n=4;
        try {
            byte[] prefix="{\"grantToken\":\"".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
            System.arraycopy(prefix,0,out,n,prefix.length);n+=prefix.length;
            for (int i=0;i<token.length();i++) {
                char c=token.charAt(i);int cp=c;
                if (Character.isHighSurrogate(c)) {
                    if (++i>=token.length() || !Character.isLowSurrogate(token.charAt(i))) throw new IllegalArgumentException();
                    cp=Character.toCodePoint(c,token.charAt(i));
                } else if (Character.isLowSurrogate(c)) throw new IllegalArgumentException();
                int need=cp<32?6:cp=='"'||cp=='\\'?2:cp<128?1:cp<2048?2:cp<65536?3:4;
                if (n+need+2>out.length) throw new IllegalArgumentException();
                if (cp<32) {
                    out[n++]='\\';out[n++]='u';out[n++]='0';out[n++]='0';
                    out[n++]=(byte)"0123456789abcdef".charAt(cp>>4);out[n++]=(byte)"0123456789abcdef".charAt(cp&15);
                } else if (cp=='"'||cp=='\\') {out[n++]='\\';out[n++]=(byte)cp;}
                else if (cp<128) out[n++]=(byte)cp;
                else {
                    if (cp>=65536) {out[n++]=(byte)(240|(cp>>18));out[n++]=(byte)(128|((cp>>12)&63));}
                    else if (cp>=2048) out[n++]=(byte)(224|(cp>>12));
                    else out[n++]=(byte)(192|(cp>>6));
                    if (cp>=2048) out[n++]=(byte)(128|((cp>>6)&63));
                    out[n++]=(byte)(128|(cp&63));
                }
            }
            out[n++]='"';out[n++]='}';int size=n-4;
            out[0]=(byte)(size>>24);out[1]=(byte)(size>>16);out[2]=(byte)(size>>8);out[3]=(byte)size;return out;
        } catch (RuntimeException failure) {Arrays.fill(out,(byte)0);throw failure;}
    }
}
