import base64
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

spec = importlib.util.spec_from_file_location('authorize_google', Path(__file__).with_name('authorize-google.py'))
auth = importlib.util.module_from_spec(spec); spec.loader.exec_module(auth)


class GoogleConsentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.client = self.root/'client.json'
        self.config = {'client_id':'123-example.apps.googleusercontent.com','client_secret':'secret-fixture',
                       'auth_uri':'https://accounts.google.com/o/oauth2/auth','token_uri':auth.TOKEN_URL,'redirect_uris':['http://localhost']}
        self.client.write_text(json.dumps({'installed':self.config}))
        self.result = {'access_token':'access-fixture','refresh_token':'refresh-fixture','token_type':'Bearer','scope':' '.join(auth.SCOPES)}

    def test_downloaded_desktop_only_and_fixed_google_endpoints(self):
        self.assertEqual(auth.client_config(self.client)['client_id'],self.config['client_id'])
        for data in ({'web':self.config},{'installed':dict(self.config,token_uri='https://example.com/token')},
                     {'installed':dict(self.config,redirect_uris=['https://example.com'])},
                     {'installed':dict(self.config,client_id='invalid')}):
            self.client.write_text(json.dumps(data))
            with self.assertRaises(auth.OAuthError):auth.client_config(self.client)

    def test_auth_url_has_loopback_exact_scopes_state_and_s256(self):
        url,state,verifier,redirect=auth.authorization(self.config,9765)
        parsed=urlsplit(url);q=parse_qs(parsed.query)
        self.assertEqual(parsed.scheme+'://'+parsed.netloc+parsed.path,auth.AUTH_URL)
        self.assertEqual(q['redirect_uri'],['http://127.0.0.1:9765'])
        self.assertEqual(set(q['scope'][0].split()),set(auth.SCOPES))
        self.assertEqual(q['access_type'],['offline']);self.assertEqual(q['prompt'],['consent'])
        self.assertEqual(q['state'],[state]);self.assertGreaterEqual(len(state),32)
        expected=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        self.assertEqual(q['code_challenge'],[expected]);self.assertEqual(q['code_challenge_method'],['S256'])
        self.assertNotIn(self.config['client_secret'],url);self.assertNotIn(verifier,url)
        for port in (0,80,65536,True,'9765'):
            with self.assertRaises(auth.OAuthError):auth.authorization(self.config,port)

    def test_callback_requires_exact_state_and_unique_code(self):
        self.assertEqual(auth.callback_code('/?state=expected&code=fixture','expected'),'fixture')
        for target in ('/?state=wrong&code=fixture','/?code=fixture','/?state=expected&state=other&code=fixture',
                       '/?state=expected&code=a&code=b','/?state=expected&error=access_denied',
                       'https://example.com/?state=expected&code=x','/other?state=expected&code=x'):
            with self.subTest(target=target), self.assertRaises(auth.OAuthError):auth.callback_code(target,'expected')

    def test_exchange_once_uses_pkce_and_saves_only_refresh_credentials(self):
        calls=[]
        def transport(fields):calls.append(fields);return dict(self.result)
        credentials=auth.exchange(self.config,'code-fixture','verifier-fixture','http://127.0.0.1:9765',transport)
        self.assertEqual(len(calls),1);self.assertEqual(calls[0]['code_verifier'],'verifier-fixture')
        self.assertEqual(calls[0]['grant_type'],'authorization_code')
        self.assertEqual(credentials['type'],'authorized_user');self.assertNotIn('access_token',credentials)
        self.assertEqual(credentials['refresh_token'],'refresh-fixture')

    def test_transport_error_and_bad_token_responses_are_sanitized(self):
        def transport(fields):raise RuntimeError('access-fixture refresh-fixture secret-fixture code-fixture')
        with self.assertRaises(auth.OAuthError) as caught:auth.exchange(self.config,'code-fixture','verifier','redirect',transport)
        self.assertNotIn('fixture',str(caught.exception))
        for result in ({'error':'secret-fixture'},dict(self.result,refresh_token=''),dict(self.result,scope=auth.SCOPES[0]),
                       dict(self.result,scope=' '.join(auth.SCOPES)+' https://www.googleapis.com/auth/drive')):
            with self.assertRaises(auth.OAuthError) as caught:
                auth.exchange(self.config,'code','verifier','redirect',lambda fields:result)
            self.assertNotIn('secret-fixture',str(caught.exception))

    def test_atomic_private_output_refuses_overwrite_and_symlinks(self):
        target=self.root/'private'/'authorized.json'
        credentials=auth.exchange(self.config,'code','verifier','redirect',lambda fields:self.result)
        auth.save_credentials(target,credentials)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o600)
        before=target.read_bytes()
        with self.assertRaises(auth.OAuthError):auth.save_credentials(target,{'different':'token'})
        self.assertEqual(target.read_bytes(),before)
        link=self.root/'link';link.symlink_to(target)
        with self.assertRaises(ValueError):auth.save_credentials(link,credentials)
        self.assertEqual(list(target.parent.glob('.oauth-*')),[])
        with self.assertRaises(auth.OAuthError):auth.output_path(Path(__file__).resolve().parent/'credentials.json')

    def test_authorize_binds_only_loopback_and_never_logs_tokens(self):
        class Server:
            def __init__(server,address,handler):self.assertEqual(address,('127.0.0.1',9765))
            def __enter__(server):return server
            def __exit__(server,*args):pass
            def handle_request(server):server.code='code-fixture'
        messages=[];target=self.root/'authorized.json';calls=[]
        def transport(fields):calls.append(fields);return self.result
        with patch.object(auth,'LoopbackServer',Server):auth.authorize(self.client,target,transport=transport,emit=messages.append)
        self.assertTrue(target.exists());self.assertEqual(len(calls),1)
        output='\n'.join(messages)
        for secret in ('secret-fixture','code-fixture','access-fixture','refresh-fixture'):self.assertNotIn(secret,output)
        self.assertIn(auth.AUTH_URL,output)
        with patch.object(auth,'LoopbackServer') as server:
            with self.assertRaises(auth.OAuthError):auth.authorize(self.client,target)
            server.assert_not_called()

    def test_timeout_never_exchanges_or_writes_credentials(self):
        class Server:
            def __init__(server,*args):pass
            def __enter__(server):return server
            def __exit__(server,*args):pass
        target=self.root/'timeout.json'
        with patch.object(auth,'LoopbackServer',Server),patch.object(auth.time,'monotonic',side_effect=[0,2]),patch.object(auth,'token_transport') as transport:
            with self.assertRaisesRegex(auth.OAuthError,'timed out'):
                auth.authorize(self.client,target,timeout=1,transport=transport,emit=lambda message:None)
            transport.assert_not_called()
        self.assertFalse(target.exists())

    def test_main_sanitizes_errors_and_timeout_is_bounded(self):
        out=io.StringIO();err=io.StringIO()
        with redirect_stdout(out),redirect_stderr(err),patch.object(auth,'authorize',side_effect=auth.OAuthError('refresh-fixture')):
            self.assertEqual(auth.main(['--client',str(self.client),'--output',str(self.root/'output')]),2)
        self.assertNotIn('refresh-fixture',out.getvalue()+err.getvalue())
        for wait in (0,601,True):
            with self.assertRaises(auth.OAuthError):auth.authorize(self.client,self.root/'output',timeout=wait)


if __name__=='__main__':unittest.main()
