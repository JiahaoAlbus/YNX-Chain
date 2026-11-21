import unittest
from qualify_original_ethereum_ci import REQUIRED, qualify

class OriginalEthereumCITest(unittest.TestCase):
    def test_required_events_and_fail_closed(self):
        for kind, names in REQUIRED.items():
            package = "github.com/JiahaoAlbus/YNX-Chain/internal/" + kind
            event = lambda action, name=None: {"Package": package, "Action": action, **({"Test": name} if name else {})}
            good = [event("start")]
            for name in names:
                good += [event("run", name), event("pass", name)]
            good += [event("pass")]
            qualify(kind, good)
            for bad in (good[:-1], good[:1] + good[3:], good[:-1] + [event("skip", names[0]+"/child"), good[-1]], good[:-1] + [event("fail")], good[:1] + [event("pass", names[0])] + good[1:]):
                with self.assertRaises(ValueError):
                    qualify(kind, bad)

if __name__ == "__main__":
    unittest.main()
