"""331's existing reply-SURB control logs, filtered before storage. No payloads.

Recipient equality identifies only the selected provider, never a request/stream.
Local enqueue is not remote receipt; absence is not proof of SURB exhaustion.
"""
import hashlib
import re
from nym_runtime_stage_observer import RuntimeStageObserver, RUST_LOG as BASE_RUST_LOG

RUST_LOG = (BASE_RUST_LOG +
    ',nym_client_core::client::replies::reply_controller::sender_controller=trace'
    ',nym_client_core::client::real_messages_control::message_handler=debug')
RECIPIENT = r'([1-9A-HJ-NP-Za-km-z]{32,44}\.[1-9A-HJ-NP-Za-km-z]{32,44}@[1-9A-HJ-NP-Za-km-z]{32,44})'

class ReplySurbObserver(RuntimeStageObserver):
    def feed(self, line):
        if not isinstance(line, str) or len(line) > 8192:
            return super().feed(line)
        parsed = re.fullmatch(r'\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(common/[A-Za-z0-9_./-]+\.rs):\d+: (.*)', line)
        if not parsed:
            return super().feed(line)
        level, source, text = parsed.groups()
        event = None
        if source.endswith('client-core/src/client/received_buffer.rs') and level == 'DEBUG':
            match = re.fullmatch(r'received request for (\d{1,10}) additional reply SURBs from ' + RECIPIENT, text)
            if match and int(match[1]) <= 2**32 - 1:
                event = self._event('additional_surbs_requested', match[2], requestedCount=int(match[1]))
        if source.endswith('client-core/src/client/replies/reply_controller/sender_controller.rs'):
            match = re.fullmatch(r'sent (\d{1,3}) reply SURBs to ' + RECIPIENT, text)
            if level == 'TRACE' and match and 1 <= int(match[1]) <= 100:
                event = self._event('additional_surbs_locally_enqueued', match[2], count=int(match[1]), remoteDeliveryProven=False)
            match = re.fullmatch(r'failed to send additional surbs to ' + RECIPIENT + r' - .{0,2048}', text)
            if level == 'WARN' and match:
                event = self._event('additional_surbs_enqueue_failed', match[1])
            match = re.fullmatch(RECIPIENT + r' asked us for reply SURBs even though we never sent them any anonymous messages before!', text)
            if level == 'WARN' and match:
                event = self._event('additional_surbs_unknown_peer_rejected', match[1])
        if source.endswith('client-core/src/client/real_messages_control/message_handler.rs') and level == 'DEBUG' and text == 'Sending additional reply SURBs with packet type Mix':
            event = dict(event='additional_surbs_generation_started', providerAssociation='NOT_OBSERVABLE', connectionAssociation='NOT_PROVEN')
        if event is None:
            return super().feed(line)
        # Same combined 256-event budget as the parent observer, not an extra
        # SURB log allowance. Known coverage loss independently stops the owner.
        if self.events >= 256:
            if self.first_failure is None:
                self.first_failure = dict(fixedReason='RUNTIME_OBSERVATION_LIMIT', classification='coverage_incomplete')
            self.dropped += 1
            return None
        self.events += 1
        name = event['event']; self.counts[name] = self.counts.get(name, 0) + 1
        event['NoProductionAuthority'] = True
        return event

    def _event(self, name, recipient, **fields):
        # Digest is only a transient equality input. Do not export raw address,
        # its hash, SURBs, errors, keys, or any message bytes.
        matches = self.provider_sha256 is not None and hashlib.sha256(recipient.encode('ascii')).hexdigest() == self.provider_sha256
        return dict(event=name, selectedProvider=matches,
                    providerAssociation='MATCHED_SELECTED_PROVIDER' if matches else 'NOT_MATCHED',
                    connectionAssociation='NOT_PROVEN', **fields)
