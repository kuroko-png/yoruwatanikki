"""開発用サーバー（保存すると画面が自動で更新される）

使い方: このフォルダで  python dev.py  を実行（または start.bat をダブルクリック）
  - パソコン:  表示される http://localhost:5173
  - スマホ:    同じWi-Fiにつないで、表示される http://192.168.x.x:5173
止めるときは Ctrl + C
"""
import http.server, os, socket, socketserver, sys, threading, time

PORT = int(os.environ.get('PORT', 5173))
ROOT = os.path.dirname(os.path.abspath(__file__))
WATCH = ['index.html', 'manifest.webmanifest', 'src']
INJECT = b"""<script>window.__DEV__ = true;
(() => { const es = new EventSource('/__reload'); es.onmessage = () => location.reload(); })();
</script>"""

def snapshot():
    stamp = 0
    for w in WATCH:
        p = os.path.join(ROOT, w)
        if os.path.isfile(p):
            stamp = max(stamp, os.stat(p).st_mtime_ns)
        for dirpath, _, files in os.walk(p):
            for f in files:
                try: stamp = max(stamp, os.stat(os.path.join(dirpath, f)).st_mtime_ns)
                except OSError: pass
    return stamp

version = {'n': 0}
def watcher():
    last = snapshot()
    while True:
        time.sleep(.4)
        now = snapshot()
        if now != last:
            last = now; version['n'] += 1
            print(time.strftime('%H:%M:%S'), '変更を検知 → 画面を更新します', flush=True)
threading.Thread(target=watcher, daemon=True).start()

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
                      '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8'}
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, fmt, *args): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/__reload':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            seen = version['n']
            try:
                while True:
                    if version['n'] != seen:
                        self.wfile.write(b'data: reload\n\n'); self.wfile.flush(); return
                    time.sleep(.3)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return
        if path in ('/', '/index.html'):
            body = open(os.path.join(ROOT, 'index.html'), 'rb').read().replace(b'</head>', INJECT + b'\n</head>', 1)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body); return
        if path == '/sw.js':  # 開発中は service worker を使わない
            self.send_error(404); return
        super().do_GET()

def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); ip = s.getsockname()[0]; s.close(); return ip
    except OSError:
        return None

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == '__main__':
    httpd = Server(('0.0.0.0', PORT), Handler)
    print(f'夜渡日記 開発サーバー')
    print(f'  パソコン: http://localhost:{PORT}')
    ip = lan_ip()
    if ip: print(f'  スマホ:   http://{ip}:{PORT}  （同じWi-Fiにつないでください）')
    print('  ファイルを保存すると、開いている画面が自動で更新されます。止めるときは Ctrl + C', flush=True)
    try: httpd.serve_forever()
    except KeyboardInterrupt: print('\n止めました')
