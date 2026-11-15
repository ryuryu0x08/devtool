// What the export scripts share on the command line: argument errors, step logging, the summary.
import { relative } from 'node:path';

export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

const useColor = process.stderr.isTTY && !('NO_COLOR' in process.env);
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const MARK = { start: paint(36, '▶'), done: paint(32, '●'), skip: paint(90, '○'), fail: paint(31, '■') };

/** A path as the user would type it from where they are. */
export const shown = (path) => relative(process.cwd(), path) || '.';

const log = (mark, step, total, text) => {
  const time = new Date().toTimeString().slice(0, 8);
  process.stderr.write(`${time} ${mark} [${step}/${total}] ${text}\n`);
};

/** Prints an argument error and the usage; returns the exit code for it. */
export function usageError(message, usage) {
  process.stderr.write(`${MARK.fail} ${message}\n\n${usage}\n`);
  return EXIT_USAGE;
}

function finished(step, total, label, { written, total: count }) {
  if (written === 0) {
    log(MARK.skip, step, total, `${label}: ${count} 个文件内容未变，无需重复写入`);
    return 'skipped';
  }
  const unchanged = count - written ? `，${count - written} 个未变` : '';
  log(MARK.done, step, total, `${label}: 写入 ${written} 个文件${unchanged}`);
  return 'done';
}

/**
 * Runs `steps` in order, each `{ label, target, run }` where `run` resolves to `{ written, total }`.
 * Logs each step and a summary; returns the exit code.
 */
export async function runSteps(steps, { heading, rerun }) {
  const tally = { done: 0, skipped: 0 };
  const started = Date.now();
  process.stderr.write(`${heading}，总计 ${steps.length} 步\n`);
  for (const [index, step] of steps.entries()) {
    const number = index + 1;
    log(MARK.start, number, steps.length, `${step.label} → ${step.target}`);
    try {
      tally[finished(number, steps.length, step.label, await step.run())] += 1;
    } catch (err) {
      log(MARK.fail, number, steps.length, `${step.label}失败: ${err.message}`);
      process.stderr.write(`完成 ${tally.done}，跳过 ${tally.skipped}，失败 1，未执行 ${steps.length - number}。修复后重跑: ${rerun}\n`);
      return EXIT_FAIL;
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(`完成 ${tally.done}，跳过 ${tally.skipped}，失败 0，耗时 ${seconds}s\n`);
  return 0;
}
