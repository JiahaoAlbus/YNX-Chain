"""Only bounded public diagnostic parsing; no network or time authority."""
import datetime,json,unittest
from epoch_cache_control import header_data,epoch_data

class HeaderControls(unittest.TestCase):
    def test_only_finite_header_values_are_retained(self):
        data=header_data('Cache-Control',['public, max-age=150, custom=PRIVATE_KEY'])
        self.assertEqual(data['seconds'],{'max-age':150});self.assertEqual(data['unknownDirectiveCount'],1)
        for name,value in [('ETag','"PRIVATE_KEY secret"'),('Via','1.1 private-gateway.invalid'),('X-Cache','COOKIE-secret')]:
            self.assertNotIn(value,json.dumps(header_data(name,[value])))
        self.assertEqual(header_data('X-Cache',['HIT, MISS'])['categories'],['HIT','MISS'])
    def test_dates_and_counts_never_change_local_time_or_policy(self):
        self.assertEqual(header_data('Date',['Sun, 08 Nov 2026 05:34:20 GMT'])['classification'],'PARSED_UNTRUSTED')
        self.assertEqual(header_data('Date',['PRIVATE_KEY'])['classification'],'INVALID_DATE')
        self.assertEqual(header_data('Age',['not-a-number'])['seconds'],[None])
        self.assertEqual(header_data('Via',['x'*513])['classification'],'BOUND_REJECTED')
    def test_expired_epoch_is_observation_not_admission_and_duplicate_or_boolean_is_rejected(self):
        value={'id':1,'epochs_in_interval':720,'current_epoch_id':1,'total_elapsed_epochs':34883,
               'current_epoch_start':'2020-01-01T00:00:00Z','epoch_length':{'secs':3600,'nanos':0}}
        observed=epoch_data(json.dumps(value).encode());self.assertTrue(observed['notAnAdmission']);self.assertLess(observed['remainingByLocalWallSeconds'],0)
        with self.assertRaises(ValueError):epoch_data(json.dumps(dict(value,total_elapsed_epochs=True)).encode())
        raw=json.dumps(value).replace('"id": 1','"id": 1, "id": 2').encode()
        with self.assertRaisesRegex(ValueError,'EPOCH_DUPLICATE_KEY'):epoch_data(raw)

if __name__=='__main__':unittest.main()
