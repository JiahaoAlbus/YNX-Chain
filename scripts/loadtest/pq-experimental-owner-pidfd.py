"""Original synthetic owner process identity; experimental Linux-only DATA."""
import os
import signal
import sys
import threading


class OriginalOwnerPidfd:
    def __init__(self, process):
        if sys.platform != 'linux' or not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal'):
            raise RuntimeError('original Linux pidfd is required for experimental owner retirement')
        # Called immediately after the original Popen and before the process is
        # published to load workers/monitors. The original child is unreaped.
        if process.returncode is not None:
            raise RuntimeError('original owner process was already reaped')
        self.fd=os.pidfd_open(process.pid,0)
        self.pid=process.pid
        self.lock=threading.Lock()
        self._close_uncertain=False
        self._close_error_type=None

    def send(self, signum, *, timeout=.05):
        if type(timeout) not in (int,float) or not 0<=timeout<=.05:
            raise ValueError('bounded original pidfd signal wait required')
        if not self.lock.acquire(timeout=timeout):
            raise RuntimeError('original owner pidfd lock unavailable; preserve UNKNOWN and cleanup debt')
        try:
            if self.fd is None:raise RuntimeError('original owner pidfd already closed')
            signal.pidfd_send_signal(self.fd,signum,None,0)
        finally:self.lock.release()

    def close(self):
        if not self.close_bounded(timeout=1):
            raise RuntimeError('original pidfd close unknown; preserve cleanup debt')

    def close_bounded(self, timeout=0.05):
        """Retain identity debt if another original operation holds the lock."""
        if type(timeout) not in (int,float) or not 0<=timeout<=1:
            raise ValueError('bounded original pidfd close wait required')
        if not self.lock.acquire(timeout=timeout):return False
        try:
            if getattr(self,'_close_uncertain',False):return False
            if self.fd is not None:
                original=self.fd
                # A failed close can still have released this descriptor.
                # Disown its number before the single attempt and never send
                # or retry it if the syscall outcome is uncertain.
                self.fd=None
                self._close_uncertain=True
                try:os.close(original)
                except BaseException as error:
                    self._close_error_type=type(error).__name__
                    raise
                self._close_uncertain=False
            return True
        finally:self.lock.release()
