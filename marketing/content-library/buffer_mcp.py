"""Buffer's official remote MCP transport. No automatic request retries.

Only read tools are enabled until live schema discovery and an exact-approved
Queue scheduling adapter have been reviewed. This module never logs payloads.
"""
import copy
from datetime import datetime, timezone
import json
import os
import re
from urllib.parse import urlsplit
import stat
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

ENDPOINT = 'https://mcp.buffer.com/mcp'
PROTOCOL = '2025-06-18'
MAX_RESPONSE = 8 * 1024 * 1024
READ_TOOLS = frozenset({'get_account', 'list_channels', 'get_channel', 'get_post'})


class BufferError(ValueError):
    """Sanitized transport/protocol error; never contains provider bodies."""
    def __init__(self, message, *, status=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_transport(url, headers, body, timeout):
    request = Request(url, data=body, headers=headers, method='POST')
    # Never forward the bearer header to redirects, even within Buffer.
    try:
        response = build_opener(_NoRedirect()).open(request, timeout=timeout)
    except HTTPError as error:
        with error:
            return error.code, dict(error.headers), b''
    with response:
        return response.status, dict(response.headers), response.read(MAX_RESPONSE + 1)


class BufferMCP:
    def __init__(self, key_path, *, transport=None, timeout=30):
        if type(timeout) not in (int, float) or not 0 < timeout <= 300:
            raise BufferError('Buffer timeout must be between zero and 300 seconds')
        try:
            descriptor = os.open(key_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as key_file:
                info = os.fstat(key_file.fileno())
                if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.geteuid():
                    raise BufferError('Buffer key requires an owned regular file with mode 0600')
                key = key_file.read(8193).decode('ascii').strip()
                if not key or len(key) > 8192 or any(ord(c) < 33 or ord(c) > 126 for c in key):
                    raise BufferError('Invalid Buffer key file')
                self._key = key
        except (OSError, UnicodeError):
            raise BufferError('Cannot read private Buffer key file') from None
        self._transport = transport or http_transport
        self.timeout = timeout
        self._session = None
        self._initialized = False
        self._id = 0
        self._tools = None

    def _rpc(self, method, params=None, *, notification=False):
        headers = {'Authorization': 'Bearer ' + self._key,
                   'Content-Type': 'application/json',
                   'Accept': 'application/json, text/event-stream'}
        if self._session:
            headers['Mcp-Session-Id'] = self._session
        if self._initialized:
            headers['MCP-Protocol-Version'] = PROTOCOL
        message = {'jsonrpc': '2.0', 'method': method}
        if params is not None:
            message['params'] = params
        if not notification:
            self._id += 1
            message['id'] = self._id
        try:
            status, response_headers, body = self._transport(ENDPOINT, headers, json.dumps(message).encode(), self.timeout)
        except Exception:
            raise BufferError('Buffer request failed; no automatic retry') from None
        response_headers = {k.lower(): v for k, v in response_headers.items()}
        if status != 200 and not (notification and status == 202):
            retry = str(response_headers.get('retry-after', ''))
            retry = int(retry) if retry.isascii() and retry.isdigit() and len(retry) < 10 else None
            raise BufferError('Buffer HTTP request rejected', status=status, retry_after=retry)
        session = response_headers.get('mcp-session-id')
        if session:
            if not isinstance(session, str) or any(ord(c) < 33 or ord(c) > 126 for c in session):
                raise BufferError('Invalid MCP session header')
            self._session = session
        if notification:
            if status != 202 or body:
                raise BufferError('MCP notification not accepted')
            return None
        if not isinstance(body, bytes) or len(body) > MAX_RESPONSE:
            raise BufferError('Invalid or oversized MCP response')
        try:
            content_type = response_headers.get('content-type', '').split(';')[0].strip().lower()
            if content_type == 'application/json':
                messages = [json.loads(body)]
            elif content_type == 'text/event-stream':
                messages = []
                data = []
                for line in body.decode('utf-8-sig').splitlines() + ['']:
                    if not line:
                        if data:
                            messages.append(json.loads('\n'.join(data)))
                            data = []
                    elif line.startswith('data:'):
                        data.append(line[5:].removeprefix(' '))
            else:
                raise BufferError('Unsupported MCP response content type')
            matches = [m for m in messages if isinstance(m, dict) and type(m.get('id')) is int and m['id'] == message['id']]
            if len(matches) != 1:
                raise BufferError('Missing or ambiguous MCP response')
            response = matches[0]
            if response.get('jsonrpc') != '2.0' or 'error' in response or not isinstance(response.get('result'), dict):
                raise BufferError('MCP request failed or response invalid')
            return response['result']
        except (ValueError, UnicodeError, TypeError):
            raise BufferError('MCP request failed or response invalid') from None

    def initialize(self):
        if not self._initialized:
            result = self._rpc('initialize', {'protocolVersion': PROTOCOL, 'capabilities': {},
                               'clientInfo': {'name': 'meabeclick-content-machine', 'version': '1'}})
            if result.get('protocolVersion') != PROTOCOL:
                raise BufferError('Unsupported MCP protocol version')
            self._initialized = True
            try:
                self._rpc('notifications/initialized', notification=True)
            except BufferError:
                self._initialized = False
                raise

    def tools(self, *, refresh=False):
        """Discover live schemas, following at most ten MCP cursor pages."""
        if self._tools is not None and not refresh:
            return copy.deepcopy(self._tools)
        self.initialize()
        tools, cursors, names = [], set(), set()
        params = {}
        for _ in range(10):
            result = self._rpc('tools/list', params)
            page = result.get('tools')
            if not isinstance(page, list) or len(tools) + len(page) > 1000:
                raise BufferError('Invalid or excessive MCP tool list')
            for tool in page:
                if not isinstance(tool, dict) or not isinstance(tool.get('name'), str) or not tool['name'] or not isinstance(tool.get('inputSchema'), dict) or tool['name'] in names:
                    raise BufferError('Invalid or duplicate MCP tool schema')
                names.add(tool['name'])
                tools.append(tool)
            cursor = result.get('nextCursor')
            if cursor is None:
                self._tools = tools
                return copy.deepcopy(tools)
            if not isinstance(cursor, str) or not cursor or cursor in cursors:
                raise BufferError('Invalid or repeated MCP tool cursor')
            cursors.add(cursor)
            params = {'cursor': cursor}
        raise BufferError('MCP tool discovery page limit exceeded')

    def discover_to(self, path):
        """Persist exact live schemas privately. Never stores a bearer key."""
        snapshot = {'endpoint': ENDPOINT, 'protocolVersion': PROTOCOL,
                    'discovered_at': datetime.now(timezone.utc).isoformat(),
                    'tools': self.tools(refresh=True)}
        encoded = json.dumps(snapshot, ensure_ascii=False, indent=2)
        if self._key in encoded:
            raise BufferError('Refusing credential-bearing MCP discovery snapshot')
        path = Path(path)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.buffer-discovery-', delete=False) as output:
                temporary = Path(output.name)
                os.fchmod(output.fileno(), 0o600)
                output.write(encoded + '\n')
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        except OSError:
            raise BufferError('Cannot save private MCP discovery snapshot') from None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        return snapshot

    @staticmethod
    def _rate_limit(result):
        """Return a retry delay only for a provider-reported exhausted limit."""
        delays = []
        for item in result.get('content', []):
            try:
                body = json.loads(item.get('text', ''))
            except (AttributeError, TypeError, ValueError):
                continue
            if not isinstance(body, dict):
                continue
            for limit in body.get('rateLimit', []):
                if not isinstance(limit, dict) or limit.get('remaining') != 0:
                    continue
                seconds = limit.get('resetSeconds')
                if type(seconds) is int and seconds > 0:
                    delays.append(seconds)
        return max(delays, default=None)

    def call(self, name, arguments):
        """Read-only tools/call. Scheduling deliberately awaits live adapter review.

        Returns the complete MCP result (content/structuredContent/quota), so no
        guessed JSON text envelope can become a publication receipt.
        """
        if name not in READ_TOOLS:
            raise BufferError('Tool not enabled; writes require exact-approved scheduling adapter')
        if not isinstance(arguments, dict):
            raise BufferError('MCP tool arguments must be an object')
        if name not in {t['name'] for t in self.tools()}:
            raise BufferError('Tool unavailable in live MCP discovery')
        result = self._rpc('tools/call', {'name': name, 'arguments': arguments})
        if result.get('isError'):
            delay = self._rate_limit(result)
            raise BufferError('Buffer MCP tool rejected request; no automatic retry',
                              status=429 if delay else None, retry_after=delay)
        return result

    def validate_create(self, arguments):
        """Validate our bounded payload against the currently discovered schema."""
        schemas = [t['inputSchema'] for t in self.tools() if t['name'] == 'create_post']
        if len(schemas) != 1 or not _schema_valid(arguments, schemas[0]):
            raise BufferError('Create arguments do not match live Buffer schema')

    def _write(self, name, arguments):
        """Internal boundary used only by the exact-approved Queue adapter."""
        if name != 'create_post':
            raise BufferError('Only the approved create-post adapter may write')
        self.validate_create(arguments)
        result = self._rpc('tools/call', {'name': name, 'arguments': arguments})
        if result.get('isError'):
            delay = self._rate_limit(result)
            raise BufferError('Buffer MCP create rejected; no automatic retry',
                              status=429 if delay else None, retry_after=delay)
        return result

    def account(self):
        return self.call('get_account', {})

    def channels(self, organization_id):
        return self.call('list_channels', {'organizationId': organization_id})

    def get_post(self, post_id):
        return self.call('get_post', {'postId': post_id})


def result_data(result):
    """Decode one data object; quota blocks are never publication evidence."""
    if not isinstance(result, dict) or result.get('isError'):
        raise BufferError('Invalid Buffer tool result')
    candidates = []
    structured = result.get('structuredContent')
    if isinstance(structured, dict) and set(structured) != {'rateLimit'}:
        candidates.append(structured)
    for block in result.get('content', []):
        if not isinstance(block, dict) or block.get('type') != 'text':
            continue
        try:
            value = json.loads(block.get('text', ''))
        except (ValueError, TypeError):
            raise BufferError('Unrecognized Buffer tool text') from None
        if isinstance(value, dict) and set(value) == {'rateLimit'}:
            continue
        if not isinstance(value, (dict, list)):
            raise BufferError('Buffer data must be an object or array')
        if value not in candidates:
            candidates.append(value)
    if len(candidates) != 1:
        raise BufferError('Missing or ambiguous Buffer tool data')
    return candidates[0]


def _schema_valid(value, schema):
    """Supported JSON Schema subset used by Buffer's captured create input.

    Fail closed on references/compositions requiring unsupported semantics.
    """
    allowed = {'$schema', 'description', 'default', 'title', 'type', 'anyOf', 'const', 'enum', 'properties',
               'required', 'additionalProperties', 'items', 'pattern', 'format', 'minimum', 'maximum'}
    if not set(schema) <= allowed or schema.get('format') not in (None, 'uri', 'date-time'):
        return False
    if isinstance(schema.get('additionalProperties'), dict):
        return False
    if 'anyOf' in schema and not any(_schema_valid(value, s) for s in schema['anyOf']):
        return False
    types = schema.get('type', [])
    types = [types] if isinstance(types, str) else types
    matches = {'object': isinstance(value, dict), 'array': isinstance(value, list),
               'string': isinstance(value, str), 'boolean': type(value) is bool,
               'integer': type(value) is int, 'number': type(value) in (int, float), 'null': value is None}
    if types and not any(matches.get(t, False) for t in types):
        return False
    if 'const' in schema and value != schema['const']:
        return False
    if 'enum' in schema and value not in schema['enum']:
        return False
    if isinstance(value, dict):
        if not set(schema.get('required', [])) <= value.keys():
            return False
        properties = schema.get('properties', {})
        if schema.get('additionalProperties') is False and not value.keys() <= properties.keys():
            return False
        if any(not _schema_valid(v, properties[k]) for k, v in value.items() if k in properties):
            return False
    if isinstance(value, list) and 'items' in schema:
        if any(not _schema_valid(v, schema['items']) for v in value):
            return False
    if isinstance(value, str):
        if 'pattern' in schema and re.search(schema['pattern'], value) is None:
            return False
        if schema.get('format') == 'date-time':
            try:
                if datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is None:
                    return False
            except ValueError:
                return False
        if schema.get('format') == 'uri':
            parsed = urlsplit(value)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname:
                return False
    if type(value) in (int, float):
        if 'minimum' in schema and value < schema['minimum'] or 'maximum' in schema and value > schema['maximum']:
            return False
    return True
