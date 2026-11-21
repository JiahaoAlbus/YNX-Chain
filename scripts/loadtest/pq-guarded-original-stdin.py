"""Experimental single-original stdin wrapper. No signing or retry authority.

All writes and flushes must use this wrapper from process creation onward. If a
writer holds the lock at cancellation we leave its exact stream intact, report
UNKNOWN/debt and never spawn a waiter or try again. An uncontended cut replaces
only the owned pipe fd with /dev/null before closing the buffered stream, so an
unsent command cannot be flushed to the child. This is not a process-tree or key
wipe attestation and does not enable any runtime profile.
"""
import os
import threading


class GuardedOriginalStdin:
    def __init__(self, original):
        self._original=original
        self._lock=threading.Lock()
        self._state=threading.Lock()
        self._attempted=False
        self._outcome=None
        self._closed=bool(original.closed)

    @property
    def closed(self):
        # Never query BufferedWriter.closed while another thread owns its
        # internal lock; this value is advanced only by the guarded cut.
        with self._state:return self._closed

    def fileno(self):return self._original.fileno()

    def write(self, value):
        with self._lock:
            if self._attempted:raise RuntimeError('original stdin retirement started; preserve UNKNOWN')
            return self._original.write(value)

    def flush(self):
        with self._lock:
            if self._attempted:raise RuntimeError('original stdin retirement started; preserve UNKNOWN')
            return self._original.flush()

    def cut_once(self, *, timeout=0.05):
        if not isinstance(timeout,(int,float)) or not 0<=timeout<=1:
            raise ValueError('bounded original stream lock wait required')
        with self._state:
            if self._attempted:
                return dict(self._outcome or dict(status='UNKNOWN',cleanupDebt=True,reason='original cut still in flight'))
            self._attempted=True
        result=dict(status='UNKNOWN',cleanupDebt=True,originalBytesReplayed=False)
        acquired=self._lock.acquire(timeout=timeout)
        if not acquired:
            result['reason']='original writer still holds stream; no close attempted'
        else:
            nullfd=None
            try:
                if self._original.closed:
                    result.update(reason='original stream already closed; no cut attested')
                else:
                    nullfd=os.open(os.devnull,os.O_WRONLY|os.O_CLOEXEC)
                    os.dup2(nullfd,self._original.fileno(),inheritable=False)
                    self._original.close()
                    with self._state:self._closed=True
                    result.update(status='CUT_AND_CLOSED',cleanupDebt=False)
            except BaseException as error:
                result.update(reason='original stream cut outcome uncertain',errorType=type(error).__name__)
            finally:
                if nullfd is not None:
                    try:os.close(nullfd)
                    except OSError as error:result.update(status='UNKNOWN',cleanupDebt=True,errorType=type(error).__name__)
                self._lock.release()
        with self._state:self._outcome=dict(result)
        return result
