import winston from "winston";

let logLevel = "info";

export function configureLogger(level: string): void {
  logLevel = level;
  logger.level = level;
}

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const rest = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
      return `${timestamp} [${level.toUpperCase()}] ${message}${rest}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});
