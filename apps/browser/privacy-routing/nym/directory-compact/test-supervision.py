#!/usr/bin/env python3
"""New watchdog delta only. No client, network, identity, build or profile access."""
import unittest
from directory_supervision import BudgetUnavailable, observation_plan, terminal_decision

class SupervisionTests(unittest.TestCase):
    def setUp(self):
        self.plan = observation_plan(10, 100, 210, 1000)

    def test_policy_terminal_is_not_cut_off_by_legacy_100_seconds(self):
        self.assertEqual(self.plan['policyDeadline'], 120)
        self.assertEqual(self.plan['observeUntil'], 122)
        self.assertGreater(self.plan['observeUntil'], 10 + 100)

    def test_late_success_cannot_be_consumed(self):
        self.assertEqual(terminal_decision(self.plan, 120.1, 0), 'REJECT_LATE_SUCCESS')

    def test_actual_client_failure_can_be_observed_after_expiry(self):
        self.assertEqual(terminal_decision(self.plan, 120.1, 1), 'CLIENT_TERMINAL')

    def test_post_expiry_wait_is_only_terminal_observation(self):
        self.assertEqual(terminal_decision(self.plan, 121, None), 'WAIT_CLIENT_TERMINAL')

    def test_missing_terminal_after_grace_remains_unknown(self):
        self.assertEqual(terminal_decision(self.plan, 122, None), 'STOP_UNKNOWN')

    def test_insufficient_cleanup_budget_rejects_launch(self):
        with self.assertRaises(BudgetUnavailable):
            observation_plan(10, 100, 210, 130)

if __name__ == '__main__':
    unittest.main()
