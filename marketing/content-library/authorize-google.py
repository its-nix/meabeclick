#!/usr/bin/env python3
"""One-time desktop consent; never obtains credentials from connected plugins.

Primary protocol: https://developers.google.com/identity/protocols/oauth2/native-app
Offline consent: https://developers.google.com/identity/protocols/oauth2/web-server#offline
Token expiry: https://developers.google.com/identity/protocols/oauth2#expiration
Use your own downloaded Desktop app client JSON. Enable Sheets and Drive APIs first.
External apps in Google's Testing status may receive seven-day refresh tokens.
For SSH, forward the selected loopback port to the machine running this helper.
"""
import argparse
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

import engine

AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
SCOPES = ('https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file')


class OAuthError(ValueError): pass
class ConsentDenied(OAuthError): pass


def client_config(path):
    try:
        path = engine.physical_path(Path(path).expanduser())
        if path.stat().st_size > 65536: raise OAuthError('Desktop client JSON is too large')
        data = json.loads(path.read_text())
        value = data.get('installed') if isinstance(data, dict) else None
        if not isinstance(value, dict) or 'web' in data: raise OAuthError('Download an installed Desktop app OAuth client JSON')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com', str(value.get('client_id', ''))): raise OAuthError('Invalid desktop client ID')
        secret = value.get('client_secret')
        if not isinstance(secret, str) or not secret or len(secret) > 4096 or any(ord(c) < 32 for c in secret): raise OAuthError('Desktop client secret missing or malformed')
        if value.get('auth_uri') not in (AUTH_URL, 'https://accounts.google.com/o/oauth2/auth') or value.get('token_uri') != TOKEN_URL: raise OAuthError('Desktop client must use official Google OAuth endpoints')
        redirects = value.get('redirect_uris')
        if not isinstance(redirects, list) or not any(uri in ('http://localhost', 'http://127.0.0.1') for uri in redirects): raise OAuthError('Desktop client loopback redirect missing')
        return {'client_id': value['client_id'], 'client_secret': secret}
    except OAuthError: raise
    except Exception: raise OAuthError('Cannot read a valid downloaded desktop client JSON') from None


def authorization(client, port):
    if type(port) is not int or not 1024 <= port <= 65535: raise OAuthError('Port must be 1024..65535')
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=').decode('ascii')
    redirect = f'http://127.0.0.1:{port}'
    fields = {'client_id': client['client_id'], 'redirect_uri': redirect, 'response_type': 'code',
              'scope': ' '.join(SCOPES), 'access_type': 'offline', 'prompt': 'consent',
              'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'}
    return AUTH_URL + '?' + urlencode(fields), state, verifier, redirect


def callback_code(target, expected_state):
    if len(target) > 8192: raise OAuthError('Invalid callback')
    parsed = urlsplit(target)
    if parsed.path not in ('', '/') or parsed.scheme or parsed.netloc or parsed.fragment: raise OAuthError('Invalid callback path')
    try: fields = parse_qs(parsed.query, strict_parsing=True, max_num_fields=20)
    except ValueError: raise OAuthError('Invalid callback fields') from None
    states = fields.get('state', [])
    if len(states) != 1 or not secrets.compare_digest(states[0], expected_state): raise OAuthError('Callback state mismatch')
    if 'error' in fields: raise ConsentDenied('Google consent was denied or unavailable')
    codes = fields.get('code', [])
    if len(codes) != 1 or not codes[0] or len(codes[0]) > 4096: raise OAuthError('Authorization code missing or invalid')
    return codes[0]


class LoopbackServer(HTTPServer):
    allow_reuse_address = False
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(2)
        return connection, address
    def handle_error(self, request, address): pass  # Callback contents never reach stderr.


class CallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_GET(self):
        if self.headers.get('Host') != self.server.expected_host:
            self.send_error(400, 'Invalid callback host'); return
        try:
            code = callback_code(self.path, self.server.state)
        except ConsentDenied:
            self.server.denied = True
            self.send_response(400); self.end_headers(); self.wfile.write(b'Consent was declined. Return to the terminal.'); return
        except OAuthError:
            self.send_response(400); self.end_headers(); self.wfile.write(b'Authorization callback rejected. Return to the terminal.'); return
        if self.server.code is not None:
            self.send_error(409, 'Callback already received'); return
        self.server.code = code
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b'Consent received. Check the terminal for the final credential result. You may close this tab.')


