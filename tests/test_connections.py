"""No cloud traffic or real credentials: provider contract and cancellation tests."""
import importlib.util
import json
import os
from pathlib import Path
import select
import socket
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('translationhub_server', os.environ.get('TRANSLATIONHUB_SERVER_FILE', Path(__file__).parents[1] / 'server.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ForwardTests(unittest.TestCase):
    def setUp(self):
        self.handler = object.__new__(module.Handler)
        self.calls = []
        self.info = {'model_info': {'general.architecture': 'plamo3', 'plamo3.context_length': 262144}}
        self.result = {'done': True, 'done_reason': 'stop', 'message': {'content': '結果'}, 'eval_count': 10}
        def stub(url, payload=None, headers=None, gas=False):
            self.calls.append((url, payload, headers, gas))
            return self.info if url.endswith('/api/show') else self.result
        self.handler.request_json = stub
        self.request = {'provider': 'ollama', 'endpoint': 'http://127.0.0.1:11435', 'model': 'local',
                        'action': 'chat', 'profile': 'plamo', 'messages': [{'role': 'user', 'content': 'Translate.'}]}

    def test_unfinished_output_is_rejected(self):
        self.result['done'] = False
        with self.assertRaisesRegex(ValueError, '完了'):
            self.handler.forward(self.request)

    def test_output_budget_is_not_accepted_as_success(self):
        for reason, count in [('length', 10), ('stop', 4096)]:
            self.result.update(done_reason=reason, eval_count=count)
            with self.assertRaisesRegex(ValueError, '出力上限'):
                self.handler.forward(self.request)

    def test_input_kept_and_output_reserved_for_cjk(self):
        text = '計測値は変更しない。' * 300
        self.request['messages'][0]['content'] = text
        self.handler.forward(self.request)
        payload = self.calls[-1][1]
        self.assertEqual(payload['messages'][0]['content'], text)
        self.assertFalse(payload['truncate'])
        self.assertFalse(payload['shift'])
        self.assertGreater(payload['options']['num_ctx'], 8192)
        self.assertLessEqual(payload['options']['num_ctx'], 32768)
        self.assertEqual(payload['options']['stop'], ['<|plamo:tag|>', '<|plamo:bos|>'])

    def test_short_context_model_refuses_unsafe_request(self):
        self.info['model_info']['plamo3.context_length'] = 4096
        self.request['messages'][0]['content'] = 'This paragraph must not be silently cut. ' * 100
        with self.assertRaisesRegex(ValueError, '文脈上限'):
            self.handler.forward(self.request)
        self.assertEqual(len(self.calls), 1)

    def test_plamo_reference_context_does_not_join_current_source(self):
        reference = 'Heavy rain had swollen the river overnight.\nEngineers found cracks in the earthen barrier.'
        source = 'The bank had to be reinforced before work could continue.'
        settings = '[plamo-translate]\ntarget_lang=ja\nsource_lang=en\n---\n' + reference
        self.request['messages'] = [
            {'role': 'system', 'content': settings},
            {'role': 'user', 'content': source},
        ]
        self.handler.forward(self.request)
        payload = self.calls[-1][1]
        self.assertEqual(payload['messages'], [
            {'role': 'system', 'content': settings},
            {'role': 'user', 'content': source},
        ])
        self.assertFalse(payload['truncate'])
        self.assertFalse(payload['shift'])

    def test_plamo_accepts_only_a_complete_bounded_history_pair(self):
        self.request['messages'] = [
            {'role': 'system', 'content': '[plamo-translate]\ntarget_lang=en\nsource_lang=ja'},
            {'role': 'user', 'content': '眼鏡を買った。'},
            {'role': 'assistant', 'content': 'I bought glasses.'},
            {'role': 'user', 'content': '毎日かけている。'},
        ]
        self.handler.forward(self.request)
        self.assertEqual(self.calls[-1][1]['messages'], self.request['messages'])
        for profile, role, size in [('gemma', 'assistant', 1), ('plamo', 'system', 1), ('plamo', 'assistant', 641)]:
            self.request['profile'] = profile
            self.request['messages'][2] = {'role': role, 'content': 'x' * size}
            with self.assertRaisesRegex(ValueError, 'history'):
                self.handler.forward(self.request)

    def test_reference_context_counts_toward_input_budget(self):
        self.info['model_info']['plamo3.context_length'] = 8192
        self.request['messages'] = [
            {'role': 'system', 'content': '[plamo-translate]\ntarget_lang=en\n---\n' + '参照文脈。' * 300},
            {'role': 'user', 'content': 'それは小さかった。'},
        ]
        with self.assertRaisesRegex(ValueError, '文脈上限'):
            self.handler.forward(self.request)
        self.assertEqual(len(self.calls), 1)

    def test_previous_request_context_is_not_reused(self):
        self.request['messages'] = [
            {'role': 'system', 'content': '[plamo-translate]\ntarget_lang=en\n---\n前の文書だけの参照。'},
            {'role': 'user', 'content': '最初の文書。'},
        ]
        self.handler.forward(self.request)
        self.request['messages'] = [
            {'role': 'system', 'content': '[plamo-translate]\ntarget_lang=en'},
            {'role': 'user', 'content': '別の文書。'},
        ]
        self.handler.forward(self.request)
        self.assertEqual(self.calls[-1][1]['messages'], self.request['messages'])
        self.assertNotIn('前の文書', json.dumps(self.calls[-1][1], ensure_ascii=False))

    def test_google_plain_text_is_not_unescaped_twice(self):
        raw = 'x < 0; AT&T; literal &lt; and &#39; and \\alpha'
        self.result = {'data': {'translations': [{'translatedText': raw}]}}
        result = self.handler.forward({'provider': 'google', 'key': 'synthetic-key', 'text': raw, 'source': 'en', 'target': 'ja'})
        url, payload, headers, _ = self.calls[-1]
        self.assertEqual(payload['format'], 'text')
        self.assertEqual(payload['q'], [raw])
        self.assertNotIn('synthetic-key', url)
        self.assertEqual(headers['X-Goog-Api-Key'], 'synthetic-key')
        self.assertEqual(result['data']['translations'][0]['translatedText'], raw)

    def test_cloud_model_is_blocked_before_text_request(self):
        self.info['remote_host'] = 'https://example.invalid'
        with self.assertRaisesRegex(ValueError, 'クラウド'):
            self.handler.forward(self.request)
        self.assertEqual(len(self.calls), 1)

    def test_cloud_limits_reject_before_any_outbound_request(self):
        for provider in ('google', 'gas'):
            for text in ('', 'x' * 3001, {'not': 'text'}):
                with self.assertRaises(ValueError):
                    self.handler.forward({'provider': provider, 'key': 'synthetic-key', 'text': text,
                        'secret': 'synthetic-secret-at-least-32-characters',
                        'endpoint': 'https://script.google.com/macros/s/synthetic/exec'})
        self.assertEqual(self.calls, [])

    def test_gas_fields_and_endpoint_are_passed_as_plain_data(self):
        self.handler.forward({'provider': 'gas', 'text': 'x < y; &lt;', 'source': 'auto', 'target': 'ja',
            'secret': 'synthetic-secret-at-least-32-characters',
            'endpoint': 'https://script.google.com/macros/s/synthetic/exec'})
        _, payload, _, gas = self.calls[0]
        self.assertTrue(gas)
        self.assertEqual(payload['text'], 'x < y; &lt;')
        self.assertEqual(payload['source'], 'auto')

    def test_explicit_loopback_endpoints_are_not_silently_retargeted(self):
        for supplied, expected in [('http://[::1]:11435', 'http://[::1]:11435/api/tags'),
                                   ('http://localhost', 'http://127.0.0.1:80/api/tags')]:
            self.handler.forward({'provider': 'ollama', 'endpoint': supplied, 'action': 'tags'})
            self.assertEqual(self.calls[-1][0], expected)
        with self.assertRaises(ValueError):
            self.handler.forward({'provider': 'ollama', 'endpoint': 'http://localhost:0', 'action': 'tags'})


class CancellationTests(unittest.TestCase):
    def test_browser_disconnect_closes_waiting_provider_socket(self):
        for status in (None, 500):
            with self.subTest(status=status):
                self.check_disconnect(status)

    def check_disconnect(self, status):
        started, closed = threading.Event(), threading.Event()
        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                if self.path == '/api/show':
                    body = b'{"model_info": {}}'
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    if status:
                        self.send_response(status)
                        self.send_header('Content-Length', '100000')
                        self.end_headers()
                    started.set()
                    # Wait during model loading or a stalled HTTP error body.
                    deadline = time.monotonic() + 4
                    while time.monotonic() < deadline:
                        if select.select([self.connection], [], [], .1)[0] and not self.connection.recv(1, socket.MSG_PEEK):
                            closed.set()
                            return
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        bridge = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        bridge.allowed_hosts = {f'127.0.0.1:{bridge.server_port}'}
        bridge.allowed_origins = set()
        bridge.session_token = 'synthetic-session'
        for server in (upstream, bridge):
            server.daemon_threads = True
            threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            body = json.dumps({'provider': 'ollama', 'endpoint': f'http://127.0.0.1:{upstream.server_port}',
                'model': 'local', 'action': 'chat', 'messages': [{'role': 'user', 'content': 'Non-secret sample.'}]}).encode()
            client = socket.create_connection(('127.0.0.1', bridge.server_port))
            headers = (f'POST /api/bridge HTTP/1.1\r\nHost: 127.0.0.1:{bridge.server_port}\r\n'
                       f'Content-Type: application/json\r\nX-TranslationHub-Token: synthetic-session\r\nContent-Length: {len(body)}\r\n\r\n')
            client.sendall(headers.encode() + body)
            self.assertTrue(started.wait(2), 'provider did not start')
            client.shutdown(socket.SHUT_RDWR)
            client.close()
            self.assertTrue(closed.wait(1.5), 'provider continued after browser cancellation')
        finally:
            for server in (bridge, upstream):
                server.shutdown()
                server.server_close()

    def test_deadline_interrupts_upstream(self):
        browser, peer = socket.socketpair()
        upstream, upstream_peer = socket.socketpair()
        try:
            with module.RequestScope(browser, timeout=.15) as scope:
                scope.attach(upstream)
                upstream_peer.settimeout(1)
                self.assertEqual(upstream_peer.recv(1), b'')
                with self.assertRaisesRegex(module.RequestCancelled, '時間内'):
                    scope.check()
        finally:
            for connection in (browser, peer, upstream, upstream_peer):
                connection.close()


class LocalTransportTests(unittest.TestCase):
    def test_local_model_bypasses_system_http_proxy(self):
        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                body = b'{"local": true}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        try:
            handler = object.__new__(module.Handler)
            # Unreachable loopback proxy: any accidental proxy use fails. No
            # request can reach the internet even if this regression returns.
            with patch.dict(os.environ, {'http_proxy': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1',
                                         'no_proxy': '', 'NO_PROXY': '', 'REQUEST_METHOD': ''}):
                result = handler.request_json(f'http://127.0.0.1:{upstream.server_port}/api/tags')
            self.assertEqual(result, {'local': True})
        finally:
            upstream.shutdown(); upstream.server_close()


if __name__ == '__main__':
    unittest.main()
