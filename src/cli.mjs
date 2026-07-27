#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { createRedactor } from './redact.mjs';
import { createScheduler } from './scheduler.mjs';
import { createProxyServer, listen } from './proxy.mjs';
import { listModels } from './models.mjs';
import { logPath, statePath } from './paths.mjs';
import { readRequestLog, RequestLog } from './request-log.mjs';

const VERSION = '1.0.0';
const VALUE_OPTIONS = new Set(['port', 'host', 'limit']);
const BOOLEAN_OPTIONS = new Set(['json', 'help', 'version']);

const HELP = `free-llm ${VERSION}

Usage:
  free-llm serve [--port 8080] [--host 127.0.0.1] [--json]
  free-llm status [--json]
  free-llm models [--json]
  free-llm log [--limit n] [--json]
  free-llm check [--json]
  free-llm --version

Configuration:
  ~/.config/free-llm/providers.json

API keys are read only from each provider's configured apiKeyEnv variable.
`;

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h') {
      options.help = true;
      continue;
    }
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    const equal = argument.indexOf('=');
    const rawName = argument.slice(2, equal < 0 ? undefined : equal);
    if (BOOLEAN_OPTIONS.has(rawName)) {
      if (equal >= 0) throw new Error(`Option --${rawName} does not take a value`);
      options[rawName] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(rawName)) throw new Error(`Unknown option --${rawName}`);
    const value = equal >= 0 ? argument.slice(equal + 1) : argv[++index];
    if (value == null || value === '') {
      throw new Error(`Option --${rawName} requires a value`);
    }
    options[rawName] = value;
  }
  return { options, positionals };
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printRows(output, rows, columns) {
  if (rows.length === 0) {
    output.write('None\n');
    return;
  }
  output.write(`${columns.map((column) => column.label).join('\t')}\n`);
  for (const row of rows) {
    output.write(`${columns.map((column) => column.value(row)).join('\t')}\n`);
  }
}

