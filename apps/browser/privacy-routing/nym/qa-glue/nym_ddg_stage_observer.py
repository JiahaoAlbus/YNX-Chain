"""Use the existing R7 parser for the fixed DuckDuckGo socket log scope."""
import re

SOURCE = re.compile(r'\S+\s+(?:TRACE|DEBUG|INFO|WARN|ERROR)\s+common/[a-zA-Z0-9_./-]+\.rs:\d+: (.*)')
DDG = 'html.duckduckgo.com:443'
RFC = 'www.rfc-editor.org:443'


def make_observer(parent, nonce, local_port):
    class FixedSearchObserver(parent):
        def feed(self, line):
            if isinstance(line, str) and len(line) <= 8192:
                match = SOURCE.fullmatch(line)
                if match:
                    message = match[1]
                    if message.startswith('Starting proxy for '+RFC+' (id: ') or ' → '+RFC in message or message.startswith(RFC+' → '):
                        self.dropped += 1
                        return None
                    if message.startswith('Starting proxy for '+DDG+' (id: ') or ' → '+DDG in message or message.startswith(DDG+' → '):
                        line = line[:match.start(1)] + message.replace(DDG, RFC)
            return super().feed(line)
    return FixedSearchObserver(nonce, local_port)
