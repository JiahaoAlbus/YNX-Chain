"""Bounded DATA-only readback of original synthetic header stream bytes.

This independently checks a producer receipt and content against caller-pinned
original bytes. It does not authenticate the producer, exclude replay, prove a
node/process/clock identity, establish coverage, or authorize a runtime.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import threading

_MAX_STREAM = 16 << 20
_MAX_RECEIPT = 512 << 10
_MAX_SELECTED = 500
_HEADER = b'{"version":"YNX-SYNTHETIC-HEADER-STREAM/v1","classification":"DATA_ONLY"}\n'
_FIELDS = ('height', 'headerHash', 'appHash', 'captureEpoch', 'attempt', 'monotonicNs')
_RECEIPT = ('version','classification','status','streamStatus','enqueued','written','bytes','sha256',
            'streamDurable','streamCleanupDebt','firstCauseBytes','firstCauseTruncated',
            'startupCoverageComplete','walReplayExcluded','nodeBindingVerified','runtimeAuthorized',
            'independentFinality','receiptPublicationVerified')
_spec=importlib.util.spec_from_file_location('header_stream_original_clock_reader',Path(__file__).with_name('pq-commit-clock-readback.py'))
_original=importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_original)


def _require(value):
    if not value: raise ValueError('original synthetic header stream DATA unavailable')


def _sha(raw): return hashlib.sha256(raw).hexdigest()


def _pin(value): return type(value) is str and re.fullmatch(r'[0-9a-f]{64}',value) is not None


def inspect_bytes(stream, receipt, *, stream_sha256, receipt_sha256, selected_heights=()):
    """Validate independently pinned raw inputs and return only bounded selected DATA.

    Any failure raises a generic ValueError without disclosing the receipt's
    potentially private first-cause text. Empty selection returns counts only.
    """
    _require(type(stream) is bytes and 0<len(stream)<=_MAX_STREAM and type(receipt) is bytes and 0<len(receipt)<=_MAX_RECEIPT)
    _require(_pin(stream_sha256) and _pin(receipt_sha256) and _sha(stream)==stream_sha256 and _sha(receipt)==receipt_sha256)
    _require(type(selected_heights) in (tuple,list) and len(selected_heights)<=_MAX_SELECTED
             and all(type(h) is int and 0<h<1<<63 for h in selected_heights)
             and len(set(selected_heights))==len(selected_heights))
    try:
        obj=_original.strict(receipt,_MAX_RECEIPT)
        _require(type(obj) is dict and tuple(obj)==_RECEIPT
                 and json.dumps(obj,separators=(',',':'),ensure_ascii=True).encode()+b'\n'==receipt)
        _require(obj['version']=='YNX-SYNTHETIC-HEADER-STREAM-RECEIPT/v1' and obj['classification']=='DATA_ONLY'
                 and obj['status']=='UNKNOWN' and obj['streamStatus']=='OBSERVED_DATA')
        _require(obj['streamDurable'] is True and obj['streamCleanupDebt'] is False
                 and obj['firstCauseBytes']==0 and type(obj['firstCauseBytes']) is int and obj['firstCauseTruncated'] is False)
        _require(all(obj[k] is False for k in ('startupCoverageComplete','walReplayExcluded','nodeBindingVerified',
                                                'runtimeAuthorized','independentFinality','receiptPublicationVerified')))
        _require(type(obj['enqueued']) is int and type(obj['written']) is int and type(obj['bytes']) is int
                 and 0<obj['written']==obj['enqueued']<1<<64 and obj['bytes']==len(stream) and obj['sha256']==stream_sha256)
        source=io.BytesIO(stream);_require(source.readline()==_HEADER)
        selected={}; wanted=set(selected_heights); previous=None; count=0
        for line in source:
            _require(line.endswith(b'\n') and len(line)<=512)
            row=_original.strict(line,512)
            _require(type(row) is dict and tuple(row)==_FIELDS)
            _require(json.dumps(row,separators=(',',':'),ensure_ascii=True).encode()+b'\n'==line)
            _require(type(row['height']) is int and 0<row['height']<1<<63
                     and all(type(row[k]) is int and 0<row[k]<1<<64 for k in ('captureEpoch','attempt'))
                     and all(_pin(row[k]) and row[k]!='0'*64 for k in ('headerHash','appHash')))
            ns=_original.decimal(row['monotonicNs'],positive=True)
            if previous is not None:
                h,epoch,attempt,old_ns=previous
                _require(row['height']==h+1 and row['captureEpoch']==epoch and row['attempt']>attempt and ns>=old_ns)
            previous=(row['height'],row['captureEpoch'],row['attempt'],ns);count+=1
            if row['height'] in wanted: selected[row['height']]=row
        _require(count==obj['written'] and len(selected)==len(wanted))
    except (ValueError,TypeError,KeyError,UnicodeError,OverflowError,RecursionError):
        raise ValueError('original synthetic header stream DATA unavailable') from None
    return dict(classification='DATA_ONLY',status='OBSERVED_DATA',streamSHA256=stream_sha256,
                receiptSHA256=receipt_sha256,events=count,selected=selected,
                sourceVerified=False,nodeBindingVerified=False,startupCoverageComplete=False,
                walReplayExcluded=False,runtimeAuthorized=False,independentFinality=False,
                receiptPublicationVerified=False)


_READBACK_STATE=sys.__dict__.setdefault('_ynx_synthetic_header_readback_state_v1',dict(lock=threading.Lock(),debts=[]))
_READBACK_CLOSE_CUSTODY=_READBACK_STATE['debts'] # Strongly retain original exceptions; never retry a numeric FD.


class _OriginalReadbackCloseUnknown(ValueError):
    def __init__(self,first_error,close_error):
        super().__init__('original synthetic header DATA readback cleanup UNKNOWN')
        self.firstError=first_error
        self.closeError=close_error
        self.additionalCloseErrors=[]
        self.firstErrorType=type(first_error).__name__
        self.readbackCleanupDebt=True
        _READBACK_CLOSE_CUSTODY.append(self)
OriginalReadbackCloseUnknown=_READBACK_STATE.setdefault('errorClass',_OriginalReadbackCloseUnknown)


def _close_after_primary(fd,primary):
    try:os.close(fd)
    except OSError as close_error:
        if isinstance(primary,OriginalReadbackCloseUnknown):
            primary.additionalCloseErrors.append(close_error)
            return primary
        return OriginalReadbackCloseUnknown(primary,close_error)
    return primary


def _close_after_success(fd):
    try:os.close(fd)
    except OSError as error:raise OriginalReadbackCloseUnknown(error,error) from None


def _read_leaf(directory,path,limit):
    fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=directory)
    try:
        before=os.fstat(fd)
        _require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode)==0o600
                 and before.st_uid==os.geteuid() and before.st_nlink==1 and 0<before.st_size<=limit)
        chunks=[];size=0
        while True:
            part=os.read(fd,min(65536,limit+1-size))
            if not part:break
            size+=len(part);_require(size<=limit);chunks.append(part)
        after=os.fstat(fd);named=os.stat(path.name,dir_fd=directory,follow_symlinks=False);current=path.lstat()
        fields=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_nlink,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
        _require(path.resolve(strict=True)==path and fields(before)==fields(after)==fields(named)==fields(current)
                 and size==before.st_size)
        result=b''.join(chunks)
    except BaseException as error:
        preserved=_close_after_primary(fd,error)
        if preserved is error:raise
        raise preserved from None
    _close_after_success(fd)
    return result


def _read_private_pair_owned(path,receipt_path):
    if _READBACK_CLOSE_CUSTODY:raise _READBACK_CLOSE_CUSTODY[0]
    _require(path.is_absolute() and '..' not in path.parts)
    directory=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        for part in path.parts[1:-1]:
            nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory)
            old,directory=directory,nxt
            _close_after_success(old)
        before=os.fstat(directory)
        _require(stat.S_ISDIR(before.st_mode) and stat.S_IMODE(before.st_mode)==0o700 and before.st_uid==os.geteuid())
        stream=_read_leaf(directory,path,_MAX_STREAM)
        receipt=_read_leaf(directory,receipt_path,_MAX_RECEIPT)
        after=os.fstat(directory);named=path.parent.lstat()
        fields=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_mtime_ns,x.st_ctime_ns)
        _require(path.parent.resolve(strict=True)==path.parent and fields(before)==fields(after)==fields(named))
    except BaseException as error:
        preserved=_close_after_primary(directory,error)
        if preserved is error:raise
        raise preserved from None
    _close_after_success(directory)
    return stream,receipt


def _read_private_pair(path,receipt_path):
    if not _READBACK_STATE['lock'].acquire(blocking=False):
        raise ValueError('original synthetic header DATA readback busy; preserve UNKNOWN')
    try:return _read_private_pair_owned(path,receipt_path)
    finally:_READBACK_STATE['lock'].release()


def inspect_paths(stream_path, receipt_path, *, stream_sha256, receipt_sha256, selected_heights=()):
    """Read private 0600 originals using anchored no-follow regular-file FDs."""
    try:
        stream_path=Path(stream_path); receipt_path=Path(receipt_path)
        _require(stream_path.is_absolute() and receipt_path==stream_path.with_name(stream_path.name+'.receipt.json'))
        stream,receipt=_read_private_pair(stream_path,receipt_path)
    except OriginalReadbackCloseUnknown:raise
    except (ValueError,OSError):
        raise ValueError('original synthetic header stream DATA unavailable') from None
    return inspect_bytes(stream,receipt,stream_sha256=stream_sha256,receipt_sha256=receipt_sha256,selected_heights=selected_heights)
