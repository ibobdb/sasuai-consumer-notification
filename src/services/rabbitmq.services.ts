import amqplib from 'amqplib';
import { config } from '../config';
import { MessagePayload } from '../types';
import { ApiService } from './api.services';

// Type definitions untuk memastikan compatibility
type AmqpConnection = any;
type AmqpChannel = any;
type ConsumeMessage = any;

export class RabbitMQService {
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;
  private apiService: ApiService;
  private isConnecting: boolean = false;

  constructor() {
    this.apiService = new ApiService();
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      throw new Error('Connection already in progress');
    }

    if (this.connection && this.channel) {
      console.log('⚠️ Already connected to RabbitMQ');
      return;
    }

    this.isConnecting = true;

    try {
      this.connection = await amqplib.connect(config.rabbitUrl);

      if (!this.connection) {
        throw new Error('Failed to establish connection');
      }

      this.channel = await this.connection.createChannel();

      if (!this.channel) {
        throw new Error('Failed to create channel');
      }

      await this.channel.assertQueue(config.queueName, { durable: true });

      console.log(
        `📥 Connected to RabbitMQ - Waiting for messages in queue: ${config.queueName}`
      );

      // Handle connection errors
      this.connection.on('error', (err: Error) => {
        console.error('❌ RabbitMQ connection error:', err.message);
        this.connection = null;
        this.channel = null;
      });

      this.connection.on('close', () => {
        console.log('🔌 RabbitMQ connection closed');
        this.connection = null;
        this.channel = null;
      });
    } catch (error) {
      console.error('❌ Failed to connect to RabbitMQ:', error);
      this.connection = null;
      this.channel = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  async startConsuming(): Promise<void> {
    const channel = this.channel;

    if (!channel) {
      throw new Error('Channel is not initialized. Call connect() first.');
    }

    try {
      await channel.consume(
        config.queueName,
        async (msg: ConsumeMessage | null) => {
          if (msg !== null) {
            await this.processMessage(msg);
          }
        },
        { noAck: false }
      );

      console.log(
        `🎧 Started consuming messages from queue: ${config.queueName}`
      );
    } catch (error) {
      console.error('❌ Failed to start consuming:', error);
      throw error;
    }
  }

  private async processMessage(msg: ConsumeMessage): Promise<void> {
    const channel = this.channel;

    if (!channel) {
      console.error('❌ Channel is null, cannot process message');
      return;
    }

    try {
      const message = msg.content.toString();
      console.log(`📨 Received: ${message}`);

      let payload: MessagePayload;

      try {
        payload = JSON.parse(message);
      } catch (parseError) {
        console.error('❌ Invalid JSON format:', parseError);
        channel.ack(msg);
        return;
      }

      // Validate payload
      if (!payload || typeof payload !== 'object') {
        console.error('❌ Invalid payload structure');
        channel.ack(msg);
        return;
      }

      if (!Array.isArray(payload.numbers) || payload.numbers.length === 0) {
        console.error('❌ Invalid or empty numbers array:', payload.numbers);
        channel.ack(msg);
        return;
      }

      if (!payload.content || typeof payload.content !== 'string') {
        console.error('❌ Missing or invalid content in payload');
        channel.ack(msg);
        return;
      }

      // Send to API
      const result = await this.apiService.sendMessage(payload);

      console.log('✅ API Response:', result);
      console.log(`📊 Sent to ${payload.numbers.length} numbers`);

      // Acknowledge message after successful processing
      channel.ack(msg);
    } catch (err) {
      console.error(
        '❌ Error processing message:',
        err instanceof Error ? err.message : err
      );

      // Re-check channel before nack operation
      const currentChannel = this.channel;
      if (currentChannel) {
        // Option 1: Reject without requeue (sends to DLQ if configured)
        // currentChannel.nack(msg, false, false);
        // Option 2: Reject with requeue (will retry immediately)
        // currentChannel.nack(msg, false, true);
        // Current behavior: Don't ack, message stays in queue
      }
    }
  }

  async close(): Promise<void> {
    const errors: Error[] = [];
    const channel = this.channel;
    const connection = this.connection;

    // Close channel first
    if (channel) {
      try {
        await channel.close();
        this.channel = null;
      } catch (error) {
        console.error('❌ Error closing channel:', error);
        this.channel = null;
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Then close connection
    if (connection) {
      try {
        await connection.close();
        this.connection = null;
      } catch (error) {
        console.error('❌ Error closing connection:', error);
        this.connection = null;
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length === 0) {
      console.log('🔌 RabbitMQ connection closed gracefully');
    } else {
      throw new Error(
        `Failed to close RabbitMQ properly: ${errors
          .map((e) => e.message)
          .join(', ')}`
      );
    }
  }

  // Helper method to check connection status
  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  // Graceful shutdown
  async gracefulShutdown(): Promise<void> {
    console.log('🛑 Initiating graceful shutdown...');

    try {
      // Wait a bit for current messages to finish processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Close connections
      await this.close();
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
      throw error;
    }
  }

  // Get channel for advanced operations (with null check)
  getChannel(): AmqpChannel {
    const channel = this.channel;
    if (!channel) {
      throw new Error('Channel is not initialized');
    }
    return channel;
  }

  // Get connection for advanced operations (with null check)
  getConnection(): AmqpConnection {
    const connection = this.connection;
    if (!connection) {
      throw new Error('Connection is not initialized');
    }
    return connection;
  }
}
