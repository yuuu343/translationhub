"""TranslationHub local companion. Standard library only; no content/credential logs."""
from __future__ import annotations

import argparse
import hmac
import http.client
import json
import re
import secrets
import select
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_BODY = 2 * 1024 * 1024
MAX_RESPONSE = 8 * 1024 * 1024
PROVIDER_TIMEOUT = 180


class RequestCancelled(Exception):
    pass


class RequestScope:
    """Close upstream sockets when the browser leaves or the deadline expires."""
    def __init__(self, client, timeout=PROVIDER_TIMEOUT):
        self.client = client
        self.deadline = time.monotonic() + timeout
        self.finished = threading.Event()
        self.lock = threading.Lock()
        self.sockets = []
        self.reason = None
        self.disconnected = False

    def __enter__(self):
        threading.Thread(target=self.watch, daemon=True).start()
        return self

    def __exit__(self, *_):
        self.finished.set()

    def check(self):
        if self.reason:
            raise RequestCancelled(self.reason)

    def attach(self, upstream):
        with self.lock:
            self.sockets.append(upstream)
            cancelled = self.reason
        if cancelled:
            upstream.close()
            self.check()

    def cancel(self, reason):
        with self.lock:
            if self.reason:
                return
            self.reason = reason
            upstreams = list(self.sockets)
        for upstream in upstreams:
            try:
                upstream.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            upstream.close()

    def watch(self):
        while not self.finished.wait(.1):
            if time.monotonic() >= self.deadline:
                self.cancel('翻訳先の応答が時間内に完了しませんでした。文章を短くして再試行してください。')
                return
            try:
                ready, _, _ = select.select([self.client], [], [], 0)
                if ready and not self.client.recv(1, socket.MSG_PEEK):
                    self.disconnected = True
                    self.cancel('中止しました。送信済みのクラウド処理・料金は取り消せない場合があります。')
                    return
            except (OSError, ValueError):
                self.disconnected = True
                self.cancel('中止しました。')
                return


class ScopedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args, scope=None, **kwargs):
        self.scope = scope
        super().__init__(*args, **kwargs)

    def connect(self):
        if self.scope:
            self.scope.check()
        super().connect()
        if self.scope:
            self.scope.attach(self.sock)


class ScopedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, scope=None, **kwargs):
        self.scope = scope
        super().__init__(*args, **kwargs)

    def connect(self):
        if self.scope:
            self.scope.check()
        super().connect()
        if self.scope:
            self.scope.attach(self.sock)


class ScopedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, scope):
        self.scope = scope
        super().__init__()

    def http_open(self, req):
        return self.do_open(lambda *a, **kw: ScopedHTTPConnection(*a, scope=self.scope, **kw), req)


class ScopedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, scope):
        self.scope = scope
        super().__init__()

    def https_open(self, req):
        return self.do_open(lambda *a, **kw: ScopedHTTPSConnection(*a, scope=self.scope, **kw), req,
                            context=self._context)


