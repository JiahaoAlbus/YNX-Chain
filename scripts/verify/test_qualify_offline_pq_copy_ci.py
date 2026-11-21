import unittest
from qualify_offline_pq_copy_ci import SPECS, qualify

class OfflineCopyCITest(unittest.TestCase):
    def test_original_event_requirements(self):
        for kind, (suffix, names) in SPECS.items():
            package = 'github.com/JiahaoAlbus/YNX-Chain/' + suffix
            def event(action, name=None): return {'Package': package, 'Action': action, **({'Test': name} if name else {})}
            good = [event('start')]
            for name in names: good += [event('run', name), event('pass', name)]
            good += [event('pass')]
            qualify(kind, good)
            for bad in (good[:-1], good[:1] + good[3:], good[:-1] + [event('skip', names[0]+'/child'), good[-1]], good[:-1]+[event('fail')], good[:1]+[event('pass', names[0])]+good[1:]):
                with self.assertRaises(ValueError): qualify(kind, bad)

if __name__ == '__main__': unittest.main()
