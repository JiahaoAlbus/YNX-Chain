# Text size accessibility: description and focus

Parent: 6ea17a1e6904094670e3ef28303e8d7c6f78ca9c. Owned Card source only.

Existing radiogroup/radio semantics, checked state, single tab stop, Arrow/Home/End selection, 44px minimum target, device scaling and persisted preferences are preserved. Each radio now references the device-scaling description on Web and carries a localized native accessibility hint. Web focus has an explicit 3px Klein Blue outline and offset independent of selection. Blur removes only its own focus indication. Native does not receive DOM focus/ARIA description props.

Restricted owned typography fixtures: 16/16 passed, including 12 locales, focus/blur without selection changes, native descriptions, existing persistence ordering/storage failure/scaling. Frontend and server compiler-only typecheck passed. Evidence: typography-hints-focus-20261004.log and typography-hints-focus-typecheck-20261004.log. No actual SDK execution, main startup, real user Store, key, account access, signing or transaction. No full suite, formal build, deployment or screen-reader/browser visual claim in this checkpoint.

A's protected startup overlay remains held for constructor copied-key cleanup. This UI checkpoint does not adopt the held overlay, overwrite latest recovery UI with old210a, change original501/16 evidence, or claim a deployed protected producer/tuple. New formal runtime/full TEST journey remains unverified. All real issuance/PAN/CVV/fiat/real merchant payment remain false.
