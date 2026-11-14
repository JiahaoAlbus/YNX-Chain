"""Candidate bridge to the unchanged original driver/Window, not a source grant.

The owning controller must freeze BOTH source/Tools/CI bindings before enabling
configured_adapters. No current or historical source inherits qualification here.
There is no execution CLI. The legacy single-arm controller is not called twice
and its one-Window gate is not patched. Instead the pair controller supplies two
independently verified driver modules and their original options/CI records.

OriginalDriverAdapter is the reviewable integration seam: verify_qualification
must perform the original checkout/tree, supplier, Go, hosted job and CI checks;
admit must enforce original resource floors/caps over ALL supplied storage roots.
Neither callback may turn a refusal into a return value. The original driver.run
still performs its own source, semantic, resource and hosted checks unchanged.

Registration is synchronous, BEFORE original Window.__init__, outside the
original driver's business exception handler. An exception is re-raised unchanged
and no original constructor, cache/key creation or child launch follows it.
Retirement checks the original on-disk receipt AND original Popen objects, worker
and observer evidence. It never repairs a failed receipt or resumes an UNKNOWN.
The Window lease spans execute AND retirement. Missing receipts or unresolved
cleanup keep that coordinator fenced; returning from driver.run is insufficient.
The tests use explicit low-cost lifecycle/source controls, not chain evidence.
"""
import copy
import importlib.util
import os
from pathlib import Path
import threading


spec = importlib.util.spec_from_file_location('pair_adapter_producer', Path(__file__).with_name('pq-same-runner-pair-producer.py'))
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)
require = producer.require

# Must be populated by the original controller owner in a reviewed frozen
# integration, together with original CI/dispatch wiring; NOT a runtime flag.
QUALIFIED_PAIR_BINDING = None
_WINDOW_LEASE = threading.Lock()


def configured_adapters(factory):
    """Refuse before loading a driver, reading keys or creating any Window."""
    require(QUALIFIED_PAIR_BINDING is not None,
            'same-runner original source/Tools/CI pair binding NOT_SUPPLIED')
    adapters = factory(copy.deepcopy(QUALIFIED_PAIR_BINDING))
    require(set(adapters) == set(producer.reader.ARMS), 'both original arm adapters required')
    return adapters


def roots(paths):
    result = []
    for value in paths:
        path = Path(value)
        require(path.is_absolute() and path.resolve(strict=True) == path,
                'canonical existing original storage root required')
        if any(root == path or root in path.parents for root in result):
            continue
        result = [root for root in result if path not in root.parents]
        result.append(path)
    return tuple(result)


