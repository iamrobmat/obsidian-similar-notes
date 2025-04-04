import OpenAI from 'openai';

export class EmbeddingManager {
    private openai: OpenAI | null = null;
    private readonly model = 'text-embedding-ada-002';

    constructor(apiKey: string) {
        console.log('Initializing EmbeddingManager with API key:', apiKey ? 'Key provided' : 'No key provided');
        if (apiKey && apiKey.trim() !== '') {
            try {
                this.openai = new OpenAI({
                    apiKey: apiKey.trim(),
                    dangerouslyAllowBrowser: true // Wymagane dla Obsidian
                });
                console.log('OpenAI client initialized successfully');
            } catch (error) {
                console.error('Error initializing OpenAI client:', error);
                throw error;
            }
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        if (!this.openai) {
            console.error('OpenAI client not initialized');
            throw new Error('OpenAI API key not configured. Please add your key in the plugin settings.');
        }

        if (!text || text.trim().length === 0) {
            console.error('Empty text provided for embedding');
            throw new Error('Cannot generate embedding for empty text');
        }

        console.log('Generating embedding for text of length:', text.length);
        try {
            const trimmedText = text.slice(0, 8000); // Limit tokenów
            const response = await this.openai.embeddings.create({
                model: this.model,
                input: trimmedText
            });

            console.log('Embedding generated successfully, dimensions:', response.data[0].embedding.length);
            return response.data[0].embedding;
        } catch (error: any) {
            // Konwertuj błędy OpenAI na bardziej przyjazne komunikaty
            if (error.status === 401) {
                console.error('Invalid API key:', error);
                throw new Error('Invalid OpenAI API key. Please check your settings.');
            } else if (error.status === 429) {
                console.error('Rate limit exceeded:', error);
                throw new Error('OpenAI API rate limit exceeded. Please try again later.');
            } else if (error.status === 500) {
                console.error('OpenAI server error:', error);
                throw new Error('OpenAI server error. Please try again later.');
            } else {
                console.error('Error generating embedding:', error);
                throw new Error('Error generating embedding: ' + (error.message || 'Unknown error'));
            }
        }
    }

    calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
        if (vec1.length !== vec2.length) {
            console.error('Vector length mismatch:', vec1.length, vec2.length);
            throw new Error('Wektory muszą mieć tę samą długość');
        }

        const dotProduct = vec1.reduce((sum, a, i) => sum + a * vec2[i], 0);
        const norm1 = Math.sqrt(vec1.reduce((sum, a) => sum + a * a, 0));
        const norm2 = Math.sqrt(vec2.reduce((sum, a) => sum + a * a, 0));

        const similarity = dotProduct / (norm1 * norm2);
        console.log('Calculated similarity:', similarity);
        return similarity;
    }
} 