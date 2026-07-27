function redactString(value, secrets) {
  let redacted = value;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

export function createRedactor(values = []) {
  const secrets = [...new Set(
    values.filter((value) => typeof value === 'string' && value.length > 0),
  )].sort((left, right) => right.length - left.length);

  function redact(value) {
    if (typeof value === 'string') return redactString(value, secrets);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, redact(item)]),
      );
    }
    return value;
  }

  return Object.freeze({
    string(value) {
      return redactString(String(value), secrets);
    },
    value: redact,
  });
}
