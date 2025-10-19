import amqplib from 'amqplib';
import { config } from '../config';
import { MessagePayload } from '../types';
import { ApiService } from './api.services';

type AmqpConnection = any;
type AmqpChannel = any;
type ConsumeMessage = any;

export class RabbitMQService {
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;
  private apiService: ApiService;
  private isConnecting: boolean = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000; // 5 detik

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
      // Set heartbeat untuk keep connection alive
      this.connection = await amqplib.connect(config.rabbitUrl, {
        heartbeat: 60, // heartbeat setiap 60 detik
      });

      if (!this.connection) {
        throw new Error('Failed to establish connection');
      }

      this.channel = await this.connection.createChannel();

      if (!this.channel) {
        throw new Error('Failed to create channel');
      }

      // Set prefetch untuk control message consumption
      await this.channel.prefetch(1);
      await this.channel.assertQueue(config.queueName, { durable: true });

      console.log(
        `📥 Connected to RabbitMQ - Waiting for messages in queue: ${config.queueName}`
      );

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;

      // Setup event handlers
      this.setupConnectionHandlers();

      // Start heartbeat monitoring
      this.startHeartbeat();
    } catch (error) {
      console.error('❌ Failed to connect to RabbitMQ:', error);
      this.connection = null;
      this.channel = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', async (err: Error) => {
      console.error('❌ RabbitMQ connection error:', err.message);
      this.connection = null;
      this.channel = null;
      this.stopHeartbeat();

      // Attempt to reconnect
      await this.attemptReconnect();
    });

    this.connection.on('close', async () => {
      console.log('🔌 RabbitMQ connection closed');
      this.connection = null;
      this.channel = null;
      this.stopHeartbeat();

      // Attempt to reconnect
      await this.attemptReconnect();
    });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached. Giving up.');
      process.exit(1);
    }

    this.reconnectAttempts++;
    console.log(
      `🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));

    try {
      await this.connect();
      await this.startConsuming();
      console.log('✅ Reconnected successfully!');
    } catch (error) {
      console.error('❌ Reconnection failed:', error);
      await this.attemptReconnect();
    }
  }

  private startHeartbeat(): void {
    // Stop existing heartbeat if any
    this.stopHeartbeat();

    // Send periodic heartbeat (setiap 5 menit)
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        console.log('💓 Heartbeat - Connection alive');

        // Optional: Check queue stats untuk memastikan channel masih aktif
        this.checkQueueHealth();
      }
    }, 5 * 60 * 1000); // 5 menit
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async checkQueueHealth(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.checkQueue(config.queueName);
      }
    } catch (error) {
      console.error('❌ Queue health check failed:', error);
      // Trigger reconnection
      this.connection = null;
      this.channel = null;
      await this.attemptReconnect();
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

      const currentChannel = this.channel;
      if (currentChannel) {
        // Reject with requeue for transient errors
        currentChannel.nack(msg, false, true);
      }
    }
  }

  async close(): Promise<void> {
    const errors: Error[] = [];

    // Stop heartbeat
    this.stopHeartbeat();

    const channel = this.channel;
    const connection = this.connection;

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

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  async gracefulShutdown(): Promise<void> {
    console.log('🛑 Initiating graceful shutdown...');

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await this.close();
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
      throw error;
    }
  }

  getChannel(): AmqpChannel {
    const channel = this.channel;
    if (!channel) {
      throw new Error('Channel is not initialized');
    }
    return channel;
  }

  getConnection(): AmqpConnection {
    const connection = this.connection;
    if (!connection) {
      throw new Error('Connection is not initialized');
    }
    return connection;
  }
}
