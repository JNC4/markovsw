import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Add CORS headers to all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL parameter is required' });
  }

  try {
    console.log(`Attempting to scrape: ${url}`);

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (urlError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    // Fetch with size and timeout limits
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarkovTextBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      let errorMessage = 'Failed to fetch the URL';
      if (fetchError.name === 'AbortError') {
        errorMessage = 'Request timed out after 15 seconds';
      }
      return res.status(500).json({ success: false, error: errorMessage });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Server responded with ${response.status}: ${response.statusText}`
      });
    }

    // Check content length before downloading
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const sizeInMB = parseInt(contentLength) / (1024 * 1024);
      if (sizeInMB > 2) {
        return res.status(413).json({
          success: false,
          error: `File too large (${sizeInMB.toFixed(1)}MB). Maximum size is 2MB. Try downloading the file and uploading it instead.`
        });
      }
    }

    const contentType = response.headers.get('content-type') || '';
    console.log('Content-Type:', contentType);
    
    // Read content with manual size checking
    let content = '';
    let totalSize = 0;
    const maxSize = 2 * 1024 * 1024; // 2MB limit
    
    try {
      // For text files, we can process them more efficiently
      if (contentType.includes('text/plain') || url.endsWith('.txt')) {
        const reader = response.body;
        const decoder = new TextDecoder();
        
        for await (const chunk of reader) {
          totalSize += chunk.length;
          if (totalSize > maxSize) {
            return res.status(413).json({
              success: false,
              error: 'File too large (>2MB). Try downloading the file and uploading it instead.'
            });
          }
          content += decoder.decode(chunk, { stream: true });
        }
        content += decoder.decode(); // Final decode
      } else {
        // For HTML, read normally but with size check
        content = await response.text();
        if (content.length > maxSize) {
          return res.status(413).json({
            success: false,
            error: 'Content too large. Try a smaller page or download and upload the file instead.'
          });
        }
      }
    } catch (readError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to read content: ' + readError.message
      });
    }

    if (!content || content.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'The URL returned empty content'
      });
    }

    console.log('Content length:', content.length);

    let extractedText = '';

    // Process based on content type
    if (contentType.includes('text/plain') || url.endsWith('.txt')) {
      console.log('Processing as plain text file');
      
      // Process in chunks to avoid memory issues
      const chunkSize = 100000; // 100KB chunks
      let processedContent = '';
      
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        processedContent += chunk
          .replace(/\r\n/g, '\n')
          .replace(/\n\s*\n\s*\n/g, '\n\n');
      }
      
      extractedText = processedContent.trim();
      
      // Clean up Project Gutenberg files
      if (url.includes('gutenberg.org')) {
        // Remove header (everything before "*** START OF" or similar)
        extractedText = extractedText.replace(/^[\s\S]*?\*\*\*\s*START\s+OF[\s\S]*?\*\*\*\n?/i, '');
        // Remove footer (everything after "*** END OF" or similar)
        extractedText = extractedText.replace(/\*\*\*\s*END\s+OF[\s\S]*$/i, '');
        console.log('After Gutenberg cleanup:', extractedText.length, 'characters');
      }
      
      // If still too long, truncate to first 100,000 characters
      if (extractedText.length > 100000) {
        extractedText = extractedText.substring(0, 100000) + '\n\n[Text truncated to first 100,000 characters for processing efficiency]';
      }
      
    } else {
      // HTML processing (unchanged but with size limits)
      console.log('Processing as HTML');
      
      let $;
      try {
        $ = cheerio.load(content);
      } catch (cheerioError) {
        extractedText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }

      if ($) {
        // Same HTML processing logic as before...
        if (url.includes('theunsentproject.com')) {
          $('.post-content, .entry-content, .post, .message').each((i, el) => {
            extractedText += $(el).text().trim() + '\n\n';
          });
        } else {
          // Generic scraping
          const contentSelectors = ['article', '.post-content', '.entry-content', '.content', 'main p', 'p'];
          
          for (const selector of contentSelectors) {
            const elements = $(selector);
            if (elements.length > 0) {
              elements.each((i, el) => {
                const text = $(el).text().trim();
                if (text.length > 30) {
                  extractedText += text + '\n\n';
                }
              });
              break;
            }
          }

          if (!extractedText.trim()) {
            $('script, style, nav, header, footer').remove();
            extractedText = $('body').text().replace(/\s+/g, ' ').trim();
          }
        }
      }
    }

    // Final cleanup with chunked processing for large texts
    if (extractedText.length > 50000) {
      const chunkSize = 10000;
      let cleanedText = '';
      
      for (let i = 0; i < extractedText.length; i += chunkSize) {
        const chunk = extractedText.slice(i, i + chunkSize);
        cleanedText += chunk
          .replace(/\s+/g, ' ')
          .replace(/\n\s*\n/g, '\n\n');
      }
      extractedText = cleanedText.trim();
    } else {
      extractedText = extractedText
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
    }

    if (!extractedText || extractedText.length < 50) {
      return res.status(400).json({ 
        success: false, 
        error: 'Could not extract meaningful text from the URL.' 
      });
    }

    console.log(`Successfully extracted ${extractedText.length} characters`);

    return res.status(200).json({
      success: true,
      text: extractedText,
      wordCount: extractedText.split(/\s+/).filter(word => word.length > 0).length,
      url: url,
      truncated: extractedText.includes('[Text truncated')
    });

  } catch (error) {
    console.error('Scraping error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred: ' + error.message
    });
  }
}