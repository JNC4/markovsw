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

    let htmlContent;
    if (mode === 'batch' && isLargeFile) {
      htmlContent = await fetchBatch(url, parseInt(batch) || 0);
    } else if (mode === 'sample' && isLargeFile) {
      htmlContent = await fetchSample(url);
    } else {
      htmlContent = await fetchComplete(url);
    }

    let extractedText = '';
    const contentType = await getContentType(url);

    // Check if it's plain text
    if (contentType.includes('text/plain') || url.endsWith('.txt')) {
      // Plain text processing
      extractedText = htmlContent
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
      extractedText = await intelligentExtraction(htmlContent, url);
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
async function intelligentExtraction(htmlContent, url) {
  const domain = new URL(url).hostname.toLowerCase();
  
  // Site-specific extractors
  if (domain.includes('theunsentproject.com')) {
    return extractUnsentProject(htmlContent);
  } else if (domain.includes('reddit.com')) {
    return extractReddit(htmlContent);
  } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
    return extractTwitter(htmlContent);
  } else if (domain.includes('medium.com')) {
    return extractMedium(htmlContent);
  } else if (domain.includes('substack.com')) {
    return extractSubstack(htmlContent);
  } else if (domain.includes('news.ycombinator.com')) {
    return extractHackerNews(htmlContent);
  } else if (domain.includes('stackoverflow.com')) {
    return extractStackOverflow(htmlContent);
  } else if (domain.includes('wikipedia.org')) {
    return extractWikipedia(htmlContent);
  } else if (domain.includes('github.com')) {
    return extractGitHub(htmlContent);
  } else {
    // Generic content extraction
    return extractGenericContent(htmlContent);
  }
}

// The Unsent Project extractor
function extractUnsentProject(htmlContent) {
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
        altText.length > 10 && // Messages should be reasonably long
        altText.length < 500) { // But not too long
      messages.push(altText);
    }
  }
  
  // Also look for any text content in message containers
  const messageContainerRegex = /<div[^>]*class[^>]*message[^>]*>([^<]+)</gi;
  while ((match = messageContainerRegex.exec(htmlContent)) !== null) {
    const messageText = match[1].trim();
    if (messageText && messageText.length > 10) {
      messages.push(messageText);
    }
  }
  
  // Clean and deduplicate messages
  const cleanedMessages = messages
    .map(msg => msg.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    .filter((msg, index, arr) => arr.indexOf(msg) === index) // Remove duplicates
    .filter(msg => msg.length > 5); // Final length filter
  
  return cleanedMessages.join('\n\n');
}

// Reddit extractor
function extractReddit(htmlContent) {
  const posts = [];
  
  // Extract post titles and content
  const titleRegex = /<h3[^>]*>([^<]+)</gi;
  const contentRegex = /<div[^>]*data-testid="comment"[^>]*>[\s\S]*?<div[^>]*>([^<]+)</gi;
  
  let match;
  while ((match = titleRegex.exec(htmlContent)) !== null) {
    posts.push(cleanText(match[1]));
  }
  
  while ((match = contentRegex.exec(htmlContent)) !== null) {
    posts.push(cleanText(match[1]));
  }
  
  return posts.join('\n\n');
}

// Twitter/X extractor
function extractTwitter(htmlContent) {
  const tweets = [];
  
  // Look for tweet content in various possible structures
  const tweetRegex = /<div[^>]*data-testid="tweetText"[^>]*>([^<]+)</gi;
  const tweetRegex2 = /<span[^>]*>([^<]{20,280})</gi; // Tweet-length spans
  
  let match;
  while ((match = tweetRegex.exec(htmlContent)) !== null) {
    tweets.push(cleanText(match[1]));
  }
  
  return tweets.join('\n\n');
}

// Medium extractor
function extractMedium(htmlContent) {
  // Extract article content
  const paragraphs = [];
  const paragraphRegex = /<p[^>]*>([^<]+)</gi;
  const headerRegex = /<h[1-6][^>]*>([^<]+)</g;
  
  let match;
  while ((match = paragraphRegex.exec(htmlContent)) !== null) {
    const text = cleanText(match[1]);
    if (text.length > 20) {
      paragraphs.push(text);
    }
  }
  
  while ((match = headerRegex.exec(htmlContent)) !== null) {
    paragraphs.push(cleanText(match[1]));
  }
  
  return paragraphs.join('\n\n');
}

