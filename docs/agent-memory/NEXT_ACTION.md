# Next Action

Read the final check rollup for PR `#11` at head `21a2f0412598ef94dd33ff132456c63d5cee6798`. For every failed job, open the failed log, classify whether the failure is Pay-owned or inherited from central main, fix all Pay-owned failures, run the matching local command, commit, push, and verify the new remote SHA. If all checks pass, update the Pay release record and dependency acceptance with the exact CI run IDs before requesting integration-owner acceptance.
