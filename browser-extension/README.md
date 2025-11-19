# DeepSeeker Browser Extension - "The Pipe"

A minimalist Chrome extension for capturing web content and sending it to your local DeepSeeker instance.

## Features

- **Text Selection Capture**: Select any text on a webpage and clip it to DeepSeeker
- **Context Preservation**: Automatically captures surrounding paragraph for better context
- **Zero Auth**: No login, no cloud, just local loopback communication
- **Instant Indexing**: Clipped content is immediately searchable in DeepSeeker

## Installation

### Development Mode

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `browser-extension` folder

### Usage

1. Make sure DeepSeeker desktop app is running (HTTP server on port 3737)
2. Select text on any webpage
3. Right-click and select "Clip to DeepSeeker"
   - OR click the DeepSeeker extension icon in toolbar
4. Content is saved to your local DeepSeeker collection

## Architecture

```
┌─────────────────┐
│   Web Page      │
│  (Selection)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Content Script  │ ← Captures window.getSelection()
│  (content.js)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Background SW   │ ← HTTP POST to localhost:3737
│ (background.js) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ DeepSeeker App  │ ← Stores in SQLite + FTS5
│  (localhost)    │
└─────────────────┘
```

## API Endpoint

**POST** `http://localhost:3737/api/clip`

```json
{
  "url": "https://example.com/page",
  "title": "Page Title",
  "content": "Selected text content",
  "context": "Surrounding paragraph for context",
  "collection_id": 1,
  "timestamp": "2025-01-15T10:30:00Z",
  "source": "browser-extension"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Content clipped successfully",
  "document_id": 42
}
```

## Configuration

The extension stores minimal config in Chrome storage:
- `port`: DeepSeeker API port (default: 3737)
- `collectionId`: Target collection ID (default: null → uses collection 1)
- `enabled`: Extension enabled/disabled

## Privacy

- **100% Local**: All data stays on your machine
- **No Tracking**: Zero analytics or telemetry
- **No Cloud**: No external servers involved
- **No Auth**: No accounts or tokens needed

## Troubleshooting

### "DeepSeeker Not Running" error
- Ensure DeepSeeker desktop app is open
- Check that HTTP server started (look for "HTTP server listening on 127.0.0.1:3737" in logs)

### No text captured
- Make sure you've selected text before clicking the extension
- Try selecting at least 10+ characters

### Icon not changing status
- The icon updates every 30 seconds to reflect DeepSeeker connection status
- Green icon = connected, Gray icon = disconnected

## Development

### File Structure
```
browser-extension/
├── manifest.json      # Extension config (MV3)
├── content.js        # Text selection capture
├── background.js     # API communication
├── icon16.png        # Toolbar icon (16x16)
├── icon48.png        # Extension icon (48x48)
└── icon128.png       # Store icon (128x128)
```

### Future Enhancements
- [ ] Visual feedback on text selection
- [ ] Configurable keyboard shortcuts
- [ ] Batch clip multiple selections
- [ ] Image capture support
- [ ] PDF annotation capture
- [ ] Collection selector popup

## License

Proprietary - Part of DeepSeeker project
