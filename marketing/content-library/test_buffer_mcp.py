"""Protocol fixtures test the client; they do not claim a live Buffer connection."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.request import Request
import buffer_mcp


class BufferMCPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.key = self.root / 'buffer-key'
        self.key.write_text('test-secret\n')
        self.key.chmod(0o600)
        self.requests = []

    def tearDown(self):
        self.temp.cleanup()

    def transport(self, url, headers, body, timeout):
        request = json.loads(body)
        self.requests.append((url, headers, request))
        if request['method'] == 'notifications/initialized':
            return 202, {}, b''
        if request['method'] == 'initialize':
            result = {'protocolVersion': '2025-06-18', 'capabilities': {'tools': {}}}
        elif request['method'] == 'tools/list':
            result = {'tools': [{'name': 'get_account', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}}]}
        else:
            result = {'content': [{'type': 'text', 'text': '{"account": "fixture"}'}]}
        return 200, {'Content-Type': 'application/json', 'Mcp-Session-Id': 'fixture-session'}, json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}).encode()

    def test_initializes_then_lists_tools_and_reuses_session(self):
        client = buffer_mcp.BufferMCP(self.key, transport=self.transport)
        self.assertEqual(client.tools()[0]['name'], 'get_account')
        self.assertEqual([r[2]['method'] for r in self.requests], ['initialize', 'notifications/initialized', 'tools/list'])
        self.assertEqual(self.requests[0][2]['params']['protocolVersion'], '2025-06-18')
        self.assertEqual(self.requests[1][1]['Mcp-Session-Id'], 'fixture-session')
        self.assertEqual(self.requests[2][1]['MCP-Protocol-Version'], '2025-06-18')
        self.assertEqual(self.requests[0][1]['Authorization'], 'Bearer test-secret')
        self.assertEqual(self.requests[0][0], 'https://mcp.buffer.com/mcp')
        self.assertIn('text/event-stream', self.requests[0][1]['Accept'])

    def test_key_must_be_private_regular_file_and_header_safe(self):
        for mode in (0o644, 0o640, 0o400):
            self.key.chmod(mode)
            with self.assertRaises(buffer_mcp.BufferError):
                buffer_mcp.BufferMCP(self.key)
        self.key.chmod(0o600)
        link = self.root / 'link'
        link.symlink_to(self.key)
        with self.assertRaises(buffer_mcp.BufferError):
            buffer_mcp.BufferMCP(link)
        for invalid in ('', 'test-secret\nInjected: value'):
            self.key.write_text(invalid)
            with self.assertRaises(buffer_mcp.BufferError) as error:
                buffer_mcp.BufferMCP(self.key)
            self.assertNotIn('test-secret', str(error.exception))

    def test_key_read_failure_is_sanitized(self):
        with self.assertRaises(buffer_mcp.BufferError) as error:
            buffer_mcp.BufferMCP(self.root / 'missing-secret-path')
        self.assertNotIn('missing-secret-path', str(error.exception))

    def test_sse_matches_response_among_notifications_with_multiline_data(self):
        def stream(url, headers, body, timeout):
            request = json.loads(body)
            if request['method'] != 'tools/list':
                return self.transport(url, headers, body, timeout)
            payload = {'jsonrpc': '2.0', 'id': request['id'], 'result': {'tools': []}}
            lines = json.dumps(payload, indent=2).splitlines()
            event = ': keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'
            event += '\r\n'.join('data: ' + line for line in lines) + '\r\n\r\n'
            return 200, {'Content-Type': 'text/event-stream; charset=utf-8'}, event.encode()
        self.assertEqual(buffer_mcp.BufferMCP(self.key, transport=stream).tools(), [])

    def test_http_rpc_and_malformed_errors_are_sanitized_without_retries(self):
        for status, headers, body in (
            (429, {'Retry-After': '12'}, b'test-secret'),
            (401, {}, b'test-secret'),
            (500, {}, b'test-secret'),
            (200, {'Content-Type': 'application/json'}, b'test-secret'),
            (200, {'Content-Type': 'application/json'}, b'{"jsonrpc":"2.0","id":999,"result":{}}'),
            (200, {'Content-Type': 'application/json'}, b'{"jsonrpc":"2.0","id":1,"error":{"message":"test-secret"}}'),
        ):
            calls = []
            def broken(*args):
                calls.append(args)
                return status, headers, body
            with self.subTest(status=status, body=body):
                with self.assertRaises(buffer_mcp.BufferError) as error:
                    buffer_mcp.BufferMCP(self.key, transport=broken).tools()
                self.assertNotIn('test-secret', str(error.exception))
                self.assertEqual(len(calls), 1)
                if status == 429:
                    self.assertEqual(error.exception.retry_after, 12)

    def test_transport_exception_is_sanitized_without_retry(self):
        calls = []
        def disconnected(*args):
            calls.append(args)
            raise TimeoutError('test-secret')
        with self.assertRaises(buffer_mcp.BufferError) as error:
            buffer_mcp.BufferMCP(self.key, transport=disconnected).tools()
        self.assertNotIn('test-secret', str(error.exception))
        self.assertEqual(len(calls), 1)

    def test_unsupported_protocol_fails_before_tools(self):
        def old_protocol(*args):
            status, headers, body = self.transport(*args)
            return status, headers, body.replace(b'2025-06-18', b'2024-11-05')
        with self.assertRaises(buffer_mcp.BufferError):
            buffer_mcp.BufferMCP(self.key, transport=old_protocol).tools()
        self.assertEqual(len(self.requests), 1)

    def test_tools_pagination_cache_and_private_capture(self):
        def paginated(url, headers, body, timeout):
            request = json.loads(body)
            if request['method'] != 'tools/list':
                return self.transport(url, headers, body, timeout)
            self.requests.append((url, headers, request))
            if request['params'].get('cursor') == 'second':
                result = {'tools': [{'name': 'get_post', 'inputSchema': {'type': 'object'}}]}
            else:
                result = {'tools': [{'name': 'get_account', 'inputSchema': {'type': 'object'}}], 'nextCursor': 'second'}
            return 200, {'Content-Type': 'application/json'}, json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}).encode()
        client = buffer_mcp.BufferMCP(self.key, transport=paginated)
        self.assertEqual([t['name'] for t in client.tools()], ['get_account', 'get_post'])
        client.tools()[0]['name'] = 'mutated'
        self.assertEqual(client.tools()[0]['name'], 'get_account')
        self.assertEqual(len(self.requests), 4)
        capture = self.root / 'schemas.json'
        client.discover_to(capture)
        self.assertEqual(capture.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(capture.read_text())['tools'][1]['name'], 'get_post')
        self.assertNotIn('test-secret', capture.read_text())

    def test_repeated_or_excess_tools_cursor_fails_bounded(self):
        for cursor in ('same', 'increment'):
            count = []
            def endless(url, headers, body, timeout):
                request = json.loads(body)
                if request['method'] != 'tools/list':
                    return self.transport(url, headers, body, timeout)
                count.append(1)
                result = {'tools': [], 'nextCursor': cursor if cursor == 'same' else str(len(count))}
                return 200, {'Content-Type': 'application/json'}, json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}).encode()
            with self.assertRaises(buffer_mcp.BufferError):
                buffer_mcp.BufferMCP(self.key, transport=endless).tools()
            self.assertLessEqual(len(count), 10)

    def test_read_helpers_use_discovered_tools_and_keep_mcp_result_envelope(self):
        def read_tools(url, headers, body, timeout):
            request = json.loads(body)
            if request['method'] == 'tools/list':
                self.requests.append((url, headers, request))
                tools = [{'name': name, 'inputSchema': {'type': 'object'}} for name in ('get_account', 'list_channels', 'get_channel', 'get_post')]
                return 200, {'Content-Type': 'application/json'}, json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': {'tools': tools}}).encode()
            return self.transport(url, headers, body, timeout)
        client = buffer_mcp.BufferMCP(self.key, transport=read_tools)
        self.assertIn('content', client.account())
        client.channels('org-fixture')
        client.get_post('post-fixture')
        calls = [r[2]['params'] for r in self.requests if r[2]['method'] == 'tools/call']
        self.assertEqual(calls, [{'name': 'get_account', 'arguments': {}}, {'name': 'list_channels', 'arguments': {'organizationId': 'org-fixture'}}, {'name': 'get_post', 'arguments': {'postId': 'post-fixture'}}])

    def test_unknown_or_write_tool_fails_before_any_remote_call(self):
        client = buffer_mcp.BufferMCP(self.key, transport=self.transport)
        for name in ('create_post', 'delete_post', 'invented_read'):
            with self.assertRaises(buffer_mcp.BufferError):
                client.call(name, {})
        self.assertEqual(self.requests, [])

    def test_tool_error_does_not_return_untrusted_text_or_retry(self):
        def tool_failure(url, headers, body, timeout):
            request = json.loads(body)
            if request['method'] == 'tools/call':
                self.requests.append((url, headers, request))
                result = {'isError': True, 'content': [{'type': 'text', 'text': 'test-secret'}]}
                return 200, {'Content-Type': 'application/json'}, json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}).encode()
            return self.transport(url, headers, body, timeout)
        client = buffer_mcp.BufferMCP(self.key, transport=tool_failure)
        with self.assertRaises(buffer_mcp.BufferError) as error:
            client.account()
        self.assertNotIn('test-secret', str(error.exception))
        self.assertEqual(len([r for r in self.requests if r[2]['method'] == 'tools/call']), 1)

    def test_default_transport_blocks_redirects_and_bounds_read(self):
        self.assertIsNone(buffer_mcp._NoRedirect().redirect_request(Request(buffer_mcp.ENDPOINT), None, 302, 'redirect', {}, 'https://other.invalid/'))
        class Response:
            status = 200
            headers = {'Content-Type': 'application/json'}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit):
                self.limit = limit
                return b'{}'
        response = Response()
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return response
        opener = Opener()
        with patch.object(buffer_mcp, 'build_opener', return_value=opener) as make_opener:
            self.assertEqual(buffer_mcp.http_transport(buffer_mcp.ENDPOINT, {'Authorization': 'Bearer test-secret'}, b'{}', 5), (200, response.headers, b'{}'))
        self.assertIsInstance(make_opener.call_args.args[0], buffer_mcp._NoRedirect)
        self.assertEqual(opener.request.get_method(), 'POST')
        self.assertEqual(opener.timeout, 5)
        self.assertEqual(response.limit, buffer_mcp.MAX_RESPONSE + 1)

    def test_invalid_response_and_discovery_shapes_fail_closed(self):
        for result in ({}, {'tools': 'bad'}, {'tools': [{'name': 'get_account'}]}, {'tools': [], 'nextCursor': 1}):
            def malformed(url, headers, body, timeout):
                request = json.loads(body)
                if request['method'] != 'tools/list':
                    return self.transport(url, headers, body, timeout)
                return 200, {'Content-Type': 'application/json'}, json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}).encode()
            with self.subTest(result=result), self.assertRaises(buffer_mcp.BufferError):
                buffer_mcp.BufferMCP(self.key, transport=malformed).tools()

    def test_failed_initialized_notification_keeps_client_uninitialized(self):
        def rejected(url, headers, body, timeout):
            request = json.loads(body)
            if request['method'] == 'notifications/initialized':
                return 400, {}, b'private-error'
            return self.transport(url, headers, body, timeout)
        client = buffer_mcp.BufferMCP(self.key, transport=rejected)
        with self.assertRaises(buffer_mcp.BufferError):
            client.tools()
        self.assertFalse(client._initialized)

    def test_timeout_must_be_finite_positive_and_bounded(self):
        for timeout in (0, -1, float('inf'), float('nan'), 301, True):
            with self.subTest(timeout=timeout), self.assertRaises(buffer_mcp.BufferError):
                buffer_mcp.BufferMCP(self.key, timeout=timeout)


if __name__ == '__main__':
    unittest.main()

class ResultDataTests(unittest.TestCase):
    def test_text_payload_ignores_rate_limit_block_and_rejects_ambiguity(self):
        envelope = {'content': [{'type': 'text', 'text': '{"id":"fixture"}'}, {'type': 'text', 'text': '{"rateLimit":{"remaining":5}}'}]}
        self.assertEqual(buffer_mcp.result_data(envelope), {'id': 'fixture'})
        envelope['content'].append({'type': 'text', 'text': '{"id":"other"}'})
        with self.assertRaises(buffer_mcp.BufferError):
            buffer_mcp.result_data(envelope)

    def test_channel_list_is_array(self):
        self.assertEqual(buffer_mcp.result_data({'content': [{'type': 'text', 'text': '[{"id":"fixture"}]'}]}), [{'id': 'fixture'}])


class WriteBoundaryTests(BufferMCPTests):
    def test_internal_write_allows_only_create_and_validates_live_schema(self):
        client = buffer_mcp.BufferMCP(self.key, transport=self.transport)
        client._tools = [{'name': 'create_post', 'inputSchema': {'type': 'object', 'properties': {'channelId': {'type': 'string', 'pattern': '^[a-f0-9]{24}$'}, 'mode': {'type': 'string', 'enum': ['customScheduled']}}, 'required': ['channelId', 'mode'], 'additionalProperties': False}}]
        for name, args in [('delete_post', {}), ('create_post', {'channelId': 'wrong', 'mode': 'customScheduled'}), ('create_post', {'channelId': '1' * 24, 'mode': 'shareNow'})]:
            with self.assertRaises(buffer_mcp.BufferError): client._write(name, args)
        self.assertEqual(self.requests, [])
        client._write('create_post', {'channelId': '1' * 24, 'mode': 'customScheduled'})
        self.assertEqual(len(self.requests), 1)
        with self.assertRaises(buffer_mcp.BufferError): client.call('create_post', {})

    def test_unrecognized_live_schema_constraint_fails_closed(self):
        self.assertFalse(buffer_mcp._schema_valid('short', {'type': 'string', 'minLength': 10}))
        self.assertFalse(buffer_mcp._schema_valid('anything', {'type': 'string', 'format': 'unknown-format'}))
