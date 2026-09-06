// Putting FORMATTED text on the clipboard, so a digest pastes into an email as a digest rather
// than as a wall of tags.
//
// Why this file exists at all: VS Code's clipboard API writes plain text only. There is no
// extension API for the HTML clipboard flavour, so the only route is the OS. On Windows that
// means the CF_HTML format, which is not the markup — it is the markup behind a header of BYTE
// offsets into its own payload. Getting those offsets wrong does not error; the app silently
// falls back to plain text, which is exactly the failure that makes this look like it works
// until someone pastes into Outlook.
//
// Everything here is best-effort and reports WHY it failed, because the caller has a good
// fallback (open the rendered page and copy from there) and a silent failure would send markup
// to a colleague.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The ABSOLUTE path to Windows PowerShell.
 *
 * 🔴 Never spawn it as a bare "powershell.exe". Windows resolves a bare executable name against
 * the current directory BEFORE PATH, and the extension host's working directory is wherever the
 * editor was launched from — routinely the workspace folder. A cloned repo containing its own
 * powershell.exe would then run as the user the first time anyone copied a digest.
 */
function powershellPath(): string | null {
  // 🔴 `'C:\Windows'` is NOT that path: \W is not an escape, so the literal is "C:Windows" — a
  // DRIVE-RELATIVE path that resolves against the working directory, which is the exact hazard
  // this function exists to avoid. Escape the separator, and refuse anything not absolute.
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const exe = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!path.isAbsolute(exe)) return null;
  try { return fs.existsSync(exe) ? exe : null; } catch { return null; }
}

export interface RichCopyResult {
  ok: boolean;
  /** Plain-English reason, for the message shown when it did not work. */
  reason: string;
}

/**
 * Try to place `html` on the clipboard as formatted text. Windows only; resolves `ok: false`
 * with a reason everywhere else, and never throws or hangs (hard 10s cap).
 */
export function copyHtmlRich(html: string): Promise<RichCopyResult> {
  if (process.platform === 'darwin') return copyMac(html);
  if (process.platform !== 'win32') return copyLinux(html);
  const exe = powershellPath();
  if (!exe) return Promise.resolve({ ok: false, reason: 'PowerShell was not found where Windows keeps it' });
  const script = powershell();
  return new Promise<RichCopyResult>(resolve => {
    let settled = false;
    const done = (r: RichCopyResult) => { if (!settled) { settled = true; resolve(r); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe,
        // -STA is required: Clipboard.SetDataObject throws on a multi-threaded apartment, and
        // relying on 5.1's default would break the moment a different host is used.
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (e) {
      return done({ ok: false, reason: `PowerShell could not start: ${(e as Error).message}` });
    }
    // A blocked or wedged shell must never hang the command.
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } done({ ok: false, reason: 'PowerShell did not respond' }); }, 10000);
    let stderr = '';
    child.stderr?.on('data', d => { stderr += String(d); });
    // If the shell exits before draining stdin — a policy block, its own early exit, or a digest
    // larger than the pipe buffer — the write fails ASYNCHRONOUSLY. With no listener that is an
    // uncaught exception in the extension host, i.e. this feature could take the editor down.
    child.stdin?.on('error', () => { /* the close handler reports the real outcome */ });
    child.on('error', e => { clearTimeout(timer); done({ ok: false, reason: `PowerShell could not start: ${e.message}` }); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return done({ ok: true, reason: '' });
      const first = stderr.trim().split('\n')[0] || `exit code ${code}`;
      done({ ok: false, reason: /execution.of.scripts|ExecutionPolicy/i.test(stderr) ? 'PowerShell execution policy blocked it' : first.slice(0, 120) });
    });
    try {
      child.stdin?.end(html, 'utf8');
    } catch (e) {
      clearTimeout(timer);
      done({ ok: false, reason: `could not send the content: ${(e as Error).message}` });
    }
  });
}

/**
 * macOS: osascript puts «class HTML» on the pasteboard. The data has to arrive as hex, so the
 * markup is passed on stdin and turned into a hex string by the script itself rather than being
 * interpolated into AppleScript source (where a quote in a task name would end the string).
 */
function copyMac(html: string): Promise<RichCopyResult> {
  const hex = Buffer.from(html, 'utf8').toString('hex');
  return runTool('/usr/bin/osascript',
    ['-e', `set the clipboard to «data HTML${hex}»`],
    undefined, 'the macOS clipboard tool did not accept it');
}

/**
 * Linux: xclip if it is there, otherwise say so. There is deliberately no silent fallback to
 * plain text here — the caller offers "open the rendered page and copy from there", which
 * actually produces formatted output, and quietly putting markup on the clipboard instead is
 * how a colleague ends up receiving a wall of tags.
 */
function copyLinux(html: string): Promise<RichCopyResult> {
  for (const exe of ['/usr/bin/xclip', '/bin/xclip', '/usr/local/bin/xclip']) {
    try { if (fs.existsSync(exe)) return runTool(exe, ['-selection', 'clipboard', '-t', 'text/html'], html, 'xclip did not accept it'); } catch { /* keep looking */ }
  }
  return Promise.resolve({ ok: false, reason: 'formatted copy needs xclip (apt install xclip)' });
}

