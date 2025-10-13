export interface MessagePayload {
  numbers: (string | number)[];
  content: string;
  api_key: string;
}

export interface ApiResponse {
  success: boolean;
  message?: string;
  data?: any;
}

export interface Config {
  rabbitUrl: string;
  queueName: string;
  apiKey: string;
  apiUrl: string;
}
