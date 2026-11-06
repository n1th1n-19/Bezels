import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';

/** Copy a PNG to the OS clipboard: wl-copy (Wayland), xclip (X11), osascript (macOS), PowerShell (Windows). */
export function copyImageToClipboard(file: string): Promise<void> {
  const p = process.platform;
  let cmd: string, args: string[], stdin = true;
  if (p === 'darwin') { cmd = 'osascript'; args = ['-e', `set the clipboard to (read (POSIX file "${file.replace(/"/g, '\\"')}") as «class PNGf»)`]; stdin = false; }
  else if (p === 'win32') { cmd = 'powershell'; args = ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${file.replace(/'/g, "''")}'))`]; stdin = false; }
  else if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland') { cmd = 'wl-copy'; args = ['--type', 'image/png']; }
  else { cmd = 'xclip'; args = ['-selection', 'clipboard', '-t', 'image/png', '-i']; }
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'], detached: cmd === 'wl-copy' });
    let err = '';
    c.stderr?.on('data', (d) => (err += d));
    c.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT'
      ? new Error(`${cmd} not found. Install it: ${cmd === 'wl-copy' ? 'sudo apt install wl-clipboard' : cmd === 'xclip' ? 'sudo apt install xclip' : cmd}`)
      : e));
    if (stdin) createReadStream(file).pipe(c.stdin!);
    // wl-copy forks to serve the clipboard; we only wait for it to take the data.
    c.on('exit', (code) => (code === 0 || cmd === 'wl-copy' ? resolve() : reject(new Error(`${cmd} failed: ${err.trim()}`))));
    if (cmd === 'wl-copy') { c.stdin?.on('finish', () => setTimeout(() => { c.unref(); resolve(); }, 150)); }
  });
}
