#!/usr/bin/env node
/**
 * Ring 5 — the `devdigest` CLI entry point.
 *
 * A second entry point into this package, beside the stdio MCP server. They
 * share the API port, the narrow schemas and the domain layer; they share no
 * process. The stdio server treats stdout as the JSON-RPC channel, so nothing
 * here is imported by it and nothing there prints.
 *
 * In THIS process stdout is the report and stderr is the diagnostics, which is
 * the ordinary CLI convention: `devdigest review --json | jq` has to work.
 */
import process, { argv, cwd, env, stderr, stdout } from 'node:process';
import { createGitClient } from './adapters/git.js';
import { createHttpApi } from './adapters/http-client.js';
import { HELP, formatReview } from './domain/cli-format.js';
import {
  EXIT_ERROR,
  reviewWorkingTree,
  type ReviewFailure,
} from './usecases/review-working-tree.js';

interface Args {
  command: string | undefined;
  /** Set when a flag arrived without a usable value, or is unrecognised. */
  badFlag: string | undefined;
  mode: string;
  agentId: string | undefined;
  json: boolean;
  help: boolean;
}

export function parseArgs(argvSlice: string[]): Args {
  const args: Args = {
    command: undefined,
    badFlag: undefined,
    mode: 'working',
    agentId: undefined,
    json: false,
    help: false,
  };

  for (let i = 0; i < argvSlice.length; i += 1) {
    const token = argvSlice[i];
    if (token === '-h' || token === '--help') args.help = true;
    else if (token === '--json') args.json = true;
    else if (token === '--mode' || token === '--agent') {
      // A value that is absent or is itself a flag is a typo, not a default.
      // Left to fall through, `--agent` with no value would run a paid review
      // against whichever reviewer happens to be first.
      const value = argvSlice[i + 1];
      if (value === undefined || value.startsWith('-')) {
        args.badFlag = token;
        break;
      }
      i += 1;
      if (token === '--mode') args.mode = value;
      else args.agentId = value;
    } else if (token && !token.startsWith('-') && !args.command) args.command = token;
    else if (token && token.startsWith('-')) args.badFlag = token;
  }

  return args;
}

/** One line of advice per cause. A failure a caller cannot act on is noise. */
export function failureMessage(failure: ReviewFailure): string {
  switch (failure.kind) {
    case 'unsupported_mode':
      return failure.mode === 'staged' || failure.mode === 'branch'
        ? `--mode ${failure.mode} is not implemented yet. Only --mode working is available.`
        : `Unknown --mode "${failure.mode}". Available: working (staged and branch are not implemented yet).`;
    case 'git':
      switch (failure.failure.kind) {
        case 'git_missing':
          return 'git was not found on PATH. This command reads the working tree with git.';
        case 'not_a_repo':
          return `Not inside a git repository (${failure.failure.cwd}). Run this from a working copy.`;
        case 'no_head':
          return 'This repository has no commits yet, so there is nothing to diff against. Make an initial commit first.';
        default:
          return `git failed: ${failure.failure.message}`;
      }
    case 'no_changes':
      return failure.untracked.length > 0
        ? `No tracked changes to review. ${failure.untracked.length} untracked file(s) exist — \`git diff HEAD\` cannot see those, so nothing was reviewed. \`git add\` them first.`
        : 'No tracked changes to review — the working tree is clean against HEAD.';
    case 'api':
      return failure.message;
  }
}

export async function main(argvSlice: string[]): Promise<number> {
  const args = parseArgs(argvSlice);

  // --help still wins: someone asking how to use it should get the help, not a
  // complaint about the flag they were asking about.
  if (args.badFlag && !args.help) {
    stderr.write(
      `${args.badFlag} needs a value, or is not a recognised option. ` +
        'Run `devdigest review --help`.\n',
    );
    return EXIT_ERROR;
  }

  if (args.help || !args.command) {
    stdout.write(`${HELP}\n`);
    // No command is a usage error, not a successful run; --help is what a
    // caller asking for help gets a 0 for.
    return args.help ? 0 : EXIT_ERROR;
  }

  if (args.command !== 'review') {
    stderr.write(`Unknown command "${args.command}". The only command is: review\n`);
    return EXIT_ERROR;
  }

  const api = createHttpApi({ baseUrl: env.DEVDIGEST_API_URL ?? 'http://localhost:3001' });
  const result = await reviewWorkingTree(
    { api, git: createGitClient() },
    { cwd: cwd(), mode: args.mode, agentId: args.agentId },
  );

  if (!result.ok) {
    stderr.write(`${failureMessage(result.failure)}\n`);
    return result.exit;
  }

  if (args.json) {
    stdout.write(
      `${JSON.stringify(
        {
          branch: result.branch,
          untracked: result.untracked,
          review: result.review,
          exit: result.exit,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    stdout.write(
      `${formatReview(result.review, { branch: result.branch, untracked: result.untracked })}\n`,
    );
  }

  return result.exit;
}

/**
 * Run only when this file IS the process entry, so the test suite can import
 * `parseArgs` and `failureMessage` without the module launching a review and
 * calling `process.exit` out from under the runner.
 */
if (argv[1] && /[\\/]cli\.ts$/.test(argv[1])) {
  main(argv.slice(2))
    .then((code) => {
      // `exitCode`, not `exit()`. Calling `exit()` tears down stdout while the
      // report may still be draining — on Windows that aborts the process in
      // libuv instead of exiting, losing both the output and the exit code.
      // Setting the code lets node leave once the stream has flushed.
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      stderr.write(`devdigest review failed: ${String(error)}\n`);
      process.exitCode = EXIT_ERROR;
    });
}