/** Spawn a clipboard helper with an absolute path, a hard timeout, and no unhandled stdin error. */
function runTool(exe: string, args: string[], stdin: string | undefined, fallbackReason: string): Promise<RichCopyResult> {
  if (!path.isAbsolute(exe)) return Promise.resolve({ ok: false, reason: 'clipboard helper path is not absolute' });
  try { if (!fs.existsSync(exe)) return Promise.resolve({ ok: false, reason: `${path.basename(exe)} was not found` }); } catch { /* fall through */ }
  return new Promise<RichCopyResult>(resolve => {
    let settled = false;
    const done = (r: RichCopyResult) => { if (!settled) { settled = true; resolve(r); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'] });
    } catch (e) {
      return done({ ok: false, reason: `${path.basename(exe)} could not start: ${(e as Error).message}` });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } done({ ok: false, reason: `${path.basename(exe)} did not respond` }); }, 10000);
    let stderr = '';
    child.stderr?.on('data', d => { stderr += String(d); });
    child.stdin?.on('error', () => { /* the close handler reports the real outcome */ });
    child.on('error', e => { clearTimeout(timer); done({ ok: false, reason: `${path.basename(exe)} could not start: ${e.message}` }); });
    // 🔴 'exit', not 'close'. xclip FORKS: the parent calls exit(EXIT_SUCCESS) while the forked
    // child stays alive to serve the X selection and never closes the stderr descriptor it
    // inherited. 'close' waits for that descriptor, so it never fired - the command froze for
    // the full ten-second timeout and then reported failure on a copy that had already
    // succeeded, where the previous code had declined in about two milliseconds and let the
    // caller fall through to its working fallback.
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) return done({ ok: true, reason: '' });
      // Only the failure path waits, and only briefly, so the message can name the cause.
      setTimeout(() => done({ ok: false, reason: (stderr.trim().split('\n')[0] || fallbackReason).slice(0, 120) }), 100);
    });
    if (stdin !== undefined) {
      try { child.stdin?.end(stdin, 'utf8'); } catch (e) { clearTimeout(timer); done({ ok: false, reason: `could not send the content: ${(e as Error).message}` }); }
    }
  });
}

/**
 * Reads the fragment from stdin, wraps it, computes the four CF_HTML offsets in BYTES (not
 * characters — one curly quote or £ sign and a character count is wrong), and sets both the HTML
 * and plain-text flavours so an app that wants plain text still gets something sensible.
 */
function powershell(): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
# 🔴 Read stdin as UTF-8 explicitly. Without this the console decodes with the OEM code page, so
# every non-ASCII character (an em dash, a curly quote, a currency symbol) comes back as a
# different number of characters than was sent — and the byte offsets below then point past the
# end of the fragment. Measured: an em dash and a pound sign put the fragment 3 bytes out.
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
$fragment = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($fragment)) { exit 3 }
$pre = "Version:0.9\`r\`nStartHTML:{0:0000000000}\`r\`nEndHTML:{1:0000000000}\`r\`nStartFragment:{2:0000000000}\`r\`nEndFragment:{3:0000000000}\`r\`n"
$head = "<html><body>"
$startMark = "<!--StartFragment-->"
$endMark = "<!--EndFragment-->"
$tail = "</body></html>"
$body = $head + $startMark + $fragment + $endMark + $tail
# Offsets are byte counts into the FINAL string, including this header, so the header length is
# measured with a placeholder of the same width first.
$headerLen = ([System.Text.Encoding]::UTF8.GetByteCount(($pre -f 0,0,0,0)))
$b = [System.Text.Encoding]::UTF8
$startHtml = $headerLen
$startFragment = $headerLen + $b.GetByteCount($head + $startMark)
$endFragment = $startFragment + $b.GetByteCount($fragment)
$endHtml = $headerLen + $b.GetByteCount($body)
$cf = ($pre -f $startHtml, $endHtml, $startFragment, $endFragment) + $body
# The plain-text flavour, for an app that asks for text rather than HTML. Block-level tags
# become newlines and the rest become a SPACE: stripping every tag with nothing in its place
# glued each number to the caption of the next cell, so counts read as different numbers.
$plain = [System.Text.RegularExpressions.Regex]::Replace($fragment, '<(br|/p|/div|/tr|/li|/h[1-6]|/table)[^>]*>', "\`n")
$plain = [System.Text.RegularExpressions.Regex]::Replace($plain, '<[^>]+>', ' ')
$plain = [System.Net.WebUtility]::HtmlDecode($plain)
$plain = [System.Text.RegularExpressions.Regex]::Replace($plain, '[ \t]{2,}', ' ')
$plain = [System.Text.RegularExpressions.Regex]::Replace($plain, "(\`n\s*){3,}", "\`n\`n").Trim()
$data = New-Object System.Windows.Forms.DataObject
# 🔴 As a STREAM of UTF-8 bytes, not as a string.
#
# SetData(DataFormats.Html, <string>) under Windows PowerShell 5.1 serialises through the
# system ANSI code page, one byte per character - while the four offsets above are counted in
# UTF-8 bytes. Every digest containing a curly quote, an em dash or a pound sign therefore
# shipped a header that over-counted by (utf8 bytes - chars): EndHTML pointed past the end of
# the allocation and EndFragment past the EndFragment marker. Worse, any character with no
# CP1252 mapping was replaced by '?', so script names silently became ????? in a document the
# user forwards to colleagues, under a toast reporting success.
#
# A Stream is written to the clipboard verbatim, so the bytes and the offsets agree.
$bytes = [System.Text.Encoding]::UTF8.GetBytes($cf)
$stream = New-Object System.IO.MemoryStream
$stream.Write($bytes, 0, $bytes.Length)
$stream.Position = 0
$data.SetData([System.Windows.Forms.DataFormats]::Html, $false, $stream)
$data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $plain)
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
exit 0
`.trim();
}
