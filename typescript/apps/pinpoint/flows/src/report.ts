/** Tiny narrated test runner: steps print as they run; assertions are soft and summarised at the end. */
const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  ok: (s: string) => `\x1b[32m${s}\x1b[0m`,
  bad: (s: string) => `\x1b[31m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export interface Failure {
  readonly step: string;
  readonly message: string;
}

export class Report {
  readonly failures: Failure[] = [];
  readonly skipped: string[] = [];
  private current = '';
  private stepNo = 0;

  async step<T>(title: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.stepNo += 1;
    this.current = title;
    const started = Date.now();
    process.stdout.write(`\n${C.bold(`${String(this.stepNo).padStart(2, '0')}  ${title}`)}\n`);
    try {
      const out = await fn();
      process.stdout.write(C.dim(`    done in ${Date.now() - started}ms\n`));
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failures.push({ step: title, message: msg });
      process.stdout.write(`    ${C.bad('✗ step failed:')} ${msg}\n`);
      return undefined;
    }
  }

  note(line: string): void {
    process.stdout.write(`    ${C.dim('·')} ${line}\n`);
  }

  expect(condition: boolean, message: string): void {
    if (condition) process.stdout.write(`    ${C.ok('✓')} ${message}\n`);
    else {
      process.stdout.write(`    ${C.bad('✗')} ${message}\n`);
      this.failures.push({ step: this.current, message });
    }
  }

  skip(message: string): void {
    this.skipped.push(`${this.current}: ${message}`);
    process.stdout.write(`    ${C.warn('↷ skipped:')} ${message}\n`);
  }

  summary(): number {
    process.stdout.write('\n' + C.bold('Summary') + '\n');
    if (this.skipped.length)
      for (const s of this.skipped) process.stdout.write(`  ${C.warn('↷')} ${s}\n`);
    if (this.failures.length === 0) {
      process.stdout.write(`  ${C.ok('all assertions passed')}\n`);
      return 0;
    }
    for (const f of this.failures)
      process.stdout.write(`  ${C.bad('✗')} ${f.step} — ${f.message}\n`);
    process.stdout.write(`  ${C.bad(`${this.failures.length} failure(s)`)}\n`);
    return 1;
  }
}
