"""Wait for the exact deployed revision, not a cached healthy predecessor."""
import argparse
import json
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('url')
parser.add_argument('commit')
parser.add_argument('--timeout', type=int, default=600)
args = parser.parse_args()
if not args.url.startswith('https://'):
    raise SystemExit('Production verification requires HTTPS')
deadline = time.monotonic() + args.timeout
while time.monotonic() < deadline:
    try:
        separator = '&' if '?' in args.url else '?'
        request = urllib.request.Request(args.url + separator + 'verify=' + str(time.time_ns()), headers={'Cache-Control':'no-cache'})
        with urllib.request.urlopen(request, timeout=15) as response:
            value = json.load(response)
        if value.get('commit') == args.commit:
            print('Verified deployed commit ' + args.commit)
            break
    except (OSError, ValueError):
        pass
    time.sleep(10)
else:
    raise SystemExit('Deployment did not serve the expected commit within the deadline')
