import { RabbitMQService } from './services/rabbitmq.services';

async function main() {
  const rabbitMQ = new RabbitMQService();

  try {
    await rabbitMQ.connect();
    await rabbitMQ.startConsuming();

    console.log('🚀 Consumer is running...');
  } catch (error) {
    console.error('❌ Failed to start consumer:', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, closing gracefully...`);
    await rabbitMQ.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
