import importlib.util
from pathlib import Path
from unittest import mock
import unittest


spec=importlib.util.spec_from_file_location('runtime_hardware',Path(__file__).with_name('pq-runtime-hardware.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class HardwareControls(unittest.TestCase):
    def test_models_are_distinct_bounded_and_do_not_expose_serials(self):
        value=m.cpu_models('processor: 0\nmodel name: Example CPU\nSerial: private\nmodel name: Example CPU\n')
        self.assertEqual(value,['model name: Example CPU'])
        with self.assertRaises(RuntimeError):m.cpu_models('processor: 0\n')

    def test_total_memory_is_not_available_memory(self):
        self.assertEqual(m.memory_bytes('MemTotal: 123 kB\nMemAvailable: 1 kB\n'),123*1024)
        for text in ('MemTotal: 0 kB','MemTotal: 1 MB','MemTotal: 1 kB\nMemTotal: 2 kB'):
            with self.assertRaises(RuntimeError):m.memory_bytes(text)

    def test_mount_selection_uses_device_without_exporting_private_paths(self):
        text='1 0 8:1 / /private/path rw - ext4 /dev/private rw\n2 0 0:2 / /proc rw - proc proc rw\n'
        with mock.patch.object(m.os,'major',return_value=8),mock.patch.object(m.os,'minor',return_value=1):
            self.assertEqual(m.filesystem_type(text,0),'ext4')
            with self.assertRaises(RuntimeError):m.filesystem_type(text+'3 0 8:1 / /other rw - xfs dev rw\n',0)

    def test_observation_error_stays_missing_and_cannot_change_admission(self):
        with mock.patch.object(m.platform,'system',return_value='Linux'),mock.patch.object(m,'bounded',side_effect=PermissionError),mock.patch.object(m.os,'sched_getaffinity',return_value={2,3},create=True):
            value=m.capture('/missing-original-path')
        self.assertEqual(value['status'],'PARTIAL');self.assertEqual(value['effectiveAffinity'],[2,3])
        self.assertIsNone(value['cpuModels']);self.assertIsNone(value['filesystem'])
        self.assertFalse(value['admissionChanged']);self.assertFalse(value['sameHardwareAcrossRunsProven'])

    def test_non_linux_does_not_invent_proc_or_claim_runtime_hardware(self):
        with mock.patch.object(m.platform,'system',return_value='Darwin'),mock.patch.object(m,'bounded') as reader:
            value=m.capture('/tmp')
        reader.assert_not_called();self.assertEqual(value['status'],'NOT_SUPPLIED')


if __name__=='__main__':unittest.main()