def ollama_options(info, messages, profile):
    metadata = info.get('model_info') or {}
    architecture = metadata.get('general.architecture', '')
    context = metadata.get(f'{architecture}.context_length', 8192)
    if not isinstance(context, int) or context <= 0:
        context = 8192
    # PLaMo's training window is 32K even when GGUF advertises extrapolation.
    maximum = min(context, 32768)
    output = min(4096, maximum // 2)
    # UTF-8 bytes conservatively bound common byte-fallback tokenizers. The
    # runtime also receives truncate:false / shift:false as the final guard.
    required = sum(len(m['content'].encode('utf-8')) for m in messages) + 1024 + output
    if required > maximum:
        raise ValueError('原文と訳文がモデルの文脈上限を超える可能性があります。文章を短く区切ってください。')
    context = min(maximum, max(8192, 1 << (required - 1).bit_length()))
    options = {'temperature': 0, 'num_ctx': context, 'num_predict': output}
    if profile == 'plamo':
        options['stop'] = ['<|plamo:tag|>', '<|plamo:bos|>']
    return options


def translation_fields(data):
    text, source, target = data.get('text'), data.get('source', 'auto'), data.get('target', 'ja')
    if not isinstance(text, str) or not text.strip() or len(text) > 3000:
        raise ValueError('1回の送信は1〜3000文字にしてください。長い文章は分割してください。')
    code = r'[a-z]{2,3}(?:-[A-Za-z]{2,4})?'
    if (not isinstance(target, str) or not re.fullmatch(code, target) or
        (source not in (None, '', 'auto') and (not isinstance(source, str) or not re.fullmatch(code, source)))):
        raise ValueError('翻訳元・翻訳先の言語コードを確認してください。')
    return text, source, target


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
            with RequestScope(self.connection) as scope:
                self.request_scope = scope
                try:
                    result = self.forward(data)
                except Exception:
                    scope.check()
                    raise
                scope.check()
            return self.json_response(200, result)
        except RequestCancelled as error:
            if getattr(self, 'request_scope', None) and self.request_scope.disconnected:
                return
            return self.json_response(408, {'error': str(error)})
        except urllib.error.HTTPError as error:
            # Provider responses can contain echoes; redact credentials before surfacing details.
            detail = ''
            try:
                payload = json.loads(getattr(error, 'translationhub_body', b''))
                info = payload.get('error', '')
                detail = info.get('message', '') if isinstance(info, dict) else str(info)
                for secret in (data.get('key', ''), data.get('secret', '')):
                    if secret:
                        detail = detail.replace(secret, '[redacted]')
            except Exception:
                pass
            return self.json_response(502, {'error': f'翻訳先がエラーを返しました ({error.code})。{detail[:500]}'})
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
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
        scope = getattr(self, 'request_scope', None)
        if scope:
            scope.check()
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8') if payload is not None else None,
                                     headers={'Content-Type': 'application/json', **(headers or {})})
        handlers = [SafeRedirect() if gas else NoRedirect(), ScopedHTTPHandler(scope), ScopedHTTPSHandler(scope)]
        if urllib.parse.urlparse(url).hostname in {'127.0.0.1', 'localhost', '::1'}:
            # A system HTTP_PROXY must not route local-model text off-device.
            handlers.append(urllib.request.ProxyHandler({}))
        opener = urllib.request.build_opener(*handlers)
        try:
            with opener.open(req, timeout=PROVIDER_TIMEOUT) as response:
                raw = response.read(MAX_RESPONSE + 1)
        except urllib.error.HTTPError as error:
            # Read bounded error details while the cancellation/deadline scope
            # is still active, never after its watcher has already stopped.
            try:
                error.translationhub_body = error.read(65536)
            finally:
                error.close()
            raise
        if scope:
            scope.check()
        if len(raw) > MAX_RESPONSE:
            raise ValueError('翻訳先の応答が大きすぎます。文章を短く区切ってください。')
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
            port = parsed.port if parsed.port is not None else 80
            if port == 0:
                raise ValueError('Ollamaの接続先ポートは1〜65535で指定してください。')
            host = '[::1]' if parsed.hostname == '::1' else '127.0.0.1'
            endpoint = f'http://{host}:{port}'
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
            if (not isinstance(messages, list) or not 1 <= len(messages) <= 3 or
                any(not isinstance(m, dict) or m.get('role') not in {'system', 'user', 'assistant'} or
                    not isinstance(m.get('content'), str) for m in messages)):
                raise ValueError('Invalid messages')
            options = ollama_options(info, messages, data.get('profile'))
            result = self.request_json(endpoint + '/api/chat', {
                'model': model, 'messages': messages, 'stream': False, 'truncate': False, 'shift': False,
                'options': options,
            })
            if result.get('error'):
                return result
            if result.get('done') is not True:
                raise ValueError('モデルの応答が完了しませんでした。途中の訳文は採用していません。')
            if result.get('done_reason') == 'length' or result.get('eval_count', 0) >= options['num_predict']:
                raise ValueError('モデルの出力上限に達しました。文章を短く区切って再試行してください。')
            return result
        if provider == 'google':
            key = data.get('key', '')
            if not isinstance(key, str) or not key.strip() or '\n' in key or '\r' in key:
                raise ValueError('Google Cloud APIキーを確認してください。')
            text, source, target = translation_fields(data)
            payload = {'q': [text], 'target': target, 'format': 'text'}
            if source not in {None, '', 'auto'}:
                payload['source'] = source
            return self.request_json('https://translation.googleapis.com/language/translate/v2', payload,
                                     {'X-Goog-Api-Key': key.strip()})
        if provider == 'gas':
            text, source, target = translation_fields(data)
            secret = data.get('secret')
            if not isinstance(secret, str) or len(secret) < 32:
                raise ValueError('Apps Scriptの接続用シークレットは32文字以上で設定してください。')
            endpoint = data.get('endpoint', '')
            parsed = urllib.parse.urlparse(endpoint)
            if parsed.scheme != 'https' or parsed.hostname != 'script.google.com' or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.path.startswith('/macros/s/') or not parsed.path.endswith('/exec'):
                raise ValueError('Apps Scriptの /exec で終わる公開URLを指定してください。')
            return self.request_json(endpoint, {'secret': secret, 'text': text,
                                                'source': source, 'target': target}, gas=True)
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
