import { config } from '../config';
import { MessagePayload, ApiResponse } from '../types';

export class ApiService {
  private apiUrl: string;

  constructor() {
    this.apiUrl = config.apiUrl;
  }

  async sendMessage(payload: MessagePayload): Promise<ApiResponse> {
    const numbersArray = payload.numbers.map(String);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': payload.api_key,
        },
        body: JSON.stringify({
          numbers: numbersArray,
          content: payload.content,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `API request failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: unknown = await response.json();

      // Validate response structure
      if (!this.isApiResponse(data)) {
        throw new Error('Invalid API response structure');
      }

      return data;
    } catch (error) {
      console.error('❌ Error sending message to API:', error);
      throw error;
    }
  }

  // Type guard to validate API response
  private isApiResponse(data: unknown): data is ApiResponse {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const response = data as Record<string, unknown>;

    // Add your validation based on your ApiResponse interface
    // Example validations:
    // return typeof response.success === 'boolean' && typeof response.message === 'string';

    // For now, accepting any object as valid response
    return true;
  }
}
