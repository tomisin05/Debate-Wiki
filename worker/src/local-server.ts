import 'dotenv/config';

process.env.SERVICE_ROLE = 'local';
process.env.PORT ||= '8081';

await import('./server.js');
