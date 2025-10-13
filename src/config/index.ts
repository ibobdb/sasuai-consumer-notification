import * as dotenv from 'dotenv';
import { Config } from '../types';

dotenv.config();

export const config: Config = {
  rabbitUrl: process.env.RABBIT_URL || 'amqp://localhost',
  queueName: process.env.QUEUE_NAME || 'NOTIFICATIONS',
  apiUrl:
    process.env.API_URL || 'https://api.blastify.tech/api-keys/send-messages',
};
