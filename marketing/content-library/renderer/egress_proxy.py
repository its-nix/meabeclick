#!/usr/bin/env python3
"""Small HTTPS CONNECT egress proxy that pins each DNS result to a public IP."""
import ipaddress
import select
import socket
import threading
import time
from urllib.parse import urlsplit

MAX_HEADER=8192
MAX_TUNNEL_BYTES=50*1024*1024
MAX_TUNNEL_SECONDS=300
MAX_CLIENTS=8


def resolve_public_target(authority,resolver=socket.getaddrinfo):
    if not isinstance(authority,str) or len(authority)>320:raise ValueError('Invalid CONNECT authority')
    parsed=urlsplit('//'+authority)
    if parsed.username is not None or parsed.password is not None or parsed.path or parsed.query or parsed.fragment or not parsed.hostname:
        raise ValueError('Malformed CONNECT authority')
    try:port=parsed.port
    except ValueError as exc:raise ValueError('Invalid CONNECT port') from exc
    if port!=443:raise ValueError('Only public HTTPS port 443 is allowed')
    host=parsed.hostname.rstrip('.').lower()
    if not host or host=='localhost' or host.endswith('.localhost') or host.endswith('.local'):
        raise ValueError('Internal host is not allowed')
    try:
        literal=ipaddress.ip_address(host.split('%',1)[0])
        addresses=[literal.compressed]
    except ValueError:
        try:host=host.encode('idna').decode('ascii')
        except UnicodeError as exc:raise ValueError('Invalid IDNA host') from exc
        if len(host)>253:raise ValueError('Invalid CONNECT hostname')
        if not all(c.isalnum() or c in '.-' for c in host) or '..' in host:raise ValueError('Invalid hostname')
        try:records=resolver(host,port,type=socket.SOCK_STREAM)
        except OSError as exc:raise ValueError('Public hostname did not resolve') from exc
        if len(records)>16:raise ValueError('Too many resolved addresses')
        addresses=[]
        for record in records:addresses.append(record[4][0].split('%',1)[0])
    if not addresses:raise ValueError('Public hostname did not resolve')
    normalized=[]
    for value in addresses:
        try:address=ipaddress.ip_address(value)
        except ValueError as exc:raise ValueError('Invalid resolved address') from exc
        if not address.is_global or address.is_multicast or address.is_unspecified or address.is_loopback or address.is_link_local or address.is_private or address.is_reserved:
            raise ValueError('Destination must resolve only to public IP addresses')
        normalized.append(address.compressed)
    return host,port,normalized[0]


def _connect_pinned(address,port,timeout=8):
    ip=ipaddress.ip_address(address);family=socket.AF_INET6 if ip.version==6 else socket.AF_INET
    upstream=socket.socket(family,socket.SOCK_STREAM);upstream.settimeout(timeout)
    upstream.connect((address,port));upstream.settimeout(None);return upstream


def _relay(left,right,max_bytes=MAX_TUNNEL_BYTES,max_seconds=MAX_TUNNEL_SECONDS):
    start=time.monotonic();total=0
    while time.monotonic()-start<max_seconds and total<max_bytes:
        readable,_,_=select.select([left,right],[],[],1)
        for source in readable:
            data=source.recv(min(65536,max_bytes-total))
            if not data:return
            target=right if source is left else left;target.sendall(data);total+=len(data)


def _handle(client,resolver=socket.getaddrinfo,connector=_connect_pinned):
    client.settimeout(5);buffer=b'';upstream=None
    try:
        while b'\r\n\r\n' not in buffer and len(buffer)<=MAX_HEADER:
            chunk=client.recv(1024)
            if not chunk:return
            buffer+=chunk
        if len(buffer)>MAX_HEADER:raise ValueError('Proxy header too large')
        head,extra=buffer.split(b'\r\n\r\n',1);line=head.split(b'\r\n',1)[0].decode('ascii')
        parts=line.split(' ')
        if len(parts)!=3 or parts[0]!='CONNECT' or parts[2] not in ('HTTP/1.0','HTTP/1.1'):
            raise ValueError('Only CONNECT is supported')
        host,port,address=resolve_public_target(parts[1],resolver=resolver)
        upstream=connector(address,port)
        client.sendall(b'HTTP/1.1 200 Connection established\r\n\r\n');client.settimeout(None)
        if extra:upstream.sendall(extra)
        _relay(client,upstream)
    except Exception:
        try:client.sendall(b'HTTP/1.1 403 Egress denied\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        except OSError:pass
    finally:
        if upstream is not None:
            try:upstream.close()
            except OSError:pass
        client.close()


def serve(host='0.0.0.0',port=3128):
    gate=threading.BoundedSemaphore(MAX_CLIENTS);server=socket.socket();server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);server.bind((host,port));server.listen(MAX_CLIENTS)
    while True:
        client,_=server.accept()
        if not gate.acquire(blocking=False):client.close();continue
        def task(conn):
            try:_handle(conn)
            finally:gate.release()
        threading.Thread(target=task,args=(client,),daemon=True).start()


if __name__=='__main__':serve()
