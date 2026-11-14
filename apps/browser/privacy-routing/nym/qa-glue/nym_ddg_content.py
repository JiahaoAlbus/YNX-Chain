"""Classify complete fixed-query HTML and retain only counts and hashes."""
import hashlib
from html.parser import HTMLParser
from urllib.parse import urlsplit

from nym_https_stage_probe import PhaseFailure

BODY_LIMIT = 1_048_576


class SearchMarkup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = 0
        self.challenge = False
        self.current_link = False
        self.current_text = False

    def handle_starttag(self, tag, attrs):
        fields = {key: value or '' for key, value in attrs}
        if tag == 'form' and ('/anomaly.js' in fields.get('action', '') or fields.get('id') == 'challenge-form'):
            self.challenge = True
        if 'anomaly-modal' in fields.get('class', '').split() or fields.get('id') == 'anomaly-modal':
            self.challenge = True
        if tag != 'a':
            return
        self.current_link = self.current_text = False
        if 'result__a' not in fields.get('class', '').split():
            return
        href = fields.get('href', '')
        try:
            target = urlsplit(href)
            self.current_link = bool(target.hostname and (target.scheme in ('http', 'https') or href.startswith('//')))
        except ValueError:
            return

    def handle_data(self, data):
        if self.current_link and data.strip():
            self.current_text = True

    def handle_endtag(self, tag):
        if tag == 'a':
            if self.current_link and self.current_text:
                self.links += 1
            self.current_link = self.current_text = False


def read_search_response(response, begin_body):
    status = response.status
    common = dict(httpStatus=status, tlsHandshakeVerified=True, followedRedirect=False,
                  documentBodyComplete=False, searchResultLinks=0, bodyBytes=0, bodySHA256=None)
    if 300 <= status <= 399:
        return dict(common, siteClassification='REDIRECT_NOT_FOLLOWED')
    if status in (204, 205):
        return dict(common, siteClassification='HTTP_NO_CONTENT')
    if status not in (200, 202, 403, 429):
        return dict(common, siteClassification='HTTP_SITE_DENIED' if 400 <= status <= 499 else 'HTTP_SITE_ERROR')
    if response.headers.get_content_type() not in ('text/html', 'application/xhtml+xml'):
        return dict(common, siteClassification='HTTP_UNEXPECTED_CONTENT_TYPE')
    if response.headers.get('Content-Encoding', 'identity').lower() not in ('identity', ''):
        raise PhaseFailure('UNEXPECTED_CONTENT_ENCODING')
    lengths = response.headers.get_all('Content-Length', [])
    transfer = response.headers.get_all('Transfer-Encoding', [])
    if len(lengths) > 1 or len(transfer) > 1 or (lengths and transfer):
        raise PhaseFailure('AMBIGUOUS_BODY_FRAMING')
    if (lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or response.length is None)
            or transfer and transfer[0].lower() != 'chunked'):
        raise PhaseFailure('UNSUPPORTED_BODY_FRAMING')
    if response.length is not None and response.length > BODY_LIMIT:
        raise PhaseFailure('HTTP_BODY_LENGTH_LIMIT')
    begin_body()
    body = bytearray()
    while True:
        data = response.read1(min(8192, BODY_LIMIT - len(body) + 1))
        if not data:
            break
        body.extend(data)
        if len(body) > BODY_LIMIT:
            raise PhaseFailure('HTTP_BODY_LIMIT')
    if response.length is not None and response.length != 0:
        raise PhaseFailure('HTTP_BODY_TRUNCATED')
    markup = SearchMarkup()
    text = body.decode('utf-8', errors='replace')
    markup.feed(text)
    markup.close()
    complete_markup = '</html>' in text.lower()
    if not complete_markup:
        raise PhaseFailure('HTML_DOCUMENT_INCOMPLETE')
    if markup.challenge:
        classification = 'CAPTCHA'
    elif status == 202:
        classification = 'HTTP_202_UNVERIFIED'
    elif status != 200:
        classification = 'HTTP_SITE_DENIED'
    elif markup.links:
        classification = 'COMPLETE_SEARCH_RESULTS'
    else:
        classification = 'COMPLETE_HTML_NO_RESULTS_OBSERVED'
    return dict(common, siteClassification=classification, documentBodyComplete=True,
                searchResultLinks=markup.links if classification == 'COMPLETE_SEARCH_RESULTS' else 0,
                bodyBytes=len(body), bodySHA256=hashlib.sha256(body).hexdigest())
