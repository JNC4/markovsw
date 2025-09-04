export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL parameter is required' });
  }

  try {
    // Simple URL validation
    new URL(url);
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Invalid URL' });
  }

  try {
    console.log('Fetching:', url);

    // Simple fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TextBot/1.0)'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Check if content is too large
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1000000) { // 1MB limit
      return res.status(413).json({
        success: false,
        error: 'File too large (>1MB). Please download and upload the file instead.'
      });
    }

    const text = await response.text();
    
    if (text.length > 500000) { // 500KB text limit
      return res.status(413).json({
        success: false,
        error: 'Content too large. Please try a smaller file or download and upload instead.'
      });
    }

    let extractedText = '';
    const contentType = response.headers.get('content-type') || '';

    // Simple text extraction
    if (contentType.includes('text/plain') || url.endsWith('.txt')) {
      // Plain text processing
      extractedText = text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Simple Gutenberg cleanup
      if (url.includes('gutenberg.org')) {
        const startMatch = extractedText.match(/\*\*\* START OF .* \*\*\*/i);
        const endMatch = extractedText.match(/\*\*\* END OF .* \*\*\*/i);
        
        if (startMatch) {
          const startIndex = extractedText.indexOf(startMatch[0]) + startMatch[0].length;
          extractedText = extractedText.substring(startIndex);
        }
        
        if (endMatch) {
          const endIndex = extractedText.indexOf(endMatch[0]);
          if (endIndex > 0) {
            extractedText = extractedText.substring(0, endIndex);
          }
        }
      }
    } else {
      // Very basic HTML text extraction without cheerio
      extractedText = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Truncate if still too long
    if (extractedText.length > 100000) {
      extractedText = extractedText.substring(0, 100000) + '\n\n[Truncated for processing]';
    }

    if (extractedText.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Could not extract meaningful text from this URL'
      });
    }

    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    console.log(`Success: ${extractedText.length} chars, ${wordCount} words`);

    return res.status(200).json({
      success: true,
      text: extractedText,
      wordCount: wordCount,
      url: url,
      mode: mode || 'complete',
      batch: batch || 0
    });

  } catch (error) {
    console.error('Error:', error.message);
    
    let errorMessage = 'Failed to scrape URL';
    if (error.name === 'AbortError') {
      errorMessage = 'Request timed out';
    } else if (error.message.includes('fetch')) {
      errorMessage = 'Could not connect to URL';
    }

    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}

// Helper function to check file size
async function checkFileSize(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const contentLength = response.headers.get('content-length');
    return contentLength ? parseInt(contentLength) : 0;
  } catch (e) {
    return 0;
  }
}

// Fetch complete file (for smaller files)
async function fetchComplete(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TextBot/1.0)' }
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  
  if (text.length > 500000) {
    throw new Error('File too large for complete processing');
  }

  return text;
}

// Fetch a sample from the beginning (first ~10,000 words)
async function fetchSample(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: { 
      'User-Agent': 'Mozilla/5.0 (compatible; TextBot/1.0)',
      'Range': 'bytes=0-200000' // First 200KB
    }
  });

  clearTimeout(timeout);

  if (!response.ok && response.status !== 206) {
    // If range request fails, try regular fetch with early termination
    return await fetchWithEarlyStop(url);
  }

  return await response.text();
}

// Fetch with early termination when we have enough words
async function fetchWithEarlyStop(url) {
  const response = await fetch(url);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let text = '';
  let wordCount = 0;
  const targetWords = 15000; // Get a bit more than 10k to account for cleanup

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      text += chunk;
      
      // Count words periodically
      if (text.length % 10000 === 0) {
        wordCount = text.split(/\s+/).length;
        if (wordCount > targetWords) {
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return text;
}

// Batch processing (experimental)
async function fetchBatch(url, batchNumber) {
  const batchSize = 150000; // 150KB per batch
  const start = batchNumber * batchSize;
  const end = start + batchSize - 1;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: { 
      'User-Agent': 'Mozilla/5.0 (compatible; TextBot/1.0)',
      'Range': `bytes=${start}-${end}`
    }
  });

  clearTimeout(timeout);

  if (!response.ok && response.status !== 206) {
    throw new Error(`Batch fetch failed: ${response.status}`);
  }

  return await response.text();
}