#!/usr/bin/env python3
"""LinguaFlow Native Messaging Host — executes AppleScript for Reminders import.

This script runs as a Chrome Native Messaging host. It reads JSON messages
from stdin, executes the embedded AppleScript via osascript, and writes
JSON responses to stdout.

Protocol: each message is prefixed with a 4-byte little-endian length.
"""

import sys
import json
import struct
import subprocess
import os


def read_message():
    """Read a single native-messaging message from stdin."""
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    msg_len = struct.unpack('<I', raw_len)[0]
    if msg_len == 0:
        return None
    raw_msg = sys.stdin.buffer.read(msg_len)
    return json.loads(raw_msg.decode('utf-8'))


def send_message(msg):
    """Send a native-messaging JSON response to stdout."""
    encoded = json.dumps(msg).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def run_applescript(script):
    """Execute AppleScript via osascript and return success/error."""
    try:
        proc = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode == 0:
            return {'success': True, 'output': proc.stdout.strip()}
        else:
            return {'success': False, 'error': proc.stderr.strip()}
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'AppleScript execution timed out'}
    except FileNotFoundError:
        return {'success': False, 'error': 'osascript not found — are you on macOS?'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def main():
    # macOS guard
    if sys.platform != 'darwin':
        send_message({'error': 'This native host only runs on macOS'})
        sys.exit(1)

    while True:
        msg = read_message()
        if msg is None:
            break

        action = msg.get('action', '')
        if action == 'ping':
            send_message({'pong': True, 'platform': sys.platform})
        elif action == 'runAppleScript':
            script = msg.get('script', '')
            if not script:
                send_message({'success': False, 'error': 'No script provided'})
            else:
                result = run_applescript(script)
                send_message(result)
        else:
            send_message({'error': f'Unknown action: {action}'})


if __name__ == '__main__':
    main()
