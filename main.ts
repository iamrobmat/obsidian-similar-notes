import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Notice } from 'obsidian';
import { SimilarNotesView } from './ui';
import { EmbeddingManager } from './embedding';
import { DatabaseManager } from './db';

interface SimilarNotesSettings {
    openaiApiKey: string;
    maxResults: number;
    minSimilarity: number;
    errorLogs: ErrorLogEntry[];
    maxErrorLogs: number;
}

interface ErrorLogEntry {
    timestamp: number;
    message: string;
    details?: string;
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
    openaiApiKey: '',
    maxResults: 5,
    minSimilarity: 0.75,
    errorLogs: [],
    maxErrorLogs: 50
};

export default class SimilarNotesPlugin extends Plugin {
    settings: SimilarNotesSettings;
    view: SimilarNotesView;
    embeddingManager: EmbeddingManager;
    dbManager: DatabaseManager;

    async onload() {
        await this.loadSettings();
        
        try {
            // Inicjalizacja menedżerów
            this.embeddingManager = new EmbeddingManager(this.settings.openaiApiKey);
            this.dbManager = new DatabaseManager(this.app.vault.adapter, this.embeddingManager, this.app);

            // Rejestracja callbacku do aktualizacji statystyk
            this.registerDbUpdateCallback();

            // Rejestracja widoku
            this.registerView(
                'similar-notes-view',
                (leaf: WorkspaceLeaf) => new SimilarNotesView(leaf, this)
            );

            // Dodanie skrótu klawiszowego do otwierania widoku
            this.addCommand({
                id: 'open-similar-notes-view',
                name: 'Open Similar Notes view',
                callback: () => {
                    const leaf = this.app.workspace.getLeaf('split');
                    leaf.setViewState({
                        type: 'similar-notes-view',
                        active: true,
                    });
                }
            });

            // Dodanie ustawień
            this.addSettingTab(new SimilarNotesSettingTab(this.app, this));

            // Dodanie komend
            this.addCommand({
                id: 'reindex-all-notes',
                name: 'Reindex all notes',
                callback: () => this.reindexAllNotes()
            });

            // Nasłuchiwanie na zmiany w notatkach
            this.registerEvent(
                this.app.vault.on('modify', (file: TFile) => {
                    if (file.extension === 'md') {
                        this.updateNoteEmbedding(file.path).catch(error => 
                            this.logError(`Error updating embedding for ${file.path}`, error)
                        );
                    }
                })
            );

            // Sprawdzenie, czy klucz API jest skonfigurowany
            if (!this.settings.openaiApiKey) {
                new Notice('Similar Notes plugin: OpenAI API key not configured. Please add it in the plugin settings.');
            } else {
                // Inkrementalne indeksowanie podczas startu
                new Notice('Similar Notes plugin: Checking for notes that need indexing...');
                // Uruchamiamy w setTimeout, aby nie blokować interfejsu
                setTimeout(async () => {
                    await this.reindexAllNotes(false);
                }, 1000);
            }
            
            console.log('Similar Notes plugin loaded successfully.');
        } catch (error) {
            this.logError('Error during plugin initialization', error);
        }
    }

