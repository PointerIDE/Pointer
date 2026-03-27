export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

export class ModelDiscoveryService {
  /**
   * Fetches available models from the specified API endpoint
   * @param apiEndpoint The base API endpoint (e.g., http://localhost:1234/v1)
   * @param apiKey Optional API key for authentication
   * @returns Promise<ModelInfo[]> Array of available models
   */
  static async getAvailableModels(apiEndpoint: string, apiKey?: string): Promise<ModelInfo[]> {
    let baseUrl = apiEndpoint;
    try {
      // Ensure the endpoint ends with /v1
      if (!baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.endsWith('/') 
          ? `${baseUrl}v1` 
          : `${baseUrl}/v1`;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch models: ${response.status} ${errorText}`);
      }

      const data: ModelsResponse = await response.json();
      return data.data || [];
    } catch (error) {
      // Improve diagnostics for endpoint connectivity issues (e.g., local server not running)
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error fetching available models from ${baseUrl}:`, message);

      if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        throw new Error(`Unable to reach model endpoint at ${baseUrl}. Please check your endpoint and network.`);
      }

      throw error;
    }
  }

  /**
   * Tests if an API endpoint is reachable and returns models
   * @param apiEndpoint The API endpoint to test
   * @param apiKey Optional API key
   * @returns Promise<boolean> True if endpoint is reachable
   */
  static async testEndpoint(apiEndpoint: string, apiKey?: string): Promise<boolean> {
    try {
      await this.getAvailableModels(apiEndpoint, apiKey);
      return true;
    } catch (error) {
      return false;
    }
  }
}
