// DeepSeeker Content Script - Text Selection Capture
// Minimalist design: No auth, just capture and send

console.log('DeepSeeker Clipper: Content script loaded');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelection') {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (!selectedText) {
      sendResponse({
        success: false,
        error: 'No text selected'
      });
      return;
    }

    // Get page metadata
    const pageMetadata = {
      url: window.location.href,
      title: document.title,
      selection: selectedText,
      timestamp: new Date().toISOString(),
      // Extract surrounding context (optional)
      context: extractContext(selection)
    };

    sendResponse({
      success: true,
      data: pageMetadata
    });
  }

  return true; // Keep message channel open for async response
});

/**
 * Extract surrounding context from the selection
 * Returns the paragraph or container element text
 */
function extractContext(selection) {
  if (!selection.rangeCount) return '';

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // Find the nearest block-level parent
  let parent = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : container;

  while (parent && !isBlockElement(parent) && parent !== document.body) {
    parent = parent.parentElement;
  }

  return parent ? parent.textContent.trim().substring(0, 1000) : '';
}

/**
 * Check if element is a block-level element
 */
function isBlockElement(element) {
  const blockElements = [
    'P', 'DIV', 'ARTICLE', 'SECTION', 'HEADER', 'FOOTER',
    'MAIN', 'ASIDE', 'NAV', 'BLOCKQUOTE', 'PRE', 'LI'
  ];
  return blockElements.includes(element.tagName);
}

// Optional: Add visual feedback when text is selected
document.addEventListener('mouseup', () => {
  const selection = window.getSelection().toString().trim();
  if (selection.length > 10) {
    // Show a subtle indicator that text can be clipped
    // (Implement UI feedback here if desired)
  }
});