// Substack extractor
function extractSubstack(htmlContent) {
  return extractMedium(htmlContent); // Similar structure
}

// Hacker News extractor
function extractHackerNews(htmlContent) {
  const items = [];
  
  // Extract story titles and comments
  const titleRegex = /<a[^>]*class="storylink"[^>]*>([^<]+)</gi;
  const commentRegex = /<div[^>]*class="comment"[^>]*>[\s\S]*?<span[^>]*>([^<]+)</gi;
  
  let match;
  while ((match = titleRegex.exec(htmlContent)) !== null) {
    items.push(cleanText(match[1]));
  }
  
  while ((match = commentRegex.exec(htmlContent)) !== null) {
    const text = cleanText(match[1]);
    if (text.length > 20) {
      items.push(text);
    }
  }
  
  return items.join('\n\n');
}

// Stack Overflow extractor
function extractStackOverflow(htmlContent) {
  const content = [];
  
  // Extract questions and answers
  const questionRegex = /<div[^>]*class="s-prose"[^>]*>([\s\S]*?)</div>/gi;
  const codeBlockRegex = /<pre[^>]*><code[^>]*>([^<]+)</gi;
  
  let match;
  while ((match = questionRegex.exec(htmlContent)) !== null) {
    const text = cleanText(match[1]);
    if (text.length > 20) {
      content.push(text);
    }
  }
  
  return content.join('\n\n');
}

// Wikipedia extractor
function extractWikipedia(htmlContent) {
  const paragraphs = [];
  
  // Extract main content paragraphs
  const paragraphRegex = /<p>([^<]+(?:<[^>]+>[^<]*</[^>]+>[^<]*)*)</p>/gi;
  
  let match;
  while ((match = paragraphRegex.exec(htmlContent)) !== null) {
    const text = cleanText(match[1]);
    if (text.length > 50 && !text.includes('Coordinates:')) {
      paragraphs.push(text);
    }
  }
  
  return paragraphs.join('\n\n');
}

// GitHub extractor
function extractGitHub(htmlContent) {
  const content = [];
  
  // Extract README content, issue descriptions, etc.
  const readmeRegex = /<div[^>]*class="markdown-body"[^>]*>([\s\S]*?)</div>/gi;
  const issueRegex = /<div[^>]*class="comment-body"[^>]*>([\s\S]*?)</div>/gi;
  
  let match;
  while ((match = readmeRegex.exec(htmlContent)) !== null) {
    const text = cleanText(match[1]);
    if (text.length > 20) {
      content.push(text);
    }
  }
  
  return content.join('\n\n');
}

// Generic content extractor
function extractGenericContent(htmlContent) {
  // Remove scripts, styles, and other non-content elements
  let cleanedHtml = htmlContent
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/gi, '');

  // Extract text from common content containers
  const contentRegex = /<(?:main|article|section|div)[^>]*(?:class="[^"]*(?:content|post|article|entry)[^"]*"[^>]*|id="[^"]*(?:content|post|article|entry)[^"]*"[^>]*|>)[\s\S]*?<\/(?:main|article|section|div)>/gi;
  
  let extractedContent = '';
  let match;
  
  while ((match = contentRegex.exec(cleanedHtml)) !== null) {
    extractedContent += match[0] + ' ';
  }
  
  // If no specific content containers found, extract from paragraphs and headings
  if (extractedContent.length < 100) {
    const paragraphRegex = /<(?:p|h[1-6])[^>]*>([^<]+(?:<[^>]+>[^<]*</[^>]+>[^<]*)*)</(?:p|h[1-6])>/gi;
    const paragraphs = [];
    
    while ((match = paragraphRegex.exec(cleanedHtml)) !== null) {
      const text = cleanText(match[1]);
      if (text.length > 20) {
        paragraphs.push(text);
      }
    }
    
    extractedContent = paragraphs.join('\n\n');
  } else {
    // Clean the extracted content
    extractedContent = extractedContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  return cleanText(extractedContent);
}

// Helper function to clean text
function cleanText(text) {
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
}