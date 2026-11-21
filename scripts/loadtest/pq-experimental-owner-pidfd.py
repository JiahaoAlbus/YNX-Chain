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

    def send(self, signum):
        with self.lock:
            if self.fd is None:raise RuntimeError('original owner pidfd already closed')
            signal.pidfd_send_signal(self.fd,signum,None,0)

    def close(self):
        with self.lock:
            if self.fd is not None:
                os.close(self.fd)
                self.fd=None
