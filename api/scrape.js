export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  // Reddit extractor
function extractReddit(htmlContent) {
  try {
    const posts = [];
    
    // Reddit often loads content via JavaScript, so we look for any text in common containers
    const textBlocks = [];
    
    // Look for post titles and content in various possible selectors
    const patterns = [
      /<h3[^>]*>([^<]{20,})</gi,
      /<p[^>]*>([^<]{30,})</gi,
      /<div[^>]*data-testid="post-content"[^>]*>([^<]+)</gi,
      /<div[^>]*class="[^"]*text[^"]*"[^>]*>([^<]+)</gi
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(htmlContent)) !== null) {
        const text = cleanText(match[1]);
        if (text.length > 20 && !text.includes('Reddit') && !text.includes('comment')) {
          textBlocks.push(text);
        }
      }
    });
    
    if (textBlocks.length > 0) {
      return textBlocks.slice(0, 50).join('\n\n'); // Limit to 50 posts
    }
    
    // Fallback to generic extraction
    return extractGenericContent(htmlContent);
  } catch (error) {
    console.error('Reddit extraction failed:', error.message);
    return extractGenericContent(htmlContent);
  }
}

// NFL extractor
function extractNFL(htmlContent) {
  try {
    const content = [];
    
    // Look for article headlines and content
    const patterns = [
      /<h[1-4][^>]*>([^<]{10,})</gi,
      /<p[^>]*>([^<]{50,})</gi,
      /<div[^>]*class="[^"]*article[^"]*"[^>]*>([^<]+)</gi,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([^<]+)</gi
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(htmlContent)) !== null) {
        const text = cleanText(match[1]);
        if (text.length > 20 && !text.includes('NFL.com') && !text.includes('Subscribe')) {
          content.push(text);
        }
      }
    });
    
    if (content.length > 0) {
      return content.slice(0, 30).join('\n\n');
    }
    
    return extractGenericContent(htmlContent);
  } catch (error) {
    console.error('NFL extraction failed:', error.message);
    return extractGenericContent(htmlContent);
  }
}

// Twitter extractor
function extractTwitter(htmlContent) {
  try {
    const tweets = [];
    
    // Look for tweet content patterns
    const patterns = [
      /<div[^>]*data-testid="tweetText"[^>]*>([^<]+)</gi,
      /<span[^>]*>([^<]{20,280})</gi // Tweet-length spans
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(htmlContent)) !== null) {
        const text = cleanText(match[1]);
        if (text.length > 10 && text.length < 300 && !text.includes('Twitter') && !text.includes('Follow')) {
          tweets.push(text);
        }
      }
    });
    
    if (tweets.length > 0) {
      return tweets.slice(0, 50).join('\n\n');
    }
    
    return extractGenericContent(htmlContent);
  } catch (error) {
    console.error('Twitter extraction failed:', error.message);
    return extractGenericContent(htmlContent);
  }
}

// Medium extractor
function extractMedium(htmlContent) {
  try {
    const paragraphs = [];
    
    // Look for article content
    const patterns = [
      /<p[^>]*>([^<]{50,})</gi,
      /<h[1-6][^>]*>([^<]{10,})</gi
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(htmlContent)) !== null) {
        const text = cleanText(match[1]);
        if (text.length > 20 && !text.includes('Medium') && !text.includes('Follow')) {
          paragraphs.push(text);
        }
      }
    });
    
    if (paragraphs.length > 0) {
      return paragraphs.slice(0, 40).join('\n\n');
    }
    
    return extractGenericContent(htmlContent);
  } catch (error) {
    console.error('Medium extraction failed:', error.message);
    return extractGenericContent(htmlContent);
  }
}

