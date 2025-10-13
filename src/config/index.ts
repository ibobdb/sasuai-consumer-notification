import * as dotenv from 'dotenv';
import { Config } from '../types';

dotenv.config();

export const config: Config = {
  rabbitUrl: process.env.RABBIT_URL || 'amqp://localhost',
  queueName: process.env.QUEUE_NAME || 'NOTIFICATIONS',
  apiKey: process.env.API_KEY || '',
  apiUrl:
    process.env.API_URL || 'https://api.blastify.tech/api-keys/send-messages',
};

// Validate required env vars
if (!config.apiKey) {
  console.error('❌ API_KEY is required');
  process.exit(1);
}