function numericOption(value, name, { minimum = 1, maximum = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function ensureNoPositionals(positionals, command) {
  if (positionals.length > 1) {
    throw new Error(`${command} does not accept positional arguments`);
  }
}

function formatRemaining(bucket) {
  if (!bucket) return '-';
  return `${bucket.remaining.toFixed(1)}/${bucket.limit}`;
}

function isLoopback(host) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized.startsWith('127.');
}

async function configuration(options) {
  const env = options.env ?? process.env;
  const config = options.config ?? await loadConfig({
    env,
    path: options.configPath,
  });
  const redactor = options.redactor ?? createRedactor(
    config.providers.map((provider) => provider.apiKey),
  );
  return { config, redactor };
}

async function runtime(options) {
  const env = options.env ?? process.env;
  const configured = await configuration(options);
  const scheduler = options.scheduler ?? await createScheduler(configured.config.providers, {
    env,
    statePath: options.statePath ?? statePath(env),
    clock: options.clock,
    rng: options.rng,
  });
  return { ...configured, scheduler };
}

export async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const parsed = parseArgs(argv);
  const command = parsed.positionals[0];

  if (parsed.options.version || command === '--version') {
    stdout.write(`${VERSION}\n`);
    return { exitCode: 0 };
  }
  if (parsed.options.help || command == null) {
    stdout.write(HELP);
    return { exitCode: 0 };
  }
  if (!['serve', 'status', 'models', 'log', 'check'].includes(command)) {
    throw new Error(`Unknown command "${command}"`);
  }
  ensureNoPositionals(parsed.positionals, command);

  if (command === 'log') {
    const limit = parsed.options.limit == null
      ? 20
      : numericOption(parsed.options.limit, 'limit', { minimum: 1, maximum: 10_000 });
    const entries = await readRequestLog({
      env,
      path: options.logPath ?? logPath(env),
      limit,
    });
    if (parsed.options.json) {
      writeJson(stdout, entries);
    } else {
      printRows(stdout, entries, [
        { label: 'TIME', value: (entry) => entry.timestamp ?? '-' },
        { label: 'PROVIDER', value: (entry) => entry.provider ?? '-' },
        { label: 'MODEL', value: (entry) => entry.model ?? '-' },
        { label: 'LATENCY', value: (entry) => `${entry.latencyMs ?? 0}ms` },
        { label: 'OUTCOME', value: (entry) => entry.outcome ?? '-' },
      ]);
    }
    return { exitCode: 0, entries };
  }

  const configured = await configuration({ ...options, env });
  if (command === 'check') {
    const report = {
      source: configured.config.source,
      valid: true,
      providers: configured.config.providers.map((provider) => ({
        id: provider.id,
        provider: provider.provider,
        usable: provider.configured,
        apiKeyEnv: provider.apiKeyEnv,
        reason: provider.configured
          ? 'ready'
          : `${provider.apiKeyEnv} is unset`,
      })),
    };
    if (parsed.options.json) {
      writeJson(stdout, report);
    } else {
      stdout.write(`Config: ${report.source}\n`);
      printRows(stdout, report.providers, [
        { label: 'ID', value: (provider) => provider.id },
        { label: 'USABLE', value: (provider) => (provider.usable ? 'yes' : 'no') },
        { label: 'REASON', value: (provider) => provider.reason },
      ]);
    }
    return { exitCode: 0, report };
  }

  if (command === 'models') {
    const models = listModels(configured.config);
    if (parsed.options.json) {
      writeJson(stdout, models);
    } else {
      printRows(stdout, models, [
        { label: 'MODEL', value: (model) => model.id },
        { label: 'TYPE', value: (model) => (model.alias ? 'alias' : 'concrete') },
        { label: 'PROVIDERS', value: (model) => model.providers.join(',') },
      ]);
    }
    return { exitCode: 0, models };
  }

  const current = await runtime({
    ...options,
    env,
    config: configured.config,
    redactor: configured.redactor,
  });
  if (command === 'status') {
    const report = current.scheduler.status();
    if (parsed.options.json) {
      writeJson(stdout, report);
    } else {
      printRows(stdout, report, [
        { label: 'ID', value: (provider) => provider.id },
        { label: 'CONFIGURED', value: (provider) => (provider.configured ? 'yes' : 'no') },
        { label: 'ELIGIBLE', value: (provider) => (provider.eligible ? 'yes' : 'no') },
        { label: 'RPM', value: (provider) => formatRemaining(provider.buckets.rpm) },
        { label: 'RPD', value: (provider) => formatRemaining(provider.buckets.rpd) },
        { label: 'TPM', value: (provider) => formatRemaining(provider.buckets.tpm) },
        { label: 'BREAKER', value: (provider) => provider.breaker },
        { label: 'RETRY', value: (provider) => `${provider.retryAfter}s` },
      ]);
    }
    return { exitCode: 0, report };
  }

  const port = parsed.options.port == null
    ? 8080
    : numericOption(parsed.options.port, 'port', { minimum: 0, maximum: 65_535 });
  const host = parsed.options.host ?? '127.0.0.1';
  if (!isLoopback(host)) {
    stderr.write(
      `WARNING: free-llm is binding to non-loopback host ${host}; this process holds API keys.\n`,
    );
  }
  const requestLog = options.requestLog ?? new RequestLog({
    env,
    path: options.logPath ?? logPath(env),
    redactor: current.redactor,
    clock: options.clock,
  });
  const server = options.server ?? createProxyServer({
    config: current.config,
    scheduler: current.scheduler,
    requestLog,
    redactor: current.redactor,
    fetchFn: options.fetchFn,
    logger: options.logger,
    clock: options.clock,
    timeoutMs: options.timeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    headersTimeoutMs: options.headersTimeoutMs,
  });
  const address = await listen(server, { port, host });
  const displayHost = typeof address === 'object' && address?.address
    ? address.address
    : host;
  const displayPort = typeof address === 'object' && address?.port
    ? address.port
    : port;
  const started = {
    host: displayHost,
    port: displayPort,
    url: `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${displayPort}`,
  };
  if (parsed.options.json) writeJson(stdout, started);
  else stdout.write(`free-llm listening on ${started.url}\n`);
  return { exitCode: 0, server, address: started };
}

function environmentRedactor(env) {
  const likelySecrets = Object.entries(env)
    .filter(([name, value]) => (
      /(?:API_?KEY|TOKEN|SECRET|PASSWORD)$/i.test(name)
      && typeof value === 'string'
      && value.length > 0
    ))
    .map(([, value]) => value);
  return createRedactor(likelySecrets);
}

export async function main(argv = process.argv.slice(2)) {
  let result;
  try {
    result = await runCli(argv);
  } catch (error) {
    const redactor = environmentRedactor(process.env);
    process.stderr.write(`free-llm: ${redactor.string(error?.message ?? error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (!result.server) return;
  const close = () => result.server.close();
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await once(result.server, 'close');
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