class OriginalDriverAdapter:
    """One-shot bridge; controller-owned qualification is deliberately explicit."""
    def __init__(self, driver, options, qualification_record, *, verify_qualification,
                 admit, storage_roots):
        self.driver, self._run, self._window = driver, driver.run, driver.lab.Window
        require(isinstance(self._window, type) and self._window.__new__ is object.__new__,
                'unwrapped original Window class required; do not bypass another controller')
        self.options = copy.deepcopy(options)
        self._record = copy.deepcopy(qualification_record)
        self._verify, self._admission = verify_qualification, admit
        self.storage_roots = roots(storage_roots)
        self.retained_roots = ()
        self.qualified = self.admitted = self.used = self.retired = False
        self.window = self.work = self.result = self.execution_error = None
        self.registration_error = None
        self.stop_results, self.stop_errors = [], []
        self.threads_before = set()
        self._lease = None
        self._validate_options()

    def _validate_options(self):
        expected = copy.deepcopy(self._record['configuration']['options'])
        require(expected['source'] == 'source' and expected['execute'] is False,
                'original non-executing controller plan required')
        expected.update(source=self.options.source, execute=True)
        require(vars(self.options) == expected
                and self.options.commit == self._record['configuration']['source'],
                'original driver options differ from frozen arm configuration')
        roots((self.options.source,))

    def qualification_record(self):
        return copy.deepcopy(self._record)

    def qualify(self):
        self.qualified = self.admitted = False
        require(not self.used, 'original adapter already used; never retry UNKNOWN')
        self._validate_options()
        require(self._verify() == self._record, 'original source/Tools/CI qualification differs')
        self.qualified = True
        return self.qualification_record()

    def admit(self, retained_roots):
        self.admitted = False
        require(self.qualified and (not self.used or self.retired and self.execution_error is None),
                'original arm not qualified or not fully retired')
        self.retained_roots = roots((*self.storage_roots, *retained_roots))
        require(self._admission(self.retained_roots) is None,
                'original admission must raise on refusal')
        self.admitted = True

    def execute(self, register_work):
        require(self.qualified and self.admitted and not self.used and self.retained_roots,
                'one qualified, admitted original execution required')
        self._validate_options()
        require(_WINDOW_LEASE.acquire(blocking=False), 'another original Window bridge is active')
        self._lease = _WINDOW_LEASE
        self.used = True  # A failed registration/constructor is never retried.
        self.threads_before = set(threading.enumerate())
        original, owner = self._window, self
        execution_thread = threading.get_ident()
        calls = []

        class RegisteredWindow(original):
            def __init__(window, source, work, additional_storage=()):
                require(threading.get_ident() == execution_thread and not calls,
                        'one original Window on its owning execution thread required')
                calls.append(work)
                require(Path(source) == Path(owner.options.source), 'original Window source differs')
                owner.work = Path(work)
                try:
                    register_work(owner.work)
                except BaseException as error:
                    owner.registration_error = error
                    raise
                # No constructor/cache directory or child environment before
                # the durable fence returns successfully. Keep partial objects
                # too, so constructor failure cannot hide owned cleanup debt.
                owner.window = window
                storage = roots((*additional_storage, *owner.retained_roots))
                os.environ.pop('GH_TOKEN', None)
                os.environ.pop('GITHUB_TOKEN', None)
                original.__init__(window, source, work, additional_storage=storage)
                window.storage_roots = list(roots(window.storage_roots))
                owner.driver.lab.write_new(work/'public/FIRST100-HELD-CI.json', owner._record)

            def stop(window):
                try:
                    result = original.stop(window)
                except BaseException as error:
                    owner.stop_errors.append(error)
                    raise
                owner.stop_results.append(result)
                return result

        try:
            require(self.driver.run is self._run and self.driver.lab.Window is original,
                    'original driver/Window changed after adapter binding')
            self.driver.lab.Window = RegisteredWindow
            try:
                self.result = self._run(copy.deepcopy(self.options))
                require(len(calls) == 1 and self.registration_error is None,
                        'original driver did not propagate Window registration failure')
                return self.result
            finally:
                self.driver.lab.Window = original
        except BaseException as error:
            self.execution_error = error
            raise
        # Release only in retire(), after original cleanup evidence is checked.
        # Even a successful driver return may have an alive worker or observer.

    def _release_lease(self):
        if self._lease is not None:
            self._lease.release()
            self._lease = None

    def retire(self):
        require(self.used, 'original execution never entered')
        require(not self.retired, 'original retirement already consumed')
        if self.window is None:
            require(self.execution_error is not None, 'original Window missing without failure')
            # Registration failed before construction: no owned work to stop.
            # Never mark this arm retired/qualified for subsequent admission.
            self._release_lease()
            return []
        window = self.window
        if not self.stop_results or self.stop_results[-1] is not True:
            window.stop()  # Original owned cleanup only; no foreign PID scan here.
        require(not self.stop_errors and self.stop_results
                and all(value is True for value in self.stop_results),
                'original cleanup failed; preserve first cause and cleanup debt')
        children = [dict(pid=row['process'].pid, startTicks=row.get('startTicks'), process=row['process'])
                    for row in window.children]
        # The driver may raise after writing its receipt. Trust those original
        # bytes, never its mutable return dict or an invented cleanup success.
        files = producer.public_files(self.work)
        path = self.work.name+'/public/receipt.json'
        require(path in files, 'original arm receipt missing; cleanup alone is not completion')
        receipt = producer.strict(files[path])
        producer.retired(receipt, children, self.threads_before)
        require(self.registration_error is None, 'original registration failure blocks successor')
        self.retired = True
        self._release_lease()
        return children
