import { homedir } from 'node:os';
import { join } from 'node:path';

export function configPath(env = process.env) {
  return env.FREE_LLM_CONFIG_FILE
    ?? join(homedir(), '.config', 'free-llm', 'providers.json');
}

export function statePath(env = process.env) {
  return env.FREE_LLM_STATE_FILE
    ?? join(homedir(), '.local', 'state', 'free-llm', 'buckets.json');
}

export function logPath(env = process.env) {
  return env.FREE_LLM_LOG_FILE
    ?? join(homedir(), '.local', 'state', 'free-llm', 'requests.jsonl');
}
