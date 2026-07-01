import json
import urllib.request

def get_status(base_url: str) -> dict:
    with urllib.request.urlopen(base_url.rstrip('/') + '/status', timeout=10) as response:
        return json.loads(response.read().decode('utf-8'))

