import winston from 'winston';
import path from 'path';

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack } = info as { timestamp?: string; level: string; message: unknown; stack?: string };
    const msg = String(message);
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}] ${msg}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}] ${msg}`;
  })
);

const consoleFormats: winston.Logform.Format[] = [
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
];

if (process.stdout.isTTY) {
  consoleFormats.push(winston.format.colorize());
}

consoleFormats.push(
  winston.format.printf((info) => {
    const { timestamp, level, message, stack } = info as { timestamp?: string; level: string; message: unknown; stack?: string };
    const msg = String(message);
    if (stack) {
      return `${timestamp} [${level}] ${msg}\n${stack}`;
    }
    return `${timestamp} [${level}] ${msg}`;
  })
);

const logger = winston.createLogger({
  level: 'info',
  format: baseFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(...consoleFormats)
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/app.log')
    })
  ]
});

export default logger;
