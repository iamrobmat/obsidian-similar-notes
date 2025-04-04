import { DataAdapter, TFile, App } from 'obsidian';
import { EmbeddingManager } from './embedding';

interface EmbeddingData {
    embedding: number[];
    last_updated: string;
    file_mtime: number;  // Timestamp ostatniej modyfikacji pliku
}

interface EmbeddingsDatabase {
    [key: string]: EmbeddingData;
}

interface SimilarNote {
    path: string;
    title: string;
    similarity: number;
}

type DatabaseUpdateCallback = () => void;

export class DatabaseManager {
    private readonly dbPath = '.obsidian/plugins/similar-notes/embeddings.json';
    private adapter: DataAdapter;
    private embeddingManager: EmbeddingManager;
    private app: App;
    private updateCallbacks: DatabaseUpdateCallback[] = [];

    constructor(adapter: DataAdapter, embeddingManager: EmbeddingManager, app: App) {
        this.adapter = adapter;
        this.embeddingManager = embeddingManager;
        this.app = app;
    }

    // Rejestracja funkcji callbacku do wywołania po aktualizacji bazy
    registerUpdateCallback(callback: DatabaseUpdateCallback) {
        this.updateCallbacks.push(callback);
    }

    // Wywoływanie wszystkich zarejestrowanych callbacków
    private notifyUpdateCallbacks() {
        for (const callback of this.updateCallbacks) {
            callback();
        }
    }

    async loadDatabase(): Promise<EmbeddingsDatabase> {
        try {
            const data = await this.adapter.read(this.dbPath);
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    async saveDatabase(data: EmbeddingsDatabase): Promise<void> {
        await this.adapter.write(this.dbPath, JSON.stringify(data, null, 2));
        // Powiadom o aktualizacji
        this.notifyUpdateCallbacks();
    }

    async saveEmbedding(filePath: string, embedding: number[], file_mtime: number): Promise<void> {
        const db = await this.loadDatabase();
        db[filePath] = {
            embedding,
            last_updated: new Date().toISOString(),
            file_mtime: file_mtime
        };
        await this.saveDatabase(db);
    }

    async getEmbedding(filePath: string): Promise<EmbeddingData | null> {
        const db = await this.loadDatabase();
        return db[filePath] || null;
    }

    async getAllEmbeddings(): Promise<EmbeddingsDatabase> {
        return await this.loadDatabase();
    }

    async deleteEmbedding(filePath: string): Promise<void> {
        const db = await this.loadDatabase();
        delete db[filePath];
        await this.saveDatabase(db);
    }

    async clearDatabase(): Promise<void> {
        await this.saveDatabase({});
    }

    async findSimilarNotes(notePath: string, maxResults: number, minSimilarity: number): Promise<SimilarNote[]> {
        console.log('Finding similar notes for:', notePath);
        const currentEmbedding = await this.getEmbedding(notePath);
        console.log('Current embedding found:', !!currentEmbedding);
        if (!currentEmbedding) {
            console.log('No embedding found for note, generating...');
            try {
                // Próba wygenerowania embeddingu
                const file = this.app.vault.getAbstractFileByPath(notePath);
                if (file instanceof TFile && file.extension === 'md') {
                    const content = await this.app.vault.read(file);
                    const embedding = await this.embeddingManager.generateEmbedding(content);
                    await this.saveEmbedding(notePath, embedding, new Date().getTime());
                    console.log('Generated new embedding for:', notePath);
                } else {
                    console.log('File not found or not a markdown file:', notePath);
                }
                return [];
            } catch (error) {
                console.error('Error generating embedding:', error);
                return [];
            }
        }

        const allEmbeddings = await this.getAllEmbeddings();
        console.log('Total embeddings in database:', Object.keys(allEmbeddings).length);
        const similarities: SimilarNote[] = [];

        for (const [path, data] of Object.entries(allEmbeddings)) {
            if (path !== notePath) {
                try {
                    const similarity = this.embeddingManager.calculateCosineSimilarity(
                        currentEmbedding.embedding,
                        data.embedding
                    );
                    
                    if (similarity >= minSimilarity) {
                        similarities.push({
                            path,
                            title: path.split('/').pop()?.replace('.md', '') || path,
                            similarity
                        });
                    }
                } catch (error) {
                    console.error('Error calculating similarity for:', path, error);
                }
            }
        }

        console.log('Total similar notes found:', similarities.length);
        return similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxResults);
    }
} 