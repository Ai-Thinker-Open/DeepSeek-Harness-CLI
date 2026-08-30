/**
 * Known subprocess noise that leaks out of Git Bash / MSYS2 on Windows.
 *
 * For example a failed `ssh` invocation from the harness prints a banner like
 * `ssh (1234) C:\Program Files\Git\usr\bin\ssh.exe: *** fatal error - couldn't
 * create signal pipe, Win32 error 5` to stderr. The MSYS runtime never starts,
 * so the string is pure environment noise — never meaningful user content.
 * These markers are specific enough that real drafts/messages never match.
 */
export const SUBPROCESS_NOISE_RE =
  /(?:couldn't create signal pipe|\*\*\* fatal error|Program Files[\\/]Git[\\/]usr[\\/]bin)/i

/** Remove every line that matches {@link SUBPROCESS_NOISE_RE} (per-line, so
 *  surrounding legitimate text in the same block is preserved). */
export function stripSubprocessNoise(text: string): string {
  return text
    .split("\n")
    .filter((line) => !SUBPROCESS_NOISE_RE.test(line))
    .join("\n")
}
