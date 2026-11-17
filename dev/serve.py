#!/usr/bin/env python3
"""Static server for the game, with caching disabled.

`index.html` is the whole game, so a stale cached copy silently looks like "the fix
didn't work" — every response therefore carries no-store headers. Binds 0.0.0.0 so the
sandbox preview proxy can reach it.

    python3 dev/serve.py [port] [root]
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else ROOT
    os.chdir(root)
    httpd = ThreadingHTTPServer(('0.0.0.0', port), NoStoreHandler)
    print('serving %s on http://0.0.0.0:%d' % (root, port), flush=True)
    httpd.serve_forever()


if __name__ == '__main__':
    main()
