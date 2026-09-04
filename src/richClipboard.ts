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
  const root = process.env.SystemRoot || process.env.windir || 'C:\Windows';
  const exe = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
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
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, reason: 'formatted copy needs Windows' });
  }
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
$plain = [System.Text.RegularExpressions.Regex]::Replace($fragment, '<[^>]+>', '')
$plain = [System.Net.WebUtility]::HtmlDecode($plain)
$data = New-Object System.Windows.Forms.DataObject
$data.SetData([System.Windows.Forms.DataFormats]::Html, $cf)
$data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $plain)
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
exit 0
`.trim();
}
