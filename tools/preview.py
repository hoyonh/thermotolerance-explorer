"""Serve the viewer on loopback only. Static files, plus a read-only /__data__/ route for the project's
source CSVs and glossary files so the page can offer "Load project data folder".

    python3 tools/preview.py [--port 8766] [--open] [--data DIR]
"""
import argparse
import json
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / 'dist'
SOURCES = {'SKKU': 'Lithgow_SKKU_ldh.csv', 'JHU': 'Lithgow_NEWset3.csv'}
GLOSSARY = ['glossary.csv', 'config_glossary.csv']


class Handler(SimpleHTTPRequestHandler):
    data_dir = None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _send(self, body, ctype, status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/__data__/'):
            return self.serve_data(unquote(path[len('/__data__/'):]))
        return super().do_GET()

    def serve_data(self, name):
        allowed = {**{v: v for v in SOURCES.values()}, **{g: g for g in GLOSSARY}}
        d = self.data_dir
        if name == 'index.json':
            found = {k: v for k, v in SOURCES.items() if (d / v).is_file()}
            gl = [g for g in GLOSSARY if (d / g).is_file()]
            if not found:
                return self._send(b'{}', 'application/json', 404)
            return self._send(json.dumps({'sources': found, 'glossary': gl}).encode(), 'application/json')
        if name not in allowed or not (d / name).is_file():
            return self._send(b'Not found', 'text/plain', 404)
        return self._send((d / name).read_bytes(), 'text/csv; charset=utf-8')

    def log_message(self, fmt, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8766)
    ap.add_argument('--open', action='store_true')
    ap.add_argument('--data', default=str(ROOT.parents[1] / 'data'))
    a = ap.parse_args()
    Handler.data_dir = Path(a.data).expanduser().resolve()
    server = ThreadingHTTPServer(('127.0.0.1', a.port), partial(Handler, directory=str(ROOT)))
    url = f'http://127.0.0.1:{server.server_address[1]}/'
    print(f'Thermotolerance viewer: {url}\nProject data folder: {Handler.data_dir}\nPress Control-C to stop.', flush=True)
    if a.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
