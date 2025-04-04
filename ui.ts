import { ItemView, WorkspaceLeaf, TFile, Workspace, Notice } from 'obsidian';
import type SimilarNotesPlugin from './main';

export const SIMILAR_NOTES_VIEW = 'similar-notes-view';

export class SimilarNotesView extends ItemView {
    plugin: SimilarNotesPlugin;
    contentElement: HTMLElement;
    currentPath: string | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SimilarNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return SIMILAR_NOTES_VIEW;
    }

    getDisplayText(): string {
        return 'Similar notes';
    }

    getIcon(): string {
        return 'file-text';
    }

    async onOpen() {
        const { containerEl } = this;
        containerEl.empty();

        const header = containerEl.createEl('h2', { text: 'Similar notes' });
        header.style.marginBottom = '8px';
        
        this.contentElement = containerEl.createDiv();
        this.contentElement.addClass('similar-notes-container');
        this.contentElement.style.marginTop = '0';
        
        // Dodanie stylów dla lepszego formatowania
        containerEl.style.padding = '10px 15px';

        // Nasłuchiwanie na zmiany aktywnej notatki
        this.registerEvent(
            this.app.workspace.on('file-open', (file: TFile | null) => {
                console.log('Event file-open:', file?.path);
                if (file && file.extension === 'md') {
                    this.currentPath = file.path;
                    this.updateSimilarNotes(file.path);
                } else {
                    this.currentPath = null;
                    this.contentElement.empty();
                    this.contentElement.createEl('p', { text: 'Open a note to see similar notes.' });
                }
            })
        );

        // Nasłuchiwanie na zmiany w notatkach
        this.registerEvent(
            this.app.vault.on('modify', (file: TFile) => {
                console.log('Event modify:', file.path, 'Current:', this.currentPath);
                if (file.extension === 'md' && this.app.workspace.getActiveFile()?.path === file.path) {
                    this.updateSimilarNotes(file.path);
                }
            })
        );

        // Dodatkowe nasłuchiwanie na zmiany aktywnego liścia
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const activeFile = this.app.workspace.getActiveFile();
                console.log('Event active-leaf-change:', activeFile?.path);
                if (activeFile && activeFile.extension === 'md' && this.currentPath !== activeFile.path) {
                    this.currentPath = activeFile.path;
                    this.updateSimilarNotes(activeFile.path);
                }
            })
        );

        // Inicjalne sprawdzenie aktywnej notatki
        const activeFile = this.app.workspace.getActiveFile();
        console.log('Initial active file:', activeFile?.path);
        if (activeFile && activeFile.extension === 'md') {
            this.currentPath = activeFile.path;
            this.updateSimilarNotes(activeFile.path);
        } else {
            this.contentElement.createEl('p', { text: 'Open a note to see similar notes.' });
        }
    }

    async updateSimilarNotes(notePath: string) {
        console.log('Updating similar notes for:', notePath);
        this.contentElement.empty();
        this.contentElement.createEl('p', { text: 'Searching for similar notes...' });
        
        try {
            const similarNotes = await this.plugin.dbManager.findSimilarNotes(
                notePath,
                this.plugin.settings.maxResults,
                this.plugin.settings.minSimilarity
            );

            console.log('Found similar notes:', similarNotes.length);
            this.contentElement.empty();

            if (similarNotes.length === 0) {
                this.contentElement.createEl('p', { text: 'No similar notes found.' });
                return;
            }

            const list = this.contentElement.createEl('ul');
            list.style.paddingLeft = '20px';
            for (const note of similarNotes) {
                const item = list.createEl('li');
                const link = item.createEl('a', {
                    text: note.title,
                    href: note.path
                });
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.app.workspace.openLinkText(note.path, '', false);
                });
                item.createEl('span', {
                    text: ` (${(note.similarity * 100).toFixed(1)}%)`
                });
            }
        } catch (error) {
            console.error('Error updating similar notes:', error);
            this.contentElement.empty();
            
            // Rejestrujemy błąd w logach
            this.plugin.logError('Error finding similar notes', error);
            
            // Lepsza prezentacja błędów dla użytkownika
            if (error instanceof Error && error.message.includes('API key')) {
                this.contentElement.createEl('p', { 
                    text: 'OpenAI API key not configured. Please add your API key in the plugin settings.' 
                });
            } else if (error instanceof Error && error.message.includes('rate limit')) {
                this.contentElement.createEl('p', { 
                    text: 'OpenAI API rate limit exceeded. Please try again later.' 
                });
            } else {
                this.contentElement.createEl('p', { 
                    text: 'Error loading similar notes: ' + (error instanceof Error ? error.message : String(error)) 
                });
            }
        }
    }
} 