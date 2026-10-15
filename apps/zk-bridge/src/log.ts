// One JSON line per event, for the gym computer's log file. Never a key: callers pass only counts, serial numbers and reasons.

export type Logger = {
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
};

export function consoleLogger(write: (line: string) => void = (line) => console.log(line)): Logger {
  const at =
    (level: string) =>
    (event: string, fields: Record<string, unknown> = {}) =>
      write(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
  return { info: at("info"), warn: at("warn") };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {} };