    // Rejestracja callbacku do aktualizacji statystyk
    registerDbUpdateCallback() {
        // Adres obiektu, który może być używany jako referencja do aktywnej zakładki
        const callbackState = { activeSettingTab: null as SimilarNotesSettingTab | null };
        
        // Rejestrujemy metodę, która zostanie wywołana przy tworzeniu zakładki ustawień
        const originalTabDisplay = SimilarNotesSettingTab.prototype.display;
        SimilarNotesSettingTab.prototype.display = function() {
            // Zapisz referencję do bieżącej zakładki
            callbackState.activeSettingTab = this;
            
            // Wywołaj oryginalną metodę
            originalTabDisplay.call(this);
        };
        
        // Funkcja callbacku wywoływana po aktualizacji bazy danych
        const updateCallback = () => {
            // Jeśli mamy aktywną zakładkę, aktualizujemy jej statystyki
            if (callbackState.activeSettingTab) {
                callbackState.activeSettingTab.updateDbStats();
            }
        };
        
        // Zarejestruj callback
        this.dbManager.registerUpdateCallback(updateCallback);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async reindexAllNotes(forceUpdate = false): Promise<void> {
        try {
            const files = this.app.vault.getMarkdownFiles();
            
            // Pokaż informację o rozpoczęciu procesu
            new Notice(`Checking ${files.length} notes for indexing...`);
            
            // Utworzenie wskaźnika postępu
            const statusBarItemEl = this.addStatusBarItem();
            statusBarItemEl.setText('Checking: 0%');
            
            let processedCount = 0;
            let errorCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;
            
            for (const file of files) {
                try {
                    const wasUpdated = await this.updateNoteEmbedding(file.path, forceUpdate);
                    if (wasUpdated) {
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (error) {
                    errorCount++;
                    this.logError(`Error indexing ${file.path}`, error);
                }
                
                // Aktualizacja wskaźnika postępu
                processedCount++;
                const percentage = Math.round((processedCount / files.length) * 100);
                statusBarItemEl.setText(`Processing: ${percentage}%`);
                
                // Aby UI mogło się zaktualizować
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            // Usuwamy wskaźnik po zakończeniu
            statusBarItemEl.remove();
            
            if (forceUpdate) {
                if (errorCount > 0) {
                    new Notice(`Reindexed ${updatedCount} notes. Skipped: ${skippedCount}. Errors: ${errorCount}`);
                } else {
                    new Notice(`Successfully reindexed ${updatedCount} notes. Skipped: ${skippedCount}`);
                }
            } else {
                if (updatedCount === 0 && errorCount === 0) {
                    new Notice(`All ${files.length} notes are up to date.`);
                } else {
                    new Notice(`Updated ${updatedCount} notes. Skipped: ${skippedCount}. Errors: ${errorCount}`);
                }
            }
        } catch (error) {
            this.logError('Error during reindexing process', error);
        }
    }

    async updateNoteEmbedding(filePath: string, forceUpdate = false) {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                // Sprawdź, czy notatka ma już embedding i czy nie została zmieniona
                if (!forceUpdate) {
                    const existingEmbedding = await this.dbManager.getEmbedding(filePath);
                    if (existingEmbedding && existingEmbedding.file_mtime >= file.stat.mtime) {
                        // Notatka ma już aktualny embedding, pomijamy
                        return false;
                    }
                }

                // Generowanie nowego embeddingu
                const content = await this.app.vault.read(file);
                const embedding = await this.embeddingManager.generateEmbedding(content);
                await this.dbManager.saveEmbedding(filePath, embedding, file.stat.mtime);
                return true;
            }
            return false;
        } catch (error) {
            if (error instanceof Error && error.message.includes('API key not configured')) {
                // Ignorujemy ten błąd, ponieważ jest to oczekiwane zachowanie przed konfiguracją klucza API
                return false;
            }
            throw error; // Przekazujemy błąd dalej, aby został obsłużony w reindexAllNotes lub logError
        }
    }

    /**
     * Log an error to the plugin's error log history
     */
    logError(message: string, error?: any) {
        const errorEntry: ErrorLogEntry = {
            timestamp: Date.now(),
            message: message,
        };

        if (error) {
            console.error(message, error);
            if (error instanceof Error) {
                errorEntry.details = error.message + (error.stack ? '\n' + error.stack : '');
            } else {
                errorEntry.details = String(error);
            }
        } else {
            console.error(message);
        }

        // Add to beginning of array (most recent first)
        this.settings.errorLogs.unshift(errorEntry);
        
        // Trim log if it exceeds max size
        if (this.settings.errorLogs.length > this.settings.maxErrorLogs) {
            this.settings.errorLogs = this.settings.errorLogs.slice(0, this.settings.maxErrorLogs);
        }
        
        // Save settings to persist error logs
        this.saveSettings();
        
        // Also display as a notice
        new Notice(`Error: ${message}`);
    }
}

class SimilarNotesSettingTab extends PluginSettingTab {
    plugin: SimilarNotesPlugin;
    dbInfoEl: HTMLElement | null = null;

    constructor(app: App, plugin: SimilarNotesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // Funkcja do aktualizacji statystyk bazy danych
    async updateDbStats() {
        if (!this.dbInfoEl) return;
        
        try {
            console.log('Updating database statistics display...');
            
            // Upewnij się, że contenerel jest widoczny przed aktualizacją
            if (!this.containerEl.isShown()) {
                console.log('Settings tab not visible, skipping update');
                return;
            }
            
            // Znajdź lub utwórz kontener dla statystyk
            let statsContent = this.dbInfoEl.querySelector('.stats-content');
            if (!statsContent) {
                // Usuń stare elementy p (kompatybilność wsteczna)
                this.dbInfoEl.querySelectorAll('p').forEach(el => {
                    if (el.parentElement === this.dbInfoEl) {
                        el.remove();
                    }
                });
                
                statsContent = this.dbInfoEl.createEl('div', { cls: 'stats-content' });
            } else {
                statsContent.empty();
            }
            
            // Pokaż informację o ładowaniu
            statsContent.createEl('p', { text: 'Loading statistics...' });
            
            // Pobierz dane o embeddingach i plikach
            const embeddings = await this.plugin.dbManager.getAllEmbeddings();
            const totalFiles = this.app.vault.getMarkdownFiles().length;
            const indexedFiles = Object.keys(embeddings).length;
            
            const percentage = Math.round((indexedFiles / totalFiles) * 100);
            const stats = `${indexedFiles} of ${totalFiles} notes indexed (${percentage}%)`;
            
            console.log(`Statistics: ${stats}`);
            
            // Zaktualizuj wyświetlane statystyki
            statsContent.empty();
            statsContent.createEl('p', { text: stats });
            
            // Dodaj pasek postępu
            const progressContainer = statsContent.createEl('div');
            progressContainer.style.width = '100%';
            progressContainer.style.height = '8px';
            progressContainer.style.backgroundColor = 'var(--background-modifier-border)';
            progressContainer.style.borderRadius = '4px';
            progressContainer.style.overflow = 'hidden';
            progressContainer.style.marginTop = '8px';
            
            const progressBar = progressContainer.createEl('div');
            progressBar.style.width = `${percentage}%`;
            progressBar.style.height = '100%';
            progressBar.style.backgroundColor = 'var(--interactive-accent)';
        } catch (error) {
            console.error('Error updating database statistics:', error);
            
            // W przypadku błędu, pokazujemy prostą informację
            if (this.dbInfoEl) {
                // Znajdź lub utwórz kontener dla statystyk
                let statsContent = this.dbInfoEl.querySelector('.stats-content');
                if (!statsContent) {
                    statsContent = this.dbInfoEl.createEl('div', { cls: 'stats-content' });
                } else {
                    statsContent.empty();
                }
                
                statsContent.createEl('p', { 
                    text: 'Error loading statistics. Please try again.' 
                });
            }
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Similar Notes Settings' });

        // API Key Section
        containerEl.createEl('h3', { text: 'API Configuration' });
        
        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Your OpenAI API key for generating embeddings')
            .addText(text => text
                .setPlaceholder('sk-...')
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // Privacy Notice
        const privacyEl = containerEl.createEl('div', { cls: 'similar-notes-privacy-notice' });
        privacyEl.createEl('h3', { text: 'Privacy Information' });
        privacyEl.createEl('p', { 
            text: 'This plugin uses OpenAI API to generate embeddings for your notes. ' +
                  'Note content is sent to OpenAI when generating embeddings. ' +
                  'Please review OpenAI\'s privacy policy: '
        });
        const privacyLink = privacyEl.createEl('a', { 
            text: 'OpenAI Privacy Policy',
            href: 'https://openai.com/policies/privacy-policy'
        });
        privacyLink.setAttribute('target', '_blank');
        privacyLink.setAttribute('rel', 'noopener');
        
        privacyEl.createEl('p', { 
            text: 'Embeddings are stored locally in your vault and are not shared with anyone.'
        });
        
        privacyEl.createEl('p', { 
            text: 'Tip: Consider setting up usage limits on your OpenAI account to control costs.'
        });
        
        // Results Configuration
        containerEl.createEl('h3', { text: 'Results Configuration' });
        
        new Setting(containerEl)
            .setName('Maximum Results')
            .setDesc('How many similar notes to display')
            .addText(text => text
                .setValue(this.plugin.settings.maxResults.toString())
                .onChange(async (value) => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue > 0) {
                        this.plugin.settings.maxResults = numValue;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Minimum Similarity')
            .setDesc('Minimum similarity threshold (0-1)')
            .addText(text => text
                .setValue(this.plugin.settings.minSimilarity.toString())
                .onChange(async (value) => {
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
                        this.plugin.settings.minSimilarity = numValue;
                        await this.plugin.saveSettings();
                    }
                }));
                
        // Database Management
        containerEl.createEl('h3', { text: 'Database Management' });
        
        // Pokaż informację o liczbie zaindeksowanych notatek
        this.dbInfoEl = containerEl.createEl('div', { cls: 'similar-notes-db-info' });
        this.dbInfoEl.style.marginBottom = '16px';
        this.dbInfoEl.style.padding = '8px';
        this.dbInfoEl.style.backgroundColor = 'var(--background-secondary)';
        this.dbInfoEl.style.borderRadius = '4px';
        
        // Dodaję przycisk odświeżenia
        const headerDiv = this.dbInfoEl.createEl('div', { cls: 'similar-notes-db-header' });
        headerDiv.style.display = 'flex';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.marginBottom = '8px';
        
        headerDiv.createEl('strong', { text: 'Indexing Status' });
        
        const refreshButton = headerDiv.createEl('button', { 
            cls: 'similar-notes-refresh-btn',
            text: 'Refresh' 
        });
        refreshButton.style.fontSize = '0.8em';
        refreshButton.style.padding = '2px 6px';
        refreshButton.addEventListener('click', () => {
            refreshButton.setText('Refreshing...');
            refreshButton.disabled = true;
            
            // Opóźnienie dla lepszego UX
            setTimeout(async () => {
                await this.updateDbStats();
                refreshButton.setText('Refresh');
                refreshButton.disabled = false;
            }, 300);
        });
        
        // Dodaję kontener dla statystyk
        const statsContent = this.dbInfoEl.createEl('div', { cls: 'stats-content' });
        statsContent.createEl('p', { text: 'Loading statistics...' });
        
        // Aktualizujemy statystyki
        this.updateDbStats();
        
        new Setting(containerEl)
            .setName('Update Modified Notes')
            .setDesc('Generate embeddings only for new or modified notes')
            .addButton(button => button
                .setButtonText('Update Now')
                .onClick(async () => {
                    await this.plugin.reindexAllNotes(false);
                    this.updateDbStats(); // Aktualizacja statystyk po indeksowaniu
                }));
                
        new Setting(containerEl)
            .setName('Force Reindex All Notes')
            .setDesc('Force regenerate embeddings for all notes (higher API usage)')
            .addButton(button => button
                .setButtonText('Reindex All')
                .onClick(() => {
                    new Notice('This will regenerate all embeddings and may incur API costs');
                    // Dodajemy krótkie opóźnienie, aby użytkownik miał szansę zobaczyć powiadomienie
                    setTimeout(async () => {
                        await this.plugin.reindexAllNotes(true);
                        this.updateDbStats(); // Aktualizacja statystyk po indeksowaniu
                    }, 1500);
                }));
                
        // Error Logs Section
        containerEl.createEl('h3', { text: 'Error Logs' });
        
        const errorLogsContainer = containerEl.createEl('div', { cls: 'similar-notes-error-logs' });
        
        // Add button to clear logs
        new Setting(errorLogsContainer)
            .setName('Error History')
            .setDesc(`${this.plugin.settings.errorLogs.length} errors logged. Use this to troubleshoot issues.`)
            .addButton(button => button
                .setButtonText('Clear Logs')
                .onClick(async () => {
                    this.plugin.settings.errorLogs = [];
                    await this.plugin.saveSettings();
                    this.display(); // Refresh display
                }));
                
        // If there are no logs, show a message
        if (this.plugin.settings.errorLogs.length === 0) {
            errorLogsContainer.createEl('p', { text: 'No errors logged. That\'s great!' });
        } else {
            // Create a container for the logs with max height and scrolling
            const logsEl = errorLogsContainer.createEl('div', { cls: 'similar-notes-logs-container' });
            logsEl.style.maxHeight = '300px';
            logsEl.style.overflow = 'auto';
            logsEl.style.border = '1px solid var(--background-modifier-border)';
            logsEl.style.borderRadius = '4px';
            logsEl.style.padding = '8px';
            logsEl.style.marginTop = '8px';
            
            // Add each log entry
            this.plugin.settings.errorLogs.forEach((log, index) => {
                const logEntryEl = logsEl.createEl('div', { cls: 'similar-notes-log-entry' });
                logEntryEl.style.marginBottom = '8px';
                logEntryEl.style.paddingBottom = '8px';
                
                if (index < this.plugin.settings.errorLogs.length - 1) {
                    logEntryEl.style.borderBottom = '1px solid var(--background-modifier-border)';
                }
                
                // Add timestamp
                const date = new Date(log.timestamp);
                const timeStr = date.toLocaleString();
                const timeEl = logEntryEl.createEl('div', { cls: 'similar-notes-log-time' });
                timeEl.style.fontSize = '0.8em';
                timeEl.style.color = 'var(--text-muted)';
                timeEl.style.marginBottom = '4px';
                timeEl.setText(timeStr);
                
                // Add message
                const messageEl = logEntryEl.createEl('div', { cls: 'similar-notes-log-message' });
                messageEl.style.fontWeight = 'bold';
                messageEl.style.marginBottom = '4px';
                messageEl.setText(log.message);
                
                // Add details if available
                if (log.details) {
                    const detailsToggleEl = logEntryEl.createEl('div', { cls: 'similar-notes-log-details-toggle' });
                    detailsToggleEl.style.fontSize = '0.9em';
                    detailsToggleEl.style.cursor = 'pointer';
                    detailsToggleEl.style.color = 'var(--text-accent)';
                    detailsToggleEl.setText('Show details');
                    
                    const detailsEl = logEntryEl.createEl('pre', { cls: 'similar-notes-log-details' });
                    detailsEl.style.display = 'none';
                    detailsEl.style.whiteSpace = 'pre-wrap';
                    detailsEl.style.fontSize = '0.8em';
                    detailsEl.style.backgroundColor = 'var(--background-secondary)';
                    detailsEl.style.padding = '4px';
                    detailsEl.style.borderRadius = '4px';
                    detailsEl.style.overflowX = 'auto';
                    detailsEl.setText(log.details);
                    
                    // Toggle details on click
                    detailsToggleEl.addEventListener('click', () => {
                        if (detailsEl.style.display === 'none') {
                            detailsEl.style.display = 'block';
                            detailsToggleEl.setText('Hide details');
                        } else {
                            detailsEl.style.display = 'none';
                            detailsToggleEl.setText('Show details');
                        }
                    });
                }
            });
        }
    }
} 