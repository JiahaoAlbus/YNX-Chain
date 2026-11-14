"""One approved numeric official-origin epoch GET; not a clock or route authority.

No profile, target/host/URL override, redirect, proxy, CA override or retry API.
Network execution requires a separately granted scope. Raw headers/body are not saved.
"""
import argparse,datetime,email.utils,http.client,json,re,socket,time
from pathlib import Path
from nym_https_stage_probe import ResponseSocket,SocketDeadlines,verified_context

HOST='cdn1.media-platform.net';IP='172.104.178.252'
ALLOWED=('Date','Age','Cache-Control','Expires','ETag','Last-Modified','X-Cache','Via','Content-Length')

def http_date(value):
    if not isinstance(value,str) or len(value)>128 or not re.fullmatch(r'[A-Za-z0-9,:+ \-]+',value):return None
    try:
        date=email.utils.parsedate_to_datetime(value)
        if date.tzinfo is None:return None
        return date.astimezone(datetime.timezone.utc).isoformat()
    except (ValueError,TypeError,OverflowError):return None

def header_data(name,values):
    if not values:return {'present':False}
    result={'present':True,'count':len(values)}
    if len(values)>4 or any(len(v)>512 for v in values):return dict(result,classification='BOUND_REJECTED')
    if name in ('Date','Expires','Last-Modified'):
        dates=[http_date(v) for v in values];return dict(result,UTC=dates,classification='PARSED_UNTRUSTED' if all(dates) else 'INVALID_DATE')
    if name in ('Age','Content-Length'):
        numbers=[int(v) if re.fullmatch(r'\d{1,10}',v) and int(v)<=2**32-1 else None for v in values]
        return dict(result,seconds=numbers if name=='Age' else None,bytes=numbers if name=='Content-Length' else None)
    if name=='Cache-Control':
        flags=[];seconds={};unknown=0
        for part in ','.join(values).lower().split(','):
            part=part.strip()
            if part in ('public','private','no-cache','no-store','must-revalidate','proxy-revalidate','immutable'):flags.append(part)
            elif (m:=re.fullmatch(r'(max-age|s-maxage|stale-while-revalidate|stale-if-error)\s*=\s*(\d{1,9})',part)):
                if m[1] in seconds:unknown+=1
                else:seconds[m[1]]=int(m[2])
            else:unknown+=1
        return dict(result,flags=sorted(set(flags)),seconds=seconds,unknownDirectiveCount=unknown)
    if name=='ETag':
        return dict(result,tags=[{'weak':v.startswith('W/'),'length':len(v),'quotedOpaqueToken':bool(re.fullmatch(r'(?:W/)?"[A-Za-z0-9._\-]{1,128}"',v))} for v in values])
    if name=='X-Cache':
        categories=[v.strip().upper() for raw in values for v in raw.split(',')]
        return dict(result,categories=[v if v in ('HIT','MISS','PASS','STALE','EXPIRED','BYPASS') else 'UNKNOWN' for v in categories[:16]],truncated=len(categories)>16)
    if name=='Via':
        parts=[v.strip() for raw in values for v in raw.split(',')]
        return dict(result,hopCount=len(parts),versions=[m[1] if (m:=re.match(r'(?:HTTP/)?(1\.0|1\.1|2|3)\s',v)) else 'UNKNOWN' for v in parts[:16]],peerNamesPersisted=False)
    raise ValueError('unapproved-header-name')

def epoch_data(body):
    if len(body)>4096:raise ValueError('EPOCH_BODY_LIMIT')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('EPOCH_DUPLICATE_KEY')
            result[key]=value
        return result
    value=json.loads(body,object_pairs_hook=unique)
    if not isinstance(value,dict) or set(value)!={'id','epochs_in_interval','current_epoch_id','total_elapsed_epochs','current_epoch_start','epoch_length'}:raise ValueError('EPOCH_SCHEMA')
    for key in ('id','epochs_in_interval','current_epoch_id','total_elapsed_epochs'):
        if type(value[key]) is not int or not 0<=value[key]<=2**64-1:raise ValueError('EPOCH_INTEGER')
    length=value['epoch_length']
    if not isinstance(length,dict) or set(length)!={'secs','nanos'} or type(length['secs']) is not int or not 600<=length['secs']<=86400 or type(length['nanos']) is not int or length['nanos']!=0:raise ValueError('EPOCH_DURATION')
    start=value['current_epoch_start']
    if not isinstance(start,str) or len(start)>64 or not re.fullmatch(r'[0-9T:.+Z\-]+',start):raise ValueError('EPOCH_TIME')
    parsed=datetime.datetime.fromisoformat(start.replace('Z','+00:00'))
    if parsed.tzinfo is None:raise ValueError('EPOCH_TIMEZONE')
    end=parsed+datetime.timedelta(seconds=length['secs'])
    return {'totalElapsedEpochs':value['total_elapsed_epochs'],'startUTC':parsed.isoformat(),'endUTC':end.isoformat(),'remainingByLocalWallSeconds':(end-datetime.datetime.now(datetime.timezone.utc)).total_seconds(),'notAnAdmission':True}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    a.output.mkdir(mode=0o700,exist_ok=False)
    start=time.monotonic();wall=datetime.datetime.now(datetime.timezone.utc);sock=socket.socket();tls=None;response=None
    guard=SocketDeadlines(sock,start+20);phase='numeric_tcp';verified=False
    result={'schema':'P05_OFFICIAL_EPOCH_CACHE_CONTROL_V1','localStartUTC':wall.isoformat(),'monotonicStart':start,'normalTLS':True,'NoTimeAuthority':True,'NoProductionAuthority':True,'rawHeadersOrBodyPersisted':False,'proxyOrDNSLookup':False,'phaseSeconds':{}}
    try:
        sock.settimeout(8);guard.begin_stage(8);sock.connect((IP,443));result['phaseSeconds']['TCPConnected']=time.monotonic()-start
        phase='TLS';guard.begin_stage(12);sock.settimeout(min(12,max(.01,start+20-time.monotonic())))
        tls=verified_context().wrap_socket(sock,server_hostname=HOST,do_handshake_on_connect=False);guard.set_socket(tls);tls.do_handshake();verified=True
        result['phaseSeconds']['TLSVerified']=time.monotonic()-start
        phase='HTTP';guard.begin_stage(20);tls.settimeout(max(.01,start+20-time.monotonic()))
        tls.sendall(b'GET /api/v1/epoch/current HTTP/1.1\r\nHost: cdn1.media-platform.net\r\nAccept: application/json\r\nConnection: close\r\n\r\n')
        wrapper=ResponseSocket(tls);response=http.client.HTTPResponse(wrapper);response.begin();wrapper.reader.header_done=True
        result['phaseSeconds']['HTTPHeaders']=time.monotonic()-start;result['HTTPStatus']=response.status
        result['headers']={name:header_data(name,response.headers.get_all(name,[])) for name in ALLOWED}
        dates=result['headers']['Date'].get('UTC',[])
        if len(dates)==1 and dates[0] is not None:
            result['apparentLocalWallMinusDateSeconds']=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(dates[0])).total_seconds()
            result['serverDateCouldBeCachedAndIsNotTrustedTime']=True
        if response.status!=200:raise ValueError('HTTP_STATUS_NOT_200')
        if response.length is not None and response.length>4096:raise ValueError('EPOCH_BODY_LIMIT')
        phase='epoch_body';body=response.read(4097)
        if response.length is not None and response.length!=0:raise ValueError('EPOCH_BODY_TRUNCATED')
        result['epoch']=epoch_data(body);result['phaseSeconds']['EpochComplete']=time.monotonic()-start
    except BaseException as error:
        result['firstFailure']={'phase':phase,'type':type(error).__name__,'fixedReason':str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z_]{1,64}',str(error)) else (guard.expired or 'CONTROL_REQUEST_FAILED')}
    finally:
        stopped=guard.finish()
        if response is not None:response.close()
        if tls is not None:tls.close()
        sock.close()
        result.update(localFinishUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),RTTSeconds=time.monotonic()-start,tlsHandshakeVerified=verified,deadlineOwnerJoined=stopped,ownedSocketsClosed=True)
        (a.output/'result.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({'result':str(a.output/'result.json'),'firstFailure':result.get('firstFailure'),'tlsHandshakeVerified':verified,'ownedSocketsClosed':True}),flush=True)
    return 1 if result.get('firstFailure') or not stopped else 0

if __name__=='__main__':raise SystemExit(main())
