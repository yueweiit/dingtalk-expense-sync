const winston = require('winston');
const path = require('path');

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}] ${message}`;
  })
);

const consoleFormats = [
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
];

if (process.stdout.isTTY) {
  consoleFormats.push(winston.format.colorize());
}

consoleFormats.push(
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level}] ${message}\n${stack}`;
    }
    return `${timestamp} [${level}] ${message}`;
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

module.exports = logger;
