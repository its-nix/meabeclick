#!/usr/bin/env python3
"""Run bounded ticks with durable heartbeat and sanitized failure reporting."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import sys
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def heartbeat(directory, **fields):
    directory.mkdir(parents=True, exist_ok=True)
    path=directory/'worker-health.json'; temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    temporary.write_text(json.dumps({'checked_at':datetime.now(timezone.utc).isoformat(), **fields})+'\n')
    temporary.replace(path)


def run_once(config, tick=None):
    directory=Path(os.environ.get('CONTENT_MACHINE_STATE','/state'))
    pulse_stop=threading.Event();pulse=None
    try:
        cfg=json.loads(Path(config).read_text())
        directory=Path(cfg['state_dir']).expanduser()
        heartbeat(directory,status='running')
        if tick is None:
            import machine
            tick=machine.tick
        def keep_alive():
            while not pulse_stop.wait(30):heartbeat(directory,status='running')
        pulse=threading.Thread(target=keep_alive,daemon=True);pulse.start()
        try:report=tick(config)
        finally:
            pulse_stop.set();pulse.join()
        heartbeat(directory,status='ok',ready=bool(report.get('ready',False)),
                  blocker_codes=report.get('blocker_codes',[]))
        return 0
    except Exception as exc:
        # Exception strings can contain credential values or private remote responses.
        heartbeat(directory,status='error',error_type=type(exc).__name__)
        print('Worker tick failed ('+type(exc).__name__+'); inspect private state and configuration.',file=sys.stderr,flush=True)
        return 1


def healthy(directory, max_age=3900):
    try:
        value=json.loads((Path(directory)/'worker-health.json').read_text())
        age=time.time()-datetime.fromisoformat(value['checked_at']).timestamp()
        return value['status'] in ('ok','running') and 0<=age<=max_age
    except (OSError,ValueError,KeyError,TypeError):return False


def main(argv=None,tick=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,default=Path('/run/config/machine.json'))
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--interval',type=int,default=900)
    parser.add_argument('--healthcheck',action='store_true')
    args=parser.parse_args(argv)
    if args.healthcheck:return 0 if healthy(os.environ.get('CONTENT_MACHINE_STATE','/state')) else 1
    if args.interval<1:parser.error('--interval must be positive')
    stop=threading.Event()
    for number in (signal.SIGTERM,signal.SIGINT): signal.signal(number,lambda *_:stop.set())
    while not stop.is_set():
        result=run_once(args.config,tick=tick)
        if args.once:return result
        stop.wait(args.interval)
    return 0


if __name__ == '__main__':raise SystemExit(main())
