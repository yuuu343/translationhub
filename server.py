"""TranslationHub local companion. Standard library only; no content/credential logs."""
from __future__ import annotations

import argparse
import hmac
import json
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_BODY = 2 * 1024 * 1024


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlparse(newurl)
        if target.scheme != 'https' or target.hostname not in {'script.google.com', 'script.googleusercontent.com'}:
            raise ValueError('許可されていないリダイレクトです。')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('翻訳接続先のリダイレクトは許可されていません。')


class Handler(SimpleHTTPRequestHandler):
    server_version = 'TranslationHub/1.0'
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def log_message(self, _format, *args):
        # Deliberately no request URLs, document text, credentials, or client logs.
        return

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def valid_host(self):
        return self.headers.get('Host', '') in self.server.allowed_hosts

    def valid_origin(self):
        origin = self.headers.get('Origin')
        if origin:
            return origin in self.server.allowed_origins
        return self.headers.get('Sec-Fetch-Site', 'none') in {'none', 'same-origin'}

    def json_response(self, status, data):
        encoded = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.send_header('Cache-Control', 'no-store')
        origin = self.headers.get('Origin')
        if origin in self.server.allowed_origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_OPTIONS(self):
        if not self.valid_host() or not self.valid_origin():
            return self.json_response(403, {'error': '接続元が許可されていません。'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-TranslationHub-Token')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    def do_GET(self):
        if not self.valid_host():
            return self.json_response(403, {'error': 'Invalid host'})
        route = urllib.parse.urlsplit(self.path).path
        if route.startswith('/api/'):
            if not self.valid_origin():
                return self.json_response(403, {'error': '接続元が許可されていません。'})
            if route == '/api/session':
                return self.json_response(200, {'token': self.server.session_token})
            if route == '/api/health':
                return self.json_response(200, {'app': 'translationhub', 'version': '1.0', 'storesDocuments': False})
            return self.json_response(404, {'error': 'Unknown endpoint'})
        if route == '/integrations/google-apps-script.gs':
            data = (ROOT / 'integrations/google-apps-script.gs').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_POST(self):
        if not self.valid_host() or not self.valid_origin():
            return self.json_response(403, {'error': '接続元が許可されていません。'})
        token = self.headers.get('X-TranslationHub-Token', '')
        if not hmac.compare_digest(token, self.server.session_token):
            return self.json_response(403, {'error': '接続用トークンが無効です。画面を再読み込みしてください。'})
        if urllib.parse.urlsplit(self.path).path == '/api/easyread/import':
            return self.import_easyread()
        if self.path != '/api/bridge':
            return self.json_response(404, {'error': 'Unknown endpoint'})
        if self.headers.get_content_type() != 'application/json':
            return self.json_response(415, {'error': 'JSON required'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= MAX_BODY:
                return self.json_response(413, {'error': '送信する文章が大きすぎます。分割してください。'})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Invalid request')
            result = self.forward(data)
            return self.json_response(200, result)
        except urllib.error.HTTPError as error:
            # Provider responses can contain echoes; redact credentials before surfacing details.
            detail = ''
            try:
                payload = json.loads(error.read(65536))
                info = payload.get('error', '')
                detail = info.get('message', '') if isinstance(info, dict) else str(info)
                for secret in (data.get('key', ''), data.get('secret', '')):
                    if secret:
                        detail = detail.replace(secret, '[redacted]')
            except Exception:
                pass
            return self.json_response(502, {'error': f'翻訳先がエラーを返しました ({error.code})。{detail[:500]}'})
        except (urllib.error.URLError, TimeoutError, OSError):
            return self.json_response(502, {'error': '翻訳先に接続できませんでした。Ollamaの起動状態・接続先・ネット接続を確認してください。'})
        except (ValueError, KeyError, TypeError) as error:
            return self.json_response(400, {'error': str(error)[:400]})

    def import_easyread(self):
        if self.headers.get_content_type() != 'application/pdf':
            return self.json_response(415, {'error': 'PDFファイルを指定してください。'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 128 * 1024 * 1024:
                return self.json_response(413, {'error': 'EasyReadへの送信は128 MB以下のPDFに対応しています。'})
            body = self.rfile.read(size)
            if not body.startswith(b'%PDF-'):
                return self.json_response(400, {'error': 'PDF形式を確認できませんでした。'})
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            name = query.get('name', ['document.pdf'])[0][:240]
            url = 'http://127.0.0.1:8765/api/import?' + urllib.parse.urlencode({'translate': '0', 'read': '0', 'name': name})
            request = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/pdf'})
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.loads(response.read(1024 * 1024))
            document_id = str(result.get('id', ''))
            if not document_id or len(document_id) > 200:
                raise ValueError('EasyReadから文書IDが返りませんでした。')
            return self.json_response(200, {'id': document_id, 'url': 'http://127.0.0.1:8765/read/' + urllib.parse.quote(document_id, safe='')})
        except (urllib.error.URLError, TimeoutError, OSError):
            return self.json_response(502, {'error': 'この端末のEasyReadに接続できませんでした。EasyReadを127.0.0.1:8765で起動してください。'})
        except (ValueError, TypeError, KeyError) as error:
            return self.json_response(400, {'error': str(error)[:400]})

    def request_json(self, url, payload=None, headers=None, gas=False):
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8') if payload is not None else None,
                                     headers={'Content-Type': 'application/json', **(headers or {})})
        opener = urllib.request.build_opener(SafeRedirect() if gas else NoRedirect())
        with opener.open(req, timeout=180) as response:
            raw = response.read(8 * 1024 * 1024)
        try:
            result = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError('翻訳先からJSONが返りませんでした。Webアプリの公開URL・権限を確認してください。')
        if not isinstance(result, dict):
            raise ValueError('翻訳先の応答形式が不正です。')
        return result

    def forward(self, data):
        provider = data.get('provider')
        if provider == 'ollama':
            parsed = urllib.parse.urlparse(data.get('endpoint', ''))
            if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {'', '/'}:
                raise ValueError('Ollamaの接続先はこの端末のHTTPサーバーに限定されています。')
            endpoint = f'http://127.0.0.1:{parsed.port or 11434}'
            if data.get('action') == 'tags':
                return self.request_json(endpoint + '/api/tags')
            if data.get('action') != 'chat':
                raise ValueError('Invalid Ollama action')
            model = str(data.get('model', '')).strip()
            if not model or 'cloud' in model.lower():
                raise ValueError('この接続ではローカルモデルを指定してください。')
            info = self.request_json(endpoint + '/api/show', {'model': model})
            if info.get('remote_host') or info.get('remote_model'):
                raise ValueError('クラウドモデルへの送信はローカル接続では許可されていません。')
            messages = data.get('messages')
            if not isinstance(messages, list) or not 1 <= len(messages) <= 3:
                raise ValueError('Invalid messages')
            return self.request_json(endpoint + '/api/chat', {
                'model': model, 'messages': messages, 'stream': False,
                'options': {'temperature': 0, 'num_ctx': 8192, 'num_predict': 4096},
            })
        if provider == 'google':
            key = data.get('key', '')
            if not isinstance(key, str) or not key.strip() or '\n' in key or '\r' in key:
                raise ValueError('Google Cloud APIキーを確認してください。')
            payload = {'q': [str(data.get('text', ''))], 'target': str(data.get('target', 'ja')), 'format': 'text'}
            if data.get('source') not in {None, '', 'auto'}:
                payload['source'] = str(data['source'])
            return self.request_json('https://translation.googleapis.com/language/translate/v2', payload,
                                     {'X-Goog-Api-Key': key.strip()})
        if provider == 'gas':
            endpoint = data.get('endpoint', '')
            parsed = urllib.parse.urlparse(endpoint)
            if parsed.scheme != 'https' or parsed.hostname != 'script.google.com' or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.path.startswith('/macros/s/') or not parsed.path.endswith('/exec'):
                raise ValueError('Apps Scriptの /exec で終わる公開URLを指定してください。')
            return self.request_json(endpoint, {'secret': data.get('secret'), 'text': data.get('text'),
                                                'source': data.get('source'), 'target': data.get('target')}, gas=True)
        raise ValueError('Unknown provider')


def main():
    parser = argparse.ArgumentParser(description='TranslationHub local-only server')
    parser.add_argument('--port', type=int, default=8771)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--allow-origin', action='append', default=[], help='Explicit trusted HTTPS site origin (optional)')
    args = parser.parse_args()
    origins = {f'http://127.0.0.1:{args.port}', f'http://localhost:{args.port}'}
    for origin in args.allow_origin:
        p = urllib.parse.urlparse(origin)
        if p.scheme != 'https' or not p.hostname or p.path not in {'', '/'} or p.query or p.fragment or p.username:
            parser.error('--allow-origin must be an HTTPS origin without a path')
        origins.add(origin.rstrip('/'))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        print(f'Port {args.port} is already in use. If TranslationHub is running, open http://127.0.0.1:{args.port}.', file=sys.stderr)
        return 1
    server.daemon_threads = True
    server.allowed_hosts = {f'127.0.0.1:{args.port}', f'localhost:{args.port}'}
    server.allowed_origins = origins
    server.session_token = secrets.token_urlsafe(32)
    print(f'TranslationHub: http://127.0.0.1:{args.port}', flush=True)
    print('Local only. No document or credential logs. Press Ctrl+C to stop.', flush=True)
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(f'http://127.0.0.1:{args.port}')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
