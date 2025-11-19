// DeepSeeker Background Service Worker
// Handles communication with localhost DeepSeeker instance

const DEEPSEEKER_PORT = 3737; // Default port for DeepSeeker API
const API_BASE = `http://localhost:${DEEPSEEKER_PORT}`;

// Configuration stored in Chrome storage
let config = {
  port: DEEPSEEKER_PORT,
  collectionId: null,
  enabled: true
};

// Load config on startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['config'], (result) => {
    if (result.config) {
      config = { ...config, ...result.config };
    }
    console.log('DeepSeeker Clipper installed, config:', config);
  });

  // Create context menu
  chrome.contextMenus.create({
    id: 'clip-to-deepseeker',
    title: 'Clip to DeepSeeker',
    contexts: ['selection']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'clip-to-deepseeker') {
    handleClipRequest(tab);
  }
});

// Handle extension icon clicks
chrome.action.onClicked.addListener((tab) => {
  handleClipRequest(tab);
});

/**
 * Handle clip request from user
 */
async function handleClipRequest(tab) {
  try {
    // Get selection from content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getSelection'
    });

    if (!response.success) {
      showNotification('No Selection', response.error || 'Please select text first');
      return;
    }

    // Send to DeepSeeker
    await sendToDeepSeeker(response.data);

  } catch (error) {
    console.error('Clip error:', error);
    showNotification('Clip Failed', error.message);
  }
}

/**
 * Send captured content to DeepSeeker localhost API
 */
async function sendToDeepSeeker(data) {
  const endpoint = `${API_BASE}/api/clip`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: data.url,
        title: data.title,
        content: data.selection,
        context: data.context,
        collection_id: config.collectionId,
        timestamp: data.timestamp,
        source: 'browser-extension'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    showNotification(
      '✓ Clipped to DeepSeeker',
      `"${data.title}" added to your collection`
    );

    console.log('Clip successful:', result);

  } catch (error) {
    // Check if DeepSeeker is running
    if (error.message.includes('Failed to fetch')) {
      showNotification(
        'DeepSeeker Not Running',
        'Please start DeepSeeker desktop app first'
      );
    } else {
      throw error;
    }
  }
}

/**
 * Show browser notification
 */
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon48.png',
    title: title,
    message: message,
    priority: 1
  });
}

/**
 * Check if DeepSeeker is running
 */
async function checkDeepSeekerStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Periodic health check (every 30 seconds)
setInterval(async () => {
  const isRunning = await checkDeepSeekerStatus();
  chrome.action.setIcon({
    path: isRunning ? 'icon48.png' : 'icon48-disabled.png'
  });
}, 30000);