def token_transport(fields):
    request = Request(TOKEN_URL, data=urlencode(fields).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    with urlopen(request, timeout=30) as response:
        raw = response.read(65537)
        if len(raw) > 65536: raise OAuthError('Invalid token response')
        return json.loads(raw)


def exchange(client, code, verifier, redirect, transport=token_transport):
    fields = {'client_id': client['client_id'], 'client_secret': client['client_secret'], 'code': code,
              'code_verifier': verifier, 'redirect_uri': redirect, 'grant_type': 'authorization_code'}
    try: result = transport(fields)
    except Exception: raise OAuthError('Google token exchange failed; no retry performed. Start fresh consent after checking setup.') from None
    if not isinstance(result, dict) or result.get('error'): raise OAuthError('Google token exchange rejected; check desktop client and consent setup')
    refresh = result.get('refresh_token')
    if not isinstance(refresh, str) or not refresh or len(refresh) > 16384: raise OAuthError('No refresh token received; repeat explicit offline consent')
    if not isinstance(result.get('access_token'), str) or not result['access_token'] or result.get('token_type', '').lower() != 'bearer': raise OAuthError('Invalid Google token response')
    # Never broaden Drive access or accept partial consent as unattended readiness.
    scope = result.get('scope')
    if not isinstance(scope, str) or set(scope.split()) != set(SCOPES): raise OAuthError('Granted scopes differ from the two required scopes; credentials were not saved')
    return {'type': 'authorized_user', 'client_id': client['client_id'], 'client_secret': client['client_secret'], 'refresh_token': refresh}


def output_path(path):
    path = engine.physical_path(Path(path).expanduser())
    here = Path(__file__).resolve().parent
    if path.is_relative_to(here.parents[1]) and not path.is_relative_to(here/'outputs'):
        raise OAuthError('Store credentials outside repository source or inside ignored outputs')
    return path


def save_credentials(path, credentials):
    path = output_path(path)
    if path.exists(): raise OAuthError('Credential output already exists; choose a new private path')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.oauth-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(credentials, handle, sort_keys=True); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
        os.link(temporary, path)  # Atomic create that cannot overwrite an existing file.
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    except FileExistsError: raise OAuthError('Credential output already exists; no overwrite performed') from None
    finally: os.unlink(temporary)


def authorize(client_path, output, port=9765, timeout=300, transport=token_transport, emit=print):
    if type(timeout) is not int or not 1 <= timeout <= 600: raise OAuthError('Consent timeout must be 1..600 seconds')
    client = client_config(client_path)
    output = output_path(output)
    if output.exists(): raise OAuthError('Credential output already exists; choose a new private path')
    url, state, verifier, redirect = authorization(client, port)
    try: server = LoopbackServer(('127.0.0.1', port), CallbackHandler)
    except OSError: raise OAuthError('Loopback listener unavailable; choose a free port') from None
    with server:
        server.state = state; server.code = None; server.denied = False; server.expected_host = f'127.0.0.1:{port}'
        emit('Open this Google consent URL in your browser (SSH users: forward the selected loopback port first):')
        emit(url)
        deadline = time.monotonic() + timeout
        while server.code is None and not server.denied and time.monotonic() < deadline:
            server.timeout = min(1, max(0, deadline - time.monotonic()))
            server.handle_request()
        if server.denied: raise OAuthError('Google consent was declined; no credentials saved')
        if server.code is None: raise OAuthError('Consent timed out; no credentials saved')
        credentials = exchange(client, server.code, verifier, redirect, transport)
        save_credentials(output, credentials)
    emit('Saved private authorized-user credentials. Configure this file in the content machine; account access still needs verification.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--port', type=int, default=9765)
    parser.add_argument('--timeout', type=int, default=300)
    args = parser.parse_args(argv)
    try: authorize(args.client, args.output, args.port, args.timeout)
    except (Exception, KeyboardInterrupt):
        print('Google authorization did not finish. Check desktop client setup, loopback port, consent and output path; no automatic retry was performed.', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__': sys.exit(main())
