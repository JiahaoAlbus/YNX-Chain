"""Pure bounded watchdog arithmetic. Grants no network/profile/route authority."""
import math
class BudgetUnavailable(ValueError):pass
def observation_plan(now_monotonic,now_wall,policy_expires,case_deadline,cleanup_reserve=20.0,terminal_grace=2.0):
 values=(now_monotonic,now_wall,policy_expires,case_deadline,cleanup_reserve,terminal_grace)
 if not all(math.isfinite(x) for x in values) or cleanup_reserve<15 or terminal_grace<0 or terminal_grace>2:raise BudgetUnavailable('invalid bounded timing inputs')
 policy_end=now_monotonic+(policy_expires-now_wall);work_end=case_deadline-cleanup_reserve
 if policy_end<=now_monotonic or policy_end+terminal_grace>work_end:raise BudgetUnavailable('insufficient case budget to observe original policy terminal and cleanup')
 return dict(policyDeadline=policy_end,observeUntil=policy_end+terminal_grace,workDeadline=work_end,caseDeadline=case_deadline)
def terminal_decision(plan,now_monotonic,exit_code):
 if exit_code is not None:
  if exit_code==0 and now_monotonic>=plan['policyDeadline']:return 'REJECT_LATE_SUCCESS'
  return 'CLIENT_TERMINAL'
 if now_monotonic>=plan['observeUntil']:return 'STOP_UNKNOWN'
 return 'WAIT_CLIENT_TERMINAL' if now_monotonic>=plan['policyDeadline'] else 'WAIT_CHILD'