// Wikipedia extractor
function extractWikipedia(htmlContent) {
  try {
    const paragraphs = [];
    
    // Extract main content paragraphs
    const paragraphRegex = /<p>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*)<\/p>/gi;
    
    let match;
    while ((match = paragraphRegex.exec(htmlContent)) !== null) {
      const text = cleanText(match[1]);
      if (text.length > 50 && 
          !text.includes('Coordinates:') && 
          !text.includes('Wikipedia') &&
          !text.includes('edit')) {
        paragraphs.push(text);
      }
    }
    
    if (paragraphs.length > 0) {
      return paragraphs.slice(0, 30).join('\n\n');
    }
    
    return extractGenericContent(htmlContent);
  } catch (error) {
    console.error('Wikipedia extraction failed:', error.message);
    return extractGenericContent(htmlContent);
  }
}

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { url, mode, batch } = req.query;

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
    console.log('Fetching:', url, 'Mode:', mode, 'Batch:', batch);

    // Check if this is a large file request
    const contentLength = await checkFileSize(url);
    const isLargeFile = contentLength > 1000000; // >1MB
    
    if (isLargeFile && !mode) {
      // Offer options for large files
      return res.status(200).json({
        success: true,
        isLargeFile: true,
        fileSize: contentLength,
        fileSizeMB: (contentLength / 1024 / 1024).toFixed(1),
        options: {
          sample: 'Get first 10,000 words',
          batch: 'Process in batches (experimental)'
        },
        message: 'Large file detected. Choose processing method.'
      });
    }

    let text;
    if (mode === 'batch' && isLargeFile) {
      text = await fetchBatch(url, parseInt(batch) || 0);
    } else if (mode === 'sample' && isLargeFile) {
      text = await fetchSample(url);
    } else {
      text = await fetchComplete(url);
    }

    let extractedText = '';
    const contentType = await getContentType(url);

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
      // HTML content - use intelligent extraction
      extractedText = intelligentExtraction(text, url);
    }

    // Truncate if still too long (except for samples which are already limited)
    if (mode !== 'sample' && extractedText.length > 100000) {
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
      batch: parseInt(batch) || 0
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

// Intelligent content extraction function
function intelligentExtraction(htmlContent, url) {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    
    // Site-specific extractors
    if (domain.includes('theunsentproject.com')) {
      return extractUnsentProject(htmlContent);
    }
    
    // Add more site-specific extractors as needed
    
    // Fall back to generic extraction
    return extractGenericContent(htmlContent);
  } catch (error) {
    console.error('Intelligent extraction failed, falling back to basic:', error.message);
    // Fallback to basic HTML text extraction
    return htmlContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// The Unsent Project extractor
function extractUnsentProject(htmlContent) {
  try {
    const messages = [];
    
    // Look for image alt text patterns
    const altTextRegex = /alt\s*=\s*["']([^"']+)["']/gi;
    let match;
    
    while ((match = altTextRegex.exec(htmlContent)) !== null) {
      const altText = match[1].trim();
      
      // Filter out non-message alt text
      if (altText && 
          !altText.toLowerCase().includes('logo') &&
          !altText.toLowerCase().includes('icon') &&
          !altText.toLowerCase().includes('image') &&
          !altText.toLowerCase().includes('photo') &&
          !altText.toLowerCase().includes('unsent project') &&
          altText.length > 10 && // Messages should be reasonably long
          altText.length < 500) { // But not too long
        messages.push(cleanText(altText));
      }
    }
    
    // Clean and deduplicate messages
    const cleanedMessages = messages
      .filter((msg, index, arr) => arr.indexOf(msg) === index) // Remove duplicates
      .filter(msg => msg.length > 5); // Final length filter
    
    if (cleanedMessages.length > 0) {
      return cleanedMessages.join('\n\n');
    }
    
    // If no messages found in alt text, fall back to generic extraction
    return extractGenericContent(htmlContent);
  } catch (error) {
    console.error('Unsent Project extraction failed:', error.message);
    return extractGenericContent(htmlContent);
  }
}

// Generic content extractor (simplified and more robust)
function extractGenericContent(htmlContent) {
  try {
    // Remove scripts, styles, and other non-content elements
    let cleanedHtml = htmlContent
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<!--[\s\S]*?-->/gi, '');

    // Extract text from paragraphs and headings
    const textBlocks = [];
    const paragraphRegex = /<(?:p|h[1-6])[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*)<\/(?:p|h[1-6])>/gi;
    
    let match;
    while ((match = paragraphRegex.exec(cleanedHtml)) !== null) {
      const text = cleanText(match[1]);
      if (text.length > 20) {
        textBlocks.push(text);
      }
    }
    
    if (textBlocks.length > 0) {
      return textBlocks.join('\n\n');
    }
    
    // Final fallback - strip all HTML
    return cleanText(cleanedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  } catch (error) {
    console.error('Generic extraction failed:', error.message);
    // Ultimate fallback
    return htmlContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// Helper function to clean text
function cleanText(text) {
  if (!text) return '';
  
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

// Helper function to get content type
async function getContentType(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.headers.get('content-type') || '';
  } catch (e) {
    return '';
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
}}