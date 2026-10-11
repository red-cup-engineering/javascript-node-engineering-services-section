/**
 * Node process stdin/stdout/stderr boundary access.
 */
/** Read a finite UTF-8 text payload from the Node stdin process boundary. */
export async function readProcessStdinText(input = process.stdin) {
    let text = "";
    input.setEncoding("utf8");
    for await (const chunk of input)
        text += chunk;
    return text;
}
/** The host process stdin stream for protocols that need the raw stream. */
export function processStdin() {
    return process.stdin;
}
/** The host process stdout stream for protocols that need the raw stream. */
export function processStdout() {
    return process.stdout;
}
/** Write finite text to the host process stdout boundary. */
export function writeProcessStdout(text, output = process.stdout) {
    output.write(text);
}
/** Write finite text to the host process stderr boundary. */
export function writeProcessStderr(text, output = process.stderr) {
    output.write(text);
}
