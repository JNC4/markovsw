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

  // Set a timeout for the entire function
  const functionTimeout = setTimeout(() => {
    if (!res.headersSent) {
      return res.status(408).json({
        success: false,
        error: 'Function timeout - the request took too long to process'
      });
    }
  }, 25000); // 25 seconds (Vercel hobby limit is 30s)

  try {
    console.log(`Attempting to scrape: ${url}`);

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (urlError) {
      clearTimeout(functionTimeout);
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    // Check for potentially problematic URLs
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      clearTimeout(functionTimeout);
      return res.status(400).json({
        success: false,
        error: 'Only HTTP and HTTPS URLs are supported'
      });
    }

    // Fetch the content with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarkovTextBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: controller.signal,
        // Add size limit to prevent memory issues
        size: 5 * 1024 * 1024, // 5MB limit
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      clearTimeout(functionTimeout);
      
      let errorMessage = 'Failed to fetch the URL';
      if (fetchError.name === 'AbortError') {
        errorMessage = 'Request timed out';
      } else if (fetchError.code === 'ENOTFOUND') {
        errorMessage = 'Domain not found';
      } else if (fetchError.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused';
      } else if (fetchError.message) {
        errorMessage = fetchError.message;
      }
      
      return res.status(500).json({
        success: false,
        error: errorMessage
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      clearTimeout(functionTimeout);
      return res.status(response.status).json({
        success: false,
        error: `Server responded with ${response.status}: ${response.statusText}`
      });
    }

    const contentType = response.headers.get('content-type') || '';
    console.log('Content-Type:', contentType);
    console.log('Response status:', response.status);
    
    // Read content with size check
    let content;
    try {
      content = await response.text();
    } catch (readError) {
      clearTimeout(functionTimeout);
      return res.status(500).json({
        success: false,
        error: 'Failed to read response content'
      });
    }

    if (!content || content.length === 0) {
      clearTimeout(functionTimeout);
      return res.status(400).json({
        success: false,
        error: 'The URL returned empty content'
      });
    }

    console.log('Content length:', content.length);

    let extractedText = '';

    try {
      // Check if it's a plain text file (like Gutenberg .txt files)
      if (contentType.includes('text/plain') || url.endsWith('.txt')) {
        console.log('Processing as plain text file');
        extractedText = content
          .replace(/\r\n/g, '\n') // Normalize line endings
          .replace(/\n\s*\n\s*\n/g, '\n\n') // Clean up excessive line breaks
          .trim();
        
        // Remove common Project Gutenberg headers/footers
        if (url.includes('gutenberg.org')) {
          // Remove header (everything before "*** START OF" or similar)
          extractedText = extractedText.replace(/^[\s\S]*?\*\*\*\s*START\s+OF[\s\S]*?\*\*\*\n?/i, '');
          // Remove footer (everything after "*** END OF" or similar)
          extractedText = extractedText.replace(/\*\*\*\s*END\s+OF[\s\S]*$/i, '');
          console.log('After Gutenberg cleanup:', extractedText.length, 'characters');
        }
      } else {
        // Process as HTML with error handling
        console.log('Processing as HTML');
        
        let $;
        try {
          $ = cheerio.load(content);
        } catch (cheerioError) {
          // Fallback to plain text if HTML parsing fails
          extractedText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        if ($) {
          if (url.includes('theunsentproject.com')) {
            $('.post-content, .entry-content, .post, .message').each((i, el) => {
              extractedText += $(el).text().trim() + '\n\n';
            });
          } else if (url.includes('gutenberg.org') && !url.endsWith('.txt')) {
            $('.chapter, .poem, p').each((i, el) => {
              const text = $(el).text().trim();
              if (text.length > 20) {
                extractedText += text + '\n\n';
              }
            });
          } else if (url.includes('reddit.com')) {
            $('.usertext-body, [data-testid="comment"], .md').each((i, el) => {
              extractedText += $(el).text().trim() + '\n\n';
            });
          } else if (url.includes('twitter.com') || url.includes('x.com')) {
            $('[data-testid="tweetText"], .tweet-text').each((i, el) => {
              extractedText += $(el).text().trim() + '\n\n';
            });
          } else {
            // Generic scraping
            const contentSelectors = [
              'article',
              '.post-content',
              '.entry-content', 
              '.content',
              'main p',
              '.post',
              '.message',
              'p'
            ];

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

            // Fallback: get all text
            if (!extractedText.trim()) {
              $('script, style, nav, header, footer, .ad, .advertisement').remove();
              extractedText = $('body').text().replace(/\s+/g, ' ').trim();
            }
          }
        }
      }
    } catch (processingError) {
      clearTimeout(functionTimeout);
      return res.status(500).json({
        success: false,
        error: 'Error processing content: ' + processingError.message
      });
    }

    // Clean up the extracted text
    try {
      extractedText = extractedText
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/\n\s*\n/g, '\n\n') // Clean up paragraph breaks
        .trim();
    } catch (cleanupError) {
      // If cleanup fails, use the raw extracted text
      console.warn('Text cleanup failed:', cleanupError);
    }

    if (!extractedText || extractedText.length < 50) {
      clearTimeout(functionTimeout);
      return res.status(400).json({ 
        success: false, 
        error: 'Could not extract meaningful text from the URL. The site may be protected or have dynamic content.' 
      });
    }

    console.log(`Successfully extracted ${extractedText.length} characters`);

    clearTimeout(functionTimeout);
    return res.status(200).json({
      success: true,
      text: extractedText,
      wordCount: extractedText.split(/\s+/).filter(word => word.length > 0).length,
      url: url
    });

  } catch (error) {
    clearTimeout(functionTimeout);
    console.error('Scraping error:', error);
    
    // Ensure we don't send response twice
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'An unexpected error occurred while processing the request',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}