#!/usr/bin/env python3
"""Generate a reversible logged-in macOS preparation timer; install only on request."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys

LABEL = 'com.meabeclick.content-machine'


def timer_payload(config, log_dir, interval=900):
    if not isinstance(interval, int) or isinstance(interval, bool) or interval <= 0:
        raise ValueError('Timer interval must be a positive number of seconds')
    root = Path(__file__).resolve().parent
    logs = Path(log_dir).expanduser().resolve()
    return {'Label': LABEL,
            'ProgramArguments': [str(Path(sys.executable).resolve()), str(root / 'machine.py'), 'tick', '--config', str(Path(config).expanduser().resolve())],
            'WorkingDirectory': str(root), 'RunAtLoad': True, 'StartInterval': interval,
            'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
            'ProcessType': 'Background', 'StandardOutPath': str(logs / 'machine.stdout.log'),
            'StandardErrorPath': str(logs / 'machine.stderr.log')}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--log-dir', type=Path, default=Path.home() / 'Library/Logs/MeaBeclick')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--interval', type=int, default=900)
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--uninstall', action='store_true')
    args = parser.parse_args(argv)
    if args.install and args.uninstall:
        parser.error('Choose install or uninstall')
    destination = (args.output or Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')).expanduser().resolve()
    if args.uninstall:
        if sys.platform != 'darwin': parser.error('launchd requires macOS')
        subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'], check=False)
        destination.unlink(missing_ok=True)
        print('Timer removed:', destination)
        return
    payload = timer_payload(args.config, args.log_dir, args.interval)
    if args.install:
        if sys.platform != 'darwin': parser.error('launchd requires macOS')
        if not args.config.expanduser().is_file(): parser.error('Config file must exist before installation')
        args.log_dir.expanduser().mkdir(parents=True, exist_ok=True)
    # Dry run writes only when --output is supplied; otherwise prints reviewable XML.
    xml = plistlib.dumps(payload)
    if args.output or args.install:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.plist.tmp')
        temporary.write_bytes(xml)
        temporary.replace(destination)
        print('Generated timer:', destination)
    else:
        sys.stdout.buffer.write(xml)
    if args.install:
        subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'], check=False)
        subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(destination)], check=True)
        print('Installed preparation timer; runs while logged in and awake.')


if __name__ == '__main__': main()
