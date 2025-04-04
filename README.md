# Similar Notes Plugin for Obsidian

Similar Notes is an Obsidian plugin that uses OpenAI's embedding technology to find semantically similar notes in your vault. Unlike traditional search that relies on keywords, this plugin understands the meaning and context of your notes, helping you discover connections you might otherwise miss.

![Screenshot of Similar Notes Plugin](similar-notes.png)

## Features

- Semantic similarity search using OpenAI's text embedding models
- Automatic indexing of your notes
- Real-time updates as you edit notes
- Configurable similarity threshold and result count
- Simple and intuitive interface

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins and turn off Restricted Mode
3. Click Browse and search for "Similar Notes"
4. Install the plugin and enable it

### Manual Installation

1. Download the latest release from this repository
2. Extract the zip file into your Obsidian vault's `.obsidian/plugins/` directory
3. Restart Obsidian
4. Enable the plugin in the Community Plugins settings

## Usage

1. Configure your OpenAI API key in the plugin settings
2. Open a note in your vault
3. Open the Similar Notes view using the command palette or the sidebar icon
4. The plugin will automatically show notes similar to your current note
5. Click on any note in the list to open it

## Configuration

- **OpenAI API Key**: Required for generating embeddings. [Get your API key here](https://platform.openai.com/account/api-keys)
- **Maximum Results**: Number of similar notes to display (default: 5)
- **Minimum Similarity**: Threshold for showing notes (0-1, default: 0.75)

## Privacy Policy

This plugin uses OpenAI's API to generate embeddings for your notes. Here's what you need to know about data handling:

1. **Data Sent to OpenAI**:
   - Only the content of notes you choose to index is sent to OpenAI
   - The content is sent only when generating embeddings
   - No metadata or file names are sent

2. **Data Storage**:
   - Embeddings are stored locally in your vault
   - No data is shared with any third party other than OpenAI
   - You can delete embeddings at any time

3. **API Key**:
   - Your OpenAI API key is stored locally in your vault
   - It is never shared with anyone
   - You can revoke it at any time from OpenAI's dashboard

4. **Data Deletion**:
   - You can delete all embeddings through the plugin settings
   - Deleting embeddings removes all locally stored data
   - No data is retained after deletion

## Development

This plugin is open source and contributions are welcome. To set up the development environment:

```bash
# Clone the repository
git clone https://github.com/yourusername/obsidian-similar-notes.git

# Install dependencies
cd obsidian-similar-notes
npm install

# Build the plugin
npm run build
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- Thanks to the Obsidian team for creating such a flexible platform
- OpenAI for providing the embedding technology

## Contributing

Contributions are welcome! Here's how you can help:

1. **Reporting Issues**:
   - Check if the issue already exists
   - Provide detailed information about the problem
   - Include steps to reproduce

2. **Feature Requests**:
   - Describe the feature you'd like to see
   - Explain why it would be useful
   - Provide examples if possible

3. **Pull Requests**:
   - Fork the repository
   - Create a new branch for your feature
   - Follow the existing code style
   - Add tests if applicable
   - Update documentation

4. **Code Style**:
   - Use TypeScript
   - Follow Obsidian's plugin development guidelines
   - Add comments for complex logic
   - Keep the code clean and maintainable 